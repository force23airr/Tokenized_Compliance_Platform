/**
 * Directional Compliance Service Tests
 *
 * Tests the "Smart Grandfathering" system that enables directional transfer validation:
 * - APPROVED: Can buy and sell
 * - GRANDFATHERED: Can sell only (exit positions)
 * - FROZEN: Blocked completely (AML/Sanctions)
 * - UNAUTHORIZED: Blocked (incomplete onboarding)
 */

import {
  validateDirectionalCompliance,
  canSend,
  canReceive,
  isBlocked,
  getStatusCapabilities,
} from '../src/services/directionalCompliance';
import { ComplianceStatus } from '../src/types/conflicts';

describe('Directional Compliance Service', () => {
  describe('validateDirectionalCompliance', () => {
    describe('APPROVED status', () => {
      it('should allow APPROVED sender to APPROVED recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.APPROVED,
          ComplianceStatus.APPROVED
        );

        expect(result.allowed).toBe(true);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should block APPROVED sender to GRANDFATHERED recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.APPROVED,
          ComplianceStatus.GRANDFATHERED
        );

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(false);
        expect(result.reason).toContain('GRANDFATHERED');
        expect(result.reason).toContain('cannot add new positions');
      });

      it('should block APPROVED sender to FROZEN recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.APPROVED,
          ComplianceStatus.FROZEN
        );

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(false);
        expect(result.reason).toContain('FROZEN');
      });

      it('should block APPROVED sender to UNAUTHORIZED recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.APPROVED,
          ComplianceStatus.UNAUTHORIZED
        );

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(false);
        expect(result.reason).toContain('UNAUTHORIZED');
      });
    });

    describe('GRANDFATHERED status (sell-only)', () => {
      it('should allow GRANDFATHERED sender to APPROVED recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.GRANDFATHERED,
          ComplianceStatus.APPROVED
        );

        expect(result.allowed).toBe(true);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(true);
        expect(result.reason).toBeUndefined();
      });

      it('should block GRANDFATHERED sender to GRANDFATHERED recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.GRANDFATHERED,
          ComplianceStatus.GRANDFATHERED
        );

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(false);
      });

      it('should block GRANDFATHERED sender to FROZEN recipient', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.GRANDFATHERED,
          ComplianceStatus.FROZEN
        );

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(false);
      });
    });

    describe('FROZEN status (complete block)', () => {
      it('should block FROZEN sender regardless of recipient status', () => {
        const statuses = [
          ComplianceStatus.APPROVED,
          ComplianceStatus.GRANDFATHERED,
          ComplianceStatus.FROZEN,
          ComplianceStatus.UNAUTHORIZED,
        ];

        for (const recipientStatus of statuses) {
          const result = validateDirectionalCompliance(
            ComplianceStatus.FROZEN,
            recipientStatus
          );

          expect(result.allowed).toBe(false);
          expect(result.senderCanSend).toBe(false);
          expect(result.reason).toContain('FROZEN');
          expect(result.reason).toContain('AML/Sanctions');
        }
      });
    });

    describe('UNAUTHORIZED status', () => {
      it('should block UNAUTHORIZED sender regardless of recipient status', () => {
        const result = validateDirectionalCompliance(
          ComplianceStatus.UNAUTHORIZED,
          ComplianceStatus.APPROVED
        );

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(false);
        expect(result.reason).toContain('UNAUTHORIZED');
        expect(result.reason).toContain('onboarding not complete');
      });
    });

    describe('String status normalization', () => {
      it('should handle lowercase string statuses', () => {
        const result = validateDirectionalCompliance('approved', 'approved');

        expect(result.allowed).toBe(true);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(true);
      });

      it('should handle mixed case string statuses', () => {
        const result = validateDirectionalCompliance('Grandfathered', 'Approved');

        expect(result.allowed).toBe(true);
        expect(result.senderCanSend).toBe(true);
        expect(result.recipientCanReceive).toBe(true);
      });

      it('should default unknown status to UNAUTHORIZED', () => {
        const result = validateDirectionalCompliance('invalid_status', 'approved');

        expect(result.allowed).toBe(false);
        expect(result.senderCanSend).toBe(false);
        expect(result.reason).toContain('UNAUTHORIZED');
      });
    });
  });

  describe('canSend', () => {
    it('should return true for APPROVED status', () => {
      expect(canSend(ComplianceStatus.APPROVED)).toBe(true);
    });

    it('should return true for GRANDFATHERED status', () => {
      expect(canSend(ComplianceStatus.GRANDFATHERED)).toBe(true);
    });

    it('should return false for FROZEN status', () => {
      expect(canSend(ComplianceStatus.FROZEN)).toBe(false);
    });

    it('should return false for UNAUTHORIZED status', () => {
      expect(canSend(ComplianceStatus.UNAUTHORIZED)).toBe(false);
    });

    it('should handle string inputs', () => {
      expect(canSend('approved')).toBe(true);
      expect(canSend('grandfathered')).toBe(true);
      expect(canSend('frozen')).toBe(false);
    });
  });

  describe('canReceive', () => {
    it('should return true only for APPROVED status', () => {
      expect(canReceive(ComplianceStatus.APPROVED)).toBe(true);
    });

    it('should return false for GRANDFATHERED status', () => {
      expect(canReceive(ComplianceStatus.GRANDFATHERED)).toBe(false);
    });

    it('should return false for FROZEN status', () => {
      expect(canReceive(ComplianceStatus.FROZEN)).toBe(false);
    });

    it('should return false for UNAUTHORIZED status', () => {
      expect(canReceive(ComplianceStatus.UNAUTHORIZED)).toBe(false);
    });
  });

  describe('isBlocked', () => {
    it('should return false for APPROVED status', () => {
      expect(isBlocked(ComplianceStatus.APPROVED)).toBe(false);
    });

    it('should return false for GRANDFATHERED status', () => {
      expect(isBlocked(ComplianceStatus.GRANDFATHERED)).toBe(false);
    });

    it('should return true for FROZEN status', () => {
      expect(isBlocked(ComplianceStatus.FROZEN)).toBe(true);
    });

    it('should return true for UNAUTHORIZED status', () => {
      expect(isBlocked(ComplianceStatus.UNAUTHORIZED)).toBe(true);
    });
  });

  describe('getStatusCapabilities', () => {
    it('should return full access for APPROVED', () => {
      const caps = getStatusCapabilities(ComplianceStatus.APPROVED);

      expect(caps.canBuy).toBe(true);
      expect(caps.canSell).toBe(true);
      expect(caps.description).toContain('buy and sell');
    });

    it('should return sell-only for GRANDFATHERED', () => {
      const caps = getStatusCapabilities(ComplianceStatus.GRANDFATHERED);

      expect(caps.canBuy).toBe(false);
      expect(caps.canSell).toBe(true);
      expect(caps.description).toContain('Sell-only');
      expect(caps.description).toContain('grandfathering');
    });

    it('should return no access for FROZEN', () => {
      const caps = getStatusCapabilities(ComplianceStatus.FROZEN);

      expect(caps.canBuy).toBe(false);
      expect(caps.canSell).toBe(false);
      expect(caps.description).toContain('frozen');
    });

    it('should return no access for UNAUTHORIZED', () => {
      const caps = getStatusCapabilities(ComplianceStatus.UNAUTHORIZED);

      expect(caps.canBuy).toBe(false);
      expect(caps.canSell).toBe(false);
      expect(caps.description).toContain('Unauthorized');
    });
  });
});

