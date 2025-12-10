/**
 * Compliance Audit Log Service
 *
 * Immutable forensic audit trail for all compliance decisions.
 * Tracks AI decisions, human overrides, and system actions.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import {
  AuditActorType,
  AuditAction,
  ComplianceAuditLogInput,
} from '../types/conflicts';

const prisma = new PrismaClient();

// Current AI model info (would be configured globally)
const AI_MODEL_INFO = {
  modelId: 'mistral-7b-instruct-v0.2',
  modelVersion: 'together-ai-1.0.3',
};

// Current ruleset version (would be fetched from config)
const RULESET_VERSION = '2025-01-15';

interface CreateAuditLogInput {
  complianceCaseId?: string;
  actor: string;
  actorType: AuditActorType;
  action: AuditAction;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  details?: Record<string, unknown>;
  aiModelId?: string;
  aiModelVersion?: string;
  rulesetVersion?: string;
}

interface AuditLogQuery {
  complianceCaseId?: string;
  actor?: string;
  actorType?: AuditActorType;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

interface AuditLogStatistics {
  total: number;
  byActorType: Record<string, number>;
  byAction: Record<string, number>;
  aiDecisions: number;
  manualOverrides: number;
  escalations: number;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(input: CreateAuditLogInput) {
  const {
    complianceCaseId,
    actor,
    actorType,
    action,
    previousState,
    newState,
    details,
    aiModelId,
    aiModelVersion,
    rulesetVersion,
  } = input;

  const auditLog = await prisma.complianceAuditLog.create({
    data: {
      complianceCaseId,
      actor,
      actorType,
      action,
      previousState: previousState ? JSON.parse(JSON.stringify(previousState)) : undefined,
      newState: newState ? JSON.parse(JSON.stringify(newState)) : undefined,
      details: details ? JSON.parse(JSON.stringify(details)) : undefined,
      aiModelId: aiModelId || (actorType === AuditActorType.AI ? AI_MODEL_INFO.modelId : null),
      aiModelVersion:
        aiModelVersion || (actorType === AuditActorType.AI ? AI_MODEL_INFO.modelVersion : null),
      rulesetVersion: rulesetVersion || RULESET_VERSION,
    },
  });

  logger.info('Audit log created', {
    auditLogId: auditLog.id,
    actor,
    actorType,
    action,
    complianceCaseId,
  });

  return auditLog;
}

/**
 * Log an AI decision
 */
export async function logAIDecision(
  complianceCaseId: string,
  decision: {
    approved: boolean;
    confidence: number;
    reason?: string;
    modelId?: string;
    modelVersion?: string;
  }
) {
  return createAuditLog({
    complianceCaseId,
    actor: decision.modelId || AI_MODEL_INFO.modelId,
    actorType: AuditActorType.AI,
    action: AuditAction.AI_DECISION,
    newState: {
      approved: decision.approved,
      confidence: decision.confidence,
    },
    details: {
      reason: decision.reason,
      threshold: 0.7, // Confidence threshold
      requiresManualReview: decision.confidence < 0.7 || !decision.approved,
    },
    aiModelId: decision.modelId || AI_MODEL_INFO.modelId,
    aiModelVersion: decision.modelVersion || AI_MODEL_INFO.modelVersion,
    rulesetVersion: RULESET_VERSION,
  });
}

/**
 * Log a manual override
 */
export async function logManualOverride(
  complianceCaseId: string,
  reviewerId: string,
  override: {
    previousDecision: { approved: boolean; confidence?: number };
    newDecision: { status: string; reason: string };
  }
) {
  return createAuditLog({
    complianceCaseId,
    actor: reviewerId,
    actorType: AuditActorType.HUMAN,
    action: AuditAction.MANUAL_OVERRIDE,
    previousState: override.previousDecision,
    newState: override.newDecision,
    details: {
      overrideReason: override.newDecision.reason,
      overrideTimestamp: new Date().toISOString(),
    },
  });
}

/**
 * Log a status change
 */
