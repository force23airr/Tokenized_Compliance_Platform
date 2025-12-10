/**
 * Holder Lockup Service
 *
 * Manages per-holder lockup periods for token transfers.
 * Supports Rule 144, Reg S, contractual, and vesting lockups.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { generateLockupHash } from '../utils/complianceHashing';
import { LockupType, LockupParams, VestingSchedule } from '../types/conflicts';

const prisma = new PrismaClient();

// Standard lockup periods by type (in days)
const STANDARD_LOCKUP_DAYS: Record<LockupType, number> = {
  [LockupType.INITIAL_OFFERING]: 180,
  [LockupType.RULE_144]: 365,
  [LockupType.REG_S]: 40,
  [LockupType.CONTRACTUAL]: 90,
  [LockupType.VESTING]: 730,
};

interface CreateLockupInput {
  tokenId: string;
  investorId: string;
  lockupType: LockupType;
  unlockTimestamp?: Date;
  lockupDays?: number;
  lockupReason?: string;
  vestingSchedule?: VestingSchedule;
}

interface LockupStatus {
  isLocked: boolean;
  unlockTimestamp: Date;
  lockupType: LockupType;
  remainingDays: number;
  lockupHash: string;
  vestingInfo?: VestingInfo;
}

interface VestingInfo {
  totalPeriods: number;
  vestedPeriods: number;
  nextVestingDate: Date | null;
  vestedPercentage: number;
}

/**
 * Create a new holder lockup
 */
export async function createLockup(input: CreateLockupInput) {
  const {
    tokenId,
    investorId,
    lockupType,
    unlockTimestamp,
    lockupDays,
    lockupReason,
    vestingSchedule,
  } = input;

  // Calculate unlock timestamp
  const now = new Date();
  let unlock: Date;

  if (unlockTimestamp) {
    unlock = unlockTimestamp;
  } else if (lockupDays) {
    unlock = new Date(now.getTime() + lockupDays * 24 * 60 * 60 * 1000);
  } else {
    const standardDays = STANDARD_LOCKUP_DAYS[lockupType];
    unlock = new Date(now.getTime() + standardDays * 24 * 60 * 60 * 1000);
  }

  // Get investor wallet address for hash
  const investor = await prisma.investor.findUnique({
    where: { id: investorId },
    select: { walletAddress: true },
  });

  if (!investor) {
    throw new Error(`Investor ${investorId} not found`);
  }

  // Generate lockup hash for on-chain sync
  const lockupHash = generateLockupHash(
    tokenId,
    investor.walletAddress,
    unlock,
    lockupType
  );

  logger.info('Creating holder lockup', {
    tokenId,
    investorId,
    lockupType,
    unlockTimestamp: unlock,
  });

  const lockup = await prisma.holderLockup.create({
    data: {
      tokenId,
      investorId,
      unlockTimestamp: unlock,
      lockupType,
      lockupReason,
      vestingSchedule: vestingSchedule ? JSON.parse(JSON.stringify(vestingSchedule)) : undefined,
      onChainSynced: false,
    },
  });

  logger.info('Lockup created', { lockupId: lockup.id, lockupHash });

  return { lockup, lockupHash };
}

/**
 * Get lockup by ID
 */
export async function getLockup(lockupId: string) {
  return prisma.holderLockup.findUnique({
    where: { id: lockupId },
    include: {
      token: true,
      investor: true,
    },
  });
}

/**
 * Get all lockups for a token
 */
export async function getTokenLockups(tokenId: string) {
  return prisma.holderLockup.findMany({
    where: { tokenId },
    orderBy: { unlockTimestamp: 'asc' },
    include: {
      investor: {
        select: { id: true, walletAddress: true, fullName: true },
      },
    },
  });
}

/**
 * Get all lockups for an investor
 */
export async function getInvestorLockups(investorId: string) {
  return prisma.holderLockup.findMany({
    where: { investorId },
    orderBy: { unlockTimestamp: 'asc' },
    include: {
      token: {
        select: { id: true, symbol: true, name: true },
      },
    },
  });
}

/**
 * Check lockup status for a specific holder
 */
