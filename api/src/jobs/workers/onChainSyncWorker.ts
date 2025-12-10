/**
 * On-Chain Sync Worker
 *
 * Synchronizes compliance status changes to the ComplianceRegistry smart contract.
 * Implements the bridge between off-chain database and on-chain enforcement.
 */

import { ethers } from 'ethers';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { PrismaClient } from '@prisma/client';
import { ComplianceStatus } from '../../types/conflicts';

const prisma = new PrismaClient();
const USE_MOCK = process.env.USE_MOCK_QUEUE === 'true';

let Worker: any;
let connection: any;

if (!USE_MOCK) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bullmq = require('bullmq');
  Worker = bullmq.Worker;
  connection = {
    host: config.redis.url.split('://')[1].split(':')[0],
    port: parseInt(config.redis.url.split(':')[2] || '6379'),
  };
}

// ============= ABI for ComplianceRegistry =============

const COMPLIANCE_REGISTRY_ABI = [
  'function batchUpdateStatus(address[] investors, uint8[] statuses) external',
  'function updateStatus(address investor, uint8 newStatus) external',
  'function getStatus(address investor) external view returns (uint8 status, uint256 updatedBlock)',
  'function batchGetStatus(address[] investors) external view returns (uint8[] statuses)',
  'function RULESET_VERSION() external view returns (string)',
  'event StatusUpdated(address indexed investor, uint8 oldStatus, uint8 newStatus, address indexed updatedBy)',
];

// ============= Status Mapping =============

/**
 * Maps TypeScript ComplianceStatus to Solidity enum uint8
 * Must match the enum order in ICompliance.sol:
 *   UNAUTHORIZED = 0
 *   APPROVED = 1
 *   GRANDFATHERED = 2
 *   FROZEN = 3
 */
const STATUS_TO_UINT: Record<string, number> = {
  [ComplianceStatus.UNAUTHORIZED]: 0,
  [ComplianceStatus.APPROVED]: 1,
  [ComplianceStatus.GRANDFATHERED]: 2,
  [ComplianceStatus.FROZEN]: 3,
};

const UINT_TO_STATUS: Record<number, string> = {
  0: ComplianceStatus.UNAUTHORIZED,
  1: ComplianceStatus.APPROVED,
  2: ComplianceStatus.GRANDFATHERED,
  3: ComplianceStatus.FROZEN,
};

// ============= Interfaces =============

interface OnChainSyncPayload {
  entityType: string;
  entityId: string;
  contractAddress: string;
  chainId: number;
  dataHash: string;
}

interface ComplianceStatusSyncPayload {
  investorIds: string[];
  contractAddress?: string;
  chainId?: number;
}

interface SyncResult {
  success: boolean;
  txHash?: string;
  syncedCount: number;
  failedCount: number;
  duration: number;
  message: string;
}

// ============= Provider & Contract Setup =============

/**
 * Get ethers provider for the specified chain
 */
function getProvider(chainId?: number): ethers.JsonRpcProvider {
  const rpcUrl = chainId === 137
    ? process.env.POLYGON_RPC_URL
    : chainId === 1
    ? process.env.ETHEREUM_RPC_URL
    : process.env.SEPOLIA_RPC_URL;

  if (!rpcUrl) {
    throw new Error(`No RPC URL configured for chainId ${chainId}`);
  }

  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Get signer (oracle wallet) for transactions
 */
function getOracleSigner(provider: ethers.JsonRpcProvider): ethers.Wallet {
  const privateKey = process.env.ORACLE_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('ORACLE_PRIVATE_KEY not configured');
  }

  return new ethers.Wallet(privateKey, provider);
}

/**
 * Get ComplianceRegistry contract instance
 */
function getRegistryContract(
  address: string,
  signer: ethers.Wallet
): ethers.Contract {
  return new ethers.Contract(address, COMPLIANCE_REGISTRY_ABI, signer);
}

// ============= Core Sync Functions =============

/**
 * Sync compliance statuses to blockchain (batch operation)
 * This is the main function that bridges off-chain status to on-chain.
 */
