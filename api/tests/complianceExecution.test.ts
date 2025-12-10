/**
 * Compliance Execution Service Tests
 *
 * Tests the "Execution Agent" that applies grandfathering strategies to
 * affected investors when regulatory rules change.
 */

import { GrandfatheringStrategy, ComplianceStatus } from '../src/types/conflicts';

// Mock Prisma client
jest.mock('@prisma/client', () => {
  const mockPrisma = {
    investor: {
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $disconnect: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockPrisma),
  };
});

// Mock logger
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  executeComplianceStrategy,
  revertGrandfathering,
  checkExpiredGracePeriods,
  getComplianceStatusSummary,
  ExecutionResult,
} from '../src/services/complianceExecution';
import { PrismaClient } from '@prisma/client';

const mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>;

describe('Compliance Execution Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeComplianceStrategy', () => {
    describe('FULL grandfathering strategy', () => {
      it('should update investors to GRANDFATHERED status', async () => {
        const casualties = ['inv-1', 'inv-2', 'inv-3'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 3,
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-123',
          strategy: GrandfatheringStrategy.FULL,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
          notes: 'Income threshold increased from $200K to $250K',
        });

        expect(result.success).toBe(true);
        expect(result.grandfatheredCount).toBe(3);
        expect(result.failedCount).toBe(0);
        expect(result.strategy).toBe(GrandfatheringStrategy.FULL);
        expect(result.message).toContain('grandfathered');
        expect(result.message).toContain('3 investors');
      });

      it('should handle empty casualty list', async () => {
        const result = await executeComplianceStrategy({
          proposalId: 'prop-456',
          strategy: GrandfatheringStrategy.FULL,
          casualties: [],
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
        });

        expect(result.success).toBe(true);
        expect(result.grandfatheredCount).toBe(0);
        expect(result.message).toContain('No casualties');
      });
    });

    describe('TIME_LIMITED grandfathering strategy', () => {
      it('should set grace period expiration', async () => {
        const casualties = ['inv-1', 'inv-2'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 2,
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-789',
          strategy: GrandfatheringStrategy.TIME_LIMITED,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
          gracePeriodDays: 365,
        });

        expect(result.success).toBe(true);
        expect(result.grandfatheredCount).toBe(2);
        expect(result.message).toContain('365-day grace period');
      });

      it('should default to 365 days if not specified', async () => {
        const casualties = ['inv-1'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 1,
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-999',
          strategy: GrandfatheringStrategy.TIME_LIMITED,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
          // gracePeriodDays not specified
        });

        expect(result.success).toBe(true);
        expect(result.message).toContain('365-day');
      });
    });

    describe('NONE strategy (immediate enforcement)', () => {
      it('should mark investors as UNAUTHORIZED', async () => {
        const casualties = ['inv-1', 'inv-2'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 2,
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-emergency',
          strategy: GrandfatheringStrategy.NONE,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
        });

        expect(result.success).toBe(true);
        expect(result.grandfatheredCount).toBe(0); // Not grandfathered
        expect(result.message).toContain('IMMEDIATE ENFORCEMENT');
        expect(result.message).toContain('UNAUTHORIZED');
      });
    });

    describe('HOLDINGS_FROZEN strategy', () => {
      it('should grandfather with frozen holdings semantics', async () => {
        const casualties = ['inv-1'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 1,
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-freeze',
          strategy: GrandfatheringStrategy.HOLDINGS_FROZEN,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
        });

        expect(result.success).toBe(true);
        expect(result.grandfatheredCount).toBe(1);
      });
    });

    describe('TRANSACTION_BASED strategy', () => {
      it('should grandfather until next transaction', async () => {
        const casualties = ['inv-1'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 1,
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-tx',
          strategy: GrandfatheringStrategy.TRANSACTION_BASED,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
        });

        expect(result.success).toBe(true);
        expect(result.grandfatheredCount).toBe(1);
      });
    });

    describe('Error handling', () => {
      it('should handle database errors gracefully', async () => {
        const casualties = ['inv-1'];
        (mockPrisma.investor.updateMany as jest.Mock).mockRejectedValue(
          new Error('Database connection failed')
        );

        const result = await executeComplianceStrategy({
          proposalId: 'prop-error',
          strategy: GrandfatheringStrategy.FULL,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
        });

        expect(result.success).toBe(false);
        expect(result.message).toContain('Execution failed');
        expect(result.message).toContain('Database connection failed');
      });

      it('should track partial failures', async () => {
        const casualties = ['inv-1', 'inv-2', 'inv-3'];
        (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
          count: 2, // Only 2 of 3 updated
        });

        const result = await executeComplianceStrategy({
          proposalId: 'prop-partial',
          strategy: GrandfatheringStrategy.FULL,
          casualties,
          appliedBy: 'compliance-officer-1',
          appliedAt: new Date(),
        });

        expect(result.success).toBe(false); // Not all succeeded
        expect(result.grandfatheredCount).toBe(2);
        expect(result.failedCount).toBe(1);
      });
    });
  });

  describe('revertGrandfathering', () => {
    it('should revert grandfathered investors to APPROVED', async () => {
      (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const result = await revertGrandfathering('prop-123', 'admin-1');

      expect(result.success).toBe(true);
      expect(result.revertedCount).toBe(5);
      expect(result.message).toContain('Reverted 5 investors');
    });

    it('should handle case with no investors to revert', async () => {
      (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const result = await revertGrandfathering('prop-nonexistent', 'admin-1');

      expect(result.success).toBe(true);
      expect(result.revertedCount).toBe(0);
    });

    it('should handle errors', async () => {
      (mockPrisma.investor.updateMany as jest.Mock).mockRejectedValue(
        new Error('Revert failed')
      );

      const result = await revertGrandfathering('prop-error', 'admin-1');

      expect(result.success).toBe(false);
      expect(result.revertedCount).toBe(0);
      expect(result.message).toContain('Revert failed');
    });
  });

  describe('checkExpiredGracePeriods', () => {
    it('should find investors with expired grace periods', async () => {
      const expiredInvestors = [
        { id: 'inv-1', fullName: 'John Doe', email: 'john@example.com' },
        { id: 'inv-2', fullName: 'Jane Smith', email: 'jane@example.com' },
      ];
      (mockPrisma.investor.findMany as jest.Mock).mockResolvedValue(expiredInvestors);

      const result = await checkExpiredGracePeriods();

      expect(result.expiredCount).toBe(2);
      expect(result.investorIds).toEqual(['inv-1', 'inv-2']);
    });

    it('should return empty when no expired grace periods', async () => {
      (mockPrisma.investor.findMany as jest.Mock).mockResolvedValue([]);

      const result = await checkExpiredGracePeriods();

      expect(result.expiredCount).toBe(0);
      expect(result.investorIds).toEqual([]);
    });
  });

  describe('getComplianceStatusSummary', () => {
    it('should return distribution of compliance statuses', async () => {
      (mockPrisma.investor.count as jest.Mock)
        .mockResolvedValueOnce(100) // approved
        .mockResolvedValueOnce(5)   // frozen
        .mockResolvedValueOnce(20)  // grandfathered
        .mockResolvedValueOnce(10); // unauthorized

      const summary = await getComplianceStatusSummary();

      expect(summary.approved).toBe(100);
      expect(summary.frozen).toBe(5);
      expect(summary.grandfathered).toBe(20);
      expect(summary.unauthorized).toBe(10);
      expect(summary.total).toBe(135);
    });
  });
});

