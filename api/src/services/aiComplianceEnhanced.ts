/**
 * Enhanced AI Compliance Service
 *
 * 2-Model Pipeline Architecture:
 * - Legal-BERT (preprocessing): Document understanding, entity extraction, regulation detection
 * - Mistral 7B (reasoning): Conflict resolution, compliance decisions
 *
 * Legal-BERT = "reads the law"
 * Mistral = "applies the law"
 */

import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getComplianceCache, setComplianceCache, getFallbackCache, setFallbackCache } from './cache';
import {
  ConflictType,
  ResolutionStrategy,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ConflictResolutionResult,
  JurisdictionClassificationResult,
  TokenValidationResult,
  AI_CONFIDENCE_THRESHOLD,
  buildConflictCacheKey,
  LegalDocumentAnalysis,
  LegalDocumentType,
  LegalEntity,
  LegalClause,
  EnhancedComplianceRequest,
  EnhancedComplianceResponse,
  RegulationType,
} from '../types/conflicts';

const AI_API_URL = config.externalServices.aiCompliance.apiUrl;
const AI_TIMEOUT = config.externalServices.aiCompliance.timeout || 20000;

// ============= Main Compliance Validation =============

/**
 * Validate token compliance rules against regulatory requirements
 * This is the primary entry point for pre-creation validation
 */
export async function validateTokenCompliance(
  params: ComplianceCheckRequest
): Promise<ComplianceCheckResponse> {
  const startTime = Date.now();
  const cacheKey = buildConflictCacheKey(params.jurisdictions, params.assetType);

  try {
    // Check cache first
    const cached = await getComplianceCache<ConflictResolutionResult>(cacheKey);
    if (cached) {
      logger.info('Using cached compliance result', { cacheKey });
      return formatComplianceResponse(cached, true);
    }

    // Call AI API for conflict resolution
    logger.info('Calling AI compliance API', {
      jurisdictions: params.jurisdictions,
      assetType: params.assetType,
    });

    const result = await resolveConflictsWithAI(params);

    // Cache successful result
    await setComplianceCache(cacheKey, result);

    // Also set as fallback cache
    await setFallbackCache(cacheKey, result);

    const duration = Date.now() - startTime;
    logger.info('AI compliance validation completed', {
      duration,
      hasConflicts: result.hasConflicts,
      confidence: result.confidence,
    });

    return formatComplianceResponse(result, false);
  } catch (error) {
    logger.error('AI compliance validation failed, attempting fallback', { error });

    // Try fallback cache
    const fallback = await getFallbackCache<ConflictResolutionResult>(cacheKey);
    if (fallback) {
      logger.warn('Using fallback cached result', { cacheKey });
      return formatComplianceResponse({ ...fallback, isFallback: true }, false);
    }

    // Last resort: apply strictest rules
    return getStrictestFallback(params);
  }
}

// ============= AI API Calls =============

/**
 * Call AI API to resolve conflicts across jurisdictions
 */
async function resolveConflictsWithAI(
  params: ComplianceCheckRequest
): Promise<ConflictResolutionResult> {
  const response = await axios.post<{
    has_conflicts: boolean;
    conflicts: Array<{
      type: string;
      jurisdictions: string[];
      description: string;
      rule_a: string;
      rule_b: string;
    }>;
    resolutions: Array<{
      conflict_type: string;
      strategy: string;
      resolved_requirement: string;
      rationale: string;
    }>;
    combined_requirements: {
      accredited_only: boolean;
      min_investment: number;
      max_investors: number;
      lockup_days: number;
      required_disclosures: string[];
      transfer_restrictions?: string;
      filing_requirements?: string[];
    };
    confidence: number;
    requires_manual_review: boolean;
    ruleset_version: string;
    is_fallback: boolean;
  }>(
    `${AI_API_URL}/resolve-conflicts`,
    {
      jurisdictions: params.jurisdictions,
      asset_type: params.assetType,
      investor_types: params.investorTypes || ['accredited'],
    },
    { timeout: AI_TIMEOUT }
  );

  // Transform snake_case to camelCase
  return {
    hasConflicts: response.data.has_conflicts,
    conflicts: response.data.conflicts.map((c) => ({
      type: c.type as ConflictType,
      jurisdictions: c.jurisdictions,
      description: c.description,
      ruleA: c.rule_a,
      ruleB: c.rule_b,
    })),
    resolutions: response.data.resolutions.map((r) => ({
      conflictType: r.conflict_type as ConflictType,
      strategy: r.strategy as ResolutionStrategy,
      resolvedRequirement: r.resolved_requirement,
      rationale: r.rationale,
    })),
    combinedRequirements: {
      accreditedOnly: response.data.combined_requirements.accredited_only,
      minInvestment: response.data.combined_requirements.min_investment,
      maxInvestors: response.data.combined_requirements.max_investors,
      lockupDays: response.data.combined_requirements.lockup_days,
      requiredDisclosures: response.data.combined_requirements.required_disclosures,
      transferRestrictions: response.data.combined_requirements.transfer_restrictions,
      filingRequirements: response.data.combined_requirements.filing_requirements,
    },
    confidence: response.data.confidence,
    requiresManualReview:
      response.data.requires_manual_review ||
      response.data.confidence < AI_CONFIDENCE_THRESHOLD,
    rulesetVersion: response.data.ruleset_version,
    isFallback: response.data.is_fallback,
  };
}

