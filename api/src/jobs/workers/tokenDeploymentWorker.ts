import { Worker, Job } from 'bullmq';
import { deployTokenContract } from '../../services/blockchain';
import { logger } from '../../utils/logger';

const connection = {
  host: process.env.REDIS_URL?.split('://')[1].split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
};

/**
 * Token Deployment Worker
 *
 * Processes token deployment jobs in the background
 */
export const tokenDeploymentWorker = new Worker(
  'token-deployment',
  async (job: Job) => {
    const { tokenId } = job.data;

    logger.info('Processing token deployment job', {
      jobId: job.id,
      tokenId,
      attempt: job.attemptsMade + 1,
    });

    try {
      await deployTokenContract(tokenId);

      logger.info('Token deployment completed successfully', {
        jobId: job.id,
        tokenId,
      });

      return { success: true, tokenId };
    } catch (error) {
      logger.error('Token deployment failed', {
        jobId: job.id,
        tokenId,
        error,
        attempt: job.attemptsMade + 1,
      });

      throw error; // Will trigger retry
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 deployments concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 1000, // per second
    },
  }
);

tokenDeploymentWorker.on('completed', (job) => {
  logger.info('Token deployment job completed', {
    jobId: job.id,
    result: job.returnvalue,
  });
});

tokenDeploymentWorker.on('failed', (job, error) => {
  logger.error('Token deployment job failed permanently', {
    jobId: job?.id,
    error: error.message,
  });
});

tokenDeploymentWorker.on('error', (error) => {
  logger.error('Token deployment worker error', { error });
});
