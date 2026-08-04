import { prisma } from '../lib/prisma.js';
import { sendMetaEvent } from '../lib/metaCapi.js';
import { sendGA4Event } from '../lib/ga4.js';

export const trackEvent = async (req, res) => {
  const { visitorId, eventName, eventParams, sourceApp } = req.body;

  if (!visitorId || !eventName || !sourceApp) {
    return res.status(400).json({ error: 'visitorId, eventName, and sourceApp are required' });
  }

  try {
    // 0. Ensure visitor exists to prevent foreign key constraint violations
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

    // 1. Insert into Event table
    await prisma.event.create({
      data: {
        visitorId,
        eventName,
        sourceApp,
        eventParams: eventParams || {},
      }
    });

    // Determine configurator based on sourceApp
    let configurator = null;
    if (sourceApp === 'gradcap_configurator') configurator = 'gradcap';
    if (sourceApp === 'studywear_configurator') configurator = 'studywear';

    // 2. Handle configurator_progress
    if (eventName === 'configurator_progress' && configurator && eventParams?.milestone) {
      // Map '25', '50' to enum
      let milestoneEnum = null;
      if (eventParams.milestone === 'started') milestoneEnum = 'started';
      if (eventParams.milestone === '25') milestoneEnum = 'm25';
      if (eventParams.milestone === '50') milestoneEnum = 'm50';
      if (eventParams.milestone === '75') milestoneEnum = 'm75';
      if (eventParams.milestone === '100') milestoneEnum = 'm100';

      if (milestoneEnum) {
        await prisma.configuratorProgress.upsert({
          where: {
            visitorId_configurator_milestone: {
              visitorId,
              configurator,
              milestone: milestoneEnum,
            }
          },
          update: { reachedAt: new Date() },
          create: {
            visitorId,
            configurator,
            milestone: milestoneEnum,
            reachedAt: new Date()
          }
        });
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
          packageType: eventParams?.package || null,
          orderRef: eventParams?.order_ref || null,
        }
      });

      // Fire and forget Meta CAPI + GA4
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      
      sendMetaEvent(eventName, visitorId, eventParams, clientIp, userAgent).catch(console.error);
      sendGA4Event(eventName, visitorId, eventParams).catch(console.error);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in /track:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
