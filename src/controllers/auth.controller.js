import { prisma } from '../lib/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, admin.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    // Removed profilePhoto from JWT payload to prevent 431 Request Header Fields Too Large
    const token = jwt.sign(
      { 
        id: Number(admin.id), 
        email: admin.email, 
        displayName: admin.displayName, 
        role: admin.role,
        pageAccess: admin.pageAccess
      },
      secret,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      admin: {
        id: Number(admin.id),
        email: admin.email,
        displayName: admin.displayName || 'Admin',
        profilePhoto: admin.profilePhoto,
        role: admin.role,
        pageAccess: admin.pageAccess
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const requireAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const decoded = jwt.verify(token, secret);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const getMe = async (req, res) => {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: BigInt(req.admin.id) } });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    res.json({
      id: Number(admin.id),
      email: admin.email,
      displayName: admin.displayName || 'Admin',
      profilePhoto: admin.profilePhoto,
      role: admin.role,
      pageAccess: admin.pageAccess
    });
  } catch (error) {
    console.error('getMe error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const updateProfile = async (req, res) => {
  const { displayName, profilePhoto, currentPassword, newPassword } = req.body;
  const adminId = BigInt(req.admin.id);

  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (profilePhoto !== undefined) updateData.profilePhoto = profilePhoto;

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      const isValid = await bcrypt.compare(currentPassword, admin.passwordHash);
      if (!isValid) return res.status(401).json({ error: 'Current password is incorrect' });
      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.adminUser.update({
      where: { id: adminId },
      data: updateData,
    });

    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const token = jwt.sign(
      { 
        id: Number(updated.id), 
        email: updated.email, 
        displayName: updated.displayName, 
        role: updated.role,
        pageAccess: updated.pageAccess
      },
      secret,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      admin: {
        id: Number(updated.id),
        email: updated.email,
        displayName: updated.displayName || 'Admin',
        profilePhoto: updated.profilePhoto,
        role: updated.role,
        pageAccess: updated.pageAccess
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
