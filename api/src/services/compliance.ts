import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  validateDirectionalCompliance,
  logTransferValidation,
  canSend,
  canReceive,
  getStatusCapabilities,
} from './directionalCompliance';
import { ComplianceStatus } from '../types/conflicts';

interface AMLCheckParams {
  name: string;
  walletAddress: string;
  country: string;
}

interface AMLResult {
  passed: boolean;
  riskScore: number;
  flags: string[];
}

/**
 * Run AML check via Chainalysis or Elliptic
 */
export async function runAMLCheck(params: AMLCheckParams): Promise<AMLResult> {
  try {
    logger.info('Running AML check', { walletAddress: params.walletAddress });

    // TODO: Integrate with actual Chainalysis/Elliptic API
    // For now, placeholder implementation

    if (config.externalServices.chainalysis.apiKey) {
      return await checkChainalysis(params);
    }

    // Fallback: basic sanctions screening
    return fallbackAMLCheck(params);
  } catch (error) {
    logger.error('AML check failed', { error });

    // On error, default to flagged for manual review
    return {
      passed: false,
      riskScore: 50,
      flags: ['AML_CHECK_ERROR'],
    };
  }
}

async function checkChainalysis(params: AMLCheckParams): Promise<AMLResult> {
  // Placeholder for Chainalysis integration
  // Would use their API to check wallet address

  return {
    passed: true,
    riskScore: 10,
    flags: [],
  };
}

function fallbackAMLCheck(params: AMLCheckParams): AMLResult {
  // Simple country-based screening
  const sanctionedCountries = ['KP', 'IR', 'SY', 'CU']; // North Korea, Iran, Syria, Cuba

  const isSanctioned = sanctionedCountries.includes(params.country.toUpperCase());

  return {
    passed: !isSanctioned,
    riskScore: isSanctioned ? 100 : 5,
    flags: isSanctioned ? ['SANCTIONED_COUNTRY'] : [],
  };
}

/**
 * Check if transfer is compliant with token rules
 */
export async function checkTransferCompliance(params: {
  tokenId: string;
  fromInvestor: any;
  toInvestor: any;
  amount: string;
  transferId?: string;
}): Promise<{
  approved: boolean;
  checks: any[];
  failureReason?: string;
  directionalResult?: {
    senderCanSend: boolean;
    recipientCanReceive: boolean;
    senderCapabilities?: ReturnType<typeof getStatusCapabilities>;
    recipientCapabilities?: ReturnType<typeof getStatusCapabilities>;
  };
}> {
  const checks: any[] = [];

  // ═══════════════════════════════════════════════════════════════════
  // CHECK 0: DIRECTIONAL COMPLIANCE (Smart Grandfathering)
  // ═══════════════════════════════════════════════════════════════════
  // This check MUST come first - it's the "fail fast" gate.
  // If a GRANDFATHERED investor tries to BUY, we block immediately.
  // No point running expensive AML checks if the direction is blocked.
  // ═══════════════════════════════════════════════════════════════════

  const senderStatus = params.fromInvestor.complianceStatus || ComplianceStatus.APPROVED;
  const recipientStatus = params.toInvestor.complianceStatus || ComplianceStatus.APPROVED;

  const directionalResult = validateDirectionalCompliance(senderStatus, recipientStatus);

  // Log for audit trail
  if (params.transferId) {
    logTransferValidation(params.transferId, senderStatus, recipientStatus, directionalResult);
  }

  checks.push({
    check: 'DIRECTIONAL_COMPLIANCE',
    status: directionalResult.allowed ? 'PASSED' : 'FAILED',
    details: {
      senderStatus,
      recipientStatus,
      senderCanSend: directionalResult.senderCanSend,
      recipientCanReceive: directionalResult.recipientCanReceive,
      reason: directionalResult.reason,
    },
  });

  // If directional check fails, return immediately - no need to run other checks
  if (!directionalResult.allowed) {
    logger.warn('Transfer blocked by directional compliance', {
      tokenId: params.tokenId,
      senderStatus,
      recipientStatus,
      reason: directionalResult.reason,
    });

    return {
      approved: false,
      checks,
      failureReason: directionalResult.reason,
      directionalResult: {
        senderCanSend: directionalResult.senderCanSend,
        recipientCanReceive: directionalResult.recipientCanReceive,
        senderCapabilities: getStatusCapabilities(senderStatus),
        recipientCapabilities: getStatusCapabilities(recipientStatus),
      },
    };
  }

  // Check 1: Both parties whitelisted
  // (Would query database in real implementation)
  checks.push({
    check: 'SENDER_WHITELISTED',
    status: 'PASSED',
  });

  checks.push({
    check: 'RECIPIENT_WHITELISTED',
    status: 'PASSED',
  });

  // Check 2: No lockup period violation
  checks.push({
    check: 'LOCKUP_PERIOD',
    status: 'PASSED',
  });

  // Check 3: Jurisdiction allowed
  checks.push({
    check: 'JURISDICTION_ALLOWED',
    status: 'PASSED',
  });

  // Check 4: AML screening
  const amlResult = await runAMLCheck({
    name: params.toInvestor.fullName,
    walletAddress: params.toInvestor.walletAddress,
    country: params.toInvestor.jurisdiction,
  });

  checks.push({
    check: 'AML_SCREENING',
    status: amlResult.passed ? 'PASSED' : 'FAILED',
    details: { riskScore: amlResult.riskScore, flags: amlResult.flags },
  });

  const allPassed = checks.every((c) => c.status === 'PASSED');

  return {
    approved: allPassed,
    checks,
    failureReason: allPassed ? undefined : 'One or more compliance checks failed',
    directionalResult: {
      senderCanSend: directionalResult.senderCanSend,
      recipientCanReceive: directionalResult.recipientCanReceive,
      senderCapabilities: getStatusCapabilities(senderStatus),
      recipientCapabilities: getStatusCapabilities(recipientStatus),
    },
  };
}

/**
 * Quick check if an investor can participate in a transfer direction.
 * Useful for UI pre-validation before user initiates transfer.
 */
export function preValidateTransferDirection(
  investorStatus: ComplianceStatus | string,
  direction: 'send' | 'receive'
): {
  allowed: boolean;
  reason?: string;
  capabilities: ReturnType<typeof getStatusCapabilities>;
} {
  const capabilities = getStatusCapabilities(investorStatus);

  if (direction === 'send') {
    return {
      allowed: canSend(investorStatus),
      reason: canSend(investorStatus) ? undefined : capabilities.description,
      capabilities,
    };
  } else {
    return {
      allowed: canReceive(investorStatus),
      reason: canReceive(investorStatus) ? undefined : capabilities.description,
      capabilities,
    };
  }
}
