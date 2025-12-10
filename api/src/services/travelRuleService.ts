/**
 * Travel Rule Service
 *
 * FATF Travel Rule compliance for cross-border transfers.
 * Supports FATF Recommendation 16, MiCA, FinCEN, and MAS regimes.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { generateTravelRuleHash } from '../utils/complianceHashing';
import {
  TravelRuleStatus,
  TravelRuleRegime,
  TravelRuleDataInput,
  AuditActorType,
  AuditAction,
} from '../types/conflicts';

const prisma = new PrismaClient();

// Threshold configurations by regime (in USD equivalent)
const THRESHOLDS: Record<TravelRuleRegime, number> = {
  [TravelRuleRegime.FATF]: 1000,
  [TravelRuleRegime.MICA]: 1000, // EUR 1000, simplified to USD
  [TravelRuleRegime.FINCEN]: 3000,
  [TravelRuleRegime.MAS]: 1500, // SGD 1500, simplified to USD
};

// Jurisdiction to regime mapping
const JURISDICTION_REGIMES: Record<string, TravelRuleRegime> = {
  US: TravelRuleRegime.FINCEN,
  SG: TravelRuleRegime.MAS,
  EU: TravelRuleRegime.MICA,
  GB: TravelRuleRegime.FATF,
  // Default to FATF for other jurisdictions
};

interface TravelRuleEvaluation {
  thresholdTriggered: boolean;
  applicableRegime: TravelRuleRegime;
  thresholdAmount: number;
  requiredData: string[];
  status: TravelRuleStatus;
}

interface CreateTravelRuleDataInput extends TravelRuleDataInput {
  complianceCaseId?: string;
}

/**
 * Evaluate if transfer triggers travel rule requirements
 */
export async function evaluateThreshold(
  transferValueUSD: number,
  originatorJurisdiction: string,
  beneficiaryJurisdiction: string
): Promise<TravelRuleEvaluation> {
  // Determine applicable regime based on jurisdictions
  const originatorRegime =
    JURISDICTION_REGIMES[originatorJurisdiction] || TravelRuleRegime.FATF;
  const beneficiaryRegime =
    JURISDICTION_REGIMES[beneficiaryJurisdiction] || TravelRuleRegime.FATF;

  // Use the stricter regime (lower threshold)
  const applicableRegime =
    THRESHOLDS[originatorRegime] <= THRESHOLDS[beneficiaryRegime]
      ? originatorRegime
      : beneficiaryRegime;

  const thresholdAmount = THRESHOLDS[applicableRegime];
  const thresholdTriggered = transferValueUSD >= thresholdAmount;

  // Determine required data based on regime
  const requiredData = getRequiredDataFields(applicableRegime);

  // Determine initial status
  let status: TravelRuleStatus;
  if (!thresholdTriggered) {
    status = TravelRuleStatus.EXEMPT;
  } else {
    status = TravelRuleStatus.PENDING;
  }

  logger.info('Travel rule threshold evaluated', {
    transferValueUSD,
    originatorJurisdiction,
    beneficiaryJurisdiction,
    applicableRegime,
    thresholdTriggered,
  });

  return {
    thresholdTriggered,
    applicableRegime,
    thresholdAmount,
    requiredData,
    status,
  };
}

/**
 * Collect and store travel rule data for a transfer
 */
