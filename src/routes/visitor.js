import { Router } from 'express';
import { identifyVisitor, getVisitor } from '../controllers/visitor.controller.js';

const router = Router();

router.post('/identify', identifyVisitor);
router.get('/:visitorId', getVisitor);

export default router;
