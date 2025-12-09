/**
 * Sandbox Routes - Developer Testing Endpoints
 *
 * These routes allow developers to quickly test the API with pre-filled
 * example data without needing to construct complex requests.
 * Similar to Stripe's test mode.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Create a sample Treasury token with pre-filled data
 * POST /sandbox/treasury/create
 */
router.post('/treasury/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);

    logger.info('Creating sandbox treasury token', {
      userId: req.apiKey?.userId,
      timestamp,
    });

    // Create token with example data
    const token = await prisma.token.create({
      data: {
        name: `US Treasury 4.25% 2026 (Sandbox ${randomSuffix})`,
        symbol: `UST-${randomSuffix.toUpperCase()}`,
        assetType: 'TREASURY',
        totalSupply: '10000000',
        decimals: 18,
        blockchain: 'ethereum',
        status: 'pending',
        assetDetails: {
          cusip: '912828YK0',
          face_value: 10000000,
          maturity_date: '2026-12-31',
          coupon_rate: 0.0425,
          issuer: 'US Department of Treasury',
          description: 'Sample US Treasury bond for testing',
        },
        complianceRules: {
          accredited_only: true,
          max_investors: 2000,
          lockup_period_days: 180,
          allowed_jurisdictions: ['US', 'UK', 'SG', 'EU'],
          transfer_restrictions: 'Reg D 506(c)',
        },
        custodian: 'FIREBLOCKS',
        custodianVaultId: `sandbox-vault-${randomSuffix}`,
        issuerId: req.apiKey?.userId || null,
      },
    });

    // Log audit trail
    await prisma.auditLog.create({
      data: {
        action: 'sandbox_token_created',
        entityType: 'token',
        entityId: token.id,
        userId: req.apiKey?.userId,
        metadata: {
          assetType: token.assetType,
          blockchain: token.blockchain,
          sandbox: true,
        },
      },
    });

    res.status(201).json({
      message: '✅ Sandbox token created successfully',
      sandbox: true,
      token_id: token.id,
      token_address: token.contractAddress,
      status: token.status,
      blockchain: token.blockchain,
      details: {
        name: token.name,
        symbol: token.symbol,
        total_supply: token.totalSupply,
        asset_type: token.assetType,
        custodian: token.custodian,
      },
      note: 'This is a sandbox token. No actual blockchain deployment will occur.',
      next_steps: [
        `GET /v1/tokens/${token.id} - Retrieve token details`,
        'POST /v1/investors/verify - Add test investors',
        'POST /v1/transfers/initiate - Test token transfers',
      ],
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Create a sample Private Credit token
 * POST /sandbox/private-credit/create
 */
router.post('/private-credit/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);

    const token = await prisma.token.create({
      data: {
        name: `Private Credit Fund Q1 2025 (Sandbox ${randomSuffix})`,
        symbol: `PCF-${randomSuffix.toUpperCase()}`,
        assetType: 'PRIVATE_CREDIT',
        totalSupply: '25000000',
        decimals: 18,
        blockchain: 'polygon',
        status: 'pending',
        assetDetails: {
          fund_name: 'Acme Private Credit Fund LP',
          strategy: 'Direct lending to middle-market companies',
          target_return: 0.12,
          term_years: 5,
          minimum_investment: 250000,
          management_fee: 0.015,
          performance_fee: 0.15,
        },
        complianceRules: {
          accredited_only: true,
          max_investors: 500,
          lockup_period_days: 365,
          allowed_jurisdictions: ['US', 'UK', 'SG'],
          qualification: 'qualified_purchaser',
        },
        custodian: 'ANCHORAGE',
        custodianVaultId: `sandbox-pcf-${randomSuffix}`,
        issuerId: req.apiKey?.userId || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'sandbox_token_created',
        entityType: 'token',
        entityId: token.id,
        userId: req.apiKey?.userId,
        metadata: {
          assetType: token.assetType,
          blockchain: token.blockchain,
          sandbox: true,
        },
      },
    });

    res.status(201).json({
      message: '✅ Sandbox private credit token created successfully',
      sandbox: true,
      token_id: token.id,
      status: token.status,
      blockchain: token.blockchain,
      details: {
        name: token.name,
        symbol: token.symbol,
        total_supply: token.totalSupply,
        asset_type: token.assetType,
      },
      note: 'This is a sandbox token for testing purposes only.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Create a sample Real Estate token
 * POST /sandbox/real-estate/create
 */
router.post('/real-estate/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);

    const token = await prisma.token.create({
      data: {
        name: `Manhattan Office Building (Sandbox ${randomSuffix})`,
        symbol: `RE-NYC-${randomSuffix.toUpperCase()}`,
        assetType: 'REAL_ESTATE',
        totalSupply: '50000000',
        decimals: 18,
        blockchain: 'base',
        status: 'pending',
        assetDetails: {
          property_type: 'Commercial Office',
          location: '123 Wall Street, New York, NY 10005',
          square_feet: 125000,
          built_year: 2018,
          valuation: 50000000,
          annual_rent: 3750000,
          cap_rate: 0.075,
          occupancy_rate: 0.94,
        },
        complianceRules: {
          accredited_only: true,
          max_investors: 1000,
          lockup_period_days: 730,
          allowed_jurisdictions: ['US'],
          minimum_investment: 50000,
        },
        custodian: 'FIREBLOCKS',
        custodianVaultId: `sandbox-re-${randomSuffix}`,
        issuerId: req.apiKey?.userId || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'sandbox_token_created',
        entityType: 'token',
        entityId: token.id,
        userId: req.apiKey?.userId,
        metadata: {
          assetType: token.assetType,
          blockchain: token.blockchain,
          sandbox: true,
        },
      },
    });

    res.status(201).json({
      message: '✅ Sandbox real estate token created successfully',
      sandbox: true,
      token_id: token.id,
      status: token.status,
      blockchain: token.blockchain,
      details: {
        name: token.name,
        symbol: token.symbol,
        total_supply: token.totalSupply,
        asset_type: token.assetType,
      },
      note: 'This is a sandbox token for testing purposes only.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Create a sample accredited investor
 * POST /sandbox/investor/create
 */
router.post('/investor/create', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const randomSuffix = Math.random().toString(36).substring(7);

    const investor = await prisma.investor.create({
      data: {
        investorType: 'individual',
        fullName: `Test Investor ${randomSuffix}`,
        email: `investor-${randomSuffix}@sandbox.test`,
        dateOfBirth: new Date('1980-01-15'),
        taxId: '123-45-6789',
        address: {
          street: '456 Test Avenue',
          city: 'New York',
          state: 'NY',
          zip: '10001',
          country: 'US',
        },
        jurisdiction: 'US',
        classification: 'accredited',
        kycStatus: 'approved',
        kycProvider: 'onfido',
        kycVerifiedAt: new Date(),
        amlStatus: 'approved',
        amlLastChecked: new Date(),
        documents: [
          {
            type: 'passport',
            url: 'https://sandbox.example.com/documents/passport.pdf',
            verified: true,
          },
          {
            type: 'proof_of_address',
            url: 'https://sandbox.example.com/documents/utility_bill.pdf',
            verified: true,
          },
        ],
        walletAddress: `0x${randomSuffix}${'0'.repeat(40 - randomSuffix.length)}`,
      },
    });

    res.status(201).json({
      message: '✅ Sandbox investor created successfully',
      sandbox: true,
      investor_id: investor.id,
      wallet_address: investor.walletAddress,
      classification: investor.classification,
      kyc_status: investor.kycStatus,
      note: 'This is a sandbox investor for testing purposes only.',
      next_steps: [
        'POST /v1/investors/whitelist - Add investor to token whitelist',
      ],
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get sandbox usage examples
 * GET /sandbox/examples
 */
router.get('/examples', (req: Request, res: Response) => {
  res.json({
    title: 'RWA API Sandbox Examples',
    description: 'Pre-configured endpoints to quickly test the API without manual data entry',
    sandbox_mode: true,
    examples: [
      {
        name: 'Create Treasury Token',
        method: 'POST',
        endpoint: '/sandbox/treasury/create',
        description: 'Creates a US Treasury bond token with realistic sample data',
        auth_required: true,
      },
      {
        name: 'Create Private Credit Token',
        method: 'POST',
        endpoint: '/sandbox/private-credit/create',
        description: 'Creates a private credit fund token',
        auth_required: true,
      },
      {
        name: 'Create Real Estate Token',
        method: 'POST',
        endpoint: '/sandbox/real-estate/create',
        description: 'Creates a commercial real estate token',
        auth_required: true,
      },
      {
        name: 'Create Test Investor',
        method: 'POST',
        endpoint: '/sandbox/investor/create',
        description: 'Creates an accredited investor with approved KYC/AML',
        auth_required: true,
      },
    ],
    note: 'All sandbox operations create real database records but skip blockchain deployment. Use for testing and development only.',
  });
});

export default router;
