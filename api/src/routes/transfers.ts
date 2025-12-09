import { Router } from 'express';
import { requirePermission } from '../middleware/auth';
import * as transfersController from '../controllers/transfersController';

const router = Router();

// POST /v1/transfers/initiate
router.post(
  '/initiate',
  requirePermission('transfers:initiate'),
  transfersController.initiateTransfer
);

// GET /v1/transfers/:id/status
router.get('/:id/status', transfersController.getTransferStatus);

// POST /v1/transfers/:id/approve
router.post(
  '/:id/approve',
  requirePermission('transfers:approve'),
  transfersController.approveTransfer
);

export default router;
