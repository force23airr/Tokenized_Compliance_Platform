import { z } from 'zod';

/**
 * Token Creation Validation
 */
export const createTokenSchema = z.object({
  asset_type: z.enum(['TREASURY', 'PRIVATE_CREDIT', 'REAL_ESTATE'], {
    errorMap: () => ({ message: 'Asset type must be TREASURY, PRIVATE_CREDIT, or REAL_ESTATE' }),
  }),

  asset_details: z.object({
    cusip: z.string().length(9).optional(),
    isin: z.string().length(12).optional(),
    face_value: z.number().positive().optional(),
    maturity_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    coupon_rate: z.number().min(0).max(1).optional(),
    // Private credit specific
    principal: z.number().positive().optional(),
    interest_rate: z.number().min(0).max(1).optional(),
    borrower_id: z.string().optional(),
    // Real estate specific
    property_address: z.string().optional(),
    square_footage: z.number().positive().optional(),
    appraisal_value: z.number().positive().optional(),
  }).passthrough(),

  token_config: z.object({
    name: z.string().min(3).max(50),
    symbol: z.string().min(2).max(10).regex(/^[A-Z0-9-]+$/, 'Symbol must be uppercase alphanumeric'),
    total_supply: z.number().positive(),
    decimals: z.number().int().min(0).max(18).default(18),
    blockchain: z.enum(['ETHEREUM', 'POLYGON', 'AVALANCHE', 'BASE']),
  }),

  compliance_rules: z.object({
    accredited_only: z.boolean().default(true),
    max_investors: z.number().int().positive().max(2000).default(2000),
    lockup_period_days: z.number().int().min(0).max(730).default(0),
    allowed_jurisdictions: z.array(z.string().length(2)).min(1).default(['US']),
    min_investment: z.number().positive().optional(),
    max_investment_per_investor: z.number().positive().optional(),
  }).optional(),

  custody: z.object({
    custodian: z.enum(['FIREBLOCKS', 'ANCHORAGE', 'BITGO']),
    vault_id: z.string().min(1),
    attestation_doc_url: z.string().url().optional(),
  }).optional(),
});

/**
 * Token Mint Validation
 */
export const mintTokensSchema = z.object({
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  amount: z.string().regex(/^\d+$/, 'Amount must be a positive integer string'),
});

/**
 * Token Burn Validation
 */
export const burnTokensSchema = z.object({
  holder: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  amount: z.string().regex(/^\d+$/, 'Amount must be a positive integer string'),
});

/**
 * Yield Distribution Validation
 */
export const distributeYieldSchema = z.object({
  amount_per_token: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount format'),
  total_distribution: z.string().regex(/^\d+(\.\d+)?$/, 'Invalid amount format'),
  currency: z.enum(['USDC', 'USDP', 'USD', 'USDT']),
  ex_dividend_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  record_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  distribution_type: z.enum(['dividend', 'interest', 'rent', 'redemption']).default('dividend'),
});

/**
 * Update Token NAV
 */
export const updateNavSchema = z.object({
  nav_per_token: z.number().positive(),
  total_nav: z.number().positive(),
  valuation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valuation_source: z.string().min(1),
});

// Type exports
export type CreateTokenInput = z.infer<typeof createTokenSchema>;
export type MintTokensInput = z.infer<typeof mintTokensSchema>;
export type BurnTokensInput = z.infer<typeof burnTokensSchema>;
export type DistributeYieldInput = z.infer<typeof distributeYieldSchema>;
export type UpdateNavInput = z.infer<typeof updateNavSchema>;