/**
 * Classify investor jurisdiction using AI
 */
export async function classifyJurisdictionWithAI(
  documentText: string,
  documentType: string
): Promise<JurisdictionClassificationResult> {
  try {
    const response = await axios.post<{
      jurisdiction: string;
      entity_type: string;
      investor_classification: string;
      applicable_regulations: string[];
      confidence: number;
      requires_manual_review: boolean;
      reasoning?: string;
      ruleset_version: string;
    }>(
      `${AI_API_URL}/classify-jurisdiction`,
      {
        document_text: documentText,
        document_type: documentType,
      },
      { timeout: AI_TIMEOUT }
    );

    return {
      jurisdiction: response.data.jurisdiction,
      entityType: response.data.entity_type,
      investorClassification: response.data.investor_classification,
      applicableRegulations: response.data.applicable_regulations,
      confidence: response.data.confidence,
      requiresManualReview:
        response.data.requires_manual_review ||
        response.data.confidence < AI_CONFIDENCE_THRESHOLD,
      reasoning: response.data.reasoning,
      rulesetVersion: response.data.ruleset_version,
    };
  } catch (error) {
    logger.error('Jurisdiction classification failed', { error });
    throw error;
  }
}

/**
 * Validate token configuration against regulatory requirements
 */
export async function validateTokenConfigWithAI(
  params: ComplianceCheckRequest
): Promise<TokenValidationResult> {
  try {
    const response = await axios.post<{
      valid: boolean;
      violations: Array<{
        rule: string;
        issue: string;
        required_value?: string;
        proposed_value?: string;
        severity: 'error' | 'warning';
      }>;
      suggestions: Array<{
        rule: string;
        suggested_value: string;
        rationale: string;
      }>;
      confidence: number;
      requires_manual_review: boolean;
    }>(
      `${AI_API_URL}/validate-token-compliance`,
      {
        asset_type: params.assetType,
        jurisdictions: params.jurisdictions,
        compliance_rules: {
          accredited_only: params.complianceRules.accreditedOnly ?? true,
          max_investors: params.complianceRules.maxInvestors ?? 2000,
          lockup_period_days: params.complianceRules.lockupPeriodDays ?? 0,
          min_investment: params.complianceRules.minInvestment ?? 0,
          allowed_jurisdictions: params.complianceRules.allowedJurisdictions ?? [],
        },
      },
      { timeout: AI_TIMEOUT }
    );

    return {
      valid: response.data.valid,
      violations: response.data.violations.map((v) => ({
        rule: v.rule,
        issue: v.issue,
        requiredValue: v.required_value,
        proposedValue: v.proposed_value,
        severity: v.severity,
      })),
      suggestions: response.data.suggestions.map((s) => ({
        rule: s.rule,
        suggestedValue: s.suggested_value,
        rationale: s.rationale,
      })),
      confidence: response.data.confidence,
      requiresManualReview:
        response.data.requires_manual_review ||
        response.data.confidence < AI_CONFIDENCE_THRESHOLD,
    };
  } catch (error) {
    logger.error('Token validation failed', { error });
    throw error;
  }
}

// ============= Helper Functions =============

/**
 * Format the AI result into the API response format
 */
