import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import apiRoutes from './routes';
import healthcheckRoutes from './routes/healthcheck';

// Only start workers if not using mock queue
if (process.env.USE_MOCK_QUEUE !== 'true') {
  logger.info('Starting background workers with Redis...');
  import('./jobs/workers/tokenDeploymentWorker');
  import('./jobs/workers/complianceWorker');
  import('./jobs/workers/settlementWorker');
} else {
  logger.info('Using mock queue - background jobs will run in-memory');
}

const app = express();

// Security & Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Healthcheck routes (no authentication required)
app.use('/', healthcheckRoutes);

// API Routes (authentication required)
app.use(`/${config.api.version}`, apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    }
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = config.server.port;

app.listen(PORT, () => {
  logger.info(`🚀 RWA API Server running on port ${PORT}`);
  logger.info(`📝 API Version: ${config.api.version}`);
  logger.info(`🌍 Environment: ${config.server.env}`);
});

export default app;
