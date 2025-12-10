/**
 * Token API Tests
 *
 * Tests the complete token creation and retrieval flow
 */

/// <reference path="./setup.ts" />

import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/prisma';

describe('Token API', () => {
  let apiKey: any;
  let authHeader: string;

  beforeAll(async () => {
    // Create a test API key
    apiKey = await globalThis.testUtils.createTestApiKey();
    authHeader = `Bearer ${apiKey.key}`;
  });

  afterAll(async () => {
    // Clean up test data
    await globalThis.testUtils.cleanup();
  });

  describe('POST /v1/tokens/create', () => {
    it('should create a treasury token successfully', async () => {
      const tokenData = {
        asset_type: 'TREASURY',
        asset_details: {
          cusip: '912828YK0',
          face_value: 10000000,
          maturity_date: '2026-12-31',
          coupon_rate: 0.0425,
        },
        token_config: {
          name: 'US Treasury 4.25% 2026',
          symbol: 'UST-425-26',
          total_supply: 10000000,
          decimals: 18,
          blockchain: 'ETHEREUM',
        },
        compliance_rules: {
          accredited_only: true,
          max_investors: 2000,
          lockup_period_days: 180,
          allowed_jurisdictions: ['US', 'UK', 'SG'],
        },
      };

      const response = await request(app)
        .post('/v1/tokens/create')
        .set('Authorization', authHeader)
        .send(tokenData)
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('token_id');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('blockchain');
      expect(response.body.status).toBe('pending');
      expect(response.body.blockchain).toBe('ethereum');

      // Verify token was created in database
      const token = await prisma.token.findUnique({
        where: { id: response.body.token_id },
      });

      expect(token).toBeDefined();
      expect(token?.name).toBe('US Treasury 4.25% 2026');
      expect(token?.symbol).toBe('UST-425-26');
      expect(token?.assetType).toBe('TREASURY');
      expect(token?.totalSupply).toBe('10000000');

      // Verify audit log was created
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          action: 'token_created',
          entityId: response.body.token_id,
        },
      });

      expect(auditLog).toBeDefined();
    }, 15000);

    it('should reject invalid token data', async () => {
      const invalidData = {
        asset_type: 'INVALID_TYPE',
        token_config: {
          name: 'X', // Too short
          symbol: 'A', // Too short
          total_supply: -1000, // Negative
          blockchain: 'INVALID',
        },
      };

      const response = await request(app)
        .post('/v1/tokens/create')
        .set('Authorization', authHeader)
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject requests without authentication', async () => {
      const tokenData = {
        asset_type: 'TREASURY',
        token_config: {
          name: 'Test Token',
          symbol: 'TEST',
          total_supply: 1000000,
          blockchain: 'ETHEREUM',
        },
      };

      await request(app)
        .post('/v1/tokens/create')
        .send(tokenData)
        .expect(401);
    });
  });

  describe('GET /v1/tokens/:id', () => {
    let tokenId: string;

    beforeAll(async () => {
      // Create a token for retrieval tests
      const token = await prisma.token.create({
        data: {
          name: 'Test Retrieval Token',
          symbol: 'TRT',
          assetType: 'PRIVATE_CREDIT',
          totalSupply: '5000000',
          decimals: 18,
          blockchain: 'polygon',
          status: 'deployed',
          contractAddress: '0x1234567890123456789012345678901234567890',
          assetDetails: {},
          complianceRules: {},
        },
      });
      tokenId = token.id;
    });

    it('should retrieve token details successfully', async () => {
      const response = await request(app)
        .get(`/v1/tokens/${tokenId}`)
        .set('Authorization', authHeader)
        .expect(200);

      expect(response.body).toHaveProperty('token_id');
      expect(response.body).toHaveProperty('name');
      expect(response.body).toHaveProperty('symbol');
      expect(response.body.name).toBe('Test Retrieval Token');
      expect(response.body.symbol).toBe('TRT');
      expect(response.body.asset_type).toBe('PRIVATE_CREDIT');
    });

    it('should return 404 for non-existent token', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app)
        .get(`/v1/tokens/${fakeId}`)
        .set('Authorization', authHeader)
        .expect(404);

      expect(response.body.error.code).toBe('TOKEN_NOT_FOUND');
    });
  });

  describe('Performance Metrics', () => {
    it('should track request duration in metrics', async () => {
      // Make a request
      await request(app)
        .get('/health')
        .expect(200);

      // Check metrics endpoint
      const metricsResponse = await request(app)
        .get('/metrics')
        .expect(200);

      expect(metricsResponse.body).toHaveProperty('performance');
      expect(metricsResponse.body.performance).toHaveProperty('http');
      expect(metricsResponse.body.performance.http.requests_total).toBeGreaterThan(0);
    });

    it('should expose Prometheus-formatted metrics', async () => {
      const response = await request(app)
        .get('/metrics/prometheus')
        .expect(200);

      expect(response.text).toContain('http_requests_total');
      expect(response.text).toContain('http_request_duration_ms');
      expect(response.headers['content-type']).toContain('text/plain');
    });
  });
});
