import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';
import { deployTokenContract } from '../services/blockchain';
import { logger } from '../utils/logger';
import { validateTokenCompliance } from '../services/aiComplianceEnhanced';
import {
  storeConflictEvent,
  storeComplianceDecision,
  getComplianceAuditTrail,
} from '../services/preflightCheck';

const prisma = new PrismaClient();

// ============= Validation Schemas =============

const createTokenSchema = z.object({
  asset_type: z.enum(['TREASURY', 'PRIVATE_CREDIT', 'REAL_ESTATE']),
  asset_details: z.object({
    cusip: z.string().optional(),
    face_value: z.number().optional(),
    maturity_date: z.string().optional(),
    coupon_rate: z.number().optional(),
  }).passthrough(),
  token_config: z.object({
    name: z.string().min(3).max(50),
    symbol: z.string().min(2).max(10),
    total_supply: z.number().positive(),
    decimals: z.number().int().min(0).max(18).default(18),
    blockchain: z.enum(['ETHEREUM', 'POLYGON', 'AVALANCHE', 'BASE']),
  }),
  compliance_rules: z.object({
    accredited_only: z.boolean().default(true),
    max_investors: z.number().int().positive().default(2000),
    lockup_period_days: z.number().int().min(0).default(0),
    allowed_jurisdictions: z.array(z.string()).default(['US']),
  }).optional(),
  custody: z.object({
    custodian: z.enum(['FIREBLOCKS', 'ANCHORAGE', 'BITGO']),
    vault_id: z.string(),
    attestation_doc_url: z.string().url().optional(),
  }).optional(),
});

const mintTokensSchema = z.object({
  recipient: z.string(), // Ethereum address
  amount: z.string(), // BigNumber as string
});

const distributeYieldSchema = z.object({
  amount_per_token: z.string(),
  total_distribution: z.string(),
  currency: z.enum(['USDC', 'USDP', 'USD']),
  ex_dividend_date: z.string(),
  payment_date: z.string(),
  record_date: z.string(),
});

// ============= Controller Functions =============

