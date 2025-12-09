import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * Centralized Prisma Client
 *
 * Best practices:
 * - Single instance across the application
 * - Proper connection pooling
 * - Graceful shutdown handling
 * - Query logging in development
 */

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });
};

declare global {
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
