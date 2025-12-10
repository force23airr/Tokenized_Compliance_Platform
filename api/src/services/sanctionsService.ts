/**
 * Sanctions/AML Service
 *
 * Multi-provider sanctions screening with fallback support.
 * Providers: Chainalysis -> Elliptic -> OFAC Direct
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { generateSanctionsCheckHash } from '../utils/complianceHashing';
import {
  SanctionsProvider,
  SanctionsCheckType,
  SanctionsCheckResult,
} from '../types/conflicts';

const prisma = new PrismaClient();

// Provider configuration
const PROVIDERS: SanctionsProvider[] = [
  SanctionsProvider.CHAINALYSIS,
  SanctionsProvider.ELLIPTIC,
  SanctionsProvider.OFAC_DIRECT,
];

// Check expiry (24 hours default)
const CHECK_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Current OFAC list version (would be fetched dynamically in production)
const OFAC_LIST_VERSION = '2025-01-15';

interface ProviderResponse {
  success: boolean;
  passed: boolean;
  riskScore: number;
  flags: string[];
  rawResponse?: Record<string, unknown>;
  error?: string;
}

/**
 * Run sanctions check with multi-provider fallback
 */
export async function runSanctionsCheck(
  investorId: string,
  walletAddress: string,
  jurisdiction: string,
  checkType: SanctionsCheckType = SanctionsCheckType.SANCTIONS
): Promise<SanctionsCheckResult> {
  logger.info('Starting sanctions check', { investorId, walletAddress, jurisdiction });

  // Check if we have a recent valid check
  const existingCheck = await getRecentValidCheck(investorId, checkType);
  if (existingCheck) {
    logger.info('Using cached sanctions check', { investorId, checkId: existingCheck.id });
    return mapToResult(existingCheck);
  }

  // Try providers in order with fallback
  let lastError: string | undefined;

  for (const provider of PROVIDERS) {
    try {
      const result = await checkWithProvider(provider, walletAddress, checkType);

      if (result.success) {
        // Store result
        const storedCheck = await storeSanctionsCheck(
          investorId,
          provider,
          jurisdiction,
          checkType,
          result
        );

        logger.info('Sanctions check completed', {
          investorId,
          provider,
          passed: result.passed,
          riskScore: result.riskScore,
        });

        return mapToResult(storedCheck);
      }

      lastError = result.error;
      logger.warn('Provider failed, trying next', { provider, error: result.error });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Provider exception', { provider, error: lastError });
    }
  }

  // All providers failed - create a flagged check for manual review
  logger.error('All sanctions providers failed', { investorId, lastError });

  const failedCheck = await storeSanctionsCheck(
    investorId,
    SanctionsProvider.OFAC_DIRECT, // Use OFAC as default
    jurisdiction,
    checkType,
    {
      success: true,
      passed: false, // Default to not passed for safety
      riskScore: 100, // High risk
      flags: ['ALL_PROVIDERS_FAILED', 'MANUAL_REVIEW_REQUIRED'],
      rawResponse: { error: lastError },
    },
    true // Requires manual review
  );

  return mapToResult(failedCheck);
}

/**
 * Check with specific provider
 */
async function checkWithProvider(
  provider: SanctionsProvider,
  walletAddress: string,
  checkType: SanctionsCheckType
): Promise<ProviderResponse> {
  switch (provider) {
    case SanctionsProvider.CHAINALYSIS:
      return checkChainalysis(walletAddress, checkType);
    case SanctionsProvider.ELLIPTIC:
      return checkElliptic(walletAddress, checkType);
    case SanctionsProvider.OFAC_DIRECT:
      return checkOFACDirect(walletAddress);
    default:
      return { success: false, passed: false, riskScore: 100, flags: [], error: 'Unknown provider' };
  }
}

/**
 * Chainalysis API integration (stub - implement with actual API)
 */
async function checkChainalysis(
  walletAddress: string,
  checkType: SanctionsCheckType
): Promise<ProviderResponse> {
  const apiKey = process.env.CHAINALYSIS_API_KEY;
  if (!apiKey) {
    return { success: false, passed: false, riskScore: 100, flags: [], error: 'API key not configured' };
  }

  try {
    // TODO: Implement actual Chainalysis API call
    // const response = await fetch('https://api.chainalysis.com/api/kyt/v2/users', {
    //   method: 'POST',
    //   headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ address: walletAddress })
    // });

    // Simulated response for development
    const isClean = !walletAddress.toLowerCase().includes('bad');
    return {
      success: true,
      passed: isClean,
      riskScore: isClean ? 10 : 85,
      flags: isClean ? [] : ['SANCTIONS_HIT'],
      rawResponse: { provider: 'chainalysis', address: walletAddress, checkType },
    };
  } catch (error) {
    return {
      success: false,
      passed: false,
      riskScore: 100,
      flags: [],
      error: error instanceof Error ? error.message : 'Chainalysis API error',
    };
  }
}

/**
 * Elliptic API integration (stub - implement with actual API)
 */
async function checkElliptic(
  walletAddress: string,
  checkType: SanctionsCheckType
): Promise<ProviderResponse> {
  const apiKey = process.env.ELLIPTIC_API_KEY;
  if (!apiKey) {
    return { success: false, passed: false, riskScore: 100, flags: [], error: 'API key not configured' };
  }

  try {
    // TODO: Implement actual Elliptic API call
    // Simulated response for development
    const isClean = !walletAddress.toLowerCase().includes('bad');
    return {
      success: true,
      passed: isClean,
      riskScore: isClean ? 15 : 80,
      flags: isClean ? [] : ['HIGH_RISK'],
      rawResponse: { provider: 'elliptic', address: walletAddress, checkType },
    };
  } catch (error) {
    return {
      success: false,
      passed: false,
      riskScore: 100,
      flags: [],
      error: error instanceof Error ? error.message : 'Elliptic API error',
    };
  }
}

