/**
 * Compliance Metrics for Prometheus/Grafana
 *
 * Tracks AI confidence heatmaps, fallback rates, sanctions hits,
 * manual review rates, and processing latencies.
 */

import { logger } from '../utils/logger';

// Check if prom-client is available
let promClient: any = null;
let metricsEnabled = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  promClient = require('prom-client');
  metricsEnabled = true;
} catch {
  logger.warn('prom-client not installed, metrics disabled');
}

// ============= Metric Definitions =============

// AI Confidence Tracking
const aiConfidenceHistogram = metricsEnabled
  ? new promClient.Histogram({
      name: 'compliance_ai_confidence',
      help: 'AI confidence scores distribution',
      labelNames: ['decision_type', 'jurisdiction'],
      buckets: [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0],
    })
  : null;

// Fallback Rate Counter
const fallbackCounter = metricsEnabled
  ? new promClient.Counter({
      name: 'compliance_fallback_total',
      help: 'Number of times AI fallback was used',
      labelNames: ['service', 'reason'],
    })
  : null;

// Sanctions Check Results
const sanctionsHitsCounter = metricsEnabled
  ? new promClient.Counter({
      name: 'compliance_sanctions_hits_total',
      help: 'Sanctions screening results',
      labelNames: ['provider', 'result', 'jurisdiction'],
    })
  : null;

// Manual Review Rate
const manualReviewCounter = metricsEnabled
  ? new promClient.Counter({
      name: 'compliance_manual_review_total',
      help: 'Cases requiring manual review',
      labelNames: ['reason', 'case_type'],
    })
  : null;

// Processing Latency
const processingLatencyHistogram = metricsEnabled
  ? new promClient.Histogram({
      name: 'compliance_processing_seconds',
      help: 'Compliance check processing time',
      labelNames: ['check_type', 'provider'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    })
  : null;

// Case Status Gauge
const caseStatusGauge = metricsEnabled
  ? new promClient.Gauge({
      name: 'compliance_cases_by_status',
      help: 'Number of compliance cases by status',
      labelNames: ['status'],
    })
  : null;

// Attestation Status Gauge
const attestationStatusGauge = metricsEnabled
  ? new promClient.Gauge({
      name: 'compliance_attestations_by_status',
      help: 'Number of attestations by status',
      labelNames: ['status', 'type'],
    })
  : null;

// Travel Rule Triggered Counter
const travelRuleTriggeredCounter = metricsEnabled
  ? new promClient.Counter({
      name: 'compliance_travel_rule_triggered_total',
      help: 'Number of transfers triggering travel rule',
      labelNames: ['regime', 'jurisdiction'],
    })
  : null;

// On-Chain Sync Status
const onChainSyncGauge = metricsEnabled
  ? new promClient.Gauge({
      name: 'compliance_onchain_sync_pending',
      help: 'Number of pending on-chain syncs',
      labelNames: ['entity_type'],
    })
  : null;

// Lockup Violations Counter
const lockupViolationCounter = metricsEnabled
  ? new promClient.Counter({
      name: 'compliance_lockup_violations_total',
      help: 'Number of attempted transfers blocked by lockups',
      labelNames: ['lockup_type'],
    })
  : null;

// ============= Metric Recording Functions =============

/**
 * Record AI confidence score
 */
export function recordAIConfidence(
  decisionType: string,
  jurisdiction: string,
  confidence: number
) {
  if (aiConfidenceHistogram) {
    aiConfidenceHistogram.observe({ decision_type: decisionType, jurisdiction }, confidence);
  }
  logger.debug('AI confidence recorded', { decisionType, jurisdiction, confidence });
}

/**
 * Record fallback usage
 */
export function recordFallback(service: string, reason: string) {
  if (fallbackCounter) {
    fallbackCounter.inc({ service, reason });
  }
  logger.info('Fallback recorded', { service, reason });
}

/**
 * Record sanctions check result
 */
export function recordSanctionsResult(
  provider: string,
  result: 'passed' | 'failed' | 'flagged',
  jurisdiction: string
) {
  if (sanctionsHitsCounter) {
    sanctionsHitsCounter.inc({ provider, result, jurisdiction });
  }
  logger.debug('Sanctions result recorded', { provider, result, jurisdiction });
}

/**
 * Record manual review required
 */
export function recordManualReview(reason: string, caseType: string) {
  if (manualReviewCounter) {
    manualReviewCounter.inc({ reason, case_type: caseType });
  }
  logger.info('Manual review recorded', { reason, caseType });
}

/**
 * Record processing latency
 */
export function recordProcessingLatency(
  checkType: string,
  provider: string,
  durationSeconds: number
) {
  if (processingLatencyHistogram) {
    processingLatencyHistogram.observe({ check_type: checkType, provider }, durationSeconds);
  }
  logger.debug('Processing latency recorded', { checkType, provider, durationSeconds });
}

/**
 * Update case status gauge
 */
export function updateCaseStatusGauge(status: string, count: number) {
  if (caseStatusGauge) {
    caseStatusGauge.set({ status }, count);
  }
}

/**
 * Update attestation status gauge
 */
export function updateAttestationStatusGauge(status: string, type: string, count: number) {
  if (attestationStatusGauge) {
    attestationStatusGauge.set({ status, type }, count);
  }
}

/**
 * Record travel rule triggered
 */
export function recordTravelRuleTriggered(regime: string, jurisdiction: string) {
  if (travelRuleTriggeredCounter) {
    travelRuleTriggeredCounter.inc({ regime, jurisdiction });
  }
  logger.debug('Travel rule triggered', { regime, jurisdiction });
}

/**
 * Update on-chain sync pending gauge
 */
export function updateOnChainSyncPending(entityType: string, count: number) {
  if (onChainSyncGauge) {
    onChainSyncGauge.set({ entity_type: entityType }, count);
  }
}

/**
 * Record lockup violation attempt
 */
export function recordLockupViolation(lockupType: string) {
  if (lockupViolationCounter) {
    lockupViolationCounter.inc({ lockup_type: lockupType });
  }
  logger.warn('Lockup violation attempt recorded', { lockupType });
}

// ============= Metric Helpers =============

/**
 * Timer helper for measuring processing time
 */
export function startProcessingTimer() {
  return Date.now();
}

/**
 * End timer and record latency
 */
export function endProcessingTimer(
  startTime: number,
  checkType: string,
  provider: string
) {
  const durationSeconds = (Date.now() - startTime) / 1000;
  recordProcessingLatency(checkType, provider, durationSeconds);
  return durationSeconds;
}

// ============= Metrics Export =============

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  if (!metricsEnabled || !promClient) {
    return '# Metrics disabled - prom-client not installed\n';
  }

  return promClient.register.metrics();
}