export async function collectTravelRuleData(input: CreateTravelRuleDataInput) {
  const {
    transferId,
    transferValueUSD,
    originatorName,
    originatorAccount,
    originatorVASP,
    originatorJurisdiction,
    beneficiaryName,
    beneficiaryAccount,
    beneficiaryVASP,
    beneficiaryJurisdiction,
    complianceCaseId,
  } = input;

  // Evaluate threshold
  const evaluation = await evaluateThreshold(
    transferValueUSD,
    originatorJurisdiction || 'US',
    beneficiaryJurisdiction || 'US'
  );

  // Determine compliance status based on data completeness
  let complianceStatus = evaluation.status;
  if (evaluation.thresholdTriggered) {
    const isComplete = checkDataCompleteness(
      {
        originatorName,
        originatorAccount,
        originatorVASP,
        beneficiaryName,
        beneficiaryAccount,
        beneficiaryVASP,
      },
      evaluation.applicableRegime
    );
    complianceStatus = isComplete
      ? TravelRuleStatus.COMPLIANT
      : TravelRuleStatus.PENDING;
  }

  // Check for MiCA and FinCEN specific requirements
  const micaCompliant =
    evaluation.applicableRegime === TravelRuleRegime.MICA
      ? complianceStatus === TravelRuleStatus.COMPLIANT
      : undefined;

  const fincenReportable =
    evaluation.applicableRegime === TravelRuleRegime.FINCEN &&
    evaluation.thresholdTriggered;

  logger.info('Collecting travel rule data', {
    transferId,
    transferValueUSD,
    applicableRegime: evaluation.applicableRegime,
    complianceStatus,
  });

  const travelRuleData = await prisma.travelRuleData.create({
    data: {
      transferId,
      transferValueUSD,
      thresholdTriggered: evaluation.thresholdTriggered,
      originatorName,
      originatorAccount,
      originatorVASP,
      originatorJurisdiction: originatorJurisdiction || 'US',
      beneficiaryName,
      beneficiaryAccount,
      beneficiaryVASP,
      beneficiaryJurisdiction: beneficiaryJurisdiction || 'US',
      applicableRegime: evaluation.applicableRegime,
      complianceStatus,
      micaCompliant,
      fincenReportable,
      sarFiled: false,
      complianceCaseId,
    },
  });

  // Log to audit trail if linked to a case
  if (complianceCaseId) {
    await logTravelRuleAction(
      complianceCaseId,
      'system',
      AuditActorType.SYSTEM,
      AuditAction.STATUS_CHANGE,
      {
        travelRuleId: travelRuleData.id,
        transferId,
        complianceStatus,
        applicableRegime: evaluation.applicableRegime,
      }
    );
  }

  logger.info('Travel rule data collected', {
    travelRuleId: travelRuleData.id,
    transferId,
    complianceStatus,
  });

  return { travelRuleData, evaluation };
}

/**
 * Get travel rule data by transfer ID
 */
export async function getTravelRuleData(transferId: string) {
  return prisma.travelRuleData.findUnique({
    where: { transferId },
    include: {
      transfer: true,
      complianceCase: true,
    },
  });
}

/**
 * Update travel rule compliance status
 */
export async function updateComplianceStatus(
  travelRuleId: string,
  newStatus: TravelRuleStatus,
  updatedBy: string,
  reason?: string
) {
  const existing = await prisma.travelRuleData.findUnique({
    where: { id: travelRuleId },
  });

  if (!existing) {
    throw new Error(`Travel rule data ${travelRuleId} not found`);
  }

  const previousStatus = existing.complianceStatus;

  const updated = await prisma.travelRuleData.update({
    where: { id: travelRuleId },
    data: {
      complianceStatus: newStatus,
      micaCompliant:
        existing.applicableRegime === TravelRuleRegime.MICA
          ? newStatus === TravelRuleStatus.COMPLIANT
          : existing.micaCompliant,
    },
  });

  // Log to audit trail if linked to a case
  if (existing.complianceCaseId) {
    await logTravelRuleAction(
      existing.complianceCaseId,
      updatedBy,
      AuditActorType.HUMAN,
      AuditAction.STATUS_CHANGE,
      {
        travelRuleId,
        previousStatus,
        newStatus,
        reason,
      }
    );
  }

  logger.info('Travel rule status updated', {
    travelRuleId,
    previousStatus,
    newStatus,
    updatedBy,
  });

  return updated;
}

/**
 * Update originator/beneficiary information
 */
export async function updatePartyInfo(
  travelRuleId: string,
  updates: Partial<{
    originatorName: string;
    originatorAccount: string;
    originatorVASP: string;
    beneficiaryName: string;
    beneficiaryAccount: string;
    beneficiaryVASP: string;
  }>
) {
  const existing = await prisma.travelRuleData.findUnique({
    where: { id: travelRuleId },
  });

  if (!existing) {
    throw new Error(`Travel rule data ${travelRuleId} not found`);
  }

  const updated = await prisma.travelRuleData.update({
    where: { id: travelRuleId },
    data: updates,
  });

  // Re-evaluate compliance status
  if (existing.thresholdTriggered) {
    const isComplete = checkDataCompleteness(
      {
        originatorName: updated.originatorName,
        originatorAccount: updated.originatorAccount,
        originatorVASP: updated.originatorVASP,
        beneficiaryName: updated.beneficiaryName,
        beneficiaryAccount: updated.beneficiaryAccount,
        beneficiaryVASP: updated.beneficiaryVASP,
      },
      existing.applicableRegime as TravelRuleRegime
    );

    if (isComplete && existing.complianceStatus === TravelRuleStatus.PENDING) {
      await prisma.travelRuleData.update({
        where: { id: travelRuleId },
        data: { complianceStatus: TravelRuleStatus.COMPLIANT },
      });
    }
  }

  logger.info('Travel rule party info updated', { travelRuleId });

  return updated;
}

