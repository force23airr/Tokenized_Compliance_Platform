/**
 * Compliance API Routes
 *
 * REST endpoints for compliance operations:
 * - Sanctions/AML checks
 * - Asset attestations
 * - Holder lockups
 * - Travel rule compliance
 * - Compliance cases
 * - Audit logs
 */

import { Router, Request, Response } from 'express';
import * as sanctionsService from '../services/sanctionsService';
import * as attestationService from '../services/attestationService';
import * as lockupService from '../services/lockupService';
import * as travelRuleService from '../services/travelRuleService';
import * as complianceCaseService from '../services/complianceCaseService';
import * as auditLogService from '../services/complianceAuditLogService';
import { logger } from '../utils/logger';
import {
  SanctionsCheckType,
  AttestationType,
  LockupType,
  ComplianceCaseType,
  ComplianceCaseStatus,
  CasePriority,
  AuditActorType,
  AuditAction,
} from '../types/conflicts';

const router = Router();

// ============= Sanctions/AML Routes =============

/**
 * POST /api/v1/compliance/investors/:id/sanctions-check
 * Run sanctions screening for an investor
 */
router.post('/investors/:id/sanctions-check', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { walletAddress, jurisdiction, checkType } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    const result = await sanctionsService.runSanctionsCheck(
      id,
      walletAddress,
      jurisdiction || 'US',
      checkType || SanctionsCheckType.SANCTIONS
    );

    logger.info('Sanctions check completed via API', { investorId: id, passed: result.passed });

    return res.json(result);
  } catch (error) {
    logger.error('Sanctions check API error', { error });
    return res.status(500).json({ error: 'Failed to run sanctions check' });
  }
});

/**
 * GET /api/v1/compliance/investors/:id/sanctions-status
 * Get sanctions clearance status
 */
router.get('/investors/:id/sanctions-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cleared = await sanctionsService.verifySanctionsClearance(id);
    const history = await sanctionsService.getSanctionsHistory(id);

    return res.json({
      cleared,
      lastCheck: history[0] || null,
      checkCount: history.length,
    });
  } catch (error) {
    logger.error('Sanctions status API error', { error });
    return res.status(500).json({ error: 'Failed to get sanctions status' });
  }
});

/**
 * GET /api/v1/compliance/investors/:id/sanctions-history
 * Get full sanctions check history
 */
router.get('/investors/:id/sanctions-history', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const history = await sanctionsService.getSanctionsHistory(id);
    return res.json(history);
  } catch (error) {
    logger.error('Sanctions history API error', { error });
    return res.status(500).json({ error: 'Failed to get sanctions history' });
  }
});

// ============= Attestation Routes =============

/**
 * POST /api/v1/compliance/tokens/:id/attestation
 * Create a new attestation for a token
 */
router.post('/tokens/:id/attestation', async (req: Request, res: Response) => {
  try {
    const { id: tokenId } = req.params;
    const {
      attestationType,
      assetIdentifier,
      valuationAmount,
      valuationCurrency,
      valuationProvider,
      ownershipDocHash,
      issuedBy,
      attestedBy,
      signature,
      signatureAlgorithm,
      publicKeyHash,
      validityDays,
      complianceCaseId,
    } = req.body;

    if (!attestationType || !issuedBy) {
      return res.status(400).json({ error: 'attestationType and issuedBy are required' });
    }

    const attestation = await attestationService.createAttestation({
      tokenId,
      attestationType: attestationType as AttestationType,
      assetIdentifier,
      valuationAmount,
      valuationCurrency,
      valuationProvider,
      ownershipDocHash,
      issuedBy,
      attestedBy,
      signature,
      signatureAlgorithm,
      publicKeyHash,
      validityDays,
      complianceCaseId,
    });

    logger.info('Attestation created via API', { attestationId: attestation.id, tokenId });

    return res.status(201).json(attestation);
  } catch (error) {
    logger.error('Create attestation API error', { error });
    return res.status(500).json({ error: 'Failed to create attestation' });
  }
});

/**
 * GET /api/v1/compliance/tokens/:id/attestations
 * Get all attestations for a token
 */
