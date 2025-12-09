/**
 * Enhanced AI Compliance Service
 *
 * Semantic validation layer that calls the Python AI Compliance API
 * for jurisdiction classification and conflict resolution.
 */

import axios, { AxiosError } from 'axios';
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
  Conflict,
  Resolution,
  CombinedRequirements,
  AI_CONFIDENCE_THRESHOLD,
  buildConflictCacheKey,
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
