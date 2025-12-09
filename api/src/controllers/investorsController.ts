import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';
import { classifyInvestorJurisdiction } from '../services/aiCompliance';
import { runAMLCheck } from '../services/compliance';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ============= Validation Schemas =============

const verifyInvestorSchema = z.object({
  investor_type: z.enum(['individual', 'entity', 'trust', 'fund']),
  personal_info: z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    entity_name: z.string().optional(),
    email: z.string().email(),
    phone: z.string().optional(),
    date_of_birth: z.string().optional(),
    ssn_last4: z.string().optional(),
  }),
  address: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string().optional(),
    postal_code: z.string(),
    country: z.string(),
  }),
  accreditation: z.object({
    status: z.enum(['accredited', 'qualified_purchaser', 'professional', 'retail']).optional(),
    verification_method: z.enum(['income', 'net_worth', 'entity_assets', 'license']).optional(),
    verification_doc_url: z.string().url().optional(),
  }).optional(),
  wallet_address: z.string(),
});

const whitelistSchema = z.object({
  investor_id: z.string(),
  token_id: z.string(),
  lockup_days: z.number().int().min(0).optional(),
  max_balance: z.string().optional(),
});

// ============= Controller Functions =============

export const verifyInvestor = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const validatedData = verifyInvestorSchema.parse(req.body);

    logger.info('Verifying investor', {
      email: validatedData.personal_info.email,
      walletAddress: validatedData.wallet_address,
    });

    // Check if investor already exists
    const existingInvestor = await prisma.investor.findUnique({
      where: { walletAddress: validatedData.wallet_address },
    });

    if (existingInvestor) {
      return res.status(200).json({
        investor_id: existingInvestor.id,
        kyc_status: existingInvestor.kycStatus,
        classification: existingInvestor.classification,
        message: 'Investor already exists',
      });
    }

    // Use AI to classify investor jurisdiction and type
    const aiClassification = await classifyInvestorJurisdiction({
      investorType: validatedData.investor_type,
      address: validatedData.address,
      documents: [],
    });

    // Run AML check
    const amlResult = await runAMLCheck({
      name: validatedData.personal_info.first_name || validatedData.personal_info.entity_name || '',
      walletAddress: validatedData.wallet_address,
      country: validatedData.address.country,
    });

    // Create investor record
    const investor = await prisma.investor.create({
      data: {
        investorType: validatedData.investor_type,
        fullName: validatedData.personal_info.first_name
          ? `${validatedData.personal_info.first_name} ${validatedData.personal_info.last_name}`
          : validatedData.personal_info.entity_name || '',
        email: validatedData.personal_info.email,
        dateOfBirth: validatedData.personal_info.date_of_birth
          ? new Date(validatedData.personal_info.date_of_birth)
          : null,
        taxId: validatedData.personal_info.ssn_last4,
        address: validatedData.address,
        jurisdiction: aiClassification.jurisdiction,
        classification: aiClassification.classification,
        kycStatus: 'pending',
        amlStatus: amlResult.passed ? 'approved' : 'flagged',
        amlLastChecked: new Date(),
        walletAddress: validatedData.wallet_address,
        documents: [],
      },
    });

    // Log audit trail
    await prisma.auditLog.create({
      data: {
        action: 'investor_verified',
        entityType: 'investor',
        entityId: investor.id,
        userId: req.apiKey?.userId,
        metadata: {
          jurisdiction: investor.jurisdiction,
          classification: investor.classification,
        },
      },
    });

    res.status(201).json({
      investor_id: investor.id,
      kyc_status: investor.kycStatus,
      aml_status: investor.amlStatus,
      jurisdiction: investor.jurisdiction,
      classification: investor.classification,
      onboarding_stage: 'document_verification',
      estimated_approval_time: 86400, // 24 hours
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', error.errors));
    } else {
      next(error);
    }
  }
};

export const addToWhitelist = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const validatedData = whitelistSchema.parse(req.body);

    // Verify investor exists and is approved
    const investor = await prisma.investor.findUnique({
      where: { id: validatedData.investor_id },
    });

    if (!investor) {
      throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investor not found');
    }

    if (investor.kycStatus !== 'approved') {
      throw new ApiError(400, 'KYC_NOT_APPROVED', 'Investor KYC must be approved before whitelisting');
    }

    // Verify token exists
    const token = await prisma.token.findUnique({
      where: { id: validatedData.token_id },
    });

    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    // Check compliance rules match
    const complianceRules = token.complianceRules as any;
    if (complianceRules.accredited_only && investor.classification === 'retail') {
      throw new ApiError(403, 'COMPLIANCE_VIOLATION', 'Token requires accredited investors only');
    }

    if (
      complianceRules.allowed_jurisdictions &&
      !complianceRules.allowed_jurisdictions.includes(investor.jurisdiction)
    ) {
      throw new ApiError(403, 'JURISDICTION_NOT_ALLOWED', 'Investor jurisdiction not allowed for this token');
    }

    // Create or update whitelist entry
    const lockupUntil = validatedData.lockup_days
      ? new Date(Date.now() + validatedData.lockup_days * 24 * 60 * 60 * 1000)
      : null;

    const whitelist = await prisma.investorWhitelist.upsert({
      where: {
        tokenId_investorId: {
          tokenId: validatedData.token_id,
          investorId: validatedData.investor_id,
        },
      },
      create: {
        tokenId: validatedData.token_id,
        investorId: validatedData.investor_id,
        whitelisted: true,
        approvedBy: req.apiKey?.userId,
        approvedAt: new Date(),
        lockupUntil,
        maxBalance: validatedData.max_balance,
        onChainSynced: false,
      },
      update: {
        whitelisted: true,
        approvedBy: req.apiKey?.userId,
        approvedAt: new Date(),
        lockupUntil,
        maxBalance: validatedData.max_balance,
        onChainSynced: false,
      },
    });

    // TODO: Sync to smart contract whitelist

    res.status(200).json({
      whitelist_id: whitelist.id,
      investor_id: validatedData.investor_id,
      token_id: validatedData.token_id,
      whitelisted: true,
      lockup_until: lockupUntil,
      message: 'Investor added to whitelist successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', error.errors));
    } else {
      next(error);
    }
  }
};

export const removeFromWhitelist = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { token_id } = req.body;

    const whitelist = await prisma.investorWhitelist.updateMany({
      where: {
        investorId: id,
        tokenId: token_id,
      },
      data: {
        whitelisted: false,
        onChainSynced: false,
      },
    });

    if (whitelist.count === 0) {
      throw new ApiError(404, 'WHITELIST_NOT_FOUND', 'Whitelist entry not found');
    }

    res.json({
      message: 'Investor removed from whitelist successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getInvestor = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const investor = await prisma.investor.findUnique({
      where: { id },
      include: {
        whitelistEntries: {
          where: { whitelisted: true },
          include: {
            token: {
              select: {
                id: true,
                name: true,
                symbol: true,
              },
            },
          },
        },
      },
    });

    if (!investor) {
      throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Investor not found');
    }

    res.json({
      investor_id: investor.id,
      investor_type: investor.investorType,
      email: investor.email,
      wallet_address: investor.walletAddress,
      jurisdiction: investor.jurisdiction,
      classification: investor.classification,
      kyc_status: investor.kycStatus,
      aml_status: investor.amlStatus,
      tokens: investor.whitelistEntries.map((entry) => ({
        token_id: entry.token.id,
        token_name: entry.token.name,
        token_symbol: entry.token.symbol,
        whitelisted_at: entry.approvedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};
