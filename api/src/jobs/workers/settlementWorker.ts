import { Worker, Job } from 'bullmq';
import { prisma } from '../../config/prisma';
import { executeTransfer } from '../../services/blockchain';
import { sendNotification } from '../index';
import { logger } from '../../utils/logger';

const connection = {
  host: process.env.REDIS_URL?.split('://')[1].split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
};

/**
 * Settlement Worker
 *
 * Executes on-chain transfers and settlement operations
 */
export const settlementWorker = new Worker(
  'settlement',
  async (job: Job) => {
    const { transferId } = job.data;

    logger.info('Processing settlement job', {
      jobId: job.id,
      transferId,
    });

    try {
      // Fetch transfer
      const transfer = await prisma.transfer.findUnique({
        where: { id: transferId },
      });

      if (!transfer) {
        throw new Error('Transfer not found');
      }

      if (transfer.status !== 'approved') {
        throw new Error('Transfer must be approved before settlement');
      }

      // Execute on-chain transfer
      const { txHash, blockNumber } = await executeTransfer(transferId);

      // Update transfer status
      await prisma.transfer.update({
        where: { id: transferId },
        data: {
          status: 'executed',
          txHash,
          blockNumber,
          executedAt: new Date(),
        },
      });

      // Send notifications
      if (transfer.fromInvestorId) {
        await sendNotification('transfer_executed', transfer.fromInvestorId, {
          transferId,
          txHash,
        });
      }

      logger.info('Settlement completed successfully', {
        jobId: job.id,
        transferId,
        txHash,
      });

      return { success: true, txHash, blockNumber };
    } catch (error) {
      logger.error('Settlement failed', {
        jobId: job.id,
        transferId,
        error,
      });

      // Update transfer to failed status
      await prisma.transfer.update({
        where: { id: transferId },
        data: {
          status: 'failed',
          failureReason: `Settlement error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 3, // Lower concurrency for blockchain transactions
    limiter: {
      max: 5, // Max 5 settlements
      duration: 1000, // per second (to avoid gas spikes)
    },
  }
);

settlementWorker.on('completed', (job) => {
  logger.info('Settlement job completed', {
    jobId: job.id,
    result: job.returnvalue,
  });
});

settlementWorker.on('failed', (job, error) => {
  logger.error('Settlement job failed', {
    jobId: job?.id,
    error: error.message,
  });
});
