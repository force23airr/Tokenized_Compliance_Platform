/**
 * Travel Rule Worker
 *
 * Processes FATF/MiCA threshold evaluation and reporting.
 */

import { config } from '../../config';
import { logger } from '../../utils/logger';
import * as travelRuleService from '../../services/travelRuleService';
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

interface TravelRulePayload {
  transferId: string;
  transferValueUSD: number;
}

/**
 * Process travel rule job
 */
async function processTravelRule(job: { data: TravelRulePayload; id: string }) {
  const { transferId, transferValueUSD } = job.data;

  logger.info('Processing travel rule job', {
    jobId: job.id,
    transferId,
    transferValueUSD,
  });

  try {
    const startTime = Date.now();

    // Get transfer details for jurisdiction info
    const transfer = await prisma.transfer.findUnique({
      where: { id: transferId },
      include: {
        token: true,
        fromInvestor: true,
      },
    });

    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }

    // Try to find the beneficiary by toAddress
    const toInvestor = transfer.toAddress
      ? await prisma.investor.findFirst({
          where: { walletAddress: transfer.toAddress },
        })
      : null;

    // Determine jurisdictions from investor data
    const originatorJurisdiction = transfer.fromInvestor?.jurisdiction || 'US';
    const beneficiaryJurisdiction = toInvestor?.jurisdiction || 'US';

    // Evaluate threshold
    const evaluation = await travelRuleService.evaluateThreshold(
      transferValueUSD,
      originatorJurisdiction,
      beneficiaryJurisdiction
    );

    const duration = Date.now() - startTime;

    logger.info('Travel rule evaluation completed', {
      jobId: job.id,
      transferId,
      thresholdTriggered: evaluation.thresholdTriggered,
      applicableRegime: evaluation.applicableRegime,
      status: evaluation.status,
      durationMs: duration,
    });

    // If threshold triggered, collect travel rule data
    if (evaluation.thresholdTriggered) {
      logger.info('Travel rule threshold triggered, collecting data', {
        jobId: job.id,
        transferId,
        requiredData: evaluation.requiredData,
      });

      // Create travel rule data record (with available info)
      await travelRuleService.collectTravelRuleData({
        transferId,
        transferValueUSD,
        originatorName: transfer.fromInvestor?.fullName,
        originatorAccount: transfer.fromInvestor?.walletAddress,
        originatorJurisdiction,
        beneficiaryName: toInvestor?.fullName,
        beneficiaryAccount: transfer.toAddress,
        beneficiaryJurisdiction,
      });
    }

    return {
      success: true,
      thresholdTriggered: evaluation.thresholdTriggered,
      applicableRegime: evaluation.applicableRegime,
      status: evaluation.status,
      duration,
    };
  } catch (error) {
    logger.error('Travel rule job failed', {
      jobId: job.id,
      transferId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Initialize the worker
 */
export function initTravelRuleWorker() {
  if (USE_MOCK) {
    logger.info('Travel rule worker running in mock mode');
    return null;
  }

  const worker = new Worker(
    'travel-rule',
    async (job: { data: TravelRulePayload; id: string }) => {
      return processTravelRule(job);
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on('completed', (job: { id: string }, result: unknown) => {
    logger.info('Travel rule job completed', { jobId: job.id, result });
  });

  worker.on('failed', (job: { id: string } | undefined, error: Error) => {
    logger.error('Travel rule job failed', { jobId: job?.id, error: error.message });
  });

  logger.info('Travel rule worker initialized');

  return worker;
}

// Export for manual processing
export { processTravelRule };

// Default export for worker
export const travelRuleWorker = USE_MOCK ? null : initTravelRuleWorker();