/**
 * OFAC SDN List direct check (stub - implement with actual list)
 */
async function checkOFACDirect(walletAddress: string): Promise<ProviderResponse> {
  try {
    // TODO: Implement actual OFAC SDN list check
    // This would query a local copy of the SDN list or use Treasury API

    // Simulated response for development
    const isClean = !walletAddress.toLowerCase().includes('sanctioned');
    return {
      success: true,
      passed: isClean,
      riskScore: isClean ? 5 : 100,
      flags: isClean ? [] : ['OFAC_SDN_MATCH'],
      rawResponse: { provider: 'ofac_direct', address: walletAddress, listVersion: OFAC_LIST_VERSION },
    };
  } catch (error) {
    return {
      success: false,
      passed: false,
      riskScore: 100,
      flags: [],
      error: error instanceof Error ? error.message : 'OFAC check error',
    };
  }
}

/**
 * Store sanctions check result in database
 */
async function storeSanctionsCheck(
  investorId: string,
  provider: SanctionsProvider,
  jurisdiction: string,
  checkType: SanctionsCheckType,
  result: ProviderResponse,
  requiresManualReview = false
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHECK_EXPIRY_MS);

  // Get investor wallet address for hash
  const investor = await prisma.investor.findUnique({
    where: { id: investorId },
    select: { walletAddress: true },
  });

  const checkHash = generateSanctionsCheckHash({
    address: investor?.walletAddress || investorId,
    provider,
    listVersion: OFAC_LIST_VERSION,
    timestamp: now,
  });

  return prisma.sanctionsCheck.create({
    data: {
      investorId,
      provider,
      listVersion: OFAC_LIST_VERSION,
      checkType,
      passed: result.passed,
      riskScore: result.riskScore,
      flags: result.flags,
      rawResponse: result.rawResponse ? JSON.parse(JSON.stringify(result.rawResponse)) : {},
      jurisdiction,
      aiConfidence: result.passed ? 0.95 : 0.8,
      requiresManualReview: requiresManualReview || !result.passed,
      manualReviewReason: !result.passed ? 'Sanctions flags detected' : null,
      sanctionsListVersion: OFAC_LIST_VERSION,
      checkHash,
      checkedAt: now,
      expiresAt,
    },
  });
}

/**
 * Get recent valid check (not expired)
 */
async function getRecentValidCheck(investorId: string, checkType: SanctionsCheckType) {
  return prisma.sanctionsCheck.findFirst({
    where: {
      investorId,
      checkType,
      expiresAt: { gt: new Date() },
      passed: true, // Only cache passing checks
    },
    orderBy: { checkedAt: 'desc' },
  });
}

/**
 * Map database record to result interface
 */
function mapToResult(check: {
  passed: boolean;
  provider: string;
  riskScore: number | null;
  flags: unknown;
  checkHash: string;
  jurisdiction: string;
  aiConfidence: number | null;
  requiresManualReview: boolean;
  listVersion: string;
  checkedAt: Date;
  expiresAt: Date;
}): SanctionsCheckResult {
  return {
    passed: check.passed,
    provider: check.provider as SanctionsProvider,
    riskScore: check.riskScore || 0,
    flags: (check.flags as string[]) || [],
    checkHash: check.checkHash,
    jurisdiction: check.jurisdiction,
    aiConfidence: check.aiConfidence || undefined,
    requiresManualReview: check.requiresManualReview,
    listVersion: check.listVersion,
    checkedAt: check.checkedAt,
    expiresAt: check.expiresAt,
  };
}

/**
 * Verify sanctions clearance for a wallet
 */
export async function verifySanctionsClearance(
  investorId: string,
  maxAgeMs: number = CHECK_EXPIRY_MS
): Promise<boolean> {
  const cutoff = new Date(Date.now() - maxAgeMs);

  const check = await prisma.sanctionsCheck.findFirst({
    where: {
      investorId,
      checkedAt: { gte: cutoff },
      passed: true,
      requiresManualReview: false,
    },
    orderBy: { checkedAt: 'desc' },
  });

  return !!check;
}

/**
 * Get sanctions check history for an investor
 */
export async function getSanctionsHistory(investorId: string) {
  return prisma.sanctionsCheck.findMany({
    where: { investorId },
    orderBy: { checkedAt: 'desc' },
    take: 50,
  });
}

/**
 * Flag check for manual review
 */
export async function flagForManualReview(
  checkId: string,
  reason: string
): Promise<void> {
  await prisma.sanctionsCheck.update({
    where: { id: checkId },
    data: {
      requiresManualReview: true,
      manualReviewReason: reason,
    },
  });

  logger.info('Sanctions check flagged for manual review', { checkId, reason });
}

/**
 * Mark check as recorded on-chain
 */
export async function markRecordedOnChain(
  checkId: string,
  txHash: string
): Promise<void> {
  await prisma.sanctionsCheck.update({
    where: { id: checkId },
    data: {
      recordedOnChain: true,
      onChainTxHash: txHash,
    },
  });

  logger.info('Sanctions check recorded on-chain', { checkId, txHash });
}
