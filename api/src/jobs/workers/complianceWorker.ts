import { Worker, Job } from 'bullmq';
import { prisma } from '../../config/prisma';
import { checkTransferCompliance } from '../../services/compliance';
import { logger } from '../../utils/logger';

const connection = {
  host: process.env.REDIS_URL?.split('://')[1].split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
};

/**
 * Compliance Check Worker
 *
 * Runs compliance checks for transfers in the background
 */
export const complianceWorker = new Worker(
  'compliance-check',
  async (job: Job) => {
    const { transferId } = job.data;

    logger.info('Processing compliance check job', {
      jobId: job.id,
      transferId,
    });

    try {
      // Fetch transfer with related data
      const transfer = await prisma.transfer.findUnique({
        where: { id: transferId },
        include: {
          token: true,
          fromInvestor: true,
        },
      });

      if (!transfer || !transfer.fromInvestor) {
        throw new Error('Transfer or investor not found');
      }

      // Get recipient investor
      const toInvestor = await prisma.investor.findFirst({
        where: { walletAddress: transfer.toAddress },
      });

      if (!toInvestor) {
        throw new Error('Recipient investor not found');
      }

      // Run compliance checks
      const result = await checkTransferCompliance({
        tokenId: transfer.tokenId,
        fromInvestor: transfer.fromInvestor,
        toInvestor,
        amount: transfer.amount,
      });

      // Update transfer with compliance results
      await prisma.transfer.update({
        where: { id: transferId },
        data: {
          status: result.approved ? 'approved' : 'failed',
          complianceChecks: result.checks,
          complianceResult: result.approved,
          failureReason: result.failureReason,
        },
      });

      logger.info('Compliance check completed', {
        jobId: job.id,
        transferId,
        approved: result.approved,
      });

      return { success: true, approved: result.approved };
    } catch (error) {
      logger.error('Compliance check failed', {
        jobId: job.id,
        transferId,
        error,
      });

      // Mark transfer as failed
      await prisma.transfer.update({
        where: { id: transferId },
        data: {
          status: 'failed',
          failureReason: 'Compliance check error',
        },
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 10, // Higher concurrency for compliance checks
  }
);

complianceWorker.on('completed', (job) => {
  logger.info('Compliance check job completed', {
    jobId: job.id,
  });
});

complianceWorker.on('failed', (job, error) => {
  logger.error('Compliance check job failed', {
    jobId: job?.id,
    error: error.message,
  });
});