describe('Directional Compliance Business Scenarios', () => {
  describe('Regulatory Change Scenario', () => {
    it('should allow grandfathered investor to exit position to approved investor', () => {
      // Scenario: Accreditation threshold increased, existing investor grandfathered
      const result = validateDirectionalCompliance(
        ComplianceStatus.GRANDFATHERED,
        ComplianceStatus.APPROVED
      );

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should prevent grandfathered investor from buying more tokens', () => {
      // Scenario: Grandfathered investor tries to receive tokens
      const result = validateDirectionalCompliance(
        ComplianceStatus.APPROVED,
        ComplianceStatus.GRANDFATHERED
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cannot add new positions');
    });
  });

  describe('AML/Sanctions Freeze Scenario', () => {
    it('should completely block frozen account from sending', () => {
      const result = validateDirectionalCompliance(
        ComplianceStatus.FROZEN,
        ComplianceStatus.APPROVED
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('AML/Sanctions');
    });

    it('should completely block frozen account from receiving', () => {
      const result = validateDirectionalCompliance(
        ComplianceStatus.APPROVED,
        ComplianceStatus.FROZEN
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('FROZEN');
    });
  });

  describe('Onboarding Incomplete Scenario', () => {
    it('should block unauthorized users from any transfers', () => {
      // Sender unauthorized
      const senderResult = validateDirectionalCompliance(
        ComplianceStatus.UNAUTHORIZED,
        ComplianceStatus.APPROVED
      );
      expect(senderResult.allowed).toBe(false);

      // Recipient unauthorized
      const recipientResult = validateDirectionalCompliance(
        ComplianceStatus.APPROVED,
        ComplianceStatus.UNAUTHORIZED
      );
      expect(recipientResult.allowed).toBe(false);
    });
  });

  describe('Capital Liquidity Protection', () => {
    it('should never trap capital - grandfathered can always sell', () => {
      // This is the key "anti-liquidity trap" guarantee
      const caps = getStatusCapabilities(ComplianceStatus.GRANDFATHERED);

      expect(caps.canSell).toBe(true);
      expect(canSend(ComplianceStatus.GRANDFATHERED)).toBe(true);
    });
  });
});
