import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config';
import { logger } from '../utils/logger';

// Redis connection config
const connection = {
  host: config.redis.url.split('://')[1].split(':')[0],
  port: parseInt(config.redis.url.split(':')[2] || '6379'),
};

/**
 * Job Queues
 */
export const tokenDeploymentQueue = new Queue('token-deployment', { connection });
export const complianceCheckQueue = new Queue('compliance-check', { connection });
export const settlementQueue = new Queue('settlement', { connection });
export const reportingQueue = new Queue('reporting', { connection });
export const notificationQueue = new Queue('notification', { connection });

/**
 * Add job to deployment queue
 */
export async function scheduleTokenDeployment(tokenId: string) {
  await tokenDeploymentQueue.add(
    'deploy-token',
    { tokenId },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 500, // Keep last 500 failed jobs
    }
  );

  logger.info('Token deployment job scheduled', { tokenId });
}

/**
 * Add compliance check job
 */
export async function scheduleComplianceCheck(transferId: string) {
  await complianceCheckQueue.add(
    'check-transfer-compliance',
    { transferId },
    {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 5000,
      },
    }
  );

  logger.info('Compliance check job scheduled', { transferId });
}

/**
 * Add settlement job
 */
export async function scheduleSettlement(transferId: string, scheduledFor?: Date) {
  await settlementQueue.add(
    'execute-settlement',
    { transferId },
    {
      delay: scheduledFor ? scheduledFor.getTime() - Date.now() : 0,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );

  logger.info('Settlement job scheduled', {
    transferId,
    scheduledFor: scheduledFor?.toISOString(),
  });
}

/**
 * Add daily reporting job
 */
export async function scheduleDailyReports(date: Date) {
  await reportingQueue.add(
    'generate-daily-reports',
    { date: date.toISOString() },
    {
      attempts: 2,
      removeOnComplete: 30, // Keep last 30 days
    }
  );

  logger.info('Daily reports job scheduled', { date: date.toISOString() });
}

/**
 * Send notification
 */
export async function sendNotification(
  type: string,
  recipientId: string,
  payload: any
) {
  await notificationQueue.add(
    'send-notification',
    { type, recipientId, payload },
    {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 1000,
      },
    }
  );
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [deployment, compliance, settlement, reporting, notification] = await Promise.all([
    tokenDeploymentQueue.getJobCounts(),
    complianceCheckQueue.getJobCounts(),
    settlementQueue.getJobCounts(),
    reportingQueue.getJobCounts(),
    notificationQueue.getJobCounts(),
  ]);

  return {
    tokenDeployment: deployment,
    complianceCheck: compliance,
    settlement,
    reporting,
    notification,
  };
}

/**
 * Clean up completed jobs (run periodically)
 */
export async function cleanupOldJobs() {
  const queues = [
    tokenDeploymentQueue,
    complianceCheckQueue,
    settlementQueue,
    reportingQueue,
    notificationQueue,
  ];

  for (const queue of queues) {
    await queue.clean(7 * 24 * 60 * 60 * 1000, 1000, 'completed'); // 7 days
    await queue.clean(30 * 24 * 60 * 60 * 1000, 1000, 'failed'); // 30 days
  }

  logger.info('Old jobs cleaned up');
}