export async function checkLockupStatus(
  tokenId: string,
  investorId: string
): Promise<LockupStatus | null> {
  const lockup = await prisma.holderLockup.findFirst({
    where: { tokenId, investorId },
    orderBy: { unlockTimestamp: 'desc' },
    include: {
      investor: { select: { walletAddress: true } },
    },
  });

  if (!lockup) {
    return null;
  }

  const now = new Date();
  const isLocked = lockup.unlockTimestamp > now;
  const remainingMs = Math.max(0, lockup.unlockTimestamp.getTime() - now.getTime());
  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

  // Generate hash for verification
  const lockupHash = generateLockupHash(
    tokenId,
    lockup.investor.walletAddress,
    lockup.unlockTimestamp,
    lockup.lockupType as LockupType
  );

  // Calculate vesting info if applicable
  let vestingInfo: VestingInfo | undefined;
  if (lockup.vestingSchedule && lockup.lockupType === LockupType.VESTING) {
    vestingInfo = calculateVestingInfo(
      lockup.vestingSchedule as unknown as VestingSchedule,
      lockup.createdAt
    );
  }

  return {
    isLocked,
    unlockTimestamp: lockup.unlockTimestamp,
    lockupType: lockup.lockupType as LockupType,
    remainingDays,
    lockupHash,
    vestingInfo,
  };
}

/**
 * Check if transfer is allowed (not locked)
 */
export async function isTransferAllowed(
  tokenId: string,
  fromInvestorId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const status = await checkLockupStatus(tokenId, fromInvestorId);

  if (!status) {
    // No lockup found - transfer allowed
    return { allowed: true };
  }

  if (status.isLocked) {
    return {
      allowed: false,
      reason: `Tokens locked until ${status.unlockTimestamp.toISOString()}. Lockup type: ${status.lockupType}. ${status.remainingDays} days remaining.`,
    };
  }

  return { allowed: true };
}

/**
 * Update lockup unlock timestamp
 */
export async function extendLockup(
  lockupId: string,
  newUnlockTimestamp: Date,
  reason: string
) {
  const existing = await prisma.holderLockup.findUnique({
    where: { id: lockupId },
  });

  if (!existing) {
    throw new Error(`Lockup ${lockupId} not found`);
  }

  if (newUnlockTimestamp <= existing.unlockTimestamp) {
    throw new Error('New unlock timestamp must be later than current');
  }

  const updated = await prisma.holderLockup.update({
    where: { id: lockupId },
    data: {
      unlockTimestamp: newUnlockTimestamp,
      lockupReason: `${existing.lockupReason || ''}\nExtended: ${reason}`,
      onChainSynced: false, // Needs re-sync
    },
  });

  logger.info('Lockup extended', {
    lockupId,
    previousUnlock: existing.unlockTimestamp,
    newUnlock: newUnlockTimestamp,
    reason,
  });

  return updated;
}

/**
 * Remove lockup (early release)
 */
export async function removeLockup(lockupId: string, reason: string) {
  const existing = await prisma.holderLockup.findUnique({
    where: { id: lockupId },
  });

  if (!existing) {
    throw new Error(`Lockup ${lockupId} not found`);
  }

  // Set unlock to now instead of deleting (for audit trail)
  const updated = await prisma.holderLockup.update({
    where: { id: lockupId },
    data: {
      unlockTimestamp: new Date(),
      lockupReason: `${existing.lockupReason || ''}\nEarly release: ${reason}`,
      onChainSynced: false, // Needs re-sync
    },
  });

  logger.warn('Lockup removed early', { lockupId, reason });

  return updated;
}

/**
 * Mark lockup as synced to blockchain
 */
export async function markSyncedOnChain(lockupId: string, txHash: string) {
  const updated = await prisma.holderLockup.update({
    where: { id: lockupId },
    data: {
      onChainSynced: true,
      syncTxHash: txHash,
    },
  });

  logger.info('Lockup synced on-chain', { lockupId, txHash });

  return updated;
}

/**
 * Get lockups pending on-chain sync
 */
export async function getPendingSyncLockups() {
  return prisma.holderLockup.findMany({
    where: { onChainSynced: false },
    include: {
      investor: { select: { walletAddress: true } },
      token: { select: { contractAddress: true } },
    },
  });
}