describe('Compliance Execution Business Scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Accreditation Threshold Change', () => {
    it('should grandfather existing investors below new threshold', async () => {
      // Scenario: Income threshold increased from $200K to $250K
      // 50 investors now below threshold
      const casualties = Array(50).fill(0).map((_, i) => `inv-${i}`);
      (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
        count: 50,
      });

      const result = await executeComplianceStrategy({
        proposalId: 'accred-threshold-2025-01',
        strategy: GrandfatheringStrategy.TIME_LIMITED,
        casualties,
        appliedBy: 'chief-compliance-officer',
        appliedAt: new Date(),
        gracePeriodDays: 365,
        notes: 'SEC Rule Change: Accreditation income threshold $200K → $250K',
      });

      expect(result.success).toBe(true);
      expect(result.grandfatheredCount).toBe(50);
      // These investors can still SELL but cannot BUY
    });
  });

  describe('Jurisdiction Restriction Change', () => {
    it('should handle investors in newly restricted jurisdiction', async () => {
      // Scenario: New regulation restricts investors from certain jurisdiction
      const casualties = ['inv-uk-1', 'inv-uk-2', 'inv-uk-3'];
      (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
        count: 3,
      });

      const result = await executeComplianceStrategy({
        proposalId: 'jurisdiction-uk-restrict-2025',
        strategy: GrandfatheringStrategy.FULL,
        casualties,
        appliedBy: 'compliance-officer',
        appliedAt: new Date(),
        notes: 'UK investors grandfathered due to regulatory change',
      });

      expect(result.success).toBe(true);
      // UK investors can exit positions but not add
    });
  });

  describe('Emergency Sanctions Response', () => {
    it('should immediately block sanctioned individuals', async () => {
      // Scenario: Individual added to OFAC sanctions list
      const casualties = ['inv-sanctioned-1'];
      (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const result = await executeComplianceStrategy({
        proposalId: 'sanctions-emergency-2025-01',
        strategy: GrandfatheringStrategy.NONE, // No grandfathering for sanctions
        casualties,
        appliedBy: 'compliance-officer',
        appliedAt: new Date(),
        notes: 'EMERGENCY: OFAC sanctions list addition',
      });

      expect(result.success).toBe(true);
      expect(result.grandfatheredCount).toBe(0);
      expect(result.message).toContain('UNAUTHORIZED');
    });
  });

  describe('Regulatory Proposal Reversal', () => {
    it('should revert grandfathering if proposal is cancelled', async () => {
      // Scenario: Proposed rule change cancelled, revert affected investors
      (mockPrisma.investor.updateMany as jest.Mock).mockResolvedValue({
        count: 25,
      });

      const result = await revertGrandfathering(
        'cancelled-proposal-2025',
        'legal-team'
      );

      expect(result.success).toBe(true);
      expect(result.revertedCount).toBe(25);
      // Investors restored to full APPROVED status
    });
  });
});