export const createToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Validate request body
    const validatedData = createTokenSchema.parse(req.body);

    logger.info('Creating token', {
      assetType: validatedData.asset_type,
      name: validatedData.token_config.name,
      userId: req.apiKey?.userId,
    });

    // ===== AI COMPLIANCE PRE-VALIDATION =====
    // This runs BEFORE database save to catch compliance issues early
    const complianceRules = validatedData.compliance_rules || {
      accredited_only: true,
      max_investors: 2000,
      lockup_period_days: 0,
      allowed_jurisdictions: ['US'],
    };
    const jurisdictions = complianceRules.allowed_jurisdictions || ['US'];

    const aiComplianceResult = await validateTokenCompliance({
      assetType: validatedData.asset_type,
      jurisdictions,
      complianceRules: {
        accreditedOnly: complianceRules.accredited_only,
        maxInvestors: complianceRules.max_investors,
        lockupPeriodDays: complianceRules.lockup_period_days,
        allowedJurisdictions: complianceRules.allowed_jurisdictions,
      },
    });

    logger.info('AI compliance validation result', {
      approved: aiComplianceResult.approved,
      confidence: aiComplianceResult.confidence,
      hasConflicts: aiComplianceResult.conflicts.length > 0,
      isFallback: aiComplianceResult.isFallback,
    });

    // Reject if AI compliance check fails and requires manual review
    if (!aiComplianceResult.approved && !aiComplianceResult.requiresManualReview) {
      throw new ApiError(
        400,
        'COMPLIANCE_VIOLATION',
        aiComplianceResult.reason || 'Token configuration violates regulatory requirements',
        {
          conflicts: aiComplianceResult.conflicts,
          suggestedRequirements: aiComplianceResult.combinedRequirements,
        }
      );
    }

    // ===== MERGE AI COMBINED REQUIREMENTS INTO COMPLIANCE RULES =====
    // This embeds the AI-resolved compliance requirements on-chain
    const mergedComplianceRules = {
      ...complianceRules,
      // AI-resolved requirements (override original rules with stricter AI recommendations)
      ai_combined_requirements: aiComplianceResult.combinedRequirements,
      // Track ruleset version used for this token
      ruleset_version: aiComplianceResult.rulesetVersion,
      // Flag if manual review is required
      requires_manual_review: aiComplianceResult.requiresManualReview,
      // Apply AI-recommended settings
      accredited_only: aiComplianceResult.combinedRequirements.accreditedOnly,
      max_investors: Math.min(
        complianceRules.max_investors,
        aiComplianceResult.combinedRequirements.maxInvestors
      ),
      lockup_period_days: Math.max(
        complianceRules.lockup_period_days,
        aiComplianceResult.combinedRequirements.lockupDays
      ),
      min_investment: aiComplianceResult.combinedRequirements.minInvestment,
      required_disclosures: aiComplianceResult.combinedRequirements.requiredDisclosures,
      transfer_restrictions: aiComplianceResult.combinedRequirements.transferRestrictions,
    };

    // Create token record in database with merged compliance rules
    const token = await prisma.token.create({
      data: {
        name: validatedData.token_config.name,
        symbol: validatedData.token_config.symbol,
        assetType: validatedData.asset_type,
        totalSupply: validatedData.token_config.total_supply.toString(),
        decimals: validatedData.token_config.decimals,
        blockchain: validatedData.token_config.blockchain.toLowerCase(),
        status: 'pending',
        assetDetails: validatedData.asset_details as any,
        complianceRules: mergedComplianceRules as any,
        custodian: validatedData.custody?.custodian,
        custodianVaultId: validatedData.custody?.vault_id,
        issuerId: req.apiKey?.userId || null,
      },
    });

    // ===== STORE COMPLIANCE DECISION FOR FULL AUDIT TRAIL =====
    await storeComplianceDecision(
      token.id,
      'pre_validation',
      aiComplianceResult.approved,
      aiComplianceResult.reason,
      aiComplianceResult.confidence,
      aiComplianceResult.requiresManualReview,
      aiComplianceResult.isFallback,
      aiComplianceResult.combinedRequirements,
      aiComplianceResult.rulesetVersion,
      {
        assetType: validatedData.asset_type,
        jurisdictions,
        originalComplianceRules: complianceRules,
      }
    );

    // ===== STORE ENHANCED CONFLICT EVENTS =====
    if (aiComplianceResult.conflicts.length > 0) {
      for (const conflict of aiComplianceResult.conflicts) {
        const resolution = aiComplianceResult.resolutions.find(
          (r) => r.conflictType === conflict.type
        );
        await storeConflictEvent({
          tokenId: token.id,
          conflictType: conflict.type,
          jurisdictionA: conflict.jurisdictions[0] || 'unknown',
          jurisdictionB: conflict.jurisdictions[1] || 'unknown',
          description: conflict.description,
          ruleA: conflict.ruleA,
          ruleB: conflict.ruleB,
          resolution: resolution?.resolvedRequirement || 'unresolved',
          resolutionStrategy: resolution?.strategy,
          resolutionRationale: resolution?.rationale,
          aiConfidence: aiComplianceResult.confidence,
          rulesetVersion: aiComplianceResult.rulesetVersion,
          isFallback: aiComplianceResult.isFallback,
          requiresReview: aiComplianceResult.requiresManualReview,
        });
      }
    }

    // Trigger async deployment (background job)
    deployTokenContract(token.id).catch((error) => {
      logger.error('Token deployment failed', { tokenId: token.id, error });
    });

    // Log audit trail
    await prisma.auditLog.create({
      data: {
        action: 'token_created',
        entityType: 'token',
        entityId: token.id,
        userId: req.apiKey?.userId,
        metadata: {
          assetType: token.assetType,
          blockchain: token.blockchain,
          aiCompliance: {
            approved: aiComplianceResult.approved,
            confidence: aiComplianceResult.confidence,
            requiresManualReview: aiComplianceResult.requiresManualReview,
            conflictCount: aiComplianceResult.conflicts.length,
            rulesetVersion: aiComplianceResult.rulesetVersion,
          },
        },
      },
    });

    res.status(201).json({
      token_id: token.id,
      contract_address: token.contractAddress,
      status: token.status,
      blockchain: token.blockchain,
      created_at: token.createdAt,
      estimated_deployment_time: 300, // 5 minutes
      compliance: {
        approved: aiComplianceResult.approved,
        confidence: aiComplianceResult.confidence,
        requires_manual_review: aiComplianceResult.requiresManualReview,
        conflict_count: aiComplianceResult.conflicts.length,
        combined_requirements: aiComplianceResult.combinedRequirements,
        ruleset_version: aiComplianceResult.rulesetVersion,
        is_fallback: aiComplianceResult.isFallback,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', error.errors));
    } else {
      next(error);
    }
  }
};

export const getToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const token = await prisma.token.findUnique({
      where: { id },
      include: {
        investors: {
          where: { whitelisted: true },
          select: {
            investor: {
              select: {
                id: true,
                walletAddress: true,
                classification: true,
              },
            },
          },
        },
      },
    });

    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    res.json({
      token_id: token.id,
      token_address: token.contractAddress,
      asset_type: token.assetType,
      status: token.status,
      name: token.name,
      symbol: token.symbol,
      total_supply: token.totalSupply,
      decimals: token.decimals,
      blockchain: token.blockchain,
      investor_count: token.investors.length,
      created_at: token.createdAt,
      deployed_at: token.deployedAt,
    });
  } catch (error) {
    next(error);
  }
};

