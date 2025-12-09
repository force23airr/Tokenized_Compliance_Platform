/**
 * Test Setup - Runs before all tests
 */

import { prisma } from '../src/config/prisma';

// Set environment to test
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_QUEUE = 'true';

// Increase timeout for database operations
jest.setTimeout(30000);

// Cleanup after all tests
afterAll(async () => {
  await prisma.$disconnect();
});

// Global test utilities
global.testUtils = {
  generateApiKey: () => `test_api_key_${Date.now()}_${Math.random().toString(36).substring(7)}`,

  createTestApiKey: async () => {
    const key = global.testUtils.generateApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        key,
        name: 'Test API Key',
        permissions: ['*'],
        active: true,
      },
    });
    return apiKey;
  },

  cleanup: async () => {
    // Clean up test data in reverse order of dependencies
    await prisma.auditLog.deleteMany({});
    await prisma.distribution.deleteMany({});
    await prisma.transfer.deleteMany({});
    await prisma.investorWhitelist.deleteMany({});
    await prisma.investor.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.apiKey.deleteMany({ where: { name: 'Test API Key' } });
  },
};

// Type augmentation for global test utils
declare global {
  var testUtils: {
    generateApiKey: () => string;
    createTestApiKey: () => Promise<any>;
    cleanup: () => Promise<void>;
  };
}
