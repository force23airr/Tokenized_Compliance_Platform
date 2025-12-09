import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getQueueStats } from '../jobs';
import { logger } from '../utils/logger';
import { ethers } from 'ethers';
import { config } from '../config';
import axios from 'axios';

const router = Router();

/**
 * Basic health check - no authentication required
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: config.api.version,
    environment: config.server.env,
  });
});

/**
 * Detailed health check - includes dependencies
 */
router.get('/health/detailed', async (req: Request, res: Response) => {
  const checks: Record<string, any> = {
    api: { status: 'healthy' },
    database: { status: 'unknown' },
    redis: { status: 'unknown' },
    blockchain: { status: 'unknown' },
    aiCompliance: { status: 'unknown' },
  };

  let overallStatus = 'healthy';

  // Database check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = {
      status: 'healthy',
      latency: await measureDatabaseLatency(),
    };
  } catch (error) {
    checks.database = {
      status: 'unhealthy',
      error: error.message,
    };
    overallStatus = 'degraded';
  }

  // Redis/Queue check
  try {
    const queueStats = await getQueueStats();
    checks.redis = {
      status: 'healthy',
      queues: queueStats,
    };
  } catch (error) {
    checks.redis = {
      status: 'unhealthy',
      error: error.message,
    };
    overallStatus = 'degraded';
  }

  // Blockchain RPC check
  try {
    const provider = new ethers.JsonRpcProvider(config.blockchain.sepolia.rpcUrl);
    const blockNumber = await provider.getBlockNumber();
    checks.blockchain = {
      status: 'healthy',
      network: 'sepolia',
      blockNumber,
    };
  } catch (error) {
    checks.blockchain = {
      status: 'unhealthy',
      error: error.message,
    };
    overallStatus = 'degraded';
  }

  // AI Compliance Engine check
  try {
    const response = await axios.get(
      `${config.externalServices.aiCompliance.apiUrl}/health`,
      { timeout: 5000 }
    );
    checks.aiCompliance = {
      status: response.status === 200 ? 'healthy' : 'degraded',
    };
  } catch (error) {
    checks.aiCompliance = {
      status: 'unhealthy',
      error: 'AI compliance engine unreachable',
    };
    // Don't degrade overall status - AI is optional
  }

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: config.api.version,
    checks,
  });
});

/**
 * Readiness check - for Kubernetes/load balancers
 * Returns 200 only if all critical services are ready
 */
router.get('/health/ready', async (req: Request, res: Response) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check queue connection
    await getQueueStats();

    res.status(200).json({
      ready: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Readiness check failed', { error });

    res.status(503).json({
      ready: false,
      error: 'Service not ready',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Liveness check - for Kubernetes
 * Returns 200 if the application is running (doesn't check dependencies)
 */
router.get('/health/live', (req: Request, res: Response) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Metrics endpoint - for Prometheus/monitoring
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const [
      tokenCount,
      investorCount,
      transferCount,
      pendingTransfers,
      queueStats,
    ] = await Promise.all([
      prisma.token.count(),
      prisma.investor.count(),
      prisma.transfer.count(),
      prisma.transfer.count({ where: { status: 'pending' } }),
      getQueueStats(),
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      database: {
        tokens: tokenCount,
        investors: investorCount,
        transfers: transferCount,
        pendingTransfers,
      },
      queues: queueStats,
    });
  } catch (error) {
    logger.error('Metrics fetch failed', { error });

    res.status(500).json({
      error: 'Failed to fetch metrics',
    });
  }
});

/**
 * Helper: Measure database latency
 */
async function measureDatabaseLatency(): Promise<number> {
  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return Date.now() - start;
}

export default router;
