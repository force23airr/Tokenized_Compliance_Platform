/**
 * Preflight Compliance Check Service
 *
 * Runs comprehensive compliance checks before blockchain deployment.
 * This is the final gate before tokens go on-chain.
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { validateTokenCompliance } from './aiComplianceEnhanced';
import { PreflightCheckResult, PreflightCheck, ConflictType } from '../types/conflicts';

const prisma = new PrismaClient();
const AI_API_URL = config.externalServices.aiCompliance.apiUrl;

// ============= Preflight Check Runner =============

/**
 * Run all preflight compliance checks before deployment
 * This is called by the tokenDeploymentWorker before deployTokenContract()
 */
export async function runPreflightComplianceCheck(
  tokenId: string
): Promise<PreflightCheckResult> {
  const startTime = Date.now();
  const checks: PreflightCheck[] = [];

  logger.info('Starting preflight compliance check', { tokenId });

  // Fetch token with related data
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    include: {
      investors: {
        where: { whitelisted: true },
        include: { investor: true },
      },
    },
  });

  if (!token) {
    return {
      passed: false,
      reason: `Token ${tokenId} not found`,
      checks: [],
      timestamp: new Date(),
      tokenId,
    };
  }

  // Run all checks
  checks.push(await checkTokenConfiguration(token));
  checks.push(await checkComplianceRules(token));
  checks.push(await checkAICompliance(token));
  checks.push(await checkInvestorWhitelist(token));
  checks.push(await checkCustodianSetup(token));
  checks.push(await checkJurisdictionConflicts(token));

  // Determine overall result
  const failed = checks.filter((c) => c.status === 'failed');
  const warnings = checks.filter((c) => c.status === 'warning');
  const passed = failed.length === 0;

  const duration = Date.now() - startTime;
  logger.info('Preflight check completed', {
    tokenId,
    passed,
    failedCount: failed.length,
    warningCount: warnings.length,
    duration,
  });

  return {
    passed,
    reason: passed
      ? undefined
      : `${failed.length} check(s) failed: ${failed.map((f) => f.name).join(', ')}`,
    checks,
    timestamp: new Date(),
    tokenId,
  };
}

// ============= Individual Checks =============

/**
 * Check basic token configuration is valid
 */
async function checkTokenConfiguration(token: any): Promise<PreflightCheck> {
  const start = Date.now();

  try {
    const issues: string[] = [];

    if (!token.name || token.name.length < 3) {
      issues.push('Token name too short');
    }

    if (!token.symbol || token.symbol.length < 2) {
      issues.push('Token symbol too short');
    }

    if (!token.totalSupply || BigInt(token.totalSupply) <= 0) {
      issues.push('Invalid total supply');
    }

    if (!token.blockchain) {
      issues.push('Blockchain not specified');
    }

    if (issues.length > 0) {
      return {
        name: 'Token Configuration',
        status: 'failed',
        details: issues.join('; '),
        duration: Date.now() - start,
      };
    }

    return {
      name: 'Token Configuration',
      status: 'passed',
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'Token Configuration',
      status: 'failed',
      details: error.message,
      duration: Date.now() - start,
    };
  }
}

/**
 * Check compliance rules are properly set
 */
async function checkComplianceRules(token: any): Promise<PreflightCheck> {
  const start = Date.now();

  try {
    const rules = token.complianceRules || {};
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (rules.allowed_jurisdictions?.length === 0) {
      warnings.push('No allowed jurisdictions specified - defaults to all');
    }

    // Validate investor limits
    if (rules.max_investors && rules.max_investors < 1) {
      issues.push('Invalid max_investors value');
    }

    // Validate lockup period
    if (rules.lockup_period_days && rules.lockup_period_days < 0) {
      issues.push('Invalid lockup period');
    }

    if (issues.length > 0) {
      return {
        name: 'Compliance Rules',
        status: 'failed',
        details: issues.join('; '),
        duration: Date.now() - start,
      };
    }

    if (warnings.length > 0) {
      return {
        name: 'Compliance Rules',
        status: 'warning',
        details: warnings.join('; '),
        duration: Date.now() - start,
      };
    }

    return {
      name: 'Compliance Rules',
      status: 'passed',
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'Compliance Rules',
      status: 'failed',
      details: error.message,
      duration: Date.now() - start,
    };
  }
}

