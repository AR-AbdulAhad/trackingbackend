import { Router } from 'express';
import { requireAdmin } from '../controllers/auth.controller.js';
import {
  createRecording,
  getRecordingsByVisitor,
  getRecordingEvents,
} from '../controllers/recordings.controller.js';

const router = Router();

// Public endpoint — configurators post recordings without auth
router.post('/', createRecording);

// Protected endpoints — dashboard reads recordings
router.get('/visitor/:visitorId', requireAdmin, getRecordingsByVisitor);
router.get('/play/:id', requireAdmin, getRecordingEvents);

export default router;