router.get('/tokens/:id/attestations', async (req: Request, res: Response) => {
  try {
    const { id: tokenId } = req.params;
    const { valid } = req.query;

    const attestations = valid === 'true'
      ? await attestationService.getValidAttestations(tokenId)
      : await attestationService.getTokenAttestations(tokenId);

    return res.json(attestations);
  } catch (error) {
    logger.error('Get attestations API error', { error });
    return res.status(500).json({ error: 'Failed to get attestations' });
  }
});

/**
 * GET /api/v1/compliance/attestations/:id/verify
 * Verify an attestation
 */
router.get('/attestations/:id/verify', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await attestationService.verifyAttestation(id);
    return res.json(result);
  } catch (error) {
    logger.error('Verify attestation API error', { error });
    return res.status(500).json({ error: 'Failed to verify attestation' });
  }
});

/**
 * POST /api/v1/compliance/attestations/:id/revoke
 * Revoke an attestation
 */
router.post('/attestations/:id/revoke', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { revokedBy, reason } = req.body;

    if (!revokedBy || !reason) {
      return res.status(400).json({ error: 'revokedBy and reason are required' });
    }

    const attestation = await attestationService.revokeAttestation(id, revokedBy, reason);
    return res.json(attestation);
  } catch (error) {
    logger.error('Revoke attestation API error', { error });
    return res.status(500).json({ error: 'Failed to revoke attestation' });
  }
});

/**
 * GET /api/v1/compliance/attestations/expiring
 * Get attestations expiring soon
 */
router.get('/attestations/expiring', async (req: Request, res: Response) => {
  try {
    const { days } = req.query;
    const attestations = await attestationService.getExpiringAttestations(
      days ? parseInt(days as string) : 30
    );
    return res.json(attestations);
  } catch (error) {
    logger.error('Get expiring attestations API error', { error });
    return res.status(500).json({ error: 'Failed to get expiring attestations' });
  }
});

// ============= Lockup Routes =============

/**
 * POST /api/v1/compliance/lockups
 * Create a new holder lockup
 */
router.post('/lockups', async (req: Request, res: Response) => {
  try {
    const {
      tokenId,
      investorId,
      lockupType,
      unlockTimestamp,
      lockupDays,
      lockupReason,
      vestingSchedule,
    } = req.body;

    if (!tokenId || !investorId || !lockupType) {
      return res.status(400).json({ error: 'tokenId, investorId, and lockupType are required' });
    }

    const result = await lockupService.createLockup({
      tokenId,
      investorId,
      lockupType: lockupType as LockupType,
      unlockTimestamp: unlockTimestamp ? new Date(unlockTimestamp) : undefined,
      lockupDays,
      lockupReason,
      vestingSchedule,
    });

    logger.info('Lockup created via API', { lockupId: result.lockup.id, tokenId, investorId });

    return res.status(201).json(result);
  } catch (error) {
    logger.error('Create lockup API error', { error });
    return res.status(500).json({ error: 'Failed to create lockup' });
  }
});

/**
 * GET /api/v1/compliance/lockups/token/:tokenId
 * Get all lockups for a token
 */
router.get('/lockups/token/:tokenId', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.params;
    const lockups = await lockupService.getTokenLockups(tokenId);
    return res.json(lockups);
  } catch (error) {
    logger.error('Get token lockups API error', { error });
    return res.status(500).json({ error: 'Failed to get token lockups' });
  }
});

/**
 * GET /api/v1/compliance/lockups/investor/:investorId
 * Get all lockups for an investor
 */
router.get('/lockups/investor/:investorId', async (req: Request, res: Response) => {
  try {
    const { investorId } = req.params;
    const lockups = await lockupService.getInvestorLockups(investorId);
    return res.json(lockups);
  } catch (error) {
    logger.error('Get investor lockups API error', { error });
    return res.status(500).json({ error: 'Failed to get investor lockups' });
  }
});

/**
 * GET /api/v1/compliance/lockups/check/:tokenId/:investorId
 * Check if transfer is allowed (lockup status)
 */
router.get('/lockups/check/:tokenId/:investorId', async (req: Request, res: Response) => {
  try {
    const { tokenId, investorId } = req.params;
    const result = await lockupService.isTransferAllowed(tokenId, investorId);
    return res.json(result);
  } catch (error) {
    logger.error('Check lockup API error', { error });
    return res.status(500).json({ error: 'Failed to check lockup status' });
  }
});

