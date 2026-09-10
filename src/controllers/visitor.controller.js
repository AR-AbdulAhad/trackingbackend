import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';
import { EDUCATION_TYPES, normalizeEducationType, PACKAGE_TYPES, normalizePackageType, DEFAULT_CONFIGURATOR_STEPS } from '../lib/constants.js';

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

export { EDUCATION_TYPES, normalizeEducationType, PACKAGE_TYPES, normalizePackageType };

export const identifyVisitor = async (req, res) => {
  const {
    visitorId,
    emailHash,
    phoneHash,
    educationType: rawEducationType,
    school,
    graduationYear,
    packagePreference: rawPackagePreference,
    package: rawPackage,
    packageName: rawPackageName,
    pakke: rawPakke,
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

  // Normalize packagePreference ('premium' | 'luksus' | 'standard' | 'basic')
  let packagePreference = undefined;
  const rawPkgVal = rawPackagePreference ?? rawPackage ?? rawPackageName ?? rawPakke;
  if (rawPkgVal !== undefined) {
    packagePreference = normalizePackageType(rawPkgVal);
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

// Defined order for configurator events
const EVENT_ORDER = [
  'configurator_started',
  'configurator_step_view',
  'configurator_progress',
  'configurator_completed',
  'configurator_abandoned',
];

export const getVisitor = async (req, res) => {
  try {
    const visitorId = req.params.visitorId;
    const visitor = await prisma.visitor.findUnique({
      where: { visitorId },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
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

    const sanitized = sanitizeBigInt(visitor);

    // --- Build ordered events object ---
    // Map raw events by eventName first
    const rawEventsMap = {};
    if (Array.isArray(sanitized.events)) {
      sanitized.events.forEach((ev) => {
        rawEventsMap[ev.eventName] = ev;
      });
    }

    // Build ordered object: known events first in defined order, then any extras
    const orderedEvents = {};
    EVENT_ORDER.forEach((name) => {
      if (rawEventsMap[name]) orderedEvents[name] = rawEventsMap[name];
    });
    // Append any event types not in EVENT_ORDER
    Object.keys(rawEventsMap).forEach((name) => {
      if (!orderedEvents[name]) orderedEvents[name] = rawEventsMap[name];
    });

    // --- Compute stepTracking & missedSteps from step views / checkout events ---
    const stepViewEvent = rawEventsMap['configurator_step_view'];
    const completedEvent = rawEventsMap['configurator_completed'];
    const checkoutEvent = rawEventsMap['checkout_started'] || rawEventsMap['purchase_completed'] || rawEventsMap['add_to_cart'];
    const hasCheckedOut = Boolean(checkoutEvent || (Array.isArray(sanitized.orders) && sanitized.orders.length > 0));

    // Choose primary source for step params
    const primaryParams = stepViewEvent?.eventParams || completedEvent?.eventParams || checkoutEvent?.eventParams || null;

    let stepTracking = null;
    let missedSteps = null;

    if (primaryParams) {
      const p = primaryParams;
      const visitedSteps = Array.isArray(p.visited_steps) 
        ? p.visited_steps 
        : (p.step_name ? [p.step_name] : []);

      const totalSteps = Number(p.total_steps) || DEFAULT_CONFIGURATOR_STEPS.length;

      const allSteps = Array.isArray(p.all_steps) && p.all_steps.length > 0
        ? p.all_steps
        : DEFAULT_CONFIGURATOR_STEPS;

      const visitedUpper = new Set(visitedSteps.map((s) => String(s).trim().toUpperCase()));
      const skippedSteps = allSteps.filter((s) => !visitedUpper.has(String(s).trim().toUpperCase()));

      // 11% per visited page (e.g. 1 page = 11%, 2 pages = 22%, 9 pages = 100%)
      const percentage = p.percentage !== undefined
        ? Number(p.percentage)
        : Math.min(100, Math.round((visitedSteps.length / totalSteps) * 100));

      stepTracking = {
        totalSteps,
        percentage,
        visitedCount: visitedSteps.length,
        skippedCount: skippedSteps.length,
        visitedSteps,
        skippedSteps,
        checkedOut: hasCheckedOut,
        completed: Boolean(completedEvent),
        lastStepVisited: p.step_name || (visitedSteps.length > 0 ? visitedSteps[visitedSteps.length - 1] : null),
      };

      missedSteps = {
        count: skippedSteps.length,
        steps: skippedSteps,
        visitedSteps,
        totalSteps,
        percentage,
        checkedOut: hasCheckedOut,
      };
    }

    // Remove raw skipped_steps from eventParams to avoid inconsistency (stepTracking is single source of truth)
    Object.values(orderedEvents).forEach((ev) => {
      if (ev?.eventParams?.skipped_steps !== undefined) {
        delete ev.eventParams.skipped_steps;
      }
    });

    const result = {
      ...sanitized,
      events: orderedEvents,
      stepTracking,
      missedSteps,
    };

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in GET /:visitorId:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
