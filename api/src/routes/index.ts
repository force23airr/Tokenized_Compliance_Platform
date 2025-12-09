import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimit';
import tokensRouter from './tokens';
import investorsRouter from './investors';
import transfersRouter from './transfers';

const router = Router();

// Apply rate limiting and authentication to all routes
router.use(apiLimiter);
router.use(authenticate);

// Mount route modules
router.use('/tokens', tokensRouter);
router.use('/investors', investorsRouter);
router.use('/transfers', transfersRouter);

export default router;
