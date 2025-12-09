import { z } from 'zod';

/**
 * Transfer Initiation Validation
 */
export const initiateTransferSchema = z.object({
  token_id: z.string().uuid(),
  from_investor_id: z.string().uuid(),
  to_investor_id: z.string().uuid(),
  amount: z.string().regex(/^\d+$/, 'Amount must be a positive integer string'),

  payment: z.object({
    currency: z.enum(['USDC', 'USDP', 'USD', 'USDT', 'DAI']),
    amount: z.number().positive(),
    payment_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    settlement_type: z.enum(['ATOMIC_DVP', 'MANUAL', 'DEFERRED']),
  }).optional(),

  settlement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/).optional(),

  metadata: z.object({
    trade_reference: z.string().optional(),
    counterparty_reference: z.string().optional(),
    notes: z.string().max(500).optional(),
  }).optional(),
});

/**
 * Approve Transfer Validation
 */
export const approveTransferSchema = z.object({
  transfer_id: z.string().uuid(),
  approved_by: z.string().optional(),
  compliance_notes: z.string().max(1000).optional(),
  override_reason: z.string().max(500).optional(), // If overriding failed checks
});

/**
 * Reject Transfer Validation
 */
export const rejectTransferSchema = z.object({
  transfer_id: z.string().uuid(),
  rejected_by: z.string().optional(),
  rejection_reason: z.string().min(1).max(1000),
});

/**
 * Batch Transfer Validation
 */
export const batchTransferSchema = z.object({
  token_id: z.string().uuid(),
  from_investor_id: z.string().uuid(),
  transfers: z.array(z.object({
    to_investor_id: z.string().uuid(),
    amount: z.string().regex(/^\d+$/),
  })).min(1).max(50), // Max 50 transfers per batch
  settlement_date: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/).optional(),
});

/**
 * Transfer Query Filters
 */
export const transferQuerySchema = z.object({
  token_id: z.string().uuid().optional(),
  investor_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'compliance_check', 'approved', 'executed', 'failed', 'rejected']).optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// Type exports
export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>;
export type ApproveTransferInput = z.infer<typeof approveTransferSchema>;
export type RejectTransferInput = z.infer<typeof rejectTransferSchema>;
export type BatchTransferInput = z.infer<typeof batchTransferSchema>;
export type TransferQueryInput = z.infer<typeof transferQuerySchema>;
