import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';
import { sendMetaEvent } from '../lib/metaCapi.js';
import { sendGA4Event } from '../lib/ga4.js';
import { normalizePackageType, normalizeEducationType, DEFAULT_CONFIGURATOR_STEPS, normalizeStepName } from '../lib/constants.js';

export const processTrackEvent = async (data = {}, context = {}) => {
  const { visitorId, eventName, eventParams, sourceApp } = data;

  if (!visitorId || !eventName || !sourceApp) {
    throw new Error('visitorId, eventName, and sourceApp are required');
  }

  // 0. Ensure visitor exists to prevent foreign key constraint violations
  try {
    await prisma.visitor.upsert({
      where: { visitorId },
      update: {},
      create: {
        visitorId,
        visitCount: 1,
        firstVisitAt: new Date(),
        lastVisitAt: new Date(),
        isReturning: false,
      }
    });
  } catch (upsertError) {
    if (upsertError.code !== 'P2002') {
      throw upsertError;
    }
  }

  // Prepare enriched event parameters
  let finalEventParams = eventParams || {};

  // Accurately accumulate visited pages and compute skipped pages + percentage
  if (eventName === 'configurator_step_view') {
    const existingStepEvent = await prisma.event.findUnique({
      where: {
        visitorId_eventName: { visitorId, eventName: 'configurator_step_view' },
      },
    });

    const oldParams = existingStepEvent?.eventParams || {};
    const oldVisited = Array.isArray(oldParams.visited_steps) ? oldParams.visited_steps : [];
    const newVisited = Array.isArray(eventParams?.visited_steps) ? eventParams.visited_steps : [];
    const currentStep = eventParams?.step_name ? [eventParams.step_name] : [];

    // Merge visited steps while preserving visit order and uniqueness
    const mergedVisited = [];
    const seen = new Set();
    [...oldVisited, ...newVisited, ...currentStep].forEach((step) => {
      if (!step) return;
      const normalized = normalizeStepName(step);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        mergedVisited.push(normalized);
      }
    });

    const allSteps = Array.isArray(eventParams?.all_steps) && eventParams.all_steps.length > 0
      ? eventParams.all_steps.map(normalizeStepName)
      : DEFAULT_CONFIGURATOR_STEPS;

    const totalSteps = Number(eventParams?.total_steps || oldParams.total_steps || allSteps.length);

    // Skipped steps = all steps that user has not visited yet
    const skipped = allSteps.filter((s) => !seen.has(normalizeStepName(s)));

    // 11% per page visited (1 page = 11%, 2 pages = 22%, 9 pages = 100%)
    const calculatedPct = Math.min(100, Math.round((mergedVisited.length / totalSteps) * 100));

    // Strip frontend-only percentage fields — backend is single source of truth
    const { step_percentage: _sp, activity_percentage: _ap, skipped_steps: _ss, ...cleanEventParams } = eventParams || {};

    finalEventParams = {
      ...oldParams,
      ...cleanEventParams,
      visited_steps: mergedVisited,
      skipped_steps: skipped,
      visited_count: mergedVisited.length,
      skipped_count: skipped.length,
      total_steps: totalSteps,
      percentage: calculatedPct,
      all_steps: allSteps,
    };
  } else if (['configurator_completed', 'checkout_started', 'purchase_completed', 'add_to_cart'].includes(eventName)) {
    // Carry forward visited/skipped step breakdown to checkout & order events
    const stepEvent = await prisma.event.findUnique({
      where: {
        visitorId_eventName: { visitorId, eventName: 'configurator_step_view' },
      },
    });
    if (stepEvent?.eventParams) {
      const sp = stepEvent.eventParams;
      finalEventParams = {
        visited_steps: sp.visited_steps || [],
        skipped_steps: sp.skipped_steps || [],
        visited_count: sp.visited_count || 0,
        skipped_count: sp.skipped_count || 0,
        percentage: sp.percentage || 0,
        total_steps: sp.total_steps || 9,
        ...finalEventParams,
        checked_out: true,
      };
    }
  }

  // 1. Upsert into Event table (one event object per eventName, updated continuously)
  await prisma.event.upsert({
    where: {
      visitorId_eventName: {
        visitorId,
        eventName,
      },
    },
    update: {
      sourceApp,
      eventParams: finalEventParams,
    },
    create: {
      visitorId,
      eventName,
      sourceApp,
      eventParams: finalEventParams,
    },
  });

  // Sync visitor attributes if provided in eventParams
  const pkg = normalizePackageType(eventParams?.package || eventParams?.packageType || eventParams?.packageName || eventParams?.pakke);
  const edu = normalizeEducationType(eventParams?.educationType || eventParams?.program);
  if (pkg || edu) {
    const visitorUpdate = {};
    if (pkg) visitorUpdate.packagePreference = pkg;
    if (edu) visitorUpdate.educationType = edu;
    await prisma.visitor.update({
      where: { visitorId },
      data: visitorUpdate
    }).catch(() => {});
  }

  // Determine configurator based on sourceApp
  let configurator = null;
  if (sourceApp === 'gradcap_configurator') configurator = 'gradcap';
  if (sourceApp === 'studywear_configurator') configurator = 'studywear';

  // 2. Handle configurator progress / start / step views / completion
  const progressEvents = ['configurator_started', 'configurator_progress', 'configurator_step_view', 'configurator_completed'];
  if (configurator && progressEvents.includes(eventName)) {
    const milestonesToUpsert = new Set();
    milestonesToUpsert.add('started');

    let pct = 0;
    if (eventName === 'configurator_completed') {
      pct = 100;
    } else if (eventName === 'configurator_progress') {
      const m = String(eventParams?.milestone || eventParams?.step || eventParams?.progress || '').toLowerCase();
      if (m === '25' || m === 'm25') pct = 25;
      else if (m === '50' || m === 'm50') pct = 50;
      else if (m === '75' || m === 'm75') pct = 75;
      else if (m === '100' || m === 'm100') pct = 100;
      else if (eventParams?.percentage) pct = Number(eventParams.percentage);
    } else if (eventName === 'configurator_step_view') {
      pct = finalEventParams?.percentage || 0;
    }

    if (pct >= 25) milestonesToUpsert.add('m25');
    if (pct >= 50) milestonesToUpsert.add('m50');
    if (pct >= 75) milestonesToUpsert.add('m75');
    if (pct >= 95) milestonesToUpsert.add('m100');

    for (const milestone of milestonesToUpsert) {
      await prisma.configuratorProgress.upsert({
        where: {
          visitorId_configurator_milestone: {
            visitorId,
            configurator,
            milestone,
          }
        },
        update: {},
        create: {
          visitorId,
          configurator,
          milestone,
          reachedAt: new Date()
        }
      }).catch(() => {});
    }
  }

  // 3. Handle commerce events (add_to_cart, checkout_started, purchase_completed)
  const commerceEvents = ['add_to_cart', 'checkout_started', 'purchase_completed'];
  if (commerceEvents.includes(eventName) && configurator) {
    const statusMap = {
      'add_to_cart': 'cart',
      'checkout_started': 'checkout_started',
      'purchase_completed': 'purchased'
    };

    await prisma.order.create({
      data: {
        visitorId,
        configurator,
        status: statusMap[eventName],
        value: eventParams?.value || null,
        currency: eventParams?.currency || 'DKK',
        packageType: normalizePackageType(eventParams?.package || eventParams?.packageType || eventParams?.packageName || eventParams?.pakke),
        orderRef: eventParams?.order_ref || null,
      }
    });

    // Fire and forget Meta CAPI + GA4
    const clientIp = context.clientIp;
    const userAgent = context.userAgent;
    
    sendMetaEvent(eventName, visitorId, eventParams, clientIp, userAgent).catch(console.error);
    sendGA4Event(eventName, visitorId, eventParams).catch(console.error);
  }

  // Emit real-time socket events to connected dashboard clients
  try {
    io.emit('event:tracked', {
      visitorId,
      eventName,
      eventParams: finalEventParams,
      sourceApp,
      timestamp: new Date().toISOString(),
    });

    if (eventName === 'purchase_completed') {
      io.emit('notification', {
        type: 'new_conversion',
        message: `Order completed for ${eventParams?.package || 'cap'} (${eventParams?.value || ''} DKK)`,
        visitorId,
        timestamp: new Date().toISOString(),
      });
    } else if (eventName === 'configurator_started') {
      io.emit('notification', {
        type: 'configurator_started',
        message: `Visitor started configurator (${sourceApp})`,
        visitorId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (emitErr) {
    console.warn('Failed to emit real-time event on io:', emitErr.message);
  }

  return { success: true, finalEventParams };
};

export const trackEvent = async (req, res) => {
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await processTrackEvent(req.body, { clientIp, userAgent });
    res.status(200).json(result);
  } catch (error) {
    if (error.message?.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error in /track:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