/**
 * Get metrics content type
 */
export function getMetricsContentType(): string {
  if (!metricsEnabled || !promClient) {
    return 'text/plain';
  }
  return promClient.register.contentType;
}

/**
 * Reset all metrics (useful for testing)
 */
export async function resetMetrics(): Promise<void> {
  if (metricsEnabled && promClient) {
    promClient.register.resetMetrics();
  }
}

// ============= Collect Default Metrics =============

if (metricsEnabled && promClient) {
  // Collect default Node.js metrics
  promClient.collectDefaultMetrics({
    prefix: 'compliance_api_',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  });

  logger.info('Prometheus metrics initialized');
}

// ============= Express Middleware =============

import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware to track HTTP request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!metricsEnabled) {
    return next();
  }

  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;

    // Only track compliance-related endpoints
    if (req.path.includes('/compliance')) {
      if (processingLatencyHistogram) {
        processingLatencyHistogram.observe(
          { check_type: 'http_request', provider: 'api' },
          duration
        );
      }
    }
  });

  next();
}

/**
 * Metrics endpoint handler
 */
export async function metricsHandler(req: Request, res: Response) {
  try {
    const metrics = await getMetrics();
    res.set('Content-Type', getMetricsContentType());
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics', { error });
    res.status(500).send('Error generating metrics');
  }
}

// ============= Scheduled Metrics Collection =============

import * as complianceCaseService from '../services/complianceCaseService';
import * as attestationService from '../services/attestationService';
import * as lockupService from '../services/lockupService';
import * as travelRuleService from '../services/travelRuleService';

/**
 * Collect and update gauge metrics from database
 * Should be called periodically (e.g., every minute)
 */
export async function collectGaugeMetrics() {
  if (!metricsEnabled) return;

  try {
    // Update case status gauges
    const caseStats = await complianceCaseService.getCaseStatistics();
    updateCaseStatusGauge('open', caseStats.open);
    updateCaseStatusGauge('in_review', caseStats.inReview);
    updateCaseStatusGauge('approved', caseStats.approved);
    updateCaseStatusGauge('rejected', caseStats.rejected);
    updateCaseStatusGauge('escalated', caseStats.escalated);

    // Update attestation status gauges
    const attestationStats = await attestationService.getAttestationStatistics();
    updateAttestationStatusGauge('valid', 'all', attestationStats.valid);
    updateAttestationStatusGauge('expired', 'all', attestationStats.expired);
    updateAttestationStatusGauge('revoked', 'all', attestationStats.revoked);

    // Update lockup gauges
    const lockupStats = await lockupService.getLockupStatistics();
    updateCaseStatusGauge('lockups_active', lockupStats.active);
    updateCaseStatusGauge('lockups_expired', lockupStats.expired);

    // Update travel rule gauges
    const travelRuleStats = await travelRuleService.getTravelRuleStatistics();
    updateCaseStatusGauge('travel_rule_pending', travelRuleStats.pending);
    updateCaseStatusGauge('travel_rule_compliant', travelRuleStats.compliant);

    logger.debug('Gauge metrics collected');
  } catch (error) {
    logger.error('Error collecting gauge metrics', { error });
  }
}

// Export metrics status
export const isMetricsEnabled = metricsEnabled;
