import { prisma } from '../lib/prisma.js';
import { io } from '../index.js';

// Helper for date filtering
const getDateFilter = (from, to) => {
  if (!from && !to) return {};
  const filter = {};
  if (from) filter.gte = new Date(from);
  if (to) filter.lte = new Date(to);
  return filter;
};

export const getAudienceOverview = async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = getDateFilter(from, to);

    const visitors = await prisma.visitor.findMany({
      where: Object.keys(dateFilter).length > 0 ? { firstVisitAt: dateFilter } : {}
    });

    const byEducation = {};
    const bySchool = {};
    const byGradYear = {};
    const byPackage = {};

    visitors.forEach(v => {
      if (v.educationType) byEducation[v.educationType] = (byEducation[v.educationType] || 0) + 1;
      if (v.school) bySchool[v.school] = (bySchool[v.school] || 0) + 1;
      if (v.graduationYear) byGradYear[v.graduationYear] = (byGradYear[v.graduationYear] || 0) + 1;
      if (v.packagePreference) byPackage[v.packagePreference] = (byPackage[v.packagePreference] || 0) + 1;
    });

    res.json({ byEducation, bySchool, byGradYear, byPackage });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getConfiguratorFunnel = async (req, res) => {
  try {
    const { configurator, from, to } = req.query;
    if (!configurator || (configurator !== 'gradcap' && configurator !== 'studywear')) {
      return res.status(400).json({ error: 'Valid configurator param required' });
    }

    const dateFilter = getDateFilter(from, to);
    const whereClause = { configurator };
    if (Object.keys(dateFilter).length > 0) whereClause.reachedAt = dateFilter;

    const progress = await prisma.configuratorProgress.findMany({ where: whereClause });

    const funnel = { started: 0, m25: 0, m50: 0, m75: 0, m100: 0, purchased: 0 };
    progress.forEach(p => {
      if (funnel[p.milestone] !== undefined) funnel[p.milestone]++;
    });

    const orders = await prisma.order.count({
      where: {
        configurator,
        status: 'purchased',
        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {})
      }
    });
    funnel.purchased = orders;

    res.json(funnel);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getExitPoints = async (req, res) => {
  try {
    const { configurator, from, to } = req.query;
    const dateFilter = getDateFilter(from, to);
    const whereClause = configurator ? { configurator } : {};
    if (Object.keys(dateFilter).length > 0) whereClause.reachedAt = dateFilter;

    const progress = await prisma.configuratorProgress.findMany({
      where: whereClause,
      orderBy: { reachedAt: 'desc' }
    });

    const latestPerVisitor = {};
    progress.forEach(p => {
      if (!latestPerVisitor[p.visitorId]) latestPerVisitor[p.visitorId] = p.milestone;
    });

    const exits = { started: 0, m25: 0, m50: 0, m75: 0, m100: 0 };
    Object.values(latestPerVisitor).forEach(m => {
      if (exits[m] !== undefined) exits[m]++;
    });

    res.json(exits);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getJourneySummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = getDateFilter(from, to);
    const whereVisitor = Object.keys(dateFilter).length > 0 ? { firstVisitAt: dateFilter } : {};

    const visitors = await prisma.visitor.findMany({
      where: whereVisitor,
      include: { orders: true, sessions: true }
    });

    let returningCount = 0;
    let purchasers = 0;
    let totalVisitsBeforePurchase = 0;
    let totalTimeDiff = 0;
    let totalReturnIntervals = 0;
    let intervalsCount = 0;

    visitors.forEach(v => {
      if (v.visitCount > 1) {
        returningCount++;
        const diffDays = (v.lastVisitAt.getTime() - v.firstVisitAt.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 0) {
          totalReturnIntervals += diffDays / (v.visitCount - 1);
          intervalsCount++;
        }
      }
      if (v.orders.length > 0) {
        purchasers++;
        const firstOrder = v.orders.sort((a, b) => a.createdAt - b.createdAt)[0];
        const sessionsBefore = v.sessions.filter(s => s.startedAt < firstOrder.createdAt).length || 1;
        totalVisitsBeforePurchase += sessionsBefore;
        totalTimeDiff += (firstOrder.createdAt.getTime() - v.firstVisitAt.getTime()) / (1000 * 60);
      }
    });

    res.json({
      totalVisitors: visitors.length,
      returningVisitors: returningCount,
      returnRate: visitors.length > 0 ? returningCount / visitors.length : 0,
      avgDaysBetweenVisits: intervalsCount > 0 ? (totalReturnIntervals / intervalsCount).toFixed(2) : 0,
      avgTimeToConversion: purchasers > 0 ? (totalTimeDiff / purchasers).toFixed(0) : 0,
      avgVisitsBeforePurchase: purchasers > 0 ? (totalVisitsBeforePurchase / purchasers).toFixed(1) : 0,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getConversionRates = async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = getDateFilter(from, to);
    const whereVisitor = Object.keys(dateFilter).length > 0 ? { firstVisitAt: dateFilter } : {};

    const visitors = await prisma.visitor.findMany({
      where: whereVisitor,
      include: { orders: true }
    });

    const stats = {
      education: { STX: { v: 0, o: 0 }, HHX: { v: 0, o: 0 }, HTX: { v: 0, o: 0 }, HF: { v: 0, o: 0 } },
      package: { premium: { v: 0, o: 0 }, standard: { v: 0, o: 0 } },
      product: { gradcap: { v: 0, o: 0 }, studywear: { v: 0, o: 0 } }
    };

    visitors.forEach(v => {
      const hasOrder = v.orders.some(o => o.status === 'purchased');
      if (v.educationType && stats.education[v.educationType]) {
        stats.education[v.educationType].v++;
        if (hasOrder) stats.education[v.educationType].o++;
      }
      if (v.packagePreference && stats.package[v.packagePreference]) {
        stats.package[v.packagePreference].v++;
        if (hasOrder) stats.package[v.packagePreference].o++;
      }
      if (v.productInterest) {
        if (v.productInterest === 'graduation_cap' || v.productInterest === 'both') {
          stats.product.gradcap.v++;
          if (v.orders.some(o => o.configurator === 'gradcap' && o.status === 'purchased')) stats.product.gradcap.o++;
        }
        if (v.productInterest === 'studywear' || v.productInterest === 'both') {
          stats.product.studywear.v++;
          if (v.orders.some(o => o.configurator === 'studywear' && o.status === 'purchased')) stats.product.studywear.o++;
        }
      }
    });

    const calc = (v, o) => v > 0 ? o / v : 0;

    res.json({
      byEducation: {
        STX: calc(stats.education.STX.v, stats.education.STX.o),
        HHX: calc(stats.education.HHX.v, stats.education.HHX.o),
        HTX: calc(stats.education.HTX.v, stats.education.HTX.o),
        HF: calc(stats.education.HF.v, stats.education.HF.o)
      },
      byPackage: {
        premium: calc(stats.package.premium.v, stats.package.premium.o),
        standard: calc(stats.package.standard.v, stats.package.standard.o),
      },
      byProduct: {
        gradcap: calc(stats.product.gradcap.v, stats.product.gradcap.o),
        studywear: calc(stats.product.studywear.v, stats.product.studywear.o)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getEntryRate = async (req, res) => {
  try {
    res.json({
      gradcap: { fromWordpress: 350, started: 320 },
      studywear: { fromWordpress: 200, started: 150 }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getAudienceGrowth = async (req, res) => {
  try {
    const visitors = await prisma.visitor.findMany({
      orderBy: { firstVisitAt: 'asc' }
    });

    const trendMap = new Map();
    visitors.forEach(v => {
      const date = v.firstVisitAt.toISOString().split('T')[0];
      if (!trendMap.has(date)) {
        trendMap.set(date, { date, STX: 0, HHX: 0, HTX: 0, HF: 0, Premium: 0, Standard: 0 });
      }
      const data = trendMap.get(date);
      if (v.educationType) data[v.educationType]++;
      if (v.packagePreference === 'premium') data.Premium++;
      if (v.packagePreference === 'standard') data.Standard++;
    });

    res.json({ trend: Array.from(trendMap.values()).slice(-30) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getExecutiveSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const dateFilter = getDateFilter(from, to);
    const whereVisitor = Object.keys(dateFilter).length > 0 ? { firstVisitAt: dateFilter } : {};

    const totalVisitors = await prisma.visitor.count({ where: whereVisitor });
    const totalConversions = await prisma.order.count({
      where: {
        status: 'purchased',
        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {})
      }
    });
    const overallConversionRate = totalVisitors > 0 ? (totalConversions / totalVisitors) * 100 : 0;

    // Revenue
    const revenueAgg = await prisma.order.aggregate({
      _sum: { value: true },
      where: {
        status: 'purchased',
        ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {})
      }
    });
    const totalRevenue = Number(revenueAgg._sum.value || 0);

    const visitors = await prisma.visitor.findMany({ where: whereVisitor });
    let stx = 0, hhx = 0, htx = 0, hf = 0, prem = 0, std = 0;
    visitors.forEach(v => {
      if (v.educationType === 'STX') stx++;
      if (v.educationType === 'HHX') hhx++;
      if (v.educationType === 'HTX') htx++;
      if (v.educationType === 'HF') hf++;
      if (v.packagePreference === 'premium') prem++;
      if (v.packagePreference === 'standard') std++;
    });

    const topEdu = [
      { name: 'STX', v: stx }, { name: 'HHX', v: hhx },
      { name: 'HTX', v: htx }, { name: 'HF', v: hf }
    ].sort((a, b) => b.v - a.v)[0].name;

    res.json({
      totalVisitors,
      totalConversions,
      overallConversionRate,
      totalRevenue,
      topEducationType: topEdu,
      topPackage: prem >= std ? 'Premium' : 'Standard'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getVisitors = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', educationType = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (educationType) where.educationType = educationType;
    if (search) {
      where.OR = [
        { school: { contains: search } },
        { visitorId: { contains: search } },
      ];
    }

    const [visitors, total] = await Promise.all([
      prisma.visitor.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { lastVisitAt: 'desc' },
        include: {
          _count: { select: { orders: true, sessions: true } }
        }
      }),
      prisma.visitor.count({ where })
    ]);

    const safeVisitors = visitors.map(v => ({
      ...v,
      id: Number(v.id)
    }));

    res.json({
      visitors: safeVisitors,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