/**
 * GET /api/v1/compliance/lockups/active
 * Get all active lockups
 */
router.get('/lockups/active', async (req: Request, res: Response) => {
  try {
    const { tokenId } = req.query;
    const lockups = await lockupService.getActiveLockups(tokenId as string | undefined);
    return res.json(lockups);
  } catch (error) {
    logger.error('Get active lockups API error', { error });
    return res.status(500).json({ error: 'Failed to get active lockups' });
  }
});

// ============= Travel Rule Routes =============

/**
 * POST /api/v1/compliance/transfers/:id/travel-rule
 * Evaluate and collect travel rule data for a transfer
 */
router.post('/transfers/:id/travel-rule', async (req: Request, res: Response) => {
  try {
    const { id: transferId } = req.params;
    const {
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
    } = req.body;

    if (!transferValueUSD) {
      return res.status(400).json({ error: 'transferValueUSD is required' });
    }

    const result = await travelRuleService.collectTravelRuleData({
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
    });

    logger.info('Travel rule data collected via API', {
      transferId,
      thresholdTriggered: result.evaluation.thresholdTriggered,
    });

    return res.status(201).json(result);
  } catch (error) {
    logger.error('Collect travel rule data API error', { error });
    return res.status(500).json({ error: 'Failed to collect travel rule data' });
  }
});

/**
 * GET /api/v1/compliance/transfers/:id/travel-rule
 * Get travel rule data for a transfer
 */
router.get('/transfers/:id/travel-rule', async (req: Request, res: Response) => {
  try {
    const { id: transferId } = req.params;
    const data = await travelRuleService.getTravelRuleData(transferId);

    if (!data) {
      return res.status(404).json({ error: 'Travel rule data not found' });
    }

    return res.json(data);
  } catch (error) {
    logger.error('Get travel rule data API error', { error });
    return res.status(500).json({ error: 'Failed to get travel rule data' });
  }
});

/**
 * POST /api/v1/compliance/travel-rule/evaluate
 * Evaluate threshold without storing
 */
router.post('/travel-rule/evaluate', async (req: Request, res: Response) => {
  try {
    const { transferValueUSD, originatorJurisdiction, beneficiaryJurisdiction } = req.body;

    if (!transferValueUSD) {
      return res.status(400).json({ error: 'transferValueUSD is required' });
    }

    const evaluation = await travelRuleService.evaluateThreshold(
      transferValueUSD,
      originatorJurisdiction || 'US',
      beneficiaryJurisdiction || 'US'
    );

    return res.json(evaluation);
  } catch (error) {
    logger.error('Evaluate threshold API error', { error });
    return res.status(500).json({ error: 'Failed to evaluate threshold' });
  }
});

/**
 * GET /api/v1/compliance/travel-rule/pending
 * Get pending travel rule cases
 */
router.get('/travel-rule/pending', async (req: Request, res: Response) => {
  try {
    const cases = await travelRuleService.getPendingCases();
    return res.json(cases);
  } catch (error) {
    logger.error('Get pending travel rule cases API error', { error });
    return res.status(500).json({ error: 'Failed to get pending cases' });
  }
});

// ============= Compliance Case Routes =============

/**
 * POST /api/v1/compliance/cases
 * Create a new compliance case
 */
router.post('/cases', async (req: Request, res: Response) => {
  try {
    const { caseType, entityType, entityId, priority, createdBy } = req.body;

    if (!caseType || !entityType || !entityId) {
      return res.status(400).json({ error: 'caseType, entityType, and entityId are required' });
    }

    const complianceCase = await complianceCaseService.createComplianceCase({
      caseType: caseType as ComplianceCaseType,
      entityType,
      entityId,
      priority: priority as CasePriority | undefined,
      createdBy,
    });

    logger.info('Compliance case created via API', { caseId: complianceCase.id });

    return res.status(201).json(complianceCase);
  } catch (error) {
    logger.error('Create compliance case API error', { error });
    return res.status(500).json({ error: 'Failed to create compliance case' });
  }
});

/**
 * GET /api/v1/compliance/cases/:id
 * Get compliance case by ID
 */
router.get('/cases/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const complianceCase = await complianceCaseService.getComplianceCase(id);

    if (!complianceCase) {
      return res.status(404).json({ error: 'Case not found' });
    }

    return res.json(complianceCase);
  } catch (error) {
    logger.error('Get compliance case API error', { error });
    return res.status(500).json({ error: 'Failed to get compliance case' });
  }
});

