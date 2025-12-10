/**
 * Attestation Verification Worker
 *
 * Processes custodian attestation verification and signature validation.
 */

import { config } from '../../config';
import { logger } from '../../utils/logger';
import * as attestationService from '../../services/attestationService';

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

interface AttestationVerifyPayload {
  attestationId: string;
  verifySignature: boolean;
}

/**
 * Process attestation verification job
 */
async function processAttestationVerification(job: {
  data: AttestationVerifyPayload;
  id: string;
}) {
  const { attestationId, verifySignature } = job.data;

  logger.info('Processing attestation verification job', {
    jobId: job.id,
    attestationId,
    verifySignature,
  });

  try {
    const startTime = Date.now();

    // Verify the attestation
    const result = await attestationService.verifyAttestation(attestationId);

    const duration = Date.now() - startTime;

    logger.info('Attestation verification completed', {
      jobId: job.id,
      attestationId,
      valid: result.valid,
      reason: result.reason,
      durationMs: duration,
    });

    // If attestation is invalid or expiring soon, could trigger alerts
    if (!result.valid) {
      logger.warn('Attestation verification failed', {
        jobId: job.id,
        attestationId,
        reason: result.reason,
      });
    } else if (result.expiresAt) {
      const daysUntilExpiry = Math.ceil(
        (result.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );

      if (daysUntilExpiry <= 30) {
        logger.warn('Attestation expiring soon', {
          jobId: job.id,
          attestationId,
          daysUntilExpiry,
          expiresAt: result.expiresAt.toISOString(),
        });
      }
    }

    return {
      success: true,
      valid: result.valid,
      reason: result.reason,
      expiresAt: result.expiresAt,
      duration,
    };
  } catch (error) {
    logger.error('Attestation verification job failed', {
      jobId: job.id,
      attestationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Process batch attestation verification
 */
async function processBatchVerification(tokenId: string): Promise<{
  total: number;
  valid: number;
  invalid: number;
  expired: number;
}> {
  const attestations = await attestationService.getTokenAttestations(tokenId);

  let valid = 0;
  let invalid = 0;
  let expired = 0;

  for (const attestation of attestations) {
    const result = await attestationService.verifyAttestation(attestation.id);

    if (result.valid) {
      valid++;
    } else if (result.reason?.includes('expired')) {
      expired++;
    } else {
      invalid++;
    }
  }

  return {
    total: attestations.length,
    valid,
    invalid,
    expired,
  };
}

/**
 * Initialize the worker
 */
export function initAttestationWorker() {
  if (USE_MOCK) {
    logger.info('Attestation worker running in mock mode');
    return null;
  }

  const worker = new Worker(
    'attestation-verify',
    async (job: { data: AttestationVerifyPayload; id: string }) => {
      return processAttestationVerification(job);
    },
    {
      connection,
      concurrency: 3,
    }
  );

  worker.on('completed', (job: { id: string }, result: unknown) => {
    logger.info('Attestation verification job completed', { jobId: job.id, result });
  });

  worker.on('failed', (job: { id: string } | undefined, error: Error) => {
    logger.error('Attestation verification job failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  logger.info('Attestation worker initialized');

  return worker;
}

// Export for manual processing
export { processAttestationVerification, processBatchVerification };

// Default export for worker
export const attestationWorker = USE_MOCK ? null : initAttestationWorker();
