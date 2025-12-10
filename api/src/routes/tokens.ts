import { Router } from 'express';
import { requirePermission } from '../middleware/auth';
import * as tokensController from '../controllers/tokensController';

const router = Router();

// POST /v1/tokens/create
router.post(
  '/create',
  requirePermission('tokens:create'),
  tokensController.createToken
);

// GET /v1/tokens/:id
router.get('/:id', tokensController.getToken);

// POST /v1/tokens/:id/mint
router.post(
  '/:id/mint',
  requirePermission('tokens:mint'),
  tokensController.mintTokens
);

// POST /v1/tokens/:id/burn
router.post(
  '/:id/burn',
  requirePermission('tokens:burn'),
  tokensController.burnTokens
);

// POST /v1/tokens/:id/distribute
router.post(
  '/:id/distribute',
  requirePermission('tokens:distribute'),
  tokensController.distributeYield
);

// GET /v1/tokens/:id/holders
router.get('/:id/holders', tokensController.getTokenHolders);

// GET /v1/tokens/:id/compliance-audit - Full compliance audit trail
router.get('/:id/compliance-audit', tokensController.getTokenComplianceAudit);

export default router;
