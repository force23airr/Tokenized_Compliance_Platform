/**
 * Compliance Case Service
 *
 * Master ticket system for compliance audits.
 * Links all compliance checks for a single asset issuance or transfer.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { generateCaseId } from '../utils/complianceHashing';
import {
  ComplianceCaseType,
  ComplianceCaseStatus,
  CasePriority,
  ComplianceCaseInput,
  AuditActorType,
  AuditAction,
} from '../types/conflicts';

const prisma = new PrismaClient();

/**
 * Create a new compliance case
 */
export async function createComplianceCase(input: ComplianceCaseInput) {
  const caseId = generateCaseId(
    input.caseType,
    input.entityType,
    input.entityId,
    new Date()
  );

  logger.info('Creating compliance case', { caseId, ...input });

  const complianceCase = await prisma.complianceCase.create({
    data: {
      caseType: input.caseType,
      entityType: input.entityType,
      entityId: input.entityId,
      status: ComplianceCaseStatus.OPEN,
      priority: input.priority || CasePriority.NORMAL,
      createdBy: input.createdBy || 'system',
      notes: [{ author: 'system', timestamp: new Date().toISOString(), note: `Case ${caseId} created` }],
    },
  });

  // Log the creation
  await logCaseAction(complianceCase.id, 'system', AuditActorType.SYSTEM, AuditAction.STATUS_CHANGE, {
    previousStatus: null,
    newStatus: ComplianceCaseStatus.OPEN,
  });

  return complianceCase;
}

/**
 * Get compliance case by ID
 */
export async function getComplianceCase(caseId: string) {
  return prisma.complianceCase.findUnique({
    where: { id: caseId },
    include: {
      sanctionsChecks: true,
      assetAttestations: true,
      travelRuleData: true,
      investorCompliance: true,
      auditLogs: { orderBy: { timestamp: 'desc' }, take: 20 },
    },
  });
}

/**
 * Get cases for an entity
 */
export async function getCasesForEntity(entityType: string, entityId: string) {
  return prisma.complianceCase.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    include: {
      auditLogs: { orderBy: { timestamp: 'desc' }, take: 5 },
    },
  });
}

/**
 * Update case status
 */
export async function updateCaseStatus(
  caseId: string,
  newStatus: ComplianceCaseStatus,
  actor: string,
  actorType: AuditActorType = AuditActorType.SYSTEM,
  reason?: string
) {
  const existingCase = await prisma.complianceCase.findUnique({ where: { id: caseId } });
  if (!existingCase) {
    throw new Error(`Case ${caseId} not found`);
  }

  const previousStatus = existingCase.status;

  const updatedCase = await prisma.complianceCase.update({
    where: { id: caseId },
    data: {
      status: newStatus,
      closedAt: [ComplianceCaseStatus.APPROVED, ComplianceCaseStatus.REJECTED].includes(newStatus)
        ? new Date()
        : null,
      notes: {
        push: {
          author: actor,
          timestamp: new Date().toISOString(),
          note: `Status changed from ${previousStatus} to ${newStatus}${reason ? `: ${reason}` : ''}`,
        },
      },
    },
  });

  await logCaseAction(caseId, actor, actorType, AuditAction.STATUS_CHANGE, {
    previousStatus,
    newStatus,
    reason,
  });

  logger.info('Case status updated', { caseId, previousStatus, newStatus, actor });

  return updatedCase;
}

/**
 * Assign case to reviewer
 */
export async function assignCase(
  caseId: string,
  assigneeId: string,
  assignedBy: string
) {
  const existingCase = await prisma.complianceCase.findUnique({ where: { id: caseId } });
  if (!existingCase) {
    throw new Error(`Case ${caseId} not found`);
  }

  const previousAssignee = existingCase.assignedTo;

  const updatedCase = await prisma.complianceCase.update({
    where: { id: caseId },
    data: {
      assignedTo: assigneeId,
      status: ComplianceCaseStatus.IN_REVIEW,
      notes: {
        push: {
          author: assignedBy,
          timestamp: new Date().toISOString(),
          note: `Assigned to ${assigneeId}`,
        },
      },
    },
  });

  await logCaseAction(caseId, assignedBy, AuditActorType.HUMAN, AuditAction.REVIEW_ASSIGNED, {
    previousAssignee,
    newAssignee: assigneeId,
  });

  logger.info('Case assigned', { caseId, assigneeId, assignedBy });

  return updatedCase;
}

/**
 * Record AI decision on case
 */