function formatComplianceResponse(
  result: ConflictResolutionResult,
  fromCache: boolean
): ComplianceCheckResponse {
  // Determine approval based on conflicts and manual review requirements
  const hasBlockingConflicts = result.conflicts.some(
    (c) =>
      c.type === ConflictType.JURISDICTION_CONFLICT &&
      !result.resolutions.some((r) => r.conflictType === c.type)
  );

  const approved = !hasBlockingConflicts && !result.requiresManualReview;

  let reason: string | undefined;
  if (!approved) {
    if (result.requiresManualReview) {
      reason = `AI confidence ${(result.confidence * 100).toFixed(0)}% below threshold - manual review required`;
    } else if (hasBlockingConflicts) {
      reason = `Unresolved regulatory conflicts between jurisdictions`;
    }
  }

  return {
    approved,
    reason,
    conflicts: result.conflicts,
    resolutions: result.resolutions,
    combinedRequirements: result.combinedRequirements,
    confidence: result.confidence,
    requiresManualReview: result.requiresManualReview,
    rulesetVersion: result.rulesetVersion,
    isFallback: result.isFallback || fromCache,
  };
}

/**
 * Strictest fallback when AI and cache are unavailable
 */
function getStrictestFallback(params: ComplianceCheckRequest): ComplianceCheckResponse {
  logger.warn('Using strictest fallback rules - no AI or cache available');

  return {
    approved: false,
    reason: 'AI service unavailable - manual review required for compliance verification',
    conflicts: [
      {
        type: ConflictType.JURISDICTION_CONFLICT,
        jurisdictions: params.jurisdictions,
        description: 'Unable to analyze jurisdiction conflicts - AI unavailable',
        ruleA: 'Unknown',
        ruleB: 'Unknown',
      },
    ],
    resolutions: [
      {
        conflictType: ConflictType.JURISDICTION_CONFLICT,
        strategy: ResolutionStrategy.APPLY_STRICTEST,
        resolvedRequirement: 'Require accredited investors only with manual review',
        rationale: 'Fallback mode - conservative approach applied',
      },
    ],
    combinedRequirements: {
      accreditedOnly: true,
      minInvestment: 100000,
      maxInvestors: 35,
      lockupDays: 365,
      requiredDisclosures: ['PPM', 'Subscription Agreement', 'Risk Disclosures'],
      transferRestrictions: 'All transfers require manual compliance review',
    },
    confidence: 0.0,
    requiresManualReview: true,
    rulesetVersion: 'fallback',
    isFallback: true,
  };
}

// ============= Investor Compatibility =============

/**
 * Check if an investor is compatible with a token's compliance rules
 */
export async function checkInvestorTokenCompatibility(
  investor: {
    jurisdiction: string;
    classification: string;
    kycStatus: string;
  },
  token: {
    id: string;
    complianceRules: {
      accredited_only?: boolean;
      allowed_jurisdictions?: string[];
      lockup_period_days?: number;
    };
  }
): Promise<{
  compatible: boolean;
  reason?: string;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const rules = token.complianceRules;

  // Check KYC status
  if (investor.kycStatus !== 'approved') {
    return {
      compatible: false,
      reason: 'Investor KYC not approved',
      warnings: [],
    };
  }

  // Check jurisdiction
  if (
    rules.allowed_jurisdictions &&
    rules.allowed_jurisdictions.length > 0 &&
    !rules.allowed_jurisdictions.includes(investor.jurisdiction)
  ) {
    return {
      compatible: false,
      reason: `Investor jurisdiction ${investor.jurisdiction} not allowed for this token`,
      warnings: [],
    };
  }

  // Check accreditation
  if (rules.accredited_only) {
    const accreditedClassifications = [
      'accredited',
      'accredited_investor',
      'qualified_purchaser',
      'institutional',
      'institutional_investor',
      'professional',
      'eligible_counterparty',
      'expert_investor',
    ];

    if (!accreditedClassifications.includes(investor.classification.toLowerCase())) {
      return {
        compatible: false,
        reason: `Token requires accredited investors only. Investor classification: ${investor.classification}`,
        warnings: [],
      };
    }
  }

  // Add warnings for edge cases
  if (investor.classification === 'retail') {
    warnings.push('Retail investor - additional suitability checks may be required');
  }

  return {
    compatible: true,
    warnings,
  };
}

// ============= Legal-BERT Integration =============

const LEGAL_BERT_TIMEOUT = 15000; // 15 seconds for document preprocessing

/**
 * Call Legal-BERT API to preprocess legal documents
 * Returns structured document analysis for Mistral enrichment
 */