/**
 * PUT /api/v1/compliance/cases/:id/status
 * Update case status
 */
router.put('/cases/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, actor, actorType, reason } = req.body;

    if (!status || !actor) {
      return res.status(400).json({ error: 'status and actor are required' });
    }

    const complianceCase = await complianceCaseService.updateCaseStatus(
      id,
      status as ComplianceCaseStatus,
      actor,
      actorType as AuditActorType | undefined,
      reason
    );

    return res.json(complianceCase);
  } catch (error) {
    logger.error('Update case status API error', { error });
    return res.status(500).json({ error: 'Failed to update case status' });
  }
});

/**
 * PUT /api/v1/compliance/cases/:id/assign
 * Assign case to reviewer
 */
router.put('/cases/:id/assign', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { assigneeId, assignedBy } = req.body;

    if (!assigneeId || !assignedBy) {
      return res.status(400).json({ error: 'assigneeId and assignedBy are required' });
    }

    const complianceCase = await complianceCaseService.assignCase(id, assigneeId, assignedBy);

    return res.json(complianceCase);
  } catch (error) {
    logger.error('Assign case API error', { error });
    return res.status(500).json({ error: 'Failed to assign case' });
  }
});

/**
 * POST /api/v1/compliance/cases/:id/ai-decision
 * Record AI decision on case
 */
router.post('/cases/:id/ai-decision', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approved, confidence, aiModelId, aiModelVersion, rulesetVersion, reason } = req.body;

    if (approved === undefined || confidence === undefined) {
      return res.status(400).json({ error: 'approved and confidence are required' });
    }

    const complianceCase = await complianceCaseService.recordAIDecision(
      id,
      approved,
      confidence,
      aiModelId || 'mistral-7b-instruct-v0.2',
      aiModelVersion || 'together-ai-1.0.3',
      rulesetVersion || '2025-01-15',
      reason
    );

    return res.json(complianceCase);
  } catch (error) {
    logger.error('Record AI decision API error', { error });
    return res.status(500).json({ error: 'Failed to record AI decision' });
  }
});

/**
 * POST /api/v1/compliance/cases/:id/override
 * Manual override of AI decision
 */
router.post('/cases/:id/override', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reviewerId, reason } = req.body;

    if (!status || !reviewerId || !reason) {
      return res.status(400).json({ error: 'status, reviewerId, and reason are required' });
    }

    const complianceCase = await complianceCaseService.manualOverride(
      id,
      status as ComplianceCaseStatus,
      reviewerId,
      reason
    );

    return res.json(complianceCase);
  } catch (error) {
    logger.error('Manual override API error', { error });
    return res.status(500).json({ error: 'Failed to apply manual override' });
  }
});

/**
 * POST /api/v1/compliance/cases/:id/escalate
 * Escalate a case
 */
router.post('/cases/:id/escalate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { escalatedBy, reason } = req.body;

    if (!escalatedBy || !reason) {
      return res.status(400).json({ error: 'escalatedBy and reason are required' });
    }

    const complianceCase = await complianceCaseService.escalateCase(id, escalatedBy, reason);

    return res.json(complianceCase);
  } catch (error) {
    logger.error('Escalate case API error', { error });
    return res.status(500).json({ error: 'Failed to escalate case' });
  }
});

/**
 * GET /api/v1/compliance/cases/pending
 * Get pending cases for review
 */
router.get('/cases/pending', async (req: Request, res: Response) => {
  try {
    const { assigneeId } = req.query;
    const cases = await complianceCaseService.getPendingCases(assigneeId as string | undefined);
    return res.json(cases);
  } catch (error) {
    logger.error('Get pending cases API error', { error });
    return res.status(500).json({ error: 'Failed to get pending cases' });
  }
});

/**
 * GET /api/v1/compliance/cases/statistics
 * Get case statistics
 */
router.get('/cases/statistics', async (req: Request, res: Response) => {
  try {
    const stats = await complianceCaseService.getCaseStatistics();
    return res.json(stats);
  } catch (error) {
    logger.error('Get case statistics API error', { error });
    return res.status(500).json({ error: 'Failed to get case statistics' });
  }
});

