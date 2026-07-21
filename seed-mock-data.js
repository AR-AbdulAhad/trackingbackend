import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const eduTypes = ['STX', 'HHX', 'HTX', 'HF'];
const packages = ['premium', 'standard'];
const products = ['graduation_cap', 'studywear', 'both'];
const apps = ['wordpress', 'gradcap_configurator', 'studywear_configurator'];
const configTypes = ['gradcap', 'studywear'];
const schools = [
  'Københavns åbne Gymnasium', 'Aarhus Katedralskole', 'Odense Katedralskole',
  'Aalborg Katedralskole', 'Roskilde Gymnasium', 'Nærum Gymnasium',
  'Silkeborg Gymnasium', 'Herning Gymnasium', 'Vejle Tekniske Gymnasium', 'Frederiksberg Gymnasium'
];

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function main() {
  console.log('Clearing old data (except admins)...');
  await prisma.audienceMembership.deleteMany();
  await prisma.order.deleteMany();
  await prisma.configuratorProgress.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.visitor.deleteMany();

  console.log('Generating realistic mock data...');
  const visitors = [];
  const now = new Date();
  const past30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < 1500; i++) {
    const firstVisit = randomDate(past30Days, now);
    const visitCount = Math.floor(Math.random() * 5) + 1;
    let lastVisit = firstVisit;
    if (visitCount > 1) {
      lastVisit = randomDate(firstVisit, now);
    }
    const isReturning = visitCount > 1;

    // Weights: Premium 65%, Standard 35%
    const pkg = Math.random() < 0.65 ? 'premium' : 'standard';
    
    // Weights: STX 50%, HHX 25%, HTX 15%, HF 10%
    const rEdu = Math.random();
    let edu = 'STX';
    if (rEdu > 0.5 && rEdu <= 0.75) edu = 'HHX';
    else if (rEdu > 0.75 && rEdu <= 0.90) edu = 'HTX';
    else if (rEdu > 0.90) edu = 'HF';

    visitors.push({
      visitorId: generateId(),
      educationType: edu,
      school: randItem(schools),
      graduationYear: 2026,
      packagePreference: pkg,
      productInterest: randItem(products),
      visitCount,
      firstVisitAt: firstVisit,
      lastVisitAt: lastVisit,
      isReturning,
      createdAt: firstVisit,
    });
  }

  await prisma.visitor.createMany({ data: visitors });
  const dbVisitors = await prisma.visitor.findMany();
  console.log(`Created ${dbVisitors.length} visitors.`);

  const orders = [];
  const progressData = [];
  const sessions = [];

  for (const v of dbVisitors) {
    const configurator = randItem(configTypes);
    
    // Create Session
    sessions.push({
      visitorId: v.visitorId,
      sourceApp: 'wordpress',
      startedAt: v.firstVisitAt,
      durationSeconds: Math.floor(Math.random() * 300) + 10,
    });

    const randProg = Math.random();
    const reachedAt = randomDate(v.firstVisitAt, v.lastVisitAt);
    
    progressData.push({ visitorId: v.visitorId, configurator, milestone: 'started', reachedAt });

    if (randProg > 0.2) {
      progressData.push({ visitorId: v.visitorId, configurator, milestone: 'm25', reachedAt: new Date(reachedAt.getTime() + 10000) });
      if (randProg > 0.4) {
        progressData.push({ visitorId: v.visitorId, configurator, milestone: 'm50', reachedAt: new Date(reachedAt.getTime() + 20000) });
        if (randProg > 0.6) {
          progressData.push({ visitorId: v.visitorId, configurator, milestone: 'm75', reachedAt: new Date(reachedAt.getTime() + 30000) });
          if (randProg > 0.75) {
            progressData.push({ visitorId: v.visitorId, configurator, milestone: 'm100', reachedAt: new Date(reachedAt.getTime() + 40000) });
            
            // Order
            const purchased = Math.random() > 0.3; // 70% of those who reach 100% purchase
            orders.push({
              visitorId: v.visitorId,
              configurator,
              status: purchased ? 'purchased' : 'abandoned',
              value: purchased ? (configurator === 'gradcap' ? 1200 : 800) : null,
              packageType: v.packagePreference,
              createdAt: new Date(reachedAt.getTime() + 50000)
            });
          }
        }
      }
    }
  }

  console.log('Inserting sessions...');
  await prisma.session.createMany({ data: sessions });
  
  console.log('Inserting progress...');
  await prisma.configuratorProgress.createMany({ data: progressData });
  
  console.log('Inserting orders...');
  await prisma.order.createMany({ data: orders });

  console.log('Seed complete!');
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
