/**
 * Asset Attestation Service
 *
 * Manages custodian attestations for proof of existence, ownership, and valuation.
 * Supports digital signature verification and on-chain recording.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { generateAttestationHash } from '../utils/complianceHashing';
import {
  AttestationType,
  AttestationData,
  AuditActorType,
  AuditAction,
} from '../types/conflicts';

const prisma = new PrismaClient();

// Attestation validity period (default 1 year)
const DEFAULT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

interface CreateAttestationInput {
  tokenId: string;
  attestationType: AttestationType;
  assetIdentifier?: string;
  valuationAmount?: string;
  valuationCurrency?: string;
  valuationProvider?: string;
  ownershipDocHash?: string;
  oracleProvider?: string;
  oracleAddress?: string;
  issuedBy: string;
  attestedBy?: string;
  signature?: string;
  signatureAlgorithm?: string;
  publicKeyHash?: string;
  validityDays?: number;
  complianceCaseId?: string;
}

interface AttestationVerificationResult {
  valid: boolean;
  attestation: AttestationData | null;
  reason?: string;
  expiresAt?: Date;
}

/**
 * Create a new asset attestation
 */
export async function createAttestation(input: CreateAttestationInput) {
  const {
    tokenId,
    attestationType,
    assetIdentifier,
    valuationAmount,
    valuationCurrency,
    valuationProvider,
    ownershipDocHash,
    oracleProvider,
    oracleAddress,
    issuedBy,
    attestedBy,
    signature,
    signatureAlgorithm,
    publicKeyHash,
    validityDays,
    complianceCaseId,
  } = input;

  const now = new Date();
  const validityMs = validityDays
    ? validityDays * 24 * 60 * 60 * 1000
    : DEFAULT_VALIDITY_MS;
  const expiresAt = new Date(now.getTime() + validityMs);

  // Generate attestation hash for on-chain recording
  const attestationHash = generateAttestationHash({
    assetId: tokenId,
    custodian: issuedBy,
    valuationAmount: valuationAmount || '0',
    timestamp: now,
    proofDocHashes: ownershipDocHash ? [ownershipDocHash] : [],
  });

  logger.info('Creating asset attestation', {
    tokenId,
    attestationType,
    issuedBy,
    attestationHash,
  });

  const attestation = await prisma.assetAttestation.create({
    data: {
      tokenId,
      attestationType,
      assetIdentifier,
      valuationAmount,
      valuationCurrency,
      valuationProvider,
      ownershipDocHash,
      oracleProvider,
      oracleAddress,
      attestationHash,
      issuedBy,
      attestedBy,
      signature,
      signatureAlgorithm,
      publicKeyHash,
      issuedAt: now,
      expiresAt,
      revoked: false,
      complianceCaseId,
    },
  });

  // Log to audit trail if linked to a case
  if (complianceCaseId) {
    await logAttestationAction(
      complianceCaseId,
      issuedBy,
      AuditActorType.SYSTEM,
      AuditAction.STATUS_CHANGE,
      {
        attestationId: attestation.id,
        attestationType,
        attestationHash,
      }
    );
  }

  logger.info('Attestation created', { attestationId: attestation.id, tokenId });

  return attestation;
}

/**
 * Get attestation by ID
 */
export async function getAttestation(attestationId: string) {
  return prisma.assetAttestation.findUnique({
    where: { id: attestationId },
    include: {
      token: true,
      complianceCase: true,
    },
  });
}

/**
 * Get all attestations for a token
 */
export async function getTokenAttestations(tokenId: string) {
  return prisma.assetAttestation.findMany({
    where: { tokenId },
    orderBy: { issuedAt: 'desc' },
  });
}

/**
 * Get valid (non-expired, non-revoked) attestations for a token
 */
export async function getValidAttestations(tokenId: string) {
  const now = new Date();
  return prisma.assetAttestation.findMany({
    where: {
      tokenId,
      revoked: false,
      expiresAt: { gt: now },
    },
    orderBy: { issuedAt: 'desc' },
  });
}

/**
 * Verify attestation validity
 */
export async function verifyAttestation(
  attestationId: string
): Promise<AttestationVerificationResult> {
  const attestation = await prisma.assetAttestation.findUnique({
    where: { id: attestationId },
  });

  if (!attestation) {
    return {
      valid: false,
      attestation: null,
      reason: 'Attestation not found',
    };
  }

  if (attestation.revoked) {
    return {
      valid: false,
      attestation: mapToAttestationData(attestation),
      reason: 'Attestation has been revoked',
    };
  }

  if (attestation.expiresAt < new Date()) {
    return {
      valid: false,
      attestation: mapToAttestationData(attestation),
      reason: 'Attestation has expired',
      expiresAt: attestation.expiresAt,
    };
  }

  // Verify signature if provided
  if (attestation.signature && attestation.publicKeyHash) {
    const signatureValid = await verifySignature(
      attestation.attestationHash,
      attestation.signature,
      attestation.publicKeyHash,
      attestation.signatureAlgorithm || 'ECDSA'
    );

    if (!signatureValid) {
      return {
        valid: false,
        attestation: mapToAttestationData(attestation),
        reason: 'Signature verification failed',
      };
    }
  }

  return {
    valid: true,
    attestation: mapToAttestationData(attestation),
    expiresAt: attestation.expiresAt,
  };
}

