import { Router } from 'express';
import {
  getStatus,
  getRealtime,
  getSummary,
  getAuthUrlController,
  oauthCallback,
  disconnectGAController,
} from '../controllers/ga.controller.js';

const router = Router();

router.get('/status', getStatus);
router.get('/auth-url', getAuthUrlController);
router.get('/callback', oauthCallback);
router.post('/disconnect', disconnectGAController);
router.get('/realtime', getRealtime);
router.get('/summary', getSummary);

export default router;
