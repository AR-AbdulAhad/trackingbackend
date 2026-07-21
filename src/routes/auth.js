import { Router } from 'express';
import { login, updateProfile, requireAdmin, getMe } from '../controllers/auth.controller.js';

const router = Router();

router.post('/login', login);
router.get('/me', requireAdmin, getMe);
router.put('/profile', requireAdmin, updateProfile);

export default router;
