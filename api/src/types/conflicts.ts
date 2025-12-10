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

// ============= NEW: Compliance Case Types =============

export enum ComplianceCaseType {
  ISSUANCE = 'issuance',
  TRANSFER = 'transfer',
  INVESTOR_ONBOARDING = 'investor_onboarding',
  PERIODIC_REVIEW = 'periodic_review',
}

export enum ComplianceCaseStatus {
  OPEN = 'open',
  IN_REVIEW = 'in_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
}

export enum CasePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

// ============= NEW: Lockup Types =============

export enum LockupType {
  INITIAL_OFFERING = 'initial_offering',
  RULE_144 = 'rule_144',
  REG_S = 'reg_s',
  CONTRACTUAL = 'contractual',
  VESTING = 'vesting',
}

// ============= NEW: Attestation Types =============

export enum AttestationType {
  PROOF_OF_EXISTENCE = 'proof_of_existence',
  OWNERSHIP = 'ownership',
  VALUATION = 'valuation',
  RESERVE = 'reserve',
}

// ============= NEW: Travel Rule Types =============

export enum TravelRuleStatus {
  PENDING = 'pending',
  COMPLIANT = 'compliant',
  NON_COMPLIANT = 'non_compliant',
  EXEMPT = 'exempt',
}

export enum TravelRuleRegime {
  FATF = 'fatf',
  MICA = 'mica',
  FINCEN = 'fincen',
  MAS = 'mas',
}

// ============= NEW: Sanctions/AML Types =============

export enum SanctionsCheckType {
  AML = 'aml',
  PEP = 'pep',
  SANCTIONS = 'sanctions',
  ADVERSE_MEDIA = 'adverse_media',
}

export enum SanctionsProvider {
  CHAINALYSIS = 'chainalysis',
  ELLIPTIC = 'elliptic',
  OFAC_DIRECT = 'ofac_direct',
}

// ============= NEW: Accreditation Types =============

export enum AccreditationType {
  INCOME = 'income',
  NET_WORTH = 'net_worth',
  PROFESSIONAL = 'professional',
  ENTITY = 'entity',
}

export enum VerificationMethod {
  SELF_CERT = 'self_cert',
  THIRD_PARTY = 'third_party',
  ISSUER_VERIFIED = 'issuer_verified',
}

// ============= NEW: Audit Log Types =============

export enum AuditActorType {
  AI = 'ai',
  HUMAN = 'human',
  SYSTEM = 'system',
}

export enum AuditAction {
  STATUS_CHANGE = 'status_change',
  AI_DECISION = 'ai_decision',
  MANUAL_OVERRIDE = 'manual_override',
  REVIEW_ASSIGNED = 'review_assigned',
  ESCALATION = 'escalation',
}

// ============= NEW: Compliance Interfaces =============

export interface SanctionsCheckResult {
  passed: boolean;
  provider: SanctionsProvider;
  riskScore: number;
  flags: string[];
  checkHash: string;
  jurisdiction: string;
  aiConfidence?: number;
  requiresManualReview: boolean;
  listVersion: string;
  checkedAt: Date;
  expiresAt: Date;
}

export interface AttestationData {
  tokenId: string;
  attestationType: AttestationType;
  assetIdentifier?: string;
  valuationAmount?: string;
  valuationCurrency?: string;
  issuedBy: string;
  attestedBy?: string;
  signature?: string;
  signatureAlgorithm?: string;
  expiresAt: Date;
}

export interface TravelRuleDataInput {
  transferId: string;
  transferValueUSD: number;
  originatorName?: string;
  originatorAccount?: string;
  originatorVASP?: string;
  originatorJurisdiction?: string;
  beneficiaryName?: string;
  beneficiaryAccount?: string;
  beneficiaryVASP?: string;
  beneficiaryJurisdiction?: string;
}

export interface LockupParams {
  tokenId: string;
  investorId: string;
  unlockTimestamp: Date;
  lockupType: LockupType;
  lockupReason?: string;
  vestingSchedule?: VestingSchedule;
}

export interface VestingSchedule {
  cliffDays: number;
  periods: number[];
  amounts: string[];
}

export interface ComplianceCaseInput {
  caseType: ComplianceCaseType;
  entityType: string;
  entityId: string;
  priority?: CasePriority;
  createdBy?: string;
}

