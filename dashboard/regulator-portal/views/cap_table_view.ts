/**
 * Cap Table View - Real-time investor distribution for regulators
 */

export interface CapTableMetrics {
  totalInvestors: number;
  accreditedInvestors: number;
  nonAccreditedInvestors: number;
  qualifiedPurchasers: number;
  institutionalInvestors: number;

  // Investor caps
  maxInvestorsAllowed: number;
  percentageCapacity: number;
  approachingCapWarning: boolean;

  // Geographic distribution
  investorsByJurisdiction: Record<string, number>;

  // Concentration
  top10InvestorsPercentage: number;
  largestInvestorPercentage: number;
}

export interface InvestorSummary {
  investorId: string;
  investorType: 'individual' | 'entity' | 'trust' | 'fund';
  classification: 'accredited' | 'qualified_purchaser' | 'institutional' | 'non_accredited';
  jurisdiction: string;
  verificationDate: string;
  tokenBalance: string;
  percentageOfSupply: number;
  onboardingDate: string;
}

export async function getCapTableMetrics(assetId: string): Promise<CapTableMetrics> {
  // Implementation would query the database/blockchain
  // Placeholder return
  return {
    totalInvestors: 127,
    accreditedInvestors: 120,
    nonAccreditedInvestors: 7,
    qualifiedPurchasers: 45,
    institutionalInvestors: 12,
    maxInvestorsAllowed: 2000,
    percentageCapacity: 6.35,
    approachingCapWarning: false,
    investorsByJurisdiction: {
      'US': 85,
      'UK': 18,
      'SG': 12,
      'CA': 8,
      'OTHER': 4
    },
    top10InvestorsPercentage: 42.5,
    largestInvestorPercentage: 8.2
  };
}

export async function getInvestorList(
  assetId: string,
  filters?: {
    jurisdiction?: string;
    investorType?: string;
    classification?: string;
  }
): Promise<InvestorSummary[]> {
  // Implementation would query with filters
  return [];
}
