import { Worker, Job } from 'bullmq';
import { deployTokenContract } from '../../services/blockchain';
import { logger } from '../../utils/logger';
import { runPreflightComplianceCheck } from '../../services/preflightCheck';

const connection = {
  host: process.env.REDIS_URL?.split('://')[1].split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
};

/**
 * Token Deployment Worker
 *
 * Processes token deployment jobs in the background.
 * Includes preflight compliance checks before blockchain deployment.
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
      // ===== PREFLIGHT COMPLIANCE CHECK =====
      // Run comprehensive compliance checks before deployment
      logger.info('Running preflight compliance check', { tokenId });

      const preflightResult = await runPreflightComplianceCheck(tokenId);

      logger.info('Preflight check completed', {
        tokenId,
        passed: preflightResult.passed,
        checkCount: preflightResult.checks.length,
        failedChecks: preflightResult.checks
          .filter((c) => c.status === 'failed')
          .map((c) => c.name),
      });

      if (!preflightResult.passed) {
        throw new Error(`Preflight failed: ${preflightResult.reason}`);
      }

      // ===== BLOCKCHAIN DEPLOYMENT =====
      await deployTokenContract(tokenId);

      logger.info('Token deployment completed successfully', {
        jobId: job.id,
        tokenId,
        preflightChecks: preflightResult.checks.map((c) => ({
          name: c.name,
          status: c.status,
        })),
      });

      return {
        success: true,
        tokenId,
        preflight: {
          passed: preflightResult.passed,
          checks: preflightResult.checks,
        },
      };
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
