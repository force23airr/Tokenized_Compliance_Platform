import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../middleware/errorHandler';
import { checkTransferCompliance } from '../services/compliance';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

// ============= Validation Schemas =============

const initiateTransferSchema = z.object({
  token_id: z.string(),
  from_investor_id: z.string(),
  to_investor_id: z.string(),
  amount: z.string(), // BigNumber as string
  payment: z.object({
    currency: z.enum(['USDC', 'USDP', 'USD']),
    amount: z.number(),
    payment_address: z.string(),
    settlement_type: z.enum(['ATOMIC_DVP', 'MANUAL']),
  }).optional(),
  settlement_date: z.string().optional(),
});

// ============= Controller Functions =============

export const initiateTransfer = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const validatedData = initiateTransferSchema.parse(req.body);

    logger.info('Initiating transfer', {
      tokenId: validatedData.token_id,
      from: validatedData.from_investor_id,
      to: validatedData.to_investor_id,
      amount: validatedData.amount,
    });

    // Verify token exists
    const token = await prisma.token.findUnique({
      where: { id: validatedData.token_id },
    });

    if (!token) {
      throw new ApiError(404, 'TOKEN_NOT_FOUND', 'Token not found');
    }

    if (token.status !== 'deployed') {
      throw new ApiError(400, 'TOKEN_NOT_DEPLOYED', 'Token must be deployed before transfers');
    }

    // Verify sender and recipient exist
    const [sender, recipient] = await Promise.all([
      prisma.investor.findUnique({ where: { id: validatedData.from_investor_id } }),
      prisma.investor.findUnique({ where: { id: validatedData.to_investor_id } }),
    ]);

    if (!sender || !recipient) {
      throw new ApiError(404, 'INVESTOR_NOT_FOUND', 'Sender or recipient not found');
    }

    // Run compliance checks
    const complianceResult = await checkTransferCompliance({
      tokenId: validatedData.token_id,
      fromInvestor: sender,
      toInvestor: recipient,
      amount: validatedData.amount,
    });

    // Create transfer record
    const transfer = await prisma.transfer.create({
      data: {
        tokenId: validatedData.token_id,
        fromInvestorId: validatedData.from_investor_id,
        toAddress: recipient.walletAddress,
        amount: validatedData.amount,
        transferType: 'transfer',
        status: complianceResult.approved ? 'approved' : 'pending',
        complianceChecks: complianceResult.checks,
        complianceResult: complianceResult.approved,
        failureReason: complianceResult.failureReason,
        paymentCurrency: validatedData.payment?.currency,
        paymentAmount: validatedData.payment?.amount.toString(),
        paymentAddress: validatedData.payment?.payment_address,
      },
    });

    res.status(201).json({
      transfer_id: transfer.id,
      status: transfer.status,
      compliance_checks: complianceResult.checks,
      estimated_settlement_time: complianceResult.approved ? 3600 : undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', error.errors));
    } else {
      next(error);
    }
  }
};

export const getTransferStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const transfer = await prisma.transfer.findUnique({
      where: { id },
      include: {
        token: {
          select: {
            name: true,
            symbol: true,
          },
        },
      },
    });

    if (!transfer) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    res.json({
      transfer_id: transfer.id,
      token_name: transfer.token.name,
      token_symbol: transfer.token.symbol,
      status: transfer.status,
      amount: transfer.amount,
      from: transfer.fromInvestorId,
      to: transfer.toAddress,
      compliance_result: transfer.complianceResult,
      failure_reason: transfer.failureReason,
      tx_hash: transfer.txHash,
      executed_at: transfer.executedAt,
      created_at: transfer.createdAt,
    });
  } catch (error) {
    next(error);
  }
};

export const approveTransfer = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const transfer = await prisma.transfer.findUnique({
      where: { id },
    });

    if (!transfer) {
      throw new ApiError(404, 'TRANSFER_NOT_FOUND', 'Transfer not found');
    }

    if (transfer.status !== 'pending') {
      throw new ApiError(400, 'INVALID_STATUS', 'Transfer is not in pending status');
    }

    // Update transfer to approved
    const updatedTransfer = await prisma.transfer.update({
      where: { id },
      data: {
        status: 'approved',
        complianceResult: true,
      },
    });

    // TODO: Execute on-chain transfer

    res.json({
      transfer_id: updatedTransfer.id,
      status: 'approved',
      message: 'Transfer approved and queued for execution',
    });
  } catch (error) {
    next(error);
  }
};
