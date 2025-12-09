/**
 * Mock Queue for Development (No Redis Required)
 *
 * Use this when Redis is not available.
 * WARNING: Jobs are not persisted and will be lost on restart.
 */

import { logger } from '../utils/logger';

interface Job {
  id: string;
  name: string;
  data: any;
  attempts: number;
  maxAttempts: number;
}

class MockQueue {
  private name: string;
  private jobs: Map<string, Job> = new Map();
  private processing: Set<string> = new Set();

  constructor(name: string) {
    this.name = name;
    logger.warn(`Using mock queue for ${name} - Redis not available`);
  }

  async add(jobName: string, data: any, options?: any) {
    const jobId = `${this.name}-${Date.now()}-${Math.random()}`;
    const job: Job = {
      id: jobId,
      name: jobName,
      data,
      attempts: 0,
      maxAttempts: options?.attempts || 3,
    };

    this.jobs.set(jobId, job);
    logger.info(`Mock job added: ${jobName}`, { jobId, queue: this.name });

    // Process immediately in background
    setImmediate(() => this.processJob(jobId));

    return { id: jobId };
  }

  async getJobCounts() {
    return {
      waiting: this.jobs.size - this.processing.size,
      active: this.processing.size,
      completed: 0,
      failed: 0,
    };
  }

  async clean() {
    // No-op for mock
  }

  private async processJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || this.processing.has(jobId)) return;

    this.processing.add(jobId);

    try {
      // Job processing happens in workers
      // This is just a mock - actual processing is elsewhere
      logger.info(`Mock job processing: ${job.name}`, { jobId });

      // Simulate processing time
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.jobs.delete(jobId);
      this.processing.delete(jobId);
    } catch (error) {
      logger.error(`Mock job failed: ${job.name}`, { jobId, error });
      this.processing.delete(jobId);
    }
  }
}

let useMock = false;

// Check if Redis is available
try {
  if (!process.env.REDIS_URL || process.env.USE_MOCK_QUEUE === 'true') {
    useMock = true;
  }
} catch {
  useMock = true;
}

export function createQueue(name: string) {
  if (useMock) {
    return new MockQueue(name);
  }

  // Use real BullMQ queue
  const { Queue } = require('bullmq');
  const connection = {
    host: process.env.REDIS_URL?.split('://')[1].split(':')[0] || 'localhost',
    port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
  };

  return new Queue(name, { connection });
}
