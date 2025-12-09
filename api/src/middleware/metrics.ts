import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// In-memory metrics store
export class MetricsStore {
  private static instance: MetricsStore;

  public httpRequestsTotal = 0;
  public httpRequestDuration: number[] = [];
  public dbQueryDuration: number[] = [];
  public blockchainCallsTotal = 0;
  public blockchainGasUsed: number[] = [];

  // Per-endpoint metrics
  public endpointMetrics = new Map<string, {
    count: number;
    durations: number[];
    errors: number;
  }>();

  private constructor() {}

  public static getInstance(): MetricsStore {
    if (!MetricsStore.instance) {
      MetricsStore.instance = new MetricsStore();
    }
    return MetricsStore.instance;
  }

  public recordRequest(endpoint: string, duration: number, error: boolean = false) {
    this.httpRequestsTotal++;
    this.httpRequestDuration.push(duration);

    if (!this.endpointMetrics.has(endpoint)) {
      this.endpointMetrics.set(endpoint, { count: 0, durations: [], errors: 0 });
    }

    const endpointData = this.endpointMetrics.get(endpoint)!;
    endpointData.count++;
    endpointData.durations.push(duration);
    if (error) endpointData.errors++;

    // Keep only last 1000 measurements to prevent memory leak
    if (this.httpRequestDuration.length > 1000) {
      this.httpRequestDuration.shift();
    }
    if (endpointData.durations.length > 100) {
      endpointData.durations.shift();
    }
  }

  public recordDbQuery(duration: number) {
    this.dbQueryDuration.push(duration);
    if (this.dbQueryDuration.length > 1000) {
      this.dbQueryDuration.shift();
    }
  }

  public recordBlockchainCall(gasUsed?: number) {
    this.blockchainCallsTotal++;
    if (gasUsed) {
      this.blockchainGasUsed.push(gasUsed);
      if (this.blockchainGasUsed.length > 100) {
        this.blockchainGasUsed.shift();
      }
    }
  }

  public getStats() {
    const calculateStats = (arr: number[]) => {
      if (arr.length === 0) return { avg: 0, min: 0, max: 0, p95: 0 };

      const sorted = [...arr].sort((a, b) => a - b);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const p95Index = Math.floor(sorted.length * 0.95);

      return {
        avg: Math.round(avg * 100) / 100,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p95: sorted[p95Index] || 0,
      };
    };

    const endpointStats: Record<string, any> = {};
    this.endpointMetrics.forEach((data, endpoint) => {
      endpointStats[endpoint] = {
        count: data.count,
        errors: data.errors,
        ...calculateStats(data.durations),
      };
    });

    return {
      http: {
        requests_total: this.httpRequestsTotal,
        duration_ms: calculateStats(this.httpRequestDuration),
      },
      database: {
        query_duration_ms: calculateStats(this.dbQueryDuration),
      },
      blockchain: {
        calls_total: this.blockchainCallsTotal,
        gas_used: calculateStats(this.blockchainGasUsed),
      },
      endpoints: endpointStats,
    };
  }

  public getPrometheusMetrics(): string {
    const stats = this.getStats();
    const lines: string[] = [];

    // HTTP metrics
    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    lines.push(`http_requests_total ${stats.http.requests_total}`);

    lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds');
    lines.push('# TYPE http_request_duration_ms summary');
    lines.push(`http_request_duration_ms{quantile="0.95"} ${stats.http.duration_ms.p95}`);
    lines.push(`http_request_duration_ms_sum ${stats.http.duration_ms.avg * stats.http.requests_total}`);
    lines.push(`http_request_duration_ms_count ${stats.http.requests_total}`);

    // Database metrics
    lines.push('# HELP db_query_duration_ms Database query duration in milliseconds');
    lines.push('# TYPE db_query_duration_ms summary');
    lines.push(`db_query_duration_ms{quantile="0.95"} ${stats.database.query_duration_ms.p95}`);

    // Blockchain metrics
    lines.push('# HELP blockchain_calls_total Total blockchain calls');
    lines.push('# TYPE blockchain_calls_total counter');
    lines.push(`blockchain_calls_total ${stats.blockchain.calls_total}`);

    if (stats.blockchain.gas_used.avg > 0) {
      lines.push('# HELP blockchain_gas_used Gas used in blockchain transactions');
      lines.push('# TYPE blockchain_gas_used summary');
      lines.push(`blockchain_gas_used{quantile="0.95"} ${stats.blockchain.gas_used.p95}`);
    }

    // Per-endpoint metrics
    Object.entries(stats.endpoints).forEach(([endpoint, data]: [string, any]) => {
      const sanitizedEndpoint = endpoint.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`# HELP endpoint_${sanitizedEndpoint}_requests Requests to ${endpoint}`);
      lines.push(`# TYPE endpoint_${sanitizedEndpoint}_requests counter`);
      lines.push(`endpoint_${sanitizedEndpoint}_requests ${data.count}`);
      lines.push(`endpoint_${sanitizedEndpoint}_errors ${data.errors}`);
      lines.push(`endpoint_${sanitizedEndpoint}_duration_p95 ${data.p95}`);
    });

    return lines.join('\n');
  }
}

/**
 * Middleware to track request duration and metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const endpoint = `${req.method} ${req.route?.path || req.path}`;

  // Capture the original res.json to log response time
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const duration = Date.now() - start;
    const isError = res.statusCode >= 400;

    MetricsStore.getInstance().recordRequest(endpoint, duration, isError);

    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    return originalJson(body);
  };

  next();
}

/**
 * Add timing to Prisma queries
 */
export async function measureDbQuery<T>(
  queryName: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await queryFn();
    const duration = Date.now() - start;

    MetricsStore.getInstance().recordDbQuery(duration);

    logger.debug('Database Query', {
      query: queryName,
      duration: `${duration}ms`,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Database Query Failed', {
      query: queryName,
      duration: `${duration}ms`,
      error,
    });
    throw error;
  }
}

/**
 * Track blockchain call metrics
 */
export function recordBlockchainMetrics(
  operation: string,
  gasUsed?: number,
  txHash?: string
) {
  MetricsStore.getInstance().recordBlockchainCall(gasUsed);

  logger.info('Blockchain Operation', {
    operation,
    gasUsed,
    txHash,
    estimatedCost: gasUsed ? `${gasUsed} gas` : 'N/A',
  });
}
