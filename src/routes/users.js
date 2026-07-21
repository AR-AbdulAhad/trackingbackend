import { Router } from 'express';
import { listUsers, createUser, updateUserRole, deleteUser } from '../controllers/user.controller.js';
import { requireAdmin } from '../controllers/auth.controller.js';

const router = Router();

router.use(requireAdmin); // All user mgmt routes require auth

router.get('/', listUsers);
router.post('/', createUser);
router.put('/:id/role', updateUserRole);    // legacy
router.put('/:id/access', updateUserRole);  // new — role + pageAccess
router.delete('/:id', deleteUser);

export default router;
