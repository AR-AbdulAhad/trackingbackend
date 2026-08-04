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

    let isEffectivelyNew = false;

    if (!existingVisitor) {
      try {
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
      } catch (e) {
        if (e.code === 'P2002') {
          // Concurrently created by another request. Fall through to update.
          isEffectivelyNew = true;
        } else {
          throw e;
        }
      }
    } else {
      // If it exists but was lazily created by an event moments ago
      const ageMs = new Date().getTime() - existingVisitor.createdAt.getTime();
      if (ageMs < 60000 && existingVisitor.isReturning === false && existingVisitor.visitCount === 1) {
        isEffectivelyNew = true;
      }
    }

    // Update existing visitor
    const updatedData = {
      lastVisitAt: new Date(),
    };

    if (emailHash !== undefined) updatedData.emailHash = emailHash;
    if (phoneHash !== undefined) updatedData.phoneHash = phoneHash;
    if (educationType !== undefined) updatedData.educationType = educationType;
    if (school !== undefined) updatedData.school = school;
    if (graduationYear !== undefined) updatedData.graduationYear = graduationYear;
    if (packagePreference !== undefined) updatedData.packagePreference = packagePreference;
    if (productInterest !== undefined) updatedData.productInterest = productInterest;

    if (newSession && !isEffectivelyNew) {
      updatedData.visitCount = { increment: 1 };
    }

    if (!isEffectivelyNew) {
      updatedData.isReturning = true;
    }

    const visitor = await prisma.visitor.update({
      where: { visitorId },
      data: updatedData,
    });

    if (isEffectivelyNew) {
      io.emit('notification', {
        type: 'new_visitor',
        message: `New visitor from ${visitor.school || 'unknown school'}${visitor.educationType ? ` (${visitor.educationType})` : ''}`,
        visitorId,
        timestamp: new Date().toISOString(),
      });
    }

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