export async function classifyLegalDocument(
  documentText: string
): Promise<LegalDocumentAnalysis | null> {
  const startTime = Date.now();

  try {
    logger.info('Calling Legal-BERT for document preprocessing', {
      documentLength: documentText.length,
    });

    const response = await axios.post<{
      document_type: string;
      document_type_confidence: number;
      entities: Array<{
        name: string;
        type: string;
        confidence: number;
      }>;
      regulations: Array<{
        regulation: string;
        section?: string;
        confidence: number;
      }>;
      key_clauses: Array<{
        clause_type: string;
        summary: string;
        confidence: number;
      }>;
      jurisdictions: string[];
      structured_summary: {
        document_type: string;
        primary_jurisdiction: string;
        applicable_regulations: string[];
        key_entities: string[];
        restriction_types: string[];
        investor_requirements: string[];
        lockup_provisions: string[];
        transfer_restrictions: string[];
        disclosure_requirements: string[];
      };
    }>(
      `${AI_API_URL}/classify-legal-doc`,
      { document_text: documentText },
      { timeout: LEGAL_BERT_TIMEOUT }
    );

    const duration = Date.now() - startTime;
    logger.info('Legal-BERT preprocessing completed', {
      duration,
      documentType: response.data.document_type,
      confidence: response.data.document_type_confidence,
      entityCount: response.data.entities.length,
      regulationCount: response.data.regulations.length,
    });

    // Transform snake_case to camelCase
    return {
      documentType: response.data.document_type as LegalDocumentType,
      documentTypeConfidence: response.data.document_type_confidence,
      entities: response.data.entities.map((e) => ({
        name: e.name,
        type: e.type as LegalEntity['type'],
        confidence: e.confidence,
      })),
      regulations: response.data.regulations.map((r) => ({
        regulation: r.regulation as RegulationType,
        section: r.section,
        confidence: r.confidence,
      })),
      keyClauses: response.data.key_clauses.map((c) => ({
        clauseType: c.clause_type as LegalClause['clauseType'],
        summary: c.summary,
        confidence: c.confidence,
      })),
      jurisdictions: response.data.jurisdictions,
      structuredSummary: {
        documentType: response.data.structured_summary.document_type,
        primaryJurisdiction: response.data.structured_summary.primary_jurisdiction,
        applicableRegulations: response.data.structured_summary.applicable_regulations,
        keyEntities: response.data.structured_summary.key_entities,
        restrictionTypes: response.data.structured_summary.restriction_types,
        investorRequirements: response.data.structured_summary.investor_requirements,
        lockupProvisions: response.data.structured_summary.lockup_provisions,
        transferRestrictions: response.data.structured_summary.transfer_restrictions,
        disclosureRequirements: response.data.structured_summary.disclosure_requirements,
      },
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.warn('Legal-BERT preprocessing failed, continuing with Mistral-only', {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Build enriched context from Legal-BERT analysis for Mistral prompt
 */
function buildLegalBertContext(analysis: LegalDocumentAnalysis): string {
  const summary = analysis.structuredSummary;

  const contextParts: string[] = [
    `Document Analysis (from Legal-BERT preprocessing):`,
    `- Document Type: ${summary.documentType} (confidence: ${(analysis.documentTypeConfidence * 100).toFixed(0)}%)`,
    `- Primary Jurisdiction: ${summary.primaryJurisdiction}`,
  ];

  if (analysis.jurisdictions.length > 0) {
    contextParts.push(`- Detected Jurisdictions: ${analysis.jurisdictions.join(', ')}`);
  }

  if (summary.applicableRegulations.length > 0) {
    contextParts.push(`- Applicable Regulations: ${summary.applicableRegulations.join(', ')}`);
  }

  if (summary.keyEntities.length > 0) {
    contextParts.push(`- Key Entities: ${summary.keyEntities.join(', ')}`);
  }

  if (summary.investorRequirements.length > 0) {
    contextParts.push(`- Investor Requirements: ${summary.investorRequirements.join('; ')}`);
  }

  if (summary.lockupProvisions.length > 0) {
    contextParts.push(`- Lockup Provisions: ${summary.lockupProvisions.join('; ')}`);
  }

  if (summary.transferRestrictions.length > 0) {
    contextParts.push(`- Transfer Restrictions: ${summary.transferRestrictions.join('; ')}`);
  }

  // Add high-confidence clauses
  const highConfidenceClauses = analysis.keyClauses.filter((c) => c.confidence >= 0.7);
  if (highConfidenceClauses.length > 0) {
    contextParts.push(`\nKey Clauses Identified:`);
    highConfidenceClauses.forEach((c) => {
      contextParts.push(`  - ${c.clauseType}: ${c.summary}`);
    });
  }

  return contextParts.join('\n');
}

/**
 * 2-Model Pipeline: Legal-BERT preprocessing → Mistral reasoning
 *
 * This is the enhanced compliance validation that uses both models:
 * 1. Legal-BERT analyzes the document and extracts structured information
 * 2. Mistral receives enriched context for better compliance reasoning
 */
export async function validateTokenComplianceWithPipeline(
  params: EnhancedComplianceRequest
): Promise<EnhancedComplianceResponse> {
  const startTime = Date.now();
  const cacheKey = buildConflictCacheKey(params.jurisdictions, params.assetType);

  let legalBertAnalysis: LegalDocumentAnalysis | null = null;
  let pipelineUsed: EnhancedComplianceResponse['pipelineUsed'] = 'mistral-only';

  try {
    // Step 1: Check cache first
    const cached = await getComplianceCache<ConflictResolutionResult>(cacheKey);
    if (cached) {
      logger.info('Using cached compliance result', { cacheKey });
      return {
        ...formatComplianceResponse(cached, true),
        pipelineUsed: 'fallback',
      };
    }

    // Step 2: Legal-BERT preprocessing (if document text provided)
    if (params.documentText && params.useLegalBert !== false) {
      legalBertAnalysis = await classifyLegalDocument(params.documentText);

      if (legalBertAnalysis) {
        pipelineUsed = '2-model';

        // Use detected jurisdictions from Legal-BERT if more comprehensive
        if (
          legalBertAnalysis.jurisdictions.length > params.jurisdictions.length &&
          legalBertAnalysis.documentTypeConfidence >= 0.6
        ) {
          logger.info('Enriching jurisdictions from Legal-BERT analysis', {
            original: params.jurisdictions,
            detected: legalBertAnalysis.jurisdictions,
          });
          // Merge detected jurisdictions with provided ones
          const allJurisdictions = new Set([
            ...params.jurisdictions,
            ...legalBertAnalysis.jurisdictions,
          ]);
          params.jurisdictions = Array.from(allJurisdictions);
        }
      }
    }

    // Step 3: Call AI API for conflict resolution (with or without Legal-BERT context)
    logger.info('Calling AI compliance API with pipeline', {
      jurisdictions: params.jurisdictions,
      assetType: params.assetType,
      pipelineUsed,
      hasLegalBertContext: !!legalBertAnalysis,
    });

    const result = await resolveConflictsWithPipeline(params, legalBertAnalysis);

    // Step 4: Cache successful result
    await setComplianceCache(cacheKey, result);
    await setFallbackCache(cacheKey, result);

    const duration = Date.now() - startTime;
    logger.info('2-Model pipeline compliance validation completed', {
      duration,
      hasConflicts: result.hasConflicts,
      confidence: result.confidence,
      pipelineUsed,
    });

    return {
      ...formatComplianceResponse(result, false),
      legalBertAnalysis: legalBertAnalysis || undefined,
      pipelineUsed,
    };
  } catch (error) {
    logger.error('Pipeline compliance validation failed, attempting fallback', { error });

    // Try fallback cache
    const fallback = await getFallbackCache<ConflictResolutionResult>(cacheKey);
    if (fallback) {
      logger.warn('Using fallback cached result', { cacheKey });
      return {
        ...formatComplianceResponse({ ...fallback, isFallback: true }, false),
        legalBertAnalysis: legalBertAnalysis || undefined,
        pipelineUsed: 'fallback',
      };
    }

    // Last resort: apply strictest rules
    return {
      ...getStrictestFallback(params),
      legalBertAnalysis: legalBertAnalysis || undefined,
      pipelineUsed: 'fallback',
    };
  }
}

/**
 * Call AI API to resolve conflicts with enriched Legal-BERT context
 */
async function resolveConflictsWithPipeline(
  params: EnhancedComplianceRequest,
  legalBertAnalysis: LegalDocumentAnalysis | null
): Promise<ConflictResolutionResult> {
  // Build the request payload
  const requestPayload: {
    jurisdictions: string[];
    asset_type: string;
    investor_types: string[];
    legal_bert_context?: string;
    document_analysis?: {
      document_type: string;
      confidence: number;
      regulations: string[];
      jurisdictions: string[];
      key_clauses: string[];
    };
  } = {
    jurisdictions: params.jurisdictions,
    asset_type: params.assetType,
    investor_types: params.investorTypes || ['accredited'],
  };

  // Add Legal-BERT context if available
  if (legalBertAnalysis) {
    requestPayload.legal_bert_context = buildLegalBertContext(legalBertAnalysis);
    requestPayload.document_analysis = {
      document_type: legalBertAnalysis.documentType,
      confidence: legalBertAnalysis.documentTypeConfidence,
      regulations: legalBertAnalysis.structuredSummary.applicableRegulations,
      jurisdictions: legalBertAnalysis.jurisdictions,
      key_clauses: legalBertAnalysis.keyClauses.map((c) => `${c.clauseType}: ${c.summary}`),
    };
  }

  const response = await axios.post<{
    has_conflicts: boolean;
    conflicts: Array<{
      type: string;
      jurisdictions: string[];
      description: string;
      rule_a: string;
      rule_b: string;
    }>;
    resolutions: Array<{
      conflict_type: string;
      strategy: string;
      resolved_requirement: string;
      rationale: string;
    }>;
    combined_requirements: {
      accredited_only: boolean;
      min_investment: number;
      max_investors: number;
      lockup_days: number;
      required_disclosures: string[];
      transfer_restrictions?: string;
      filing_requirements?: string[];
    };
    confidence: number;
    requires_manual_review: boolean;
    ruleset_version: string;
    is_fallback: boolean;
  }>(
    `${AI_API_URL}/resolve-conflicts`,
    requestPayload,
    { timeout: AI_TIMEOUT }
  );

  // Transform snake_case to camelCase
  return {
    hasConflicts: response.data.has_conflicts,
    conflicts: response.data.conflicts.map((c) => ({
      type: c.type as ConflictType,
      jurisdictions: c.jurisdictions,
      description: c.description,
      ruleA: c.rule_a,
      ruleB: c.rule_b,
    })),
    resolutions: response.data.resolutions.map((r) => ({
      conflictType: r.conflict_type as ConflictType,
      strategy: r.strategy as ResolutionStrategy,
      resolvedRequirement: r.resolved_requirement,
      rationale: r.rationale,
    })),
    combinedRequirements: {
      accreditedOnly: response.data.combined_requirements.accredited_only,
      minInvestment: response.data.combined_requirements.min_investment,
      maxInvestors: response.data.combined_requirements.max_investors,
      lockupDays: response.data.combined_requirements.lockup_days,
      requiredDisclosures: response.data.combined_requirements.required_disclosures,
      transferRestrictions: response.data.combined_requirements.transfer_restrictions,
      filingRequirements: response.data.combined_requirements.filing_requirements,
    },
    confidence: response.data.confidence,
    requiresManualReview:
      response.data.requires_manual_review ||
      response.data.confidence < AI_CONFIDENCE_THRESHOLD,
    rulesetVersion: response.data.ruleset_version,
    isFallback: response.data.is_fallback,
  };
}

/**
 * Analyze document structure only (Legal-BERT standalone)
 * Useful for document intake and classification before full compliance check
 */
export async function analyzeDocumentStructure(
  documentText: string
): Promise<{
  analysis: LegalDocumentAnalysis | null;
  success: boolean;
  error?: string;
}> {
  try {
    const analysis = await classifyLegalDocument(documentText);
    return {
      analysis,
      success: !!analysis,
      error: analysis ? undefined : 'Legal-BERT analysis failed',
    };
  } catch (error) {
    return {
      analysis: null,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get model status for both Legal-BERT and Mistral
 */
export async function getModelStatus(): Promise<{
  legalBert: { available: boolean; model: string };
  mistral: { available: boolean; model: string };
}> {
  try {
    const response = await axios.get<{
      legal_bert: { available: boolean; model: string };
      mistral: { available: boolean; model: string };
    }>(`${AI_API_URL}/models/status`, { timeout: 5000 });

    return {
      legalBert: {
        available: response.data.legal_bert.available,
        model: response.data.legal_bert.model,
      },
      mistral: {
        available: response.data.mistral.available,
        model: response.data.mistral.model,
      },
    };
  } catch {
    return {
      legalBert: { available: false, model: 'unknown' },
      mistral: { available: false, model: 'unknown' },
    };
  }
}