export interface ComplianceAuditLogInput {
  complianceCaseId?: string;
  actor: string;
  actorType: AuditActorType;
  action: AuditAction;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  details?: Record<string, unknown>;
  aiModelId?: string;
  aiModelVersion?: string;
  rulesetVersion?: string;
}

// ============= NEW: On-Chain Hash Types =============

export interface InvestorComplianceHashInput {
  investorId: string;
  kycDocHashes: string[];
  accreditationType?: string;
  accreditationExpiry?: Date;
}

export interface SanctionsCheckHashInput {
  address: string;
  provider: string;
  listVersion: string;
  timestamp: Date;
}

export interface AttestationHashInput {
  assetId: string;
  custodian: string;
  valuationAmount: string;
  timestamp: Date;
  proofDocHashes: string[];
}

export interface ComplianceTraceIdInput {
  tokenId: string;
  rulesetVersion: number;
  jurisdictions: string[];
  timestamp: Date;
}

// ============= Legal-BERT Types =============

export enum LegalDocumentType {
  FORM_D = 'form_d',
  PPM = 'ppm',
  RULE_506_C = 'rule_506_c',
  RULE_506_B = 'rule_506_b',
  REG_S = 'reg_s',
  SUBSCRIPTION_AGREEMENT = 'subscription_agreement',
  OPERATING_AGREEMENT = 'operating_agreement',
  INVESTMENT_AGREEMENT = 'investment_agreement',
  CUSTODY_AGREEMENT = 'custody_agreement',
  TOKEN_PURCHASE_AGREEMENT = 'token_purchase_agreement',
  PROSPECTUS = 'prospectus',
  OFFERING_MEMORANDUM = 'offering_memorandum',
  UNKNOWN = 'unknown',
}

export enum RegulationType {
  REG_D = 'reg_d',
  REG_S = 'reg_s',
  REG_A = 'reg_a',
  REG_CF = 'reg_cf',
  RULE_144 = 'rule_144',
  RULE_144A = 'rule_144a',
  MIFID_II = 'mifid_ii',
  SFA = 'sfa',
  FATF = 'fatf',
  MICA = 'mica',
  FINCEN = 'fincen',
  GDPR = 'gdpr',
  CCPA = 'ccpa',
}

export interface LegalEntity {
  name: string;
  type: 'issuer' | 'custodian' | 'law_firm' | 'auditor' | 'investor' | 'agent' | 'regulator';
  confidence: number;
}

export interface RegulationReference {
  regulation: RegulationType;
  section?: string;
  confidence: number;
}

export interface LegalClause {
  clauseType: 'lockup' | 'transfer_restriction' | 'accreditation' | 'disclosure' | 'liability' | 'termination' | 'governing_law';
  summary: string;
  confidence: number;
}

export interface LegalDocumentAnalysis {
  documentType: LegalDocumentType;
  documentTypeConfidence: number;
  entities: LegalEntity[];
  regulations: RegulationReference[];
  keyClauses: LegalClause[];
  jurisdictions: string[];
  structuredSummary: LegalDocumentStructuredSummary;
}

export interface LegalDocumentStructuredSummary {
  documentType: string;
  primaryJurisdiction: string;
  applicableRegulations: string[];
  keyEntities: string[];
  restrictionTypes: string[];
  investorRequirements: string[];
  lockupProvisions: string[];
  transferRestrictions: string[];
  disclosureRequirements: string[];
}

export interface LegalBertRequest {
  documentText: string;
}

export interface LegalBertResponse {
  documentType: LegalDocumentType;
  documentTypeConfidence: number;
  entities: LegalEntity[];
  regulations: RegulationReference[];
  keyClauses: LegalClause[];
  jurisdictions: string[];
  structuredSummary: LegalDocumentStructuredSummary;
}

export interface EnhancedComplianceRequest extends ComplianceCheckRequest {
  documentText?: string;
  useLegalBert?: boolean;
}

export interface EnhancedComplianceResponse extends ComplianceCheckResponse {
  legalBertAnalysis?: LegalDocumentAnalysis;
  pipelineUsed: '2-model' | 'mistral-only' | 'fallback';
}
