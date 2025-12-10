/**
 * Sanctions Check Worker
 *
 * Processes sanctions/AML checks with multi-provider fallback.
 * Providers: Chainalysis -> Elliptic -> OFAC Direct
 */

import { config } from '../../config';
import { logger } from '../../utils/logger';
import * as sanctionsService from '../../services/sanctionsService';
import { SanctionsCheckType } from '../../types/conflicts';

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

interface SanctionsCheckPayload {
  investorId: string;
  walletAddress: string;
  jurisdiction: string;
  providers: string[];
  checkType?: SanctionsCheckType;
}

/**
 * Process sanctions check job
 */
async function processSanctionsCheck(job: { data: SanctionsCheckPayload; id: string }) {
  const { investorId, walletAddress, jurisdiction, checkType } = job.data;

  logger.info('Processing sanctions check job', {
    jobId: job.id,
    investorId,
    walletAddress,
    jurisdiction,
  });

  try {
    const startTime = Date.now();

    // Run the sanctions check with multi-provider fallback
    const result = await sanctionsService.runSanctionsCheck(
      investorId,
      walletAddress,
      jurisdiction,
      checkType || SanctionsCheckType.SANCTIONS
    );

    const duration = Date.now() - startTime;

    logger.info('Sanctions check completed', {
      jobId: job.id,
      investorId,
      passed: result.passed,
      provider: result.provider,
      riskScore: result.riskScore,
      requiresManualReview: result.requiresManualReview,
      durationMs: duration,
    });

    // If check failed or requires manual review, could trigger notification
    if (!result.passed || result.requiresManualReview) {
      logger.warn('Sanctions check flagged', {
        jobId: job.id,
        investorId,
        flags: result.flags,
        reason: result.requiresManualReview ? 'Manual review required' : 'Check failed',
      });
    }

    return {
      success: true,
      passed: result.passed,
      provider: result.provider,
      riskScore: result.riskScore,
      flags: result.flags,
      checkHash: result.checkHash,
      duration,
    };
  } catch (error) {
    logger.error('Sanctions check job failed', {
      jobId: job.id,
      investorId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Initialize the worker
 */
export function initSanctionsWorker() {
  if (USE_MOCK) {
    logger.info('Sanctions worker running in mock mode');
    return null;
  }

  const worker = new Worker(
    'sanctions-check',
    async (job: { data: SanctionsCheckPayload; id: string }) => {
      return processSanctionsCheck(job);
    },
    {
      connection,
      concurrency: 5,
      limiter: {
        max: 20,
        duration: 1000, // Max 20 jobs per second
      },
    }
  );

  worker.on('completed', (job: { id: string }, result: unknown) => {
    logger.info('Sanctions check job completed', { jobId: job.id, result });
  });

  worker.on('failed', (job: { id: string } | undefined, error: Error) => {
    logger.error('Sanctions check job failed', { jobId: job?.id, error: error.message });
  });

  worker.on('stalled', (jobId: string) => {
    logger.warn('Sanctions check job stalled', { jobId });
  });

  logger.info('Sanctions worker initialized');

  return worker;
}

// Export for manual processing in tests
export { processSanctionsCheck };

// Default export for worker
export const sanctionsWorker = USE_MOCK ? null : initSanctionsWorker();
