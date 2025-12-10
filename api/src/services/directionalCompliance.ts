/**
 * Directional Compliance Service
 *
 * Validates transfers based on Directional Compliance States.
 * This enables "Smart Grandfathering" - investors affected by regulatory changes
 * can still EXIT their positions but cannot ADD to them.
 *
 * States:
 *   APPROVED      - Full access: Can Buy & Sell
 *   FROZEN        - No access: Cannot Buy or Sell (Sanctions/AML block)
 *   GRANDFATHERED - Sell-only: Can Sell, Cannot Buy (Regulatory shift)
 *   UNAUTHORIZED  - No access: Never completed onboarding
 */

import { ComplianceStatus, DirectionalComplianceResult } from '../types/conflicts';
import { logger } from '../utils/logger';

/**
 * Validates if a transfer is allowed based on Directional Compliance States.
 *
 * The key insight: A transfer has TWO parties with different needs:
 *   - SENDER needs permission to SEND (sell/exit position)
 *   - RECIPIENT needs permission to RECEIVE (buy/enter position)
 *
 * GRANDFATHERED investors can SEND but cannot RECEIVE.
 * This prevents capital from being trapped when regulations change.
 *
 * @param senderStatus - Compliance status of the sender (seller)
 * @param recipientStatus - Compliance status of the recipient (buyer)
 * @returns Validation result with allowed flag and reason
 */
export function validateDirectionalCompliance(
  senderStatus: ComplianceStatus | string,
  recipientStatus: ComplianceStatus | string
): DirectionalComplianceResult {
  // Normalize to enum values (handle string inputs from DB)
  const sender = normalizeStatus(senderStatus);
  const recipient = normalizeStatus(recipientStatus);

  // Track individual capabilities for detailed response
  let senderCanSend = false;
  let recipientCanReceive = false;
  let reason: string | undefined;

  // 1. Check Sender (Can they sell/send?)
  switch (sender) {
    case ComplianceStatus.APPROVED:
    case ComplianceStatus.GRANDFATHERED:
      // Both APPROVED and GRANDFATHERED can SEND (exit position)
      senderCanSend = true;
      break;
    case ComplianceStatus.FROZEN:
      return {
        allowed: false,
        reason: 'Sender account is FROZEN - all transfers blocked (AML/Sanctions)',
        senderCanSend: false,
        recipientCanReceive: false,
      };
    case ComplianceStatus.UNAUTHORIZED:
      return {
        allowed: false,
        reason: 'Sender is UNAUTHORIZED - onboarding not complete',
        senderCanSend: false,
        recipientCanReceive: false,
      };
  }

  // 2. Check Recipient (Can they buy/receive?)
  switch (recipient) {
    case ComplianceStatus.APPROVED:
      // Only APPROVED can RECEIVE (enter position)
      recipientCanReceive = true;
      break;
    case ComplianceStatus.FROZEN:
      return {
        allowed: false,
        reason: 'Recipient account is FROZEN - cannot receive transfers',
        senderCanSend,
        recipientCanReceive: false,
      };
    case ComplianceStatus.GRANDFATHERED:
      return {
        allowed: false,
        reason: 'Recipient is GRANDFATHERED - can only sell existing holdings, cannot add new positions',
        senderCanSend,
        recipientCanReceive: false,
      };
    case ComplianceStatus.UNAUTHORIZED:
      return {
        allowed: false,
        reason: 'Recipient is UNAUTHORIZED - onboarding not complete',
        senderCanSend,
        recipientCanReceive: false,
      };
  }

  // Both parties have required permissions
  if (senderCanSend && recipientCanReceive) {
    return {
      allowed: true,
      senderCanSend: true,
      recipientCanReceive: true,
    };
  }

  // Fallback (shouldn't reach here with complete switch coverage)
  return {
    allowed: false,
    reason: 'Transfer validation failed - unknown status combination',
    senderCanSend,
    recipientCanReceive,
  };
}

/**
 * Check if an investor can SEND tokens (sell/exit position).
 */
export function canSend(status: ComplianceStatus | string): boolean {
  const normalized = normalizeStatus(status);
  return (
    normalized === ComplianceStatus.APPROVED ||
    normalized === ComplianceStatus.GRANDFATHERED
  );
}

/**
 * Check if an investor can RECEIVE tokens (buy/enter position).
 */
export function canReceive(status: ComplianceStatus | string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === ComplianceStatus.APPROVED;
}

/**
 * Check if an investor is completely blocked (no transfers at all).
 */
export function isBlocked(status: ComplianceStatus | string): boolean {
  const normalized = normalizeStatus(status);
  return (
    normalized === ComplianceStatus.FROZEN ||
    normalized === ComplianceStatus.UNAUTHORIZED
  );
}

/**
 * Get human-readable description of what an investor can do.
 */
export function getStatusCapabilities(status: ComplianceStatus | string): {
  canBuy: boolean;
  canSell: boolean;
  description: string;
} {
  const normalized = normalizeStatus(status);

  switch (normalized) {
    case ComplianceStatus.APPROVED:
      return {
        canBuy: true,
        canSell: true,
        description: 'Full access - can buy and sell tokens',
      };
    case ComplianceStatus.GRANDFATHERED:
      return {
        canBuy: false,
        canSell: true,
        description: 'Sell-only - can exit positions but cannot add new ones (regulatory grandfathering)',
      };
    case ComplianceStatus.FROZEN:
      return {
        canBuy: false,
        canSell: false,
        description: 'Account frozen - all transfers blocked pending compliance review',
      };
    case ComplianceStatus.UNAUTHORIZED:
      return {
        canBuy: false,
        canSell: false,
        description: 'Unauthorized - onboarding not complete',
      };
  }
}

/**
 * Normalize string status to ComplianceStatus enum.
 */
function normalizeStatus(status: ComplianceStatus | string): ComplianceStatus {
  if (typeof status === 'string') {
    const lower = status.toLowerCase();
    switch (lower) {
      case 'approved':
        return ComplianceStatus.APPROVED;
      case 'frozen':
        return ComplianceStatus.FROZEN;
      case 'grandfathered':
        return ComplianceStatus.GRANDFATHERED;
      case 'unauthorized':
        return ComplianceStatus.UNAUTHORIZED;
      default:
        logger.warn(`Unknown compliance status: ${status}, defaulting to UNAUTHORIZED`);
        return ComplianceStatus.UNAUTHORIZED;
    }
  }
  return status;
}

/**
 * Log a transfer validation for audit purposes.
 */
export function logTransferValidation(
  transferId: string,
  senderStatus: ComplianceStatus | string,
  recipientStatus: ComplianceStatus | string,
  result: DirectionalComplianceResult
): void {
  logger.info('Directional compliance check', {
    transferId,
    senderStatus,
    recipientStatus,
    allowed: result.allowed,
    reason: result.reason,
    senderCanSend: result.senderCanSend,
    recipientCanReceive: result.recipientCanReceive,
  });
}