export const mintTokens = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const validatedData = mintTokensSchema.parse(req.body);

    const token = await prisma.token.findUnique({ where: { id } });

    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    if (token.status !== 'deployed') {
      throw new ApiError(400, 'TOKEN_NOT_DEPLOYED', 'Token must be deployed before minting');
    }

    // Create transfer record (mint type)
    const transfer = await prisma.transfer.create({
      data: {
        tokenId: id,
        toAddress: validatedData.recipient,
        amount: validatedData.amount,
        transferType: 'mint',
        status: 'pending',
        complianceChecks: [],
      },
    });

    // TODO: Execute on-chain mint transaction
    // This will be handled by blockchain service

    res.status(202).json({
      transfer_id: transfer.id,
      status: 'pending',
      message: 'Mint transaction queued for execution',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', error.errors));
    } else {
      next(error);
    }
  }
};

export const burnTokens = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Similar to mint, but burn type
    res.status(501).json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Burn functionality coming soon',
      },
    });
  } catch (error) {
    next(error);
  }
};

export const distributeYield = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const validatedData = distributeYieldSchema.parse(req.body);

    const token = await prisma.token.findUnique({ where: { id } });

    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    // Create distribution record
    const distribution = await prisma.distribution.create({
      data: {
        tokenId: id,
        distributionType: 'dividend',
        amountPerToken: validatedData.amount_per_token,
        totalAmount: validatedData.total_distribution,
        currency: validatedData.currency,
        exDate: new Date(validatedData.ex_dividend_date),
        recordDate: new Date(validatedData.record_date),
        paymentDate: new Date(validatedData.payment_date),
        status: 'pending',
      },
    });

    res.status(202).json({
      distribution_id: distribution.id,
      status: 'pending',
      payment_date: distribution.paymentDate,
      message: 'Distribution scheduled successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', error.errors));
    } else {
      next(error);
    }
  }
};

export const getTokenHolders = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const whitelistedInvestors = await prisma.investorWhitelist.findMany({
      where: {
        tokenId: id,
        whitelisted: true,
      },
      include: {
        investor: {
          select: {
            id: true,
            walletAddress: true,
            classification: true,
            jurisdiction: true,
          },
        },
      },
    });

    res.json({
      token_id: id,
      total_holders: whitelistedInvestors.length,
      holders: whitelistedInvestors.map((entry) => ({
        investor_id: entry.investor.id,
        wallet_address: entry.investor.walletAddress,
        classification: entry.investor.classification,
        jurisdiction: entry.investor.jurisdiction,
        whitelisted_at: entry.approvedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

// ============= Compliance Audit Endpoint =============

export const getTokenComplianceAudit = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    // Get token with compliance rules
    const token = await prisma.token.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        symbol: true,
        assetType: true,
        status: true,
        complianceRules: true,
        createdAt: true,
        deployedAt: true,
      },
    });

    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    // Get full compliance audit trail
    const auditTrail = await getComplianceAuditTrail(id);

    // Format response for frontend dashboard
    res.json({
      token_id: token.id,
      token_name: token.name,
      token_symbol: token.symbol,
      asset_type: token.assetType,
      status: token.status,
      created_at: token.createdAt,
      deployed_at: token.deployedAt,

      // Current compliance rules (with AI-merged requirements)
      compliance_rules: token.complianceRules,

      // AI compliance summary
      compliance_summary: {
        total_conflicts: auditTrail.summary.totalConflicts,
        resolved_conflicts: auditTrail.summary.resolvedConflicts,
        unresolved_conflicts: auditTrail.summary.unresolvedConflicts,
        manual_review_required: auditTrail.summary.manualReviewRequired,
        ai_confidence: auditTrail.summary.latestConfidence,
        ruleset_version: auditTrail.summary.latestRulesetVersion,
      },

      // Conflict events (for dashboard table display)
      conflict_events: auditTrail.conflictEvents.map((event) => ({
        id: event.id,
        conflict_type: event.conflictType,
        jurisdiction_a: event.jurisdictionA,
        jurisdiction_b: event.jurisdictionB,
        description: event.description,
        rule_a: event.ruleA,
        rule_b: event.ruleB,
        resolution: event.resolution,
        resolution_strategy: event.resolutionStrategy,
        resolution_rationale: event.resolutionRationale,
        ai_confidence: event.aiConfidence,
        is_fallback: event.isFallback,
        requires_review: event.requiresReview,
        resolved_at: event.resolvedAt,
      })),

      // Compliance decisions timeline
      compliance_decisions: auditTrail.complianceDecisions.map((decision) => ({
        id: decision.id,
        decision_type: decision.decisionType,
        approved: decision.approved,
        reason: decision.reason,
        ai_confidence: decision.aiConfidence,
        requires_manual_review: decision.requiresManualReview,
        is_fallback: decision.isFallback,
        combined_requirements: decision.combinedRequirements,
        ruleset_version: decision.rulesetVersion,
        created_at: decision.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};
