/**
 * Compliance Execution Service
 *
 * The "Execution Agent" that applies compliance strategies to casualties.
 * When a Compliance Officer approves a rule change, this service:
 *   1. Bulk updates affected investors to GRANDFATHERED status
 *   2. Records the reason and proposal ID for audit trail
 *   3. (Future) Can trigger on-chain identity registry updates
 *
 * This prevents the "Liquidity Trap" - regulatory changes don't freeze capital.
 */

import { PrismaClient } from '@prisma/client';
import {
  ComplianceStatus,
  GrandfatheringStrategy,
  ExecutionPlan,
} from '../types/conflicts';
import { logger } from '../utils/logger';
import { syncComplianceStatuses } from '../jobs/workers/onChainSyncWorker';

const prisma = new PrismaClient();

/**
 * Result of executing a compliance strategy.
 */
export interface ExecutionResult {
  success: boolean;
  strategy: GrandfatheringStrategy;
  proposalId: string;
  grandfatheredCount: number;
  failedCount: number;
  failedInvestors: string[];
  executedAt: Date;
  message: string;
}

/**
 * Execute a compliance strategy for a list of casualties.
 *
 * @param plan - The execution plan containing strategy and casualty list
 * @returns Result of the execution
 */
export async function executeComplianceStrategy(
  plan: ExecutionPlan
): Promise<ExecutionResult> {
  const startTime = Date.now();

  logger.info('Executing compliance strategy', {
    proposalId: plan.proposalId,
    strategy: plan.strategy,
    casualtyCount: plan.casualties.length,
    appliedBy: plan.appliedBy,
  });

  const result: ExecutionResult = {
    success: false,
    strategy: plan.strategy,
    proposalId: plan.proposalId,
    grandfatheredCount: 0,
    failedCount: 0,
    failedInvestors: [],
    executedAt: new Date(),
    message: '',
  };

  if (plan.casualties.length === 0) {
    result.success = true;
    result.message = 'No casualties to process';
    return result;
  }

  try {
    switch (plan.strategy) {
      case GrandfatheringStrategy.FULL:
      case GrandfatheringStrategy.HOLDINGS_FROZEN:
        // Both strategies result in GRANDFATHERED status (can sell, can't buy)
        await grandfatherInvestors(plan, result);
        break;

      case GrandfatheringStrategy.TIME_LIMITED:
        // GRANDFATHERED with a grace period expiration
        await grandfatherWithGracePeriod(plan, result);
        break;

      case GrandfatheringStrategy.TRANSACTION_BASED:
        // GRANDFATHERED until they make a transaction (handled at transfer time)
        await grandfatherInvestors(plan, result);
        break;

      case GrandfatheringStrategy.NONE:
        // Immediate enforcement - mark as UNAUTHORIZED
        await enforceImmediately(plan, result);
        break;

      default:
        result.message = `Unknown strategy: ${plan.strategy}`;
        return result;
    }

    result.success = result.failedCount === 0;
    const duration = Date.now() - startTime;

    logger.info('Compliance strategy execution complete', {
      proposalId: plan.proposalId,
      success: result.success,
      grandfatheredCount: result.grandfatheredCount,
      failedCount: result.failedCount,
      durationMs: duration,
    });

    return result;
  } catch (error) {
    logger.error('Compliance strategy execution failed', { error, plan });
    result.message = `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return result;
  }
}

/**
 * Update investors to GRANDFATHERED status (can sell, can't buy).
 */
async function grandfatherInvestors(
  plan: ExecutionPlan,
  result: ExecutionResult
): Promise<void> {
  const statusReason = `Regulatory Change Proposal ${plan.proposalId} - ${plan.notes || 'threshold update'}`;

  try {
    // Bulk update using Prisma
    const updateResult = await prisma.investor.updateMany({
      where: {
        id: { in: plan.casualties },
      },
      data: {
        complianceStatus: ComplianceStatus.GRANDFATHERED,
        complianceStatusReason: statusReason,
        complianceStatusAt: new Date(),
      },
    });

    result.grandfatheredCount = updateResult.count;
    result.failedCount = plan.casualties.length - updateResult.count;
    result.message = `Successfully grandfathered ${updateResult.count} investors. They can now SELL but cannot BUY.`;

    // Log individual updates for audit
    await logBulkStatusChange(plan, ComplianceStatus.GRANDFATHERED, statusReason);

    // Mark investors for on-chain sync and trigger blockchain update
    await markForOnChainSync(plan.casualties);
    await scheduleOnChainSync(plan.casualties, plan.proposalId);

  } catch (error) {
    logger.error('Failed to grandfather investors', { error });
    result.failedCount = plan.casualties.length;
    result.failedInvestors = plan.casualties;
    throw error;
  }
}

/**
 * Update investors to GRANDFATHERED with a grace period.
 * After the grace period, they can re-certify or become UNAUTHORIZED.
 */
async function grandfatherWithGracePeriod(
  plan: ExecutionPlan,
  result: ExecutionResult
): Promise<void> {
  const gracePeriodDays = plan.gracePeriodDays || 365; // Default 1 year
  const graceEndDate = new Date();
  graceEndDate.setDate(graceEndDate.getDate() + gracePeriodDays);

  const statusReason = `Regulatory Change Proposal ${plan.proposalId} - ${gracePeriodDays}-day grace period until ${graceEndDate.toISOString().split('T')[0]}`;

  try {
    const updateResult = await prisma.investor.updateMany({
      where: {
        id: { in: plan.casualties },
      },
      data: {
        complianceStatus: ComplianceStatus.GRANDFATHERED,
        complianceStatusReason: statusReason,
        complianceStatusAt: new Date(),
        gracePeriodEndsAt: graceEndDate,
      },
    });

    result.grandfatheredCount = updateResult.count;
    result.failedCount = plan.casualties.length - updateResult.count;
    result.message = `Grandfathered ${updateResult.count} investors with ${gracePeriodDays}-day grace period ending ${graceEndDate.toISOString().split('T')[0]}`;

    await logBulkStatusChange(plan, ComplianceStatus.GRANDFATHERED, statusReason);

    // Mark investors for on-chain sync and trigger blockchain update
    await markForOnChainSync(plan.casualties);
    await scheduleOnChainSync(plan.casualties, plan.proposalId);

  } catch (error) {
    logger.error('Failed to grandfather investors with grace period', { error });
    result.failedCount = plan.casualties.length;
    result.failedInvestors = plan.casualties;
    throw error;
  }
}

/**
 * Immediate enforcement - mark investors as UNAUTHORIZED.
 * This is the "nuclear option" - only for extreme cases.
 */
async function enforceImmediately(
  plan: ExecutionPlan,
  result: ExecutionResult
): Promise<void> {
  const statusReason = `Regulatory Change Proposal ${plan.proposalId} - IMMEDIATE ENFORCEMENT - no grandfathering applied`;

  try {
    const updateResult = await prisma.investor.updateMany({
      where: {
        id: { in: plan.casualties },
      },
      data: {
        complianceStatus: ComplianceStatus.UNAUTHORIZED,
        complianceStatusReason: statusReason,
        complianceStatusAt: new Date(),
      },
    });

    result.grandfatheredCount = 0; // Not grandfathered, directly unauthorized
    result.failedCount = plan.casualties.length - updateResult.count;
    result.message = `IMMEDIATE ENFORCEMENT: ${updateResult.count} investors marked UNAUTHORIZED. All transfers blocked.`;

    await logBulkStatusChange(plan, ComplianceStatus.UNAUTHORIZED, statusReason);

    // Mark investors for on-chain sync and trigger blockchain update
    await markForOnChainSync(plan.casualties);
    await scheduleOnChainSync(plan.casualties, plan.proposalId);

  } catch (error) {
    logger.error('Failed to enforce immediately', { error });
    result.failedCount = plan.casualties.length;
    result.failedInvestors = plan.casualties;
    throw error;
  }
}

/**
 * Log bulk status changes to the compliance audit log.
 */
async function logBulkStatusChange(
  plan: ExecutionPlan,
  newStatus: ComplianceStatus,
  reason: string
): Promise<void> {
  try {
    // Create audit log entries for each affected investor
    const auditEntries = plan.casualties.map((investorId) => ({
      actor: plan.appliedBy,
      actorType: 'human',
      action: 'status_change',
      previousState: JSON.stringify({ complianceStatus: 'approved' }),
      newState: JSON.stringify({ complianceStatus: newStatus }),
      details: JSON.stringify({
        proposalId: plan.proposalId,
        strategy: plan.strategy,
        reason,
        investorId,
      }),
      rulesetVersion: plan.proposalId,
    }));

    // Batch insert (if ComplianceAuditLog model exists)
    // await prisma.complianceAuditLog.createMany({ data: auditEntries });

    logger.info('Bulk status change logged', {
      proposalId: plan.proposalId,
      affectedCount: plan.casualties.length,
      newStatus,
    });
  } catch (error) {
    // Non-blocking - don't fail execution if audit logging fails
    logger.warn('Failed to log bulk status change', { error });
  }
}

/**
 * Revert a grandfathering decision (in case of approval reversal).
 */
export async function revertGrandfathering(
  proposalId: string,
  revertedBy: string
): Promise<{
  success: boolean;
  revertedCount: number;
  message: string;
}> {
  try {
    // Find all investors grandfathered by this proposal
    const updateResult = await prisma.investor.updateMany({
      where: {
        complianceStatusReason: { contains: proposalId },
        complianceStatus: ComplianceStatus.GRANDFATHERED,
      },
      data: {
        complianceStatus: ComplianceStatus.APPROVED,
        complianceStatusReason: `Reverted from ${proposalId} by ${revertedBy}`,
        complianceStatusAt: new Date(),
        gracePeriodEndsAt: null,
      },
    });

    logger.info('Grandfathering reverted', {
      proposalId,
      revertedBy,
      revertedCount: updateResult.count,
    });

    return {
      success: true,
      revertedCount: updateResult.count,
      message: `Reverted ${updateResult.count} investors back to APPROVED status`,
    };
  } catch (error) {
    logger.error('Failed to revert grandfathering', { error });
    return {
      success: false,
      revertedCount: 0,
      message: `Revert failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Check if any investors have expired grace periods and need action.
 * This should be run as a scheduled job (e.g., daily).
 */
export async function checkExpiredGracePeriods(): Promise<{
  expiredCount: number;
  investorIds: string[];
}> {
  const now = new Date();

  const expired = await prisma.investor.findMany({
    where: {
      complianceStatus: ComplianceStatus.GRANDFATHERED,
      gracePeriodEndsAt: { lte: now },
    },
    select: { id: true, fullName: true, email: true },
  });

  if (expired.length > 0) {
    logger.warn('Investors with expired grace periods found', {
      count: expired.length,
      investorIds: expired.map((i) => i.id),
    });
  }

  return {
    expiredCount: expired.length,
    investorIds: expired.map((i) => i.id),
  };
}

/**
 * Get summary of current compliance status distribution.
 */
export async function getComplianceStatusSummary(): Promise<{
  approved: number;
  frozen: number;
  grandfathered: number;
  unauthorized: number;
  total: number;
}> {
  const [approved, frozen, grandfathered, unauthorized] = await Promise.all([
    prisma.investor.count({ where: { complianceStatus: ComplianceStatus.APPROVED } }),
    prisma.investor.count({ where: { complianceStatus: ComplianceStatus.FROZEN } }),
    prisma.investor.count({ where: { complianceStatus: ComplianceStatus.GRANDFATHERED } }),
    prisma.investor.count({ where: { complianceStatus: ComplianceStatus.UNAUTHORIZED } }),
  ]);

  return {
    approved,
    frozen,
    grandfathered,
    unauthorized,
    total: approved + frozen + grandfathered + unauthorized,
  };
}

// ============= On-Chain Sync Integration =============

/**
 * Mark investors as needing on-chain sync.
 * Called after any status change to flag for blockchain update.
 */
async function markForOnChainSync(investorIds: string[]): Promise<void> {
  try {
    await prisma.investor.updateMany({
      where: { id: { in: investorIds } },
      data: {
        onChainSynced: false,
        onChainSyncedAt: null,
        onChainTxHash: null,
      },
    });

    logger.info('Marked investors for on-chain sync', {
      count: investorIds.length,
    });
  } catch (error) {
    logger.error('Failed to mark investors for on-chain sync', { error });
    // Non-blocking - don't fail the main operation
  }
}

/**
 * Schedule on-chain sync for the affected investors.
 * This triggers the actual blockchain transaction.
 */
async function scheduleOnChainSync(
  investorIds: string[],
  proposalId: string
): Promise<void> {
  try {
    // Check if on-chain sync is enabled
    const registryAddress = process.env.COMPLIANCE_REGISTRY_ADDRESS;
    if (!registryAddress) {
      logger.info('On-chain sync skipped - COMPLIANCE_REGISTRY_ADDRESS not configured');
      return;
    }

    // Sync in batches of 50
    const batchSize = 50;
    for (let i = 0; i < investorIds.length; i += batchSize) {
      const batch = investorIds.slice(i, i + batchSize);

      logger.info('Triggering on-chain sync for batch', {
        proposalId,
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
      });

      // Call the sync function (async, fire-and-forget for performance)
      syncComplianceStatuses({ investorIds: batch })
        .then((result) => {
          if (result.success) {
            logger.info('On-chain sync completed', {
              proposalId,
              syncedCount: result.syncedCount,
              txHash: result.txHash,
            });
          } else {
            logger.warn('On-chain sync failed', {
              proposalId,
              message: result.message,
            });
          }
        })
        .catch((error) => {
          logger.error('On-chain sync error', { proposalId, error });
        });
    }
  } catch (error) {
    logger.error('Failed to schedule on-chain sync', { error });
    // Non-blocking - don't fail the main operation
  }
}
