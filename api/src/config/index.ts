import dotenv from 'dotenv';

dotenv.config();

export const config = {
  server: {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
  },

  api: {
    version: process.env.API_VERSION || 'v1',
  },

  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/rwa_platform',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  blockchain: {
    ethereum: {
      rpcUrl: process.env.ETHEREUM_RPC_URL || '',
      chainId: 1,
    },
    polygon: {
      rpcUrl: process.env.POLYGON_RPC_URL || '',
      chainId: 137,
    },
    sepolia: {
      rpcUrl: process.env.SEPOLIA_RPC_URL || '',
      chainId: 11155111,
    },
    deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY || '',
  },

  security: {
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret',
    apiKeySalt: process.env.API_KEY_SALT || 'change-this-salt',
  },

  rateLimit: {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },

  externalServices: {
    fireblocks: {
      apiKey: process.env.FIREBLOCKS_API_KEY || '',
      apiSecret: process.env.FIREBLOCKS_API_SECRET || '',
    },
    chainalysis: {
      apiKey: process.env.CHAINALYSIS_API_KEY || '',
    },
    aiCompliance: {
      apiUrl: process.env.AI_COMPLIANCE_API_URL || 'http://localhost:8000',
      timeout: parseInt(process.env.AI_COMPLIANCE_TIMEOUT || '20000', 10),
      confidenceThreshold: parseFloat(process.env.AI_CONFIDENCE_THRESHOLD || '0.7'),
    },
  },

  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false',
    rulesTtl: parseInt(process.env.CACHE_RULES_TTL || '3600', 10),
    conflictsTtl: parseInt(process.env.CACHE_CONFLICTS_TTL || '86400', 10),
  },
};
