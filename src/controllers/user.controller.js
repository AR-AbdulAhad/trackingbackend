import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';

// GET /api/users
export const listUsers = async (req, res) => {
  try {
    const users = await prisma.adminUser.findMany({
      select: { id: true, email: true, displayName: true, profilePhoto: true, role: true, pageAccess: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users.map(u => ({ ...u, id: Number(u.id) })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to list users' });
  }
};

// POST /api/users
export const createUser = async (req, res) => {
  const { email, password, displayName, role = 'VIEWER', pageAccess = [] } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const validRoles = ['SUPERADMIN', 'ADMIN', 'VIEWER'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'User with this email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.adminUser.create({
      data: { email, passwordHash, displayName, role, pageAccess },
      select: { id: true, email: true, displayName: true, profilePhoto: true, role: true, pageAccess: true, createdAt: true },
    });
    res.status(201).json({ ...user, id: Number(user.id) });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// PUT /api/users/:id/access (was role)
export const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role, pageAccess } = req.body;

  if (role) {
    const validRoles = ['SUPERADMIN', 'ADMIN', 'VIEWER'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  }

  if (Number(id) === req.admin.id && role && role !== req.admin.role) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  try {
    const data = {};
    if (role) data.role = role;
    if (pageAccess !== undefined) data.pageAccess = pageAccess;

    const updated = await prisma.adminUser.update({
      where: { id: BigInt(id) },
      data,
      select: { id: true, email: true, displayName: true, role: true, pageAccess: true },
    });
    res.json({ ...updated, id: Number(updated.id) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user access' });
  }
};

// DELETE /api/users/:id
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.admin.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    await prisma.adminUser.delete({ where: { id: BigInt(id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
};
