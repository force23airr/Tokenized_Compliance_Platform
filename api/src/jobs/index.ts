import { config } from '../config';
import { logger } from '../utils/logger';

const USE_MOCK = process.env.USE_MOCK_QUEUE === 'true';

let Queue: any;
let connection: any;

if (!USE_MOCK) {
  // Use real BullMQ
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  connection = {
    host: config.redis.url.split('://')[1].split(':')[0],
    port: parseInt(config.redis.url.split(':')[2] || '6379'),
  };
} else {
  // Use mock queue
  Queue = class MockQueue {
    constructor(public name: string) {
      logger.info(`Using mock queue: ${name}`);
    }
    async add() { return { id: 'mock-' + Date.now() }; }
    async getJobCounts() {
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
    async clean() {}
  };
}

/**
 * Job Queues
 */
export const tokenDeploymentQueue = new Queue('token-deployment', connection ? { connection } : {});
export const complianceCheckQueue = new Queue('compliance-check', connection ? { connection } : {});
export const settlementQueue = new Queue('settlement', connection ? { connection } : {});
export const reportingQueue = new Queue('reporting', connection ? { connection } : {});
export const notificationQueue = new Queue('notification', connection ? { connection } : {});

// New compliance queues
export const sanctionsCheckQueue = new Queue('sanctions-check', connection ? { connection } : {});
export const attestationVerifyQueue = new Queue('attestation-verify', connection ? { connection } : {});
export const travelRuleQueue = new Queue('travel-rule', connection ? { connection } : {});
export const onChainSyncQueue = new Queue('on-chain-sync', connection ? { connection } : {});
export const complianceCaseQueue = new Queue('compliance-case', connection ? { connection } : {});

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
 * Schedule sanctions check with multi-provider fallback
 */
export async function scheduleSanctionsCheck(
  investorId: string,
  walletAddress: string,
  jurisdiction: string,
  providers: string[] = ['chainalysis', 'elliptic', 'ofac']
) {
  const job = await sanctionsCheckQueue.add(
    'run-sanctions-check',
    { investorId, walletAddress, jurisdiction, providers },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 3000,
      },
      removeOnComplete: 200,
      removeOnFail: 500,
    }
  );

  logger.info('Sanctions check job scheduled', { investorId, jobId: job.id });
  return job;
}

/**
 * Schedule attestation verification
 */
export async function scheduleAttestationVerification(
  attestationId: string,
  verifySignature: boolean = true
) {
  const job = await attestationVerifyQueue.add(
    'verify-attestation',
    { attestationId, verifySignature },
    {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 2000,
      },
      removeOnComplete: 100,
    }
  );

  logger.info('Attestation verification job scheduled', { attestationId, jobId: job.id });
  return job;
}

/**
 * Schedule travel rule processing
 */
export async function scheduleTravelRuleProcessing(
  transferId: string,
  transferValueUSD: number
) {
  const job = await travelRuleQueue.add(
    'process-travel-rule',
    { transferId, transferValueUSD },
    {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 2000,
      },
      removeOnComplete: 200,
    }
  );

  logger.info('Travel rule job scheduled', { transferId, jobId: job.id });
  return job;
}

/**
 * Schedule on-chain sync
 */
export async function scheduleOnChainSync(
  entityType: string,
  entityId: string,
  contractAddress: string,
  chainId: number,
  dataHash: string
) {
  const job = await onChainSyncQueue.add(
    'sync-to-chain',
    { entityType, entityId, contractAddress, chainId, dataHash },
    {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    }
  );

  logger.info('On-chain sync job scheduled', { entityType, entityId, jobId: job.id });
  return job;
}

/**
 * Schedule compliance case processing
 */
export async function scheduleComplianceCaseProcessing(
  caseId: string,
  action: 'create' | 'update' | 'review' | 'close'
) {
  const job = await complianceCaseQueue.add(
    `compliance-case-${action}`,
    { caseId, action },
    {
      attempts: 2,
      backoff: {
        type: 'fixed',
        delay: 1000,
      },
    }
  );

  logger.info('Compliance case job scheduled', { caseId, action, jobId: job.id });
  return job;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const [
    deployment,
    compliance,
    settlement,
    reporting,
    notification,
    sanctions,
    attestation,
    travelRule,
    onChainSync,
    complianceCase,
  ] = await Promise.all([
    tokenDeploymentQueue.getJobCounts(),
    complianceCheckQueue.getJobCounts(),
    settlementQueue.getJobCounts(),
    reportingQueue.getJobCounts(),
    notificationQueue.getJobCounts(),
    sanctionsCheckQueue.getJobCounts(),
    attestationVerifyQueue.getJobCounts(),
    travelRuleQueue.getJobCounts(),
    onChainSyncQueue.getJobCounts(),
    complianceCaseQueue.getJobCounts(),
  ]);

  return {
    tokenDeployment: deployment,
    complianceCheck: compliance,
    settlement,
    reporting,
    notification,
    sanctionsCheck: sanctions,
    attestationVerify: attestation,
    travelRule,
    onChainSync,
    complianceCase,
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
    sanctionsCheckQueue,
    attestationVerifyQueue,
    travelRuleQueue,
    onChainSyncQueue,
    complianceCaseQueue,
  ];

  for (const queue of queues) {
    await queue.clean(7 * 24 * 60 * 60 * 1000, 1000, 'completed'); // 7 days
    await queue.clean(30 * 24 * 60 * 60 * 1000, 1000, 'failed'); // 30 days
  }

  logger.info('Old jobs cleaned up');
}
