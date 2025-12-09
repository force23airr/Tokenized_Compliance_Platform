/**
 * Conflict Types for AI Compliance Engine
 *
 * Typed conflict categorization for analytics, auditing, and resolution tracking.
 */

// ============= Conflict Type Enums =============

export enum ConflictType {
  JURISDICTION_CONFLICT = 'jurisdiction_conflict',      // Conflicting laws between countries
  INVESTOR_LIMIT_CONFLICT = 'investor_limit_conflict',  // Different maximum investor caps
  ACCREDITATION_CONFLICT = 'accreditation_conflict',    // Different accreditation thresholds
  LOCKUP_CONFLICT = 'lockup_conflict',                  // Different holding period requirements
  DISCLOSURE_CONFLICT = 'disclosure_conflict',          // Different document/disclosure requirements
}

export enum ResolutionStrategy {
  APPLY_STRICTEST = 'apply_strictest',                  // Use most restrictive rule
  JURISDICTION_SPECIFIC = 'jurisdiction_specific',      // Apply rules per investor jurisdiction
  INVESTOR_ELECTION = 'investor_election',              // Allow investor to elect regime
  LEGAL_OPINION_REQUIRED = 'legal_opinion_required',    // Flag for manual legal review
}

export enum JurisdictionCode {
  US = 'US',
  SG = 'SG',
  GB = 'GB',
  EU = 'EU',
}

export enum InvestorClassification {
  // US Classifications
  RETAIL = 'retail',
  ACCREDITED = 'accredited',
  QUALIFIED_PURCHASER = 'qualified_purchaser',
  INSTITUTIONAL = 'institutional',
  // Singapore Classifications
  ACCREDITED_INVESTOR = 'accredited_investor',
  EXPERT_INVESTOR = 'expert_investor',
  INSTITUTIONAL_INVESTOR = 'institutional_investor',
  // UK/EU Classifications
  PROFESSIONAL = 'professional',
  ELIGIBLE_COUNTERPARTY = 'eligible_counterparty',
}

// ============= Conflict Interfaces =============

export interface Conflict {
  type: ConflictType;
  jurisdictions: string[];
  description: string;
  ruleA: string;
  ruleB: string;
}

export interface Resolution {
  conflictType: ConflictType;
  strategy: ResolutionStrategy;
  resolvedRequirement: string;
  rationale: string;
}

export interface CombinedRequirements {
  accreditedOnly: boolean;
  minInvestment: number;
  maxInvestors: number;
  lockupDays: number;
  requiredDisclosures: string[];
  transferRestrictions?: string;
  filingRequirements?: string[];
}

// ============= AI Response Interfaces =============

export interface ConflictResolutionResult {
  hasConflicts: boolean;
  conflicts: Conflict[];
  resolutions: Resolution[];
  combinedRequirements: CombinedRequirements;
  confidence: number;
  requiresManualReview: boolean;
  rulesetVersion: string;
  isFallback: boolean;
}

export interface JurisdictionClassificationResult {
  jurisdiction: string;
  entityType: string;
  investorClassification: string;
  applicableRegulations: string[];
  confidence: number;
  requiresManualReview: boolean;
  reasoning?: string;
  rulesetVersion: string;
}

export interface TokenValidationResult {
  valid: boolean;
  violations: TokenViolation[];
  suggestions: TokenSuggestion[];
  confidence: number;
  requiresManualReview: boolean;
}

export interface TokenViolation {
  rule: string;
  issue: string;
  requiredValue?: string;
  proposedValue?: string;
  severity: 'error' | 'warning';
}

export interface TokenSuggestion {
  rule: string;
  suggestedValue: string;
  rationale: string;
}

// ============= Compliance Check Request/Response =============

export interface ComplianceCheckRequest {
  assetType: string;
  jurisdictions: string[];
  complianceRules: {
    accreditedOnly?: boolean;
    maxInvestors?: number;
    lockupPeriodDays?: number;
    minInvestment?: number;
    allowedJurisdictions?: string[];
  };
  investorTypes?: string[];
}

export interface ComplianceCheckResponse {
  approved: boolean;
  reason?: string;
  conflicts: Conflict[];
  resolutions: Resolution[];
  combinedRequirements: CombinedRequirements;
  confidence: number;
  requiresManualReview: boolean;
  rulesetVersion: string;
  isFallback: boolean;
}

// ============= Preflight Check Interfaces =============

export interface PreflightCheckResult {
  passed: boolean;
  reason?: string;
  checks: PreflightCheck[];
  timestamp: Date;
  tokenId: string;
}

export interface PreflightCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  details?: string;
  duration?: number;
}

// ============= Cache Key Helpers =============

export function buildConflictCacheKey(jurisdictions: string[], assetType: string): string {
  const sortedJurisdictions = [...jurisdictions].sort().join('-');
  return `conflicts:${sortedJurisdictions}:${assetType}`;
}

export function buildRulesCacheKey(jurisdiction: string): string {
  return `rules:${jurisdiction}`;
}

// ============= Confidence Thresholds =============

export const AI_CONFIDENCE_THRESHOLD = 0.7;
export const CACHE_TTL_RULES = 3600;        // 1 hour
export const CACHE_TTL_CONFLICTS = 86400;    // 24 hours
export const FALLBACK_CACHE_TTL = 86400;     // 24 hours for fallback
