import { Router } from 'express';
import { requirePermission } from '../middleware/auth';
import * as investorsController from '../controllers/investorsController';

const router = Router();

// POST /v1/investors/verify
router.post(
  '/verify',
  requirePermission('investors:verify'),
  investorsController.verifyInvestor
);

// POST /v1/investors/whitelist
router.post(
  '/whitelist',
  requirePermission('investors:whitelist'),
  investorsController.addToWhitelist
);

// DELETE /v1/investors/:id/whitelist
router.delete(
  '/:id/whitelist',
  requirePermission('investors:whitelist'),
  investorsController.removeFromWhitelist
);

// GET /v1/investors/:id
router.get('/:id', investorsController.getInvestor);

export default router;