export async function logStatusChange(
  complianceCaseId: string,
  actor: string,
  actorType: AuditActorType,
  previousStatus: string,
  newStatus: string,
  reason?: string
) {
  return createAuditLog({
    complianceCaseId,
    actor,
    actorType,
    action: AuditAction.STATUS_CHANGE,
    previousState: { status: previousStatus },
    newState: { status: newStatus },
    details: { reason },
  });
}

/**
 * Log a review assignment
 */
export async function logReviewAssignment(
  complianceCaseId: string,
  assignedBy: string,
  assignedTo: string,
  reason?: string
) {
  return createAuditLog({
    complianceCaseId,
    actor: assignedBy,
    actorType: AuditActorType.HUMAN,
    action: AuditAction.REVIEW_ASSIGNED,
    newState: { assignedTo },
    details: { reason },
  });
}

/**
 * Log an escalation
 */
export async function logEscalation(
  complianceCaseId: string,
  escalatedBy: string,
  reason: string,
  escalationLevel?: string
) {
  return createAuditLog({
    complianceCaseId,
    actor: escalatedBy,
    actorType: AuditActorType.HUMAN,
    action: AuditAction.ESCALATION,
    newState: { escalated: true, escalationLevel },
    details: { reason },
  });
}

/**
 * Get audit log by ID
 */
export async function getAuditLog(auditLogId: string) {
  return prisma.complianceAuditLog.findUnique({
    where: { id: auditLogId },
    include: {
      complianceCase: true,
    },
  });
}

/**
 * Get audit logs for a compliance case
 */
export async function getCaseAuditLogs(complianceCaseId: string) {
  return prisma.complianceAuditLog.findMany({
    where: { complianceCaseId },
    orderBy: { timestamp: 'desc' },
  });
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(query: AuditLogQuery) {
  const {
    complianceCaseId,
    actor,
    actorType,
    action,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
  } = query;

  const where: Record<string, unknown> = {};

  if (complianceCaseId) where.complianceCaseId = complianceCaseId;
  if (actor) where.actor = actor;
  if (actorType) where.actorType = actorType;
  if (action) where.action = action;
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) (where.timestamp as Record<string, Date>).gte = startDate;
    if (endDate) (where.timestamp as Record<string, Date>).lte = endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.complianceAuditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
      include: {
        complianceCase: {
          select: { id: true, caseType: true, entityType: true, entityId: true },
        },
      },
    }),
    prisma.complianceAuditLog.count({ where }),
  ]);

  return {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + logs.length < total,
  };
}

/**
 * Get audit logs by actor
 */
export async function getAuditLogsByActor(actor: string, limit: number = 50) {
  return prisma.complianceAuditLog.findMany({
    where: { actor },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      complianceCase: {
        select: { id: true, caseType: true, entityType: true },
      },
    },
  });
}

/**
 * Get AI decision history
 */
export async function getAIDecisionHistory(limit: number = 100) {
  return prisma.complianceAuditLog.findMany({
    where: {
      actorType: AuditActorType.AI,
      action: AuditAction.AI_DECISION,
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      complianceCase: true,
    },
  });
}

/**
 * Get manual override history
 */
export async function getManualOverrideHistory(limit: number = 100) {
  return prisma.complianceAuditLog.findMany({
    where: {
      actorType: AuditActorType.HUMAN,
      action: AuditAction.MANUAL_OVERRIDE,
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      complianceCase: true,
    },
  });
}

/**
 * Get audit log statistics
 */