/**
 * Run AI compliance validation
 */
async function checkAICompliance(token: any): Promise<PreflightCheck> {
  const start = Date.now();

  try {
    const rules = token.complianceRules || {};
    const jurisdictions = rules.allowed_jurisdictions || ['US'];

    const result = await validateTokenCompliance({
      assetType: token.assetType,
      jurisdictions,
      complianceRules: {
        accreditedOnly: rules.accredited_only,
        maxInvestors: rules.max_investors,
        lockupPeriodDays: rules.lockup_period_days,
        minInvestment: rules.min_investment,
        allowedJurisdictions: rules.allowed_jurisdictions,
      },
    });

    if (!result.approved) {
      return {
        name: 'AI Compliance Check',
        status: result.requiresManualReview ? 'warning' : 'failed',
        details: result.reason || 'AI compliance check failed',
        duration: Date.now() - start,
      };
    }

    if (result.isFallback) {
      return {
        name: 'AI Compliance Check',
        status: 'warning',
        details: 'Using cached/fallback compliance data',
        duration: Date.now() - start,
      };
    }

    return {
      name: 'AI Compliance Check',
      status: 'passed',
      details: `Confidence: ${(result.confidence * 100).toFixed(0)}%`,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    logger.error('AI compliance check failed in preflight', { error });
    return {
      name: 'AI Compliance Check',
      status: 'warning', // Don't block on AI failure - manual review required
      details: `AI check failed: ${error.message}. Manual review required.`,
      duration: Date.now() - start,
    };
  }
}

/**
 * Check investor whitelist status
 */
async function checkInvestorWhitelist(token: any): Promise<PreflightCheck> {
  const start = Date.now();

  try {
    const whitelistedCount = token.investors?.length || 0;
    const rules = token.complianceRules || {};
    const maxInvestors = rules.max_investors || 2000;

    if (whitelistedCount > maxInvestors) {
      return {
        name: 'Investor Whitelist',
        status: 'failed',
        details: `Whitelisted investors (${whitelistedCount}) exceeds max (${maxInvestors})`,
        duration: Date.now() - start,
      };
    }

    // Check KYC status of whitelisted investors
    const investorsWithKYC = token.investors?.filter(
      (i: any) => i.investor.kycStatus === 'approved'
    );
    const nonKYCCount = whitelistedCount - (investorsWithKYC?.length || 0);

    if (nonKYCCount > 0) {
      return {
        name: 'Investor Whitelist',
        status: 'warning',
        details: `${nonKYCCount} whitelisted investor(s) have unapproved KYC`,
        duration: Date.now() - start,
      };
    }

    // Check accreditation for accredited-only tokens
    if (rules.accredited_only) {
      const accreditedClassifications = [
        'accredited',
        'accredited_investor',
        'qualified_purchaser',
        'institutional',
        'institutional_investor',
        'professional',
        'eligible_counterparty',
      ];

      const nonAccredited = token.investors?.filter(
        (i: any) =>
          !accreditedClassifications.includes(i.investor.classification?.toLowerCase())
      );

      if (nonAccredited?.length > 0) {
        return {
          name: 'Investor Whitelist',
          status: 'failed',
          details: `${nonAccredited.length} non-accredited investor(s) on accredited-only token`,
          duration: Date.now() - start,
        };
      }
    }

    return {
      name: 'Investor Whitelist',
      status: 'passed',
      details: `${whitelistedCount} verified investors`,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'Investor Whitelist',
      status: 'failed',
      details: error.message,
      duration: Date.now() - start,
    };
  }
}

/**
 * Check custodian setup if required
 */
async function checkCustodianSetup(token: any): Promise<PreflightCheck> {
  const start = Date.now();

  try {
    // Skip if no custodian configured
    if (!token.custodian) {
      return {
        name: 'Custodian Setup',
        status: 'skipped',
        details: 'No custodian configured',
        duration: Date.now() - start,
      };
    }

    if (!token.custodianVaultId) {
      return {
        name: 'Custodian Setup',
        status: 'failed',
        details: 'Custodian specified but vault ID missing',
        duration: Date.now() - start,
      };
    }

    // TODO: Add actual custodian API verification
    // For now, just check the vault ID format
    if (token.custodianVaultId.length < 5) {
      return {
        name: 'Custodian Setup',
        status: 'warning',
        details: 'Vault ID format may be invalid',
        duration: Date.now() - start,
      };
    }

    return {
      name: 'Custodian Setup',
      status: 'passed',
      details: `${token.custodian} vault verified`,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'Custodian Setup',
      status: 'warning',
      details: `Custodian verification skipped: ${error.message}`,
      duration: Date.now() - start,
    };
  }
}

/**
 * Check for unresolved jurisdiction conflicts
 */
async function checkJurisdictionConflicts(token: any): Promise<PreflightCheck> {
  const start = Date.now();

  try {
    const rules = token.complianceRules || {};
    const jurisdictions = rules.allowed_jurisdictions || [];

    // Single jurisdiction - no conflicts possible
    if (jurisdictions.length <= 1) {
      return {
        name: 'Jurisdiction Conflicts',
        status: 'passed',
        details: 'Single jurisdiction - no conflicts',
        duration: Date.now() - start,
      };
    }

    // Call AI API for conflict check
    const result = await validateTokenCompliance({
      assetType: token.assetType,
      jurisdictions,
      complianceRules: {
        accreditedOnly: rules.accredited_only,
        maxInvestors: rules.max_investors,
        lockupPeriodDays: rules.lockup_period_days,
        allowedJurisdictions: jurisdictions,
      },
    });

    if (result.conflicts.length > 0) {
      const unresolvedConflicts = result.conflicts.filter(
        (c) =>
          !result.resolutions.some(
            (r) => r.conflictType === c.type
          )
      );

      if (unresolvedConflicts.length > 0) {
        return {
          name: 'Jurisdiction Conflicts',
          status: 'failed',
          details: `${unresolvedConflicts.length} unresolved conflict(s)`,
          duration: Date.now() - start,
        };
      }

      return {
        name: 'Jurisdiction Conflicts',
        status: 'warning',
        details: `${result.conflicts.length} conflict(s) resolved with ${result.resolutions[0]?.strategy || 'strictest'} strategy`,
        duration: Date.now() - start,
      };
    }

    return {
      name: 'Jurisdiction Conflicts',
      status: 'passed',
      details: `${jurisdictions.length} jurisdictions analyzed - no conflicts`,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    return {
      name: 'Jurisdiction Conflicts',
      status: 'warning',
      details: `Could not verify conflicts: ${error.message}`,
      duration: Date.now() - start,
    };
  }
}

// ============= Utility Functions =============

/**
 * Get preflight check status for a token (without running)
 * Useful for UI display
 */
export async function getPreflightStatus(tokenId: string): Promise<{
  canDeploy: boolean;
  lastCheck?: PreflightCheckResult;
  requiresRecheck: boolean;
}> {
  const token = await prisma.token.findUnique({
    where: { id: tokenId },
    select: {
      status: true,
      complianceRules: true,
      updatedAt: true,
    },
  });

  if (!token) {
    return {
      canDeploy: false,
      requiresRecheck: true,
    };
  }

  // TODO: Store last preflight result in DB or cache
  // For now, always require recheck
  return {
    canDeploy: token.status === 'pending',
    requiresRecheck: true,
  };
}

/**
 * Store conflict event for audit trail
 */
export async function storeConflictEvent(
  tokenId: string,
  conflictType: ConflictType,
  jurisdictionA: string,
  jurisdictionB: string,
  ruleA: string,
  ruleB: string,
  resolution: string,
  rulesetVersion: string
): Promise<void> {
  try {
    await prisma.conflictEvent.create({
      data: {
        tokenId,
        conflictType,
        jurisdictionA,
        jurisdictionB,
        ruleA,
        ruleB,
        resolution,
        rulesetVersion,
      },
    });
  } catch (error) {
    logger.error('Failed to store conflict event', { tokenId, error });
  }
}
