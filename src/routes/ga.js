import { Router } from 'express';
import {
  getStatus,
  getRealtime,
  getSummary,
  getReport,
  getAuthUrlController,
  connectGoogle,
  oauthCallback,
  disconnectGAController,
} from '../controllers/ga.controller.js';

const router = Router();

router.get('/status', getStatus);
router.get('/auth-url', getAuthUrlController);
router.get('/connect', connectGoogle);
router.get('/callback', oauthCallback);
router.post('/disconnect', disconnectGAController);
router.get('/realtime', getRealtime);
router.get('/summary', getSummary);
router.get('/report', getReport);

export default router;