/**
 * File SAR (Suspicious Activity Report) for FinCEN
 */
export async function fileSAR(
  travelRuleId: string,
  filedBy: string,
  sarReferenceNumber: string
) {
  const updated = await prisma.travelRuleData.update({
    where: { id: travelRuleId },
    data: {
      sarFiled: true,
    },
  });

  logger.warn('SAR filed', {
    travelRuleId,
    filedBy,
    sarReferenceNumber,
  });

  return updated;
}

/**
 * Generate compliance hash for on-chain recording
 */
export async function generateComplianceHash(travelRuleId: string): Promise<string> {
  const data = await prisma.travelRuleData.findUnique({
    where: { id: travelRuleId },
  });

  if (!data) {
    throw new Error(`Travel rule data ${travelRuleId} not found`);
  }

  return generateTravelRuleHash(
    data.transferId,
    data.originatorJurisdiction || 'UNKNOWN',
    data.beneficiaryJurisdiction || 'UNKNOWN',
    data.applicableRegime || TravelRuleRegime.FATF,
    data.complianceStatus || TravelRuleStatus.PENDING,
    data.createdAt
  );
}

/**
 * Get pending travel rule cases
 */
export async function getPendingCases() {
  return prisma.travelRuleData.findMany({
    where: {
      thresholdTriggered: true,
      complianceStatus: TravelRuleStatus.PENDING,
    },
    orderBy: { createdAt: 'asc' },
    include: {
      transfer: true,
    },
  });
}

/**
 * Get non-compliant cases for review
 */
export async function getNonCompliantCases() {
  return prisma.travelRuleData.findMany({
    where: {
      complianceStatus: TravelRuleStatus.NON_COMPLIANT,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      transfer: true,
      complianceCase: true,
    },
  });
}

/**
 * Get travel rule statistics
 */
export async function getTravelRuleStatistics() {
  const [total, compliant, pending, nonCompliant, exempt, byRegime] =
    await Promise.all([
      prisma.travelRuleData.count(),
      prisma.travelRuleData.count({
        where: { complianceStatus: TravelRuleStatus.COMPLIANT },
      }),
      prisma.travelRuleData.count({
        where: { complianceStatus: TravelRuleStatus.PENDING },
      }),
      prisma.travelRuleData.count({
        where: { complianceStatus: TravelRuleStatus.NON_COMPLIANT },
      }),
      prisma.travelRuleData.count({
        where: { complianceStatus: TravelRuleStatus.EXEMPT },
      }),
      prisma.travelRuleData.groupBy({
        by: ['applicableRegime'],
        _count: true,
      }),
    ]);

  return {
    total,
    compliant,
    pending,
    nonCompliant,
    exempt,
    byRegime: byRegime.reduce(
      (acc, item) => {
        if (item.applicableRegime) {
          acc[item.applicableRegime] = item._count;
        }
        return acc;
      },
      {} as Record<string, number>
    ),
  };
}

/**
 * Get required data fields by regime
 */
function getRequiredDataFields(regime: TravelRuleRegime): string[] {
  const baseFields = [
    'originatorName',
    'originatorAccount',
    'beneficiaryName',
    'beneficiaryAccount',
  ];

  switch (regime) {
    case TravelRuleRegime.FATF:
      return [...baseFields, 'originatorVASP', 'beneficiaryVASP'];
    case TravelRuleRegime.MICA:
      return [
        ...baseFields,
        'originatorVASP',
        'beneficiaryVASP',
        'originatorAddress', // Additional for MiCA
      ];
    case TravelRuleRegime.FINCEN:
      return baseFields; // FinCEN has slightly different requirements
    case TravelRuleRegime.MAS:
      return [...baseFields, 'originatorVASP', 'beneficiaryVASP'];
    default:
      return baseFields;
  }
}

/**
 * Check data completeness for compliance
 */
function checkDataCompleteness(
  data: {
    originatorName?: string | null;
    originatorAccount?: string | null;
    originatorVASP?: string | null;
    beneficiaryName?: string | null;
    beneficiaryAccount?: string | null;
    beneficiaryVASP?: string | null;
  },
  regime: TravelRuleRegime
): boolean {
  const requiredFields = getRequiredDataFields(regime);

  for (const field of requiredFields) {
    const value = data[field as keyof typeof data];
    if (!value || value.trim() === '') {
      return false;
    }
  }

  return true;
}

/**
 * Internal: Log travel rule action to audit log
 */
async function logTravelRuleAction(
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
