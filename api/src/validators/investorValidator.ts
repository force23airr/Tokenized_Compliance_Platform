import { z } from 'zod';

/**
 * Investor Verification Validation
 */
export const verifyInvestorSchema = z.object({
  investor_type: z.enum(['individual', 'entity', 'trust', 'fund']),

  personal_info: z.object({
    // Individual fields
    first_name: z.string().min(1).max(100).optional(),
    last_name: z.string().min(1).max(100).optional(),
    middle_name: z.string().max(100).optional(),

    // Entity fields
    entity_name: z.string().min(1).max(200).optional(),
    entity_type: z.enum(['corporation', 'llc', 'partnership', 'trust', 'fund']).optional(),

    // Common fields
    email: z.string().email(),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(), // E.164 format
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    ssn_last4: z.string().length(4).regex(/^\d{4}$/).optional(),
    ein: z.string().regex(/^\d{2}-\d{7}$/).optional(), // EIN format
  }).refine(
    (data) => {
      // If individual, require first_name and last_name
      // If entity, require entity_name
      const isIndividual = data.first_name || data.last_name;
      const isEntity = data.entity_name;
      return isIndividual || isEntity;
    },
    { message: 'Either individual names or entity name is required' }
  ),

  address: z.object({
    street: z.string().min(1),
    street2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().optional(),
    postal_code: z.string().min(1),
    country: z.string().length(2), // ISO 3166-1 alpha-2
  }),

  accreditation: z.object({
    status: z.enum(['accredited', 'qualified_purchaser', 'professional', 'institutional', 'retail']).optional(),
    verification_method: z.enum([
      'income',
      'net_worth',
      'entity_assets',
      'professional_license',
      'third_party_verification',
    ]).optional(),
    verification_doc_url: z.string().url().optional(),
    verification_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    net_worth: z.number().positive().optional(),
    annual_income: z.number().positive().optional(),
  }).optional(),

  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),

  // Beneficial ownership (required for entities)
  beneficial_owners: z.array(z.object({
    name: z.string().min(1),
    ownership_percentage: z.number().min(0).max(100),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ssn_last4: z.string().length(4).optional(),
  })).optional(),

  // Control persons
  control_person: z.object({
    name: z.string().min(1),
    title: z.string().min(1),
    date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).optional(),
});

/**
 * Whitelist Investor Validation
 */
export const whitelistInvestorSchema = z.object({
  investor_id: z.string().uuid(),
  token_id: z.string().uuid(),
  lockup_days: z.number().int().min(0).max(1095).optional(), // Max 3 years
  max_balance: z.string().regex(/^\d+$/).optional(),
  restrictions: z.object({
    max_daily_transfer: z.string().optional(),
    allowed_transfer_hours: z.object({
      start: z.number().int().min(0).max(23),
      end: z.number().int().min(0).max(23),
    }).optional(),
    geographic_restrictions: z.array(z.string().length(2)).optional(),
  }).optional(),
});

/**
 * Update Investor KYC Status
 */
export const updateKycStatusSchema = z.object({
  investor_id: z.string().uuid(),
  kyc_status: z.enum(['pending', 'approved', 'rejected', 'expired']),
  kyc_provider: z.string().optional(),
  rejection_reason: z.string().optional(),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Bulk Investor Upload
 */
export const bulkInvestorUploadSchema = z.object({
  investors: z.array(verifyInvestorSchema).min(1).max(100), // Max 100 at a time
  skip_duplicates: z.boolean().default(true),
});

// Type exports
export type VerifyInvestorInput = z.infer<typeof verifyInvestorSchema>;
export type WhitelistInvestorInput = z.infer<typeof whitelistInvestorSchema>;
export type UpdateKycStatusInput = z.infer<typeof updateKycStatusSchema>;
export type BulkInvestorUploadInput = z.infer<typeof bulkInvestorUploadSchema>;
