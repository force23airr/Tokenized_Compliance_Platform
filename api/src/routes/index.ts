import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import tokensRouter from './tokens';
import investorsRouter from './investors';
import transfersRouter from './transfers';
import sandboxRouter from './sandbox';
import complianceRouter from './compliance';

const router = Router();

// Apply rate limiting and authentication to all routes
router.use(apiLimiter);
router.use(authenticate);

// Mount route modules
router.use('/tokens', tokensRouter);
router.use('/investors', investorsRouter);
router.use('/transfers', transfersRouter);
router.use('/sandbox', sandboxRouter);
router.use('/compliance', complianceRouter);

export default router;