// ============= Audit Log Routes =============

/**
 * GET /api/v1/compliance/audit-logs
 * Query audit logs
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const { complianceCaseId, actor, actorType, action, startDate, endDate, limit, offset } =
      req.query;

    const result = await auditLogService.queryAuditLogs({
      complianceCaseId: complianceCaseId as string | undefined,
      actor: actor as string | undefined,
      actorType: actorType as AuditActorType | undefined,
      action: action as AuditAction | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
    });

    return res.json(result);
  } catch (error) {
    logger.error('Query audit logs API error', { error });
    return res.status(500).json({ error: 'Failed to query audit logs' });
  }
});

/**
 * GET /api/v1/compliance/audit-logs/case/:caseId
 * Get audit logs for a case
 */
router.get('/audit-logs/case/:caseId', async (req: Request, res: Response) => {
  try {
    const { caseId } = req.params;
    const logs = await auditLogService.getCaseAuditLogs(caseId);
    return res.json(logs);
  } catch (error) {
    logger.error('Get case audit logs API error', { error });
    return res.status(500).json({ error: 'Failed to get audit logs' });
  }
});

/**
 * GET /api/v1/compliance/audit-logs/ai-decisions
 * Get AI decision history
 */
router.get('/audit-logs/ai-decisions', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const decisions = await auditLogService.getAIDecisionHistory(
      limit ? parseInt(limit as string) : undefined
    );
    return res.json(decisions);
  } catch (error) {
    logger.error('Get AI decision history API error', { error });
    return res.status(500).json({ error: 'Failed to get AI decision history' });
  }
});

/**
 * GET /api/v1/compliance/audit-logs/overrides
 * Get manual override history
 */
router.get('/audit-logs/overrides', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const overrides = await auditLogService.getManualOverrideHistory(
      limit ? parseInt(limit as string) : undefined
    );
    return res.json(overrides);
  } catch (error) {
    logger.error('Get override history API error', { error });
    return res.status(500).json({ error: 'Failed to get override history' });
  }
});

/**
 * GET /api/v1/compliance/audit-logs/statistics
 * Get audit log statistics
 */
router.get('/audit-logs/statistics', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await auditLogService.getAuditLogStatistics(
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );
    return res.json(stats);
  } catch (error) {
    logger.error('Get audit log statistics API error', { error });
    return res.status(500).json({ error: 'Failed to get audit log statistics' });
  }
});

/**
 * GET /api/v1/compliance/audit-logs/ai-confidence
 * Get AI confidence distribution
 */
router.get('/audit-logs/ai-confidence', async (req: Request, res: Response) => {
  try {
    const distribution = await auditLogService.getAIConfidenceDistribution();
    return res.json(distribution);
  } catch (error) {
    logger.error('Get AI confidence distribution API error', { error });
    return res.status(500).json({ error: 'Failed to get confidence distribution' });
  }
});

/**
 * GET /api/v1/compliance/audit-logs/export/:caseId
 * Export audit logs for a case
 */
router.get('/audit-logs/export/:caseId', async (req: Request, res: Response) => {
  try {
    const { caseId } = req.params;
    const { format } = req.query;

    const exportData = await auditLogService.exportAuditLogs(
      caseId,
      (format as 'json' | 'csv') || 'json'
    );

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${caseId}.csv"`);
      return res.send(exportData);
    }

    return res.json(exportData);
  } catch (error) {
    logger.error('Export audit logs API error', { error });
    return res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

// ============= Statistics Routes =============

/**
 * GET /api/v1/compliance/statistics
 * Get overall compliance statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const [caseStats, attestationStats, lockupStats, travelRuleStats, auditStats] =
      await Promise.all([
        complianceCaseService.getCaseStatistics(),
        attestationService.getAttestationStatistics(),
        lockupService.getLockupStatistics(),
        travelRuleService.getTravelRuleStatistics(),
        auditLogService.getAuditLogStatistics(),
      ]);

    return res.json({
      cases: caseStats,
      attestations: attestationStats,
      lockups: lockupStats,
      travelRule: travelRuleStats,
      auditLogs: auditStats,
    });
  } catch (error) {
    logger.error('Get compliance statistics API error', { error });
    return res.status(500).json({ error: 'Failed to get compliance statistics' });
  }
});

export default router;