/**
 * Get active lockups (not yet unlocked)
 */
export async function getActiveLockups(tokenId?: string) {
  const now = new Date();
  return prisma.holderLockup.findMany({
    where: {
      ...(tokenId ? { tokenId } : {}),
      unlockTimestamp: { gt: now },
    },
    orderBy: { unlockTimestamp: 'asc' },
    include: {
      token: { select: { id: true, symbol: true } },
      investor: { select: { id: true, fullName: true, walletAddress: true } },
    },
  });
}

/**
 * Get lockups expiring soon (for alerts)
 */
export async function getExpiringLockups(daysUntilExpiry: number = 30) {
  const now = new Date();
  const expiryThreshold = new Date(
    now.getTime() + daysUntilExpiry * 24 * 60 * 60 * 1000
  );

  return prisma.holderLockup.findMany({
    where: {
      unlockTimestamp: {
        gt: now,
        lte: expiryThreshold,
      },
    },
    orderBy: { unlockTimestamp: 'asc' },
    include: {
      token: { select: { id: true, symbol: true } },
      investor: { select: { id: true, fullName: true } },
    },
  });
}

/**
 * Get lockup statistics
 */
export async function getLockupStatistics(tokenId?: string) {
  const now = new Date();
  const whereClause = tokenId ? { tokenId } : {};

  const [total, active, expired, byType] = await Promise.all([
    prisma.holderLockup.count({ where: whereClause }),
    prisma.holderLockup.count({
      where: { ...whereClause, unlockTimestamp: { gt: now } },
    }),
    prisma.holderLockup.count({
      where: { ...whereClause, unlockTimestamp: { lte: now } },
    }),
    prisma.holderLockup.groupBy({
      by: ['lockupType'],
      where: whereClause,
      _count: true,
    }),
  ]);

  return {
    total,
    active,
    expired,
    byType: byType.reduce(
      (acc, item) => {
        acc[item.lockupType] = item._count;
        return acc;
      },
      {} as Record<string, number>
    ),
  };
}

/**
 * Batch create lockups for multiple investors
 */
export async function batchCreateLockups(
  tokenId: string,
  investorIds: string[],
  lockupType: LockupType,
  lockupDays?: number
) {
  const results = await Promise.all(
    investorIds.map((investorId) =>
      createLockup({
        tokenId,
        investorId,
        lockupType,
        lockupDays,
      })
    )
  );

  logger.info('Batch lockups created', {
    tokenId,
    count: investorIds.length,
    lockupType,
  });

  return results;
}

/**
 * Calculate vesting info from schedule
 */
function calculateVestingInfo(
  schedule: VestingSchedule,
  startDate: Date
): VestingInfo {
  const now = new Date();
  const cliffEnd = new Date(
    startDate.getTime() + schedule.cliffDays * 24 * 60 * 60 * 1000
  );

  // Check if still in cliff period
  if (now < cliffEnd) {
    return {
      totalPeriods: schedule.periods.length,
      vestedPeriods: 0,
      nextVestingDate: cliffEnd,
      vestedPercentage: 0,
    };
  }

  // Calculate vested periods
  let vestedPeriods = 0;
  let nextVestingDate: Date | null = null;
  let cumulativeDays = schedule.cliffDays;

  for (let i = 0; i < schedule.periods.length; i++) {
    cumulativeDays += schedule.periods[i];
    const vestDate = new Date(
      startDate.getTime() + cumulativeDays * 24 * 60 * 60 * 1000
    );

    if (now >= vestDate) {
      vestedPeriods = i + 1;
    } else if (!nextVestingDate) {
      nextVestingDate = vestDate;
    }
  }

  // Calculate vested percentage
  const totalAmount = schedule.amounts.reduce(
    (sum, amt) => sum + parseFloat(amt),
    0
  );
  const vestedAmount = schedule.amounts
    .slice(0, vestedPeriods)
    .reduce((sum, amt) => sum + parseFloat(amt), 0);
  const vestedPercentage = totalAmount > 0 ? (vestedAmount / totalAmount) * 100 : 0;

  return {
    totalPeriods: schedule.periods.length,
    vestedPeriods,
    nextVestingDate,
    vestedPercentage,
  };
}
