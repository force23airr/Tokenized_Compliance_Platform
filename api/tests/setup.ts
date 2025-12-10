/**
 * Test Setup - Runs before all tests
 */

/// <reference types="jest" />

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

// Type augmentation for global test utils - must be before usage
declare global {
  // eslint-disable-next-line no-var
  var testUtils: {
    generateApiKey: () => string;
    createTestApiKey: () => Promise<any>;
    cleanup: () => Promise<void>;
  };
}

// Global test utilities
globalThis.testUtils = {
  generateApiKey: () => `test_api_key_${Date.now()}_${Math.random().toString(36).substring(7)}`,

  createTestApiKey: async () => {
    const key = globalThis.testUtils.generateApiKey();
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
    // Must delete all tables that reference tokens first
    await prisma.complianceAuditLog.deleteMany({});
    await prisma.conflictEvent.deleteMany({}); 
    await prisma.complianceDecision.deleteMany({});
    await prisma.assetAttestation.deleteMany({});
    await prisma.holderLockup.deleteMany({});
    await prisma.transferRestriction.deleteMany({});
    await prisma.travelRuleData.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.distribution.deleteMany({});
    await prisma.transfer.deleteMany({});
    await prisma.investorWhitelist.deleteMany({});
    await prisma.sanctionsCheck.deleteMany({});
    await prisma.investorCompliance.deleteMany({});
    await prisma.investor.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.apiKey.deleteMany({ where: { name: 'Test API Key' } });
  },
};