export async function syncComplianceStatuses(
  payload: ComplianceStatusSyncPayload
): Promise<SyncResult> {
  const startTime = Date.now();
  const { investorIds, contractAddress, chainId } = payload;

  const registryAddress = contractAddress || process.env.COMPLIANCE_REGISTRY_ADDRESS;
  const targetChainId = chainId || 11155111; // Default to Sepolia

  if (!registryAddress) {
    return {
      success: false,
      syncedCount: 0,
      failedCount: investorIds.length,
      duration: Date.now() - startTime,
      message: 'COMPLIANCE_REGISTRY_ADDRESS not configured',
    };
  }

  logger.info('🔗 Starting compliance status sync to blockchain', {
    investorCount: investorIds.length,
    registryAddress,
    chainId: targetChainId,
  });

  try {
    // 1. Fetch investors from database
    const investors = await prisma.investor.findMany({
      where: { id: { in: investorIds } },
      select: {
        id: true,
        walletAddress: true,
        complianceStatus: true,
        onChainSynced: true,
      },
    });

    if (investors.length === 0) {
      return {
        success: true,
        syncedCount: 0,
        failedCount: 0,
        duration: Date.now() - startTime,
        message: 'No investors found to sync',
      };
    }

    // 2. Filter to only unsync'd investors with valid wallet addresses
    const toSync = investors.filter(
      (inv) =>
        inv.walletAddress &&
        ethers.isAddress(inv.walletAddress) &&
        !inv.onChainSynced
    );

    if (toSync.length === 0) {
      return {
        success: true,
        syncedCount: 0,
        failedCount: 0,
        duration: Date.now() - startTime,
        message: 'All investors already synced or have invalid addresses',
      };
    }

    // 3. Prepare batch data
    const addresses: string[] = [];
    const statuses: number[] = [];

    for (const inv of toSync) {
      const statusUint = STATUS_TO_UINT[inv.complianceStatus];
      if (statusUint === undefined) {
        logger.warn('Unknown compliance status, skipping', {
          investorId: inv.id,
          status: inv.complianceStatus,
        });
        continue;
      }
      addresses.push(inv.walletAddress);
      statuses.push(statusUint);
    }

    if (addresses.length === 0) {
      return {
        success: true,
        syncedCount: 0,
        failedCount: toSync.length,
        duration: Date.now() - startTime,
        message: 'No valid statuses to sync',
      };
    }

    // 4. Execute blockchain transaction
    const provider = getProvider(targetChainId);
    const signer = getOracleSigner(provider);
    const registry = getRegistryContract(registryAddress, signer);

    logger.info('📤 Sending batchUpdateStatus transaction', {
      addressCount: addresses.length,
      oracleAddress: signer.address,
    });

    const tx = await registry.batchUpdateStatus(addresses, statuses);
    logger.info('⏳ Transaction sent, waiting for confirmation', {
      txHash: tx.hash,
    });

    const receipt = await tx.wait();

    logger.info('✅ Transaction confirmed', {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    });

    // 5. Update database to mark as synced
    const syncedIds = toSync
      .filter((inv) => addresses.includes(inv.walletAddress))
      .map((inv) => inv.id);

    await prisma.investor.updateMany({
      where: { id: { in: syncedIds } },
      data: {
        onChainSynced: true,
        onChainSyncedAt: new Date(),
        onChainTxHash: receipt.hash,
      },
    });

    // 6. Record in OnChainComplianceSync table
    await prisma.onChainComplianceSync.create({
      data: {
        entityType: 'investor_batch',
        entityId: syncedIds.join(',').slice(0, 255), // Truncate if too long
        contractAddress: registryAddress,
        chainId: targetChainId,
        dataHash: ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['address[]', 'uint8[]'],
            [addresses, statuses]
          )
        ),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        syncStatus: 'confirmed',
        confirmedAt: new Date(),
      },
    });

    return {
      success: true,
      txHash: receipt.hash,
      syncedCount: syncedIds.length,
      failedCount: investorIds.length - syncedIds.length,
      duration: Date.now() - startTime,
      message: `Successfully synced ${syncedIds.length} investors to blockchain`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('❌ Compliance status sync failed', {
      error: errorMessage,
      investorIds,
    });

    // Record failed attempt
    await prisma.onChainComplianceSync.create({
      data: {
        entityType: 'investor_batch',
        entityId: investorIds.join(',').slice(0, 255),
        contractAddress: registryAddress || 'unknown',
        chainId: targetChainId,
        dataHash: 'failed',
        syncStatus: 'failed',
        errorMessage: errorMessage.slice(0, 500),
      },
    });

    return {
      success: false,
      syncedCount: 0,
      failedCount: investorIds.length,
      duration: Date.now() - startTime,
      message: `Sync failed: ${errorMessage}`,
    };
  }
}

/**
 * Get investors pending on-chain sync
 */
export async function getPendingComplianceSync(limit: number = 50) {
  return prisma.investor.findMany({
    where: {
      onChainSynced: false,
      walletAddress: { not: '' },
    },
    select: {
      id: true,
      walletAddress: true,
      complianceStatus: true,
      complianceStatusAt: true,
    },
    orderBy: { complianceStatusAt: 'asc' },
    take: limit,
  });
}

/**
 * Scheduled job: Sync all pending compliance statuses
 */
export async function runScheduledComplianceSync(): Promise<SyncResult> {
  logger.info('🕐 Running scheduled compliance sync job');

  const pending = await getPendingComplianceSync(50);

  if (pending.length === 0) {
    logger.info('✅ No pending compliance syncs');
    return {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      duration: 0,
      message: 'No pending syncs',
    };
  }

  return syncComplianceStatuses({
    investorIds: pending.map((p) => p.id),
  });
}

/**
 * Verify on-chain status matches database
 */