export async function recordAIDecision(
  caseId: string,
  approved: boolean,
  confidence: number,
  aiModelId: string,
  aiModelVersion: string,
  rulesetVersion: string,
  reason?: string
) {
  const requiresManualReview = confidence < 0.7 || !approved;

  const updatedCase = await prisma.complianceCase.update({
    where: { id: caseId },
    data: {
      aiConfidence: confidence,
      requiresManualReview,
      manualReviewReason: requiresManualReview ? (reason || 'Low AI confidence or rejection') : null,
      status: requiresManualReview ? ComplianceCaseStatus.IN_REVIEW : ComplianceCaseStatus.APPROVED,
      notes: {
        push: {
          author: 'AI',
          timestamp: new Date().toISOString(),
          note: `AI decision: ${approved ? 'Approved' : 'Rejected'} (confidence: ${(confidence * 100).toFixed(1)}%)`,
        },
      },
    },
  });

  await logCaseAction(caseId, aiModelId, AuditActorType.AI, AuditAction.AI_DECISION, {
    approved,
    confidence,
    reason,
    aiModelId,
    aiModelVersion,
    rulesetVersion,
  });

  logger.info('AI decision recorded', { caseId, approved, confidence, aiModelId });

  return updatedCase;
}

/**
 * Manual override of AI decision
 */
export async function manualOverride(
  caseId: string,
  newStatus: ComplianceCaseStatus,
  reviewerId: string,
  reason: string
) {
  const existingCase = await prisma.complianceCase.findUnique({ where: { id: caseId } });
  if (!existingCase) {
    throw new Error(`Case ${caseId} not found`);
  }

  const updatedCase = await prisma.complianceCase.update({
    where: { id: caseId },
    data: {
      status: newStatus,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      requiresManualReview: false,
      closedAt: [ComplianceCaseStatus.APPROVED, ComplianceCaseStatus.REJECTED].includes(newStatus)
        ? new Date()
        : null,
      notes: {
        push: {
          author: reviewerId,
          timestamp: new Date().toISOString(),
          note: `Manual override: ${newStatus}. Reason: ${reason}`,
        },
      },
    },
  });

  await logCaseAction(caseId, reviewerId, AuditActorType.HUMAN, AuditAction.MANUAL_OVERRIDE, {
    previousStatus: existingCase.status,
    newStatus,
    previousAIDecision: existingCase.aiConfidence,
    reason,
  });

  logger.info('Manual override applied', { caseId, newStatus, reviewerId, reason });

  return updatedCase;
}

/**
 * Escalate case
 */
export async function escalateCase(
  caseId: string,
  escalatedBy: string,
  reason: string
) {
  const updatedCase = await prisma.complianceCase.update({
    where: { id: caseId },
    data: {
      status: ComplianceCaseStatus.ESCALATED,
      priority: CasePriority.URGENT,
      notes: {
        push: {
          author: escalatedBy,
          timestamp: new Date().toISOString(),
          note: `Escalated: ${reason}`,
        },
      },
    },
  });

  await logCaseAction(caseId, escalatedBy, AuditActorType.HUMAN, AuditAction.ESCALATION, {
    reason,
  });

  logger.warn('Case escalated', { caseId, escalatedBy, reason });

  return updatedCase;
}

/**
 * Add note to case
 */
export async function addCaseNote(caseId: string, author: string, note: string) {
  return prisma.complianceCase.update({
    where: { id: caseId },
    data: {
      notes: {
        push: {
          author,
          timestamp: new Date().toISOString(),
          note,
        },
      },
    },
  });
}

/**
 * Get pending cases for review
 */
export async function getPendingCases(assigneeId?: string) {
  return prisma.complianceCase.findMany({
    where: {
      status: { in: [ComplianceCaseStatus.OPEN, ComplianceCaseStatus.IN_REVIEW] },
      requiresManualReview: true,
      ...(assigneeId ? { assignedTo: assigneeId } : {}),
    },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'asc' },
    ],
  });
}

/**
 * Get case statistics
 */
export async function getCaseStatistics() {
  const [total, open, inReview, approved, rejected, escalated] = await Promise.all([
    prisma.complianceCase.count(),
    prisma.complianceCase.count({ where: { status: ComplianceCaseStatus.OPEN } }),
    prisma.complianceCase.count({ where: { status: ComplianceCaseStatus.IN_REVIEW } }),
    prisma.complianceCase.count({ where: { status: ComplianceCaseStatus.APPROVED } }),
    prisma.complianceCase.count({ where: { status: ComplianceCaseStatus.REJECTED } }),
    prisma.complianceCase.count({ where: { status: ComplianceCaseStatus.ESCALATED } }),
  ]);

  return { total, open, inReview, approved, rejected, escalated };
}

/**
 * Internal: Log case action to audit log
 */
async function logCaseAction(
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
      aiModelId: details.aiModelId as string | undefined,
      aiModelVersion: details.aiModelVersion as string | undefined,
      rulesetVersion: details.rulesetVersion as string | undefined,
    },
  });
}
