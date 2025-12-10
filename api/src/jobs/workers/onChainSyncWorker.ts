/**
 * On-Chain Sync Worker
 *
 * Batch syncs compliance hashes to blockchain contracts.
 */

import { config } from '../../config';
import { logger } from '../../utils/logger';
import { PrismaClient } from '@prisma/client';

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

interface OnChainSyncPayload {
  entityType: string;
  entityId: string;
  contractAddress: string;
  chainId: number;
  dataHash: string;
}

/**
 * Process on-chain sync job
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

    // TODO: Implement actual on-chain transaction
    // This would use ethers.js to call the appropriate contract
    // For now, simulate the transaction

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
        blockNumber: Math.floor(Date.now() / 1000), // Mock block number
        syncStatus: 'completed',
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
    // Record failed sync attempt
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
 * Get pending syncs for retry
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
    prisma.onChainComplianceSync.count({ where: { syncStatus: 'completed' } }),
    prisma.onChainComplianceSync.count({ where: { syncStatus: 'pending' } }),
    prisma.onChainComplianceSync.count({ where: { syncStatus: 'failed' } }),
  ]);

  return { total, completed, pending, failed };
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
      concurrency: 2, // Lower concurrency due to blockchain rate limits
      limiter: {
        max: 10,
        duration: 1000, // Max 10 txs per second
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
