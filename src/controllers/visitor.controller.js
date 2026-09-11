import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';
import { EDUCATION_TYPES, normalizeEducationType, PACKAGE_TYPES, normalizePackageType, DEFAULT_CONFIGURATOR_STEPS, normalizeStepName } from '../lib/constants.js';

// Helper: compute sha256 hash for email / phone
export const hashValue = (val) => {
  if (!val || typeof val !== 'string') return null;
  const clean = val.trim().toLowerCase();
  return crypto.createHash('sha256').update(clean).digest('hex');
};

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

export const processIdentifyVisitor = async (data = {}) => {
  const {
    visitorId,
    name: rawName,
    customerName,
    email: rawEmail,
    customerEmail,
    phone: rawPhone,
    customerPhone,
    fullPhone,
    emailHash: rawEmailHash,
    phoneHash: rawPhoneHash,
    educationType: rawEducationType,
    school: rawSchool,
    schoolName,
    Skolenavn,
    graduationYear,
    packagePreference: rawPackagePreference,
    package: rawPackage,
    packageName: rawPackageName,
    pakke: rawPakke,
    productInterest: rawProductInterest,
    newSession,
  } = data;

  if (!visitorId) {
    throw new Error('visitorId is required');
  }

  const name = (rawName || customerName || '').trim() || undefined;
  const email = (rawEmail || customerEmail || '').trim() || undefined;
  const phone = (rawPhone || customerPhone || fullPhone || '').trim() || undefined;
  const school = (rawSchool || schoolName || Skolenavn || '').trim() || undefined;

  const emailHash = rawEmailHash || (email ? hashValue(email) : undefined);
  const phoneHash = rawPhoneHash || (phone ? hashValue(phone) : undefined);

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

  const existingVisitor = await prisma.visitor.findUnique({
    where: { visitorId },
  });

  let isEffectivelyNew = false;

  if (!existingVisitor) {
    try {
      const newVisitor = await prisma.visitor.create({
        data: {
          visitorId,
          name: name !== undefined ? name : null,
          email: email !== undefined ? email : null,
          phone: phone !== undefined ? phone : null,
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

      io.emit('visitor:identified', sanitizeBigInt(newVisitor));

      return sanitizeBigInt(newVisitor);
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

  if (name !== undefined) updatedData.name = name;
  if (email !== undefined) updatedData.email = email;
  if (phone !== undefined) updatedData.phone = phone;
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

  io.emit('visitor:identified', sanitizeBigInt(visitor));

  return sanitizeBigInt(visitor);
};

export const identifyVisitor = async (req, res) => {
  try {
    const result = await processIdentifyVisitor(req.body);
    res.status(200).json(result);
  } catch (error) {
    if (error.message === 'visitorId is required') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error in /identify:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * processVisitorOrderData - Handles visitor order updates from Stripe webhooks & direct API calls
 * Payload: { visitorId, name, email, phone, schoolName, amount, purchaseDate, ... }
 */
export const processVisitorOrderData = async (data = {}) => {
  const {
    visitorId,
    name: rawName,
    customerName,
    email: rawEmail,
    customerEmail,
    phone: rawPhone,
    customerPhone,
    fullPhone,
    schoolName,
    school: rawSchool,
    Skolenavn,
    amount: rawAmount,
    totalAmount,
    totalPrice,
    finalPrice,
    value: rawValue,
    purchaseDate: rawPurchaseDate,
    orderDate,
    createdAt: rawCreatedAt,
    package: rawPackage,
    packageName: rawPackageName,
    packagePreference: rawPackagePreference,
    educationType: rawEducationType,
    program: rawProgram,
    orderRef: rawOrderRef,
    orderNumber,
    configurator: rawConfigurator,
    sourceApp: rawSourceApp,
    currency: rawCurrency,
  } = data;

  if (!visitorId || typeof visitorId !== 'string' || !visitorId.trim()) {
    throw new Error('visitorId is required');
  }

  const cleanVisitorId = visitorId.trim();
  const name = (rawName || customerName || '').trim() || undefined;
  const email = (rawEmail || customerEmail || '').trim() || undefined;
  const phone = (rawPhone || customerPhone || fullPhone || '').trim() || undefined;
  const school = (schoolName || rawSchool || Skolenavn || '').trim() || undefined;

  // Numerical amount parsing
  const rawNum = rawAmount ?? totalAmount ?? totalPrice ?? finalPrice ?? rawValue;
  const parsedAmount = rawNum !== undefined && rawNum !== null && rawNum !== '' ? Number(rawNum) : null;
  const amount = parsedAmount !== null && !isNaN(parsedAmount) ? parsedAmount : null;

  // Date parsing
  const dateVal = rawPurchaseDate || orderDate || rawCreatedAt;
  let purchaseDate = new Date();
  if (dateVal) {
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      purchaseDate = d;
    }
  }

  // Normalizations
  const packagePreference = normalizePackageType(rawPackagePreference ?? rawPackage ?? rawPackageName);
  const educationType = normalizeEducationType(rawEducationType ?? rawProgram);
  const orderRef = (rawOrderRef || orderNumber || `ORDER-${Date.now()}`).trim();
  const configurator = rawConfigurator || (rawSourceApp === 'studywear_configurator' ? 'studywear' : 'gradcap');
  const currency = (rawCurrency || 'DKK').toUpperCase();

  // SHA256 hashes
  const emailHash = email ? hashValue(email) : undefined;
  const phoneHash = phone ? hashValue(phone) : undefined;

  // 1. Find or create visitor
  let visitor = await prisma.visitor.findUnique({
    where: { visitorId: cleanVisitorId },
  });

  if (!visitor) {
    visitor = await prisma.visitor.create({
      data: {
        visitorId: cleanVisitorId,
        name: name || null,
        email: email || null,
        phone: phone || null,
        emailHash: emailHash || null,
        phoneHash: phoneHash || null,
        school: school || null,
        educationType: educationType || null,
        packagePreference: packagePreference || null,
        visitCount: 1,
        firstVisitAt: purchaseDate,
        lastVisitAt: new Date(),
        isReturning: false,
      }
    });
  } else {
    // Update existing visitor data
    const updatePayload = {
      lastVisitAt: new Date(),
    };
    if (name !== undefined) updatePayload.name = name;
    if (email !== undefined) updatePayload.email = email;
    if (phone !== undefined) updatePayload.phone = phone;
    if (emailHash !== undefined) updatePayload.emailHash = emailHash;
    if (phoneHash !== undefined) updatePayload.phoneHash = phoneHash;
    if (school !== undefined) updatePayload.school = school;
    if (educationType !== undefined) updatePayload.educationType = educationType;
    if (packagePreference !== undefined) updatePayload.packagePreference = packagePreference;

    visitor = await prisma.visitor.update({
      where: { visitorId: cleanVisitorId },
      data: updatePayload,
    });
  }

  // 2. Create Order in database
  const order = await prisma.order.create({
    data: {
      visitorId: cleanVisitorId,
      configurator,
      status: 'purchased',
      value: amount,
      currency,
      packageType: packagePreference || null,
      orderRef: orderRef || null,
      createdAt: purchaseDate,
    }
  });

  // 3. Upsert purchase_completed Event
  const stepEvent = await prisma.event.findUnique({
    where: {
      visitorId_eventName: { visitorId: cleanVisitorId, eventName: 'configurator_step_view' },
    },
  });

  const stepParams = stepEvent?.eventParams || {};
  const purchaseEventParams = {
    ...stepParams,
    value: amount,
    currency,
    package: packagePreference || rawPackage || rawPackageName,
    program: educationType || rawProgram,
    school: school || visitor.school,
    customer_name: name || visitor.name,
    customer_email: email || visitor.email,
    customer_phone: phone || visitor.phone,
    order_ref: orderRef,
    purchase_date: purchaseDate.toISOString(),
    checked_out: true,
    percentage: 100,
  };

  const sourceApp = configurator === 'studywear' ? 'studywear_configurator' : 'gradcap_configurator';

  await prisma.event.upsert({
    where: {
      visitorId_eventName: {
        visitorId: cleanVisitorId,
        eventName: 'purchase_completed',
      },
    },
    update: {
      sourceApp,
      eventParams: purchaseEventParams,
    },
    create: {
      visitorId: cleanVisitorId,
      eventName: 'purchase_completed',
      sourceApp,
      eventParams: purchaseEventParams,
    },
  });

  // 4. Milestone 100% completion in ConfiguratorProgress
  try {
    for (const milestone of ['started', 'm25', 'm50', 'm75', 'm100']) {
      await prisma.configuratorProgress.upsert({
        where: {
          visitorId_configurator_milestone: {
            visitorId: cleanVisitorId,
            configurator,
            milestone,
          }
        },
        update: {},
        create: {
          visitorId: cleanVisitorId,
          configurator,
          milestone,
          reachedAt: purchaseDate
        }
      });
    }
  } catch (progressErr) {
    console.warn('Progress milestone upsert warning:', progressErr.message);
  }

  // 5. Emit real-time dashboard updates via Socket.IO
  try {
    io.emit('visitor:identified', sanitizeBigInt(visitor));
    io.emit('event:tracked', {
      visitorId: cleanVisitorId,
      eventName: 'purchase_completed',
      eventParams: purchaseEventParams,
      sourceApp,
      timestamp: new Date().toISOString(),
    });
    io.emit('notification', {
      type: 'new_conversion',
      message: `Order completed for ${name || visitor.name || cleanVisitorId}${amount ? ` (${amount} ${currency})` : ''}${school || visitor.school ? ` - ${school || visitor.school}` : ''}`,
      visitorId: cleanVisitorId,
      timestamp: new Date().toISOString(),
    });
  } catch (socketErr) {
    console.warn('Socket emit warning:', socketErr.message);
  }

  return {
    success: true,
    message: 'Visitor order data processed successfully',
    visitor: sanitizeBigInt(visitor),
    order: sanitizeBigInt(order),
  };
};

export const updateVisitorOrderData = async (req, res) => {
  try {
    const result = await processVisitorOrderData(req.body);
    res.status(200).json(result);
  } catch (error) {
    if (error.message === 'visitorId is required') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error in /order-data:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
};

export const getVisitorOrderData = updateVisitorOrderData;

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
      const rawVisited = Array.isArray(p.visited_steps) 
        ? p.visited_steps 
        : (p.step_name ? [p.step_name] : []);
      const visitedSteps = Array.from(new Set(rawVisited.map(normalizeStepName).filter(Boolean)));

      const allSteps = Array.isArray(p.all_steps) && p.all_steps.length > 0
        ? Array.from(new Set(p.all_steps.map(normalizeStepName).filter(Boolean)))
        : DEFAULT_CONFIGURATOR_STEPS;

      const totalSteps = Number(p.total_steps) || allSteps.length;

      const visitedNorm = new Set(visitedSteps.map(normalizeStepName));
      const skippedSteps = allSteps.filter((s) => !visitedNorm.has(normalizeStepName(s)));

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