export async function getAuditLogStatistics(
  startDate?: Date,
  endDate?: Date
): Promise<AuditLogStatistics> {
  const where: Record<string, unknown> = {};
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) (where.timestamp as Record<string, Date>).gte = startDate;
    if (endDate) (where.timestamp as Record<string, Date>).lte = endDate;
  }

  const [total, byActorType, byAction, aiDecisions, manualOverrides, escalations] =
    await Promise.all([
      prisma.complianceAuditLog.count({ where }),
      prisma.complianceAuditLog.groupBy({
        by: ['actorType'],
        where,
        _count: true,
      }),
      prisma.complianceAuditLog.groupBy({
        by: ['action'],
        where,
        _count: true,
      }),
      prisma.complianceAuditLog.count({
        where: { ...where, action: AuditAction.AI_DECISION },
      }),
      prisma.complianceAuditLog.count({
        where: { ...where, action: AuditAction.MANUAL_OVERRIDE },
      }),
      prisma.complianceAuditLog.count({
        where: { ...where, action: AuditAction.ESCALATION },
      }),
    ]);

  return {
    total,
    byActorType: byActorType.reduce(
      (acc, item) => {
        acc[item.actorType] = item._count;
        return acc;
      },
      {} as Record<string, number>
    ),
    byAction: byAction.reduce(
      (acc, item) => {
        acc[item.action] = item._count;
        return acc;
      },
      {} as Record<string, number>
    ),
    aiDecisions,
    manualOverrides,
    escalations,
  };
}

/**
 * Get AI confidence distribution for analytics
 */
export async function getAIConfidenceDistribution() {
  const aiDecisions = await prisma.complianceAuditLog.findMany({
    where: {
      actorType: AuditActorType.AI,
      action: AuditAction.AI_DECISION,
    },
    select: {
      newState: true,
      timestamp: true,
      complianceCaseId: true,
    },
  });

  // Group by confidence ranges
  const distribution = {
    low: 0, // < 0.5
    medium: 0, // 0.5 - 0.7
    high: 0, // 0.7 - 0.9
    veryHigh: 0, // >= 0.9
  };

  for (const decision of aiDecisions) {
    const state = decision.newState as { confidence?: number } | null;
    const confidence = state?.confidence || 0;

    if (confidence < 0.5) distribution.low++;
    else if (confidence < 0.7) distribution.medium++;
    else if (confidence < 0.9) distribution.high++;
    else distribution.veryHigh++;
  }

  return {
    distribution,
    totalDecisions: aiDecisions.length,
    averageConfidence:
      aiDecisions.length > 0
        ? aiDecisions.reduce((sum, d) => {
            const state = d.newState as { confidence?: number } | null;
            return sum + (state?.confidence || 0);
          }, 0) / aiDecisions.length
        : 0,
  };
}

/**
 * Export audit logs for compliance reporting
 */
export async function exportAuditLogs(
  complianceCaseId: string,
  format: 'json' | 'csv' = 'json'
) {
  const logs = await getCaseAuditLogs(complianceCaseId);

  if (format === 'csv') {
    // Convert to CSV format
    const headers = [
      'id',
      'timestamp',
      'actor',
      'actorType',
      'action',
      'aiModelId',
      'rulesetVersion',
    ];
    const rows = logs.map((log) =>
      [
        log.id,
        log.timestamp.toISOString(),
        log.actor,
        log.actorType,
        log.action,
        log.aiModelId || '',
        log.rulesetVersion || '',
      ].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  return logs;
}

/**
 * Verify audit log integrity (basic check)
 */
export async function verifyAuditLogIntegrity(complianceCaseId: string): Promise<{
  valid: boolean;
  issues: string[];
}> {
  const logs = await prisma.complianceAuditLog.findMany({
    where: { complianceCaseId },
    orderBy: { timestamp: 'asc' },
  });

  const issues: string[] = [];

  // Check for timestamp ordering
  for (let i = 1; i < logs.length; i++) {
    if (logs[i].timestamp < logs[i - 1].timestamp) {
      issues.push(`Timestamp ordering issue at log ${logs[i].id}`);
    }
  }

  // Check for required fields
  for (const log of logs) {
    if (!log.actor || !log.actorType || !log.action) {
      issues.push(`Missing required fields in log ${log.id}`);
    }
  }

  // Check AI decisions have model info
  const aiLogs = logs.filter((l) => l.actorType === AuditActorType.AI);
  for (const log of aiLogs) {
    if (!log.aiModelId || !log.aiModelVersion) {
      issues.push(`AI decision ${log.id} missing model info`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