/**
 * Verify attestation by hash (for on-chain verification)
 */
export async function verifyAttestationByHash(
  attestationHash: string
): Promise<AttestationVerificationResult> {
  const attestation = await prisma.assetAttestation.findUnique({
    where: { attestationHash },
  });

  if (!attestation) {
    return {
      valid: false,
      attestation: null,
      reason: 'Attestation not found for hash',
    };
  }

  return verifyAttestation(attestation.id);
}

/**
 * Revoke an attestation
 */
export async function revokeAttestation(
  attestationId: string,
  revokedBy: string,
  reason: string
) {
  const attestation = await prisma.assetAttestation.findUnique({
    where: { id: attestationId },
  });

  if (!attestation) {
    throw new Error(`Attestation ${attestationId} not found`);
  }

  const updated = await prisma.assetAttestation.update({
    where: { id: attestationId },
    data: {
      revoked: true,
    },
  });

  // Log to audit trail if linked to a case
  if (attestation.complianceCaseId) {
    await logAttestationAction(
      attestation.complianceCaseId,
      revokedBy,
      AuditActorType.HUMAN,
      AuditAction.STATUS_CHANGE,
      {
        action: 'revocation',
        attestationId,
        reason,
      }
    );
  }

  logger.warn('Attestation revoked', { attestationId, revokedBy, reason });

  return updated;
}

/**
 * Record attestation on-chain
 */
export async function markRecordedOnChain(
  attestationId: string,
  txHash: string
) {
  const updated = await prisma.assetAttestation.update({
    where: { id: attestationId },
    data: {
      onChainTxHash: txHash,
    },
  });

  logger.info('Attestation recorded on-chain', { attestationId, txHash });

  return updated;
}

/**
 * Get attestations by issuer
 */
export async function getAttestationsByIssuer(issuedBy: string) {
  return prisma.assetAttestation.findMany({
    where: { issuedBy },
    orderBy: { issuedAt: 'desc' },
    include: {
      token: true,
    },
  });
}

/**
 * Get attestations expiring soon (for renewal alerts)
 */
export async function getExpiringAttestations(daysUntilExpiry: number = 30) {
  const now = new Date();
  const expiryThreshold = new Date(
    now.getTime() + daysUntilExpiry * 24 * 60 * 60 * 1000
  );

  return prisma.assetAttestation.findMany({
    where: {
      revoked: false,
      expiresAt: {
        gt: now,
        lte: expiryThreshold,
      },
    },
    orderBy: { expiresAt: 'asc' },
    include: {
      token: true,
    },
  });
}

/**
 * Get attestation statistics
 */
export async function getAttestationStatistics() {
  const now = new Date();

  const [total, valid, expired, revoked, byType] = await Promise.all([
    prisma.assetAttestation.count(),
    prisma.assetAttestation.count({
      where: { revoked: false, expiresAt: { gt: now } },
    }),
    prisma.assetAttestation.count({
      where: { revoked: false, expiresAt: { lte: now } },
    }),
    prisma.assetAttestation.count({ where: { revoked: true } }),
    prisma.assetAttestation.groupBy({
      by: ['attestationType'],
      _count: true,
    }),
  ]);

  return {
    total,
    valid,
    expired,
    revoked,
    byType: byType.reduce(
      (acc, item) => {
        acc[item.attestationType] = item._count;
        return acc;
      },
      {} as Record<string, number>
    ),
  };
}

/**
 * Verify digital signature (stub - implement with actual crypto library)
 */
async function verifySignature(
  data: string,
  signature: string,
  publicKeyHash: string,
  algorithm: string
): Promise<boolean> {
  // TODO: Implement actual signature verification
  // This would use ethers.js or a similar library to verify ECDSA signatures
  // For now, return true if signature is provided
  logger.debug('Verifying signature', { algorithm, publicKeyHash });
  return !!signature && !!publicKeyHash;
}

/**
 * Map database record to AttestationData interface
 */
function mapToAttestationData(attestation: {
  tokenId: string;
  attestationType: string;
  assetIdentifier: string | null;
  valuationAmount: string | null;
  valuationCurrency: string | null;
  issuedBy: string;
  attestedBy: string | null;
  signature: string | null;
  signatureAlgorithm: string | null;
  expiresAt: Date;
}): AttestationData {
  return {
    tokenId: attestation.tokenId,
    attestationType: attestation.attestationType as AttestationType,
    assetIdentifier: attestation.assetIdentifier || undefined,
    valuationAmount: attestation.valuationAmount || undefined,
    valuationCurrency: attestation.valuationCurrency || undefined,
    issuedBy: attestation.issuedBy,
    attestedBy: attestation.attestedBy || undefined,
    signature: attestation.signature || undefined,
    signatureAlgorithm: attestation.signatureAlgorithm || undefined,
    expiresAt: attestation.expiresAt,
  };
}

/**
 * Internal: Log attestation action to audit log
 */
async function logAttestationAction(
  complianceCaseId: string,
  actor: string,
  actorType: AuditActorType,
  action: AuditAction,
  details: Record<string, unknown>
) {
  await prisma.complianceAuditLog.create({
    data: {
      complianceCaseId,
      actor,
      actorType,
      action,
      details: JSON.parse(JSON.stringify(details)),
    },
  });
}
