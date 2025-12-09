import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { MetricsStore } from '../middleware/metrics';

/**
 * Centralized Prisma Client
 *
 * Best practices:
 * - Single instance across the application
 * - Proper connection pooling
 * - Graceful shutdown handling
 * - Query logging in development
 * - Performance monitoring with middleware
 */

const prismaClientSingleton = () => {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });

  // Add middleware to track query performance
  prisma.$use(async (params, next) => {
    const before = Date.now();
    const result = await next(params);
    const after = Date.now();
    const duration = after - before;

    // Record metrics
    MetricsStore.getInstance().recordDbQuery(duration);

    // Log slow queries (>100ms)
    if (duration > 100) {
      logger.warn('Slow database query detected', {
        model: params.model,
        action: params.action,
        duration: `${duration}ms`,
      });
    }

    return result;
  });

  return prisma;
};

declare global {
  // eslint-disable-next-line no-var
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
  logger.info('Disconnecting Prisma client...');
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received: Disconnecting Prisma client...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received: Disconnecting Prisma client...');
  await prisma.$disconnect();
  process.exit(0);
});
