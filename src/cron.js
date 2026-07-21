import cron from 'node-cron';
import { prisma } from './lib/prisma.js';

// Hourly: audience segmentation job
cron.schedule('0 * * * *', async () => {
  console.log('Running audience segmentation cron job');
  try {
    const visitors = await prisma.visitor.findMany({
      where: {
        OR: [
          { educationType: { not: null } },
          { packagePreference: { not: null } },
          { productInterest: { not: null } }
        ]
      }
    });

    for (const v of visitors) {
      if (v.educationType) {
        await upsertAudience(v.visitorId, `education_${v.educationType}`);
      }
      if (v.packagePreference) {
        await upsertAudience(v.visitorId, `package_${v.packagePreference}`);
      }
      if (v.productInterest) {
        await upsertAudience(v.visitorId, `interest_${v.productInterest}`);
      }
    }
  } catch (error) {
    console.error('Error in audience segmentation cron:', error);
  }
});

async function upsertAudience(visitorId, audienceName) {
  await prisma.audienceMembership.upsert({
    where: {
      visitorId_audienceName: {
        visitorId,
        audienceName
      }
    },
    update: {},
    create: {
      visitorId,
      audienceName
    }
  });
}

// Daily: mark Order rows with status = 'cart' or 'checkout_started' older than 24h as 'abandoned'
cron.schedule('0 0 * * *', async () => {
  console.log('Running order abandonment cron job');
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    await prisma.order.updateMany({
      where: {
        status: { in: ['cart', 'checkout_started'] },
        updatedAt: { lt: twentyFourHoursAgo }
      },
      data: {
        status: 'abandoned'
      }
    });
  } catch (error) {
    console.error('Error in order abandonment cron:', error);
  }
});
