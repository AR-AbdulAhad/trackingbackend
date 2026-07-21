import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';

// Helper: recursively convert all BigInt values to Number
const sanitizeBigInt = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj; // Preserve Date objects
  if (Array.isArray(obj)) return obj.map(sanitizeBigInt);
  if (typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeBigInt(v);
    }
    return result;
  }
  return obj;
};

export const identifyVisitor = async (req, res) => {
  const { visitorId, emailHash, phoneHash, educationType, school, graduationYear, packagePreference, productInterest, newSession } = req.body;

  if (!visitorId) {
    return res.status(400).json({ error: 'visitorId is required' });
  }

  try {
    const existingVisitor = await prisma.visitor.findUnique({
      where: { visitorId },
    });

    if (!existingVisitor) {
      const newVisitor = await prisma.visitor.create({
        data: {
          visitorId,
          emailHash,
          phoneHash,
          educationType,
          school,
          graduationYear,
          packagePreference,
          productInterest,
          visitCount: 1,
          firstVisitAt: new Date(),
          lastVisitAt: new Date(),
          isReturning: false,
        },
      });

      // Emit real-time notification
      io.emit('notification', {
        type: 'new_visitor',
        message: `New visitor from ${school || 'unknown school'}${educationType ? ` (${educationType})` : ''}`,
        visitorId,
        timestamp: new Date().toISOString(),
      });

      return res.status(200).json(sanitizeBigInt(newVisitor));
    }

    // Update existing visitor
    const updatedData = {
      lastVisitAt: new Date(),
      isReturning: true,
    };

    if (emailHash !== undefined) updatedData.emailHash = emailHash;
    if (phoneHash !== undefined) updatedData.phoneHash = phoneHash;
    if (educationType !== undefined) updatedData.educationType = educationType;
    if (school !== undefined) updatedData.school = school;
    if (graduationYear !== undefined) updatedData.graduationYear = graduationYear;
    if (packagePreference !== undefined) updatedData.packagePreference = packagePreference;
    if (productInterest !== undefined) updatedData.productInterest = productInterest;

    if (newSession) {
      updatedData.visitCount = { increment: 1 };
    }

    const visitor = await prisma.visitor.update({
      where: { visitorId },
      data: updatedData,
    });

    res.status(200).json(sanitizeBigInt(visitor));
  } catch (error) {
    console.error('Error in /identify:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getVisitor = async (req, res) => {
  try {
    const visitorId = req.params.visitorId;
    const visitor = await prisma.visitor.findUnique({
      where: { visitorId },
      include: {
        events: { orderBy: { createdAt: 'desc' }, take: 50 },
        sessions: { orderBy: { startedAt: 'desc' } },
        orders: { orderBy: { createdAt: 'desc' } },
        progress: { orderBy: { reachedAt: 'asc' } },
        recordings: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, duration: true, pageUrl: true, createdAt: true },
        },
      }
    });

    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found' });
    }

    res.status(200).json(sanitizeBigInt(visitor));
  } catch (error) {
    console.error('Error in GET /:visitorId:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
