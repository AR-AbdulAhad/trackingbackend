import { Router } from 'express';
import { identifyVisitor, getVisitor, updateVisitorOrderData, getVisitorOrderData } from '../controllers/visitor.controller.js';

const router = Router();

router.post('/identify', identifyVisitor);
router.post('/order-data', updateVisitorOrderData);
router.post('/order', updateVisitorOrderData);
router.post('/getVisitorOrderData', getVisitorOrderData);
router.put('/order-data', updateVisitorOrderData);
router.get('/:visitorId', getVisitor);
    
export default router;
