import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';
import { EDUCATION_TYPES, normalizeEducationType } from '../lib/constants.js';

// Helper: recursively convert all BigInt values to Number
const sanitizeBigInt = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj;
  if (obj && typeof obj.toNumber === 'function') return obj.toNumber();
  if (Array.isArray(obj)) return obj.map(sanitizeBigInt);
  if (typeof obj === 'object') {
    if ('s' in obj && 'e' in obj && 'd' in obj && Array.isArray(obj.d)) {
      const numStr = obj.d.join('');
      return Number(obj.s * Number(numStr) * Math.pow(10, obj.e - numStr.length + 1));
    }
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeBigInt(v);
    }
    return result;
  }
  return obj;
};

export { EDUCATION_TYPES, normalizeEducationType };

export const identifyVisitor = async (req, res) => {
  const {
    visitorId,
    emailHash,
    phoneHash,
    educationType: rawEducationType,
    school,
    graduationYear,
    packagePreference: rawPackagePreference,
    productInterest: rawProductInterest,
    newSession,
  } = req.body;

  if (!visitorId) {
    return res.status(400).json({ error: 'visitorId is required' });
  }

  // Normalize educationType
  let educationType = undefined;
  if (rawEducationType !== undefined) {
    educationType = normalizeEducationType(rawEducationType);
  }

  // Normalize graduationYear
  let parsedGradYear = undefined;
  if (graduationYear !== undefined) {
    parsedGradYear = graduationYear ? parseInt(graduationYear, 10) : null;
    if (isNaN(parsedGradYear)) parsedGradYear = null;
  }

  // Normalize packagePreference ('premium' | 'standard')
  let packagePreference = undefined;
  if (rawPackagePreference !== undefined) {
    if (typeof rawPackagePreference === 'string' && rawPackagePreference.trim()) {
      const lower = rawPackagePreference.trim().toLowerCase();
      packagePreference = ['premium', 'standard'].includes(lower) ? lower : null;
    } else {
      packagePreference = null;
    }
  }

  // Normalize productInterest ('graduation_cap' | 'studywear' | 'both')
  let productInterest = undefined;
  if (rawProductInterest !== undefined) {
    if (typeof rawProductInterest === 'string' && rawProductInterest.trim()) {
      let cleanProd = rawProductInterest.trim().toLowerCase().replace(/[-\s]+/g, '_');
      if (cleanProd === 'gradcap' || cleanProd === 'cap') cleanProd = 'graduation_cap';
      productInterest = ['graduation_cap', 'studywear', 'both'].includes(cleanProd) ? cleanProd : null;
    } else {
      productInterest = null;
    }
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
            emailHash: emailHash !== undefined ? emailHash : null,
            phoneHash: phoneHash !== undefined ? phoneHash : null,
            educationType: educationType !== undefined ? educationType : null,
            school: school !== undefined ? school : null,
            graduationYear: parsedGradYear !== undefined ? parsedGradYear : null,
            packagePreference: packagePreference !== undefined ? packagePreference : null,
            productInterest: productInterest !== undefined ? productInterest : null,
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
    if (parsedGradYear !== undefined) updatedData.graduationYear = parsedGradYear;
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