export async function verifyOnChainStatus(investorId: string): Promise<{
  match: boolean;
  dbStatus: string;
  chainStatus: string;
  blockNumber?: number;
}> {
  const investor = await prisma.investor.findUnique({
    where: { id: investorId },
    select: { walletAddress: true, complianceStatus: true },
  });

  if (!investor?.walletAddress) {
    throw new Error('Investor not found or no wallet address');
  }

  const registryAddress = process.env.COMPLIANCE_REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new Error('COMPLIANCE_REGISTRY_ADDRESS not configured');
  }

  const provider = getProvider();
  const registry = new ethers.Contract(
    registryAddress,
    COMPLIANCE_REGISTRY_ABI,
    provider
  );

  const [statusUint, updatedBlock] = await registry.getStatus(investor.walletAddress);
  const chainStatus = UINT_TO_STATUS[Number(statusUint)] || 'unknown';

  return {
    match: chainStatus === investor.complianceStatus,
    dbStatus: investor.complianceStatus,
    chainStatus,
    blockNumber: Number(updatedBlock),
  };
}

// ============= Legacy Functions (for backwards compatibility) =============

/**
 * Process on-chain sync job (legacy, for non-compliance-status entities)
 */
async function processOnChainSync(job: { data: OnChainSyncPayload; id: string }) {
  const { entityType, entityId, contractAddress, chainId, dataHash } = job.data;

  logger.info('Processing on-chain sync job', {
    jobId: job.id,
    entityType,
    entityId,
    contractAddress,
    chainId,
  });

  try {
    const startTime = Date.now();

    // For compliance_status type, use the new sync function
    if (entityType === 'compliance_status') {
      const result = await syncComplianceStatuses({
        investorIds: [entityId],
        contractAddress,
        chainId,
      });
      return result;
    }

    // Legacy: Mock transaction for other entity types
    const mockTxHash = `0x${Buffer.from(
      `sync-${entityType}-${entityId}-${Date.now()}`
    )
      .toString('hex')
      .padEnd(64, '0')}`;

    // Record the sync in database
    await prisma.onChainComplianceSync.create({
      data: {
        entityType,
        entityId,
        contractAddress,
        chainId,
        dataHash,
        txHash: mockTxHash,
        blockNumber: Math.floor(Date.now() / 1000),
        syncStatus: 'confirmed',
      },
    });

    // Update the source entity based on type
    switch (entityType) {
      case 'sanctions_check':
        await prisma.sanctionsCheck.update({
          where: { id: entityId },
          data: {
            recordedOnChain: true,
            onChainTxHash: mockTxHash,
          },
        });
        break;

      case 'attestation':
        await prisma.assetAttestation.update({
          where: { id: entityId },
          data: {
            onChainTxHash: mockTxHash,
          },
        });
        break;

      case 'lockup':
        await prisma.holderLockup.update({
          where: { id: entityId },
          data: {
            onChainSynced: true,
            syncTxHash: mockTxHash,
          },
        });
        break;

      default:
        logger.warn('Unknown entity type for on-chain sync', { entityType, entityId });
    }

    const duration = Date.now() - startTime;

    logger.info('On-chain sync completed', {
      jobId: job.id,
      entityType,
      entityId,
      txHash: mockTxHash,
      durationMs: duration,
    });

    return {
      success: true,
      txHash: mockTxHash,
      duration,
    };
  } catch (error) {
    await prisma.onChainComplianceSync.create({
      data: {
        entityType,
        entityId,
        contractAddress,
        chainId,
        dataHash,
        syncStatus: 'failed',
      },
    });

    logger.error('On-chain sync job failed', {
      jobId: job.id,
      entityType,
      entityId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Get pending syncs for retry (legacy)
 */
export async function getPendingSyncs() {
  return prisma.onChainComplianceSync.findMany({
    where: {
      syncStatus: { in: ['pending', 'failed'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
}

/**
 * Get sync statistics
 */
export async function getSyncStatistics() {
  const [total, completed, pending, failed] = await Promise.all([
    prisma.onChainComplianceSync.count(),
    prisma.onChainComplianceSync.count({ where: { syncStatus: 'confirmed' } }),
    prisma.onChainComplianceSync.count({ where: { syncStatus: 'pending' } }),
    prisma.onChainComplianceSync.count({ where: { syncStatus: 'failed' } }),
  ]);

  const pendingInvestors = await prisma.investor.count({
    where: { onChainSynced: false },
  });

  return { total, completed, pending, failed, pendingInvestors };
}

/**
 * Initialize the worker
 */
export function initOnChainSyncWorker() {
  if (USE_MOCK) {
    logger.info('On-chain sync worker running in mock mode');
    return null;
  }

  const worker = new Worker(
    'on-chain-sync',
    async (job: { data: OnChainSyncPayload; id: string }) => {
      return processOnChainSync(job);
    },
    {
      connection,
      concurrency: 2,
      limiter: {
        max: 10,
        duration: 1000,
      },
    }
  );

  worker.on('completed', (job: { id: string }, result: unknown) => {
    logger.info('On-chain sync job completed', { jobId: job.id, result });
  });

  worker.on('failed', (job: { id: string } | undefined, error: Error) => {
    logger.error('On-chain sync job failed', { jobId: job?.id, error: error.message });
  });

  logger.info('On-chain sync worker initialized');

  return worker;
}

// Export for manual processing
export { processOnChainSync };

// Default export for worker
export const onChainSyncWorker = USE_MOCK ? null : initOnChainSyncWorker();
