import {
  isServiceAccountReady,
  isOAuthConnected,
  getOAuth2Client,
  getAuthUrl,
  saveOAuthTokens,
  clearOAuthTokens,
  runGAReport,
  runGARealtimeReport
} from '../lib/gaOAuth.js';

const SERVICE_ACCOUNT_EMAIL = 'ga-reader@studentlife-509311.iam.gserviceaccount.com';

export const getStatus = (req, res) => {
  const oauth = isOAuthConnected();
  const sa = isServiceAccountReady();
  res.json({
    connected: oauth || sa,
    isOAuth: oauth,
    email: SERVICE_ACCOUNT_EMAIL,
    propertyId: process.env.GA4_PROPERTY_ID || '503219826',
    propertyName: 'www.studentlife.dk',
    authType: oauth ? 'oauth' : 'service_account',
  });
};

export const getAuthUrlController = (req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// One-time admin link: open /api/ga/connect in a browser to log in with Google
export const connectGoogle = (req, res) => {
  try {
    res.redirect(getAuthUrl(req.query.email));
  } catch (err) {
    res.status(500).send(err.message);
  }
};

export const oauthCallback = async (req, res) => {
  const { code } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (!code) {
    return res.redirect(`${frontendUrl}/google-analytics?error=missing_code`);
  }
  try {
    const oauthClient = getOAuth2Client();
    const { tokens } = await oauthClient.getToken(code);
    saveOAuthTokens(tokens);
    return res.redirect(`${frontendUrl}/google-analytics?connected=true`);
  } catch (err) {
    console.error('[GA OAuth Callback Error]:', err.message);
    return res.redirect(`${frontendUrl}/google-analytics?error=${encodeURIComponent(err.message)}`);
  }
};

export const disconnectGAController = (req, res) => {
  try {
    clearOAuthTokens();
    res.json({ success: true, message: 'Google Analytics disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getRealtime = async (req, res) => {
  try {
    // 1. Total Active Users in last 30 minutes
    const totalReport = await runGARealtimeReport({
      metrics: [{ name: 'activeUsers' }],
    });
    const active30Min = Number(totalReport?.rows?.[0]?.metricValues?.[0]?.value || 0);

    // 2. Per Minute Breakdown (last 30 min)
    let perMinute = [];
    try {
      const minuteReport = await runGARealtimeReport({
        dimensions: [{ name: 'minutesAgo' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ dimension: { dimensionName: 'minutesAgo' }, desc: false }],
      });
      // GA only returns minutes that had traffic — fill all 30 slots, oldest first
      const byMinute = new Map(
        (minuteReport?.rows || []).map((row) => [
          Number(row.dimensionValues?.[0]?.value || 0),
          Number(row.metricValues?.[0]?.value || 0),
        ])
      );
      perMinute = Array.from({ length: 30 }, (_, i) => {
        const minuteAgo = 29 - i;
        return { minuteAgo, activeUsers: byMinute.get(minuteAgo) || 0 };
      });
    } catch (e) {}

    // 3. Realtime Countries
    let byCountry = [];
    try {
      const countryReport = await runGARealtimeReport({
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 10,
      });
      byCountry = (countryReport?.rows || []).map((row) => ({
        country: row.dimensionValues?.[0]?.value || 'Unknown',
        activeUsers: Number(row.metricValues?.[0]?.value || 0),
      }));
    } catch (e) {}

    return res.json({
      active30Min,
      perMinute,
      byCountry,
      isLive: true,
      permissionPending: false,
    });
  } catch (err) {
    console.warn('[GA API Realtime] Live query error:', err.message);
    return res.json({
      active30Min: 0,
      perMinute: [],
      byCountry: [],
      isLive: false,
      permissionPending: true,
      serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
      error: err.message,
    });
  }
};

// ---------- Date helpers ----------
const GA_MIN_DATE = '2015-08-14';
const DAY_MS = 24 * 60 * 60 * 1000;
const toISO = (d) => d.toISOString().slice(0, 10);
const parseISO = (s) => new Date(`${s}T00:00:00Z`);
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

const formatCompact = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
};

const pctChange = (cur, prev) => {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
};

const SUMMARY_METRICS = [
  'activeUsers', 'sessions', 'eventCount', 'keyEvents',
  'screenPageViews', 'newUsers', 'engagementRate', 'averageSessionDuration',
];

const readMetricRow = (report) => {
  const vals = report?.rows?.[0]?.metricValues || [];
  return Object.fromEntries(SUMMARY_METRICS.map((m, i) => [m, Number(vals[i]?.value || 0)]));
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const withShares = (rows, total, key) => {
  const max = Number(rows[0]?.metricValues?.[0]?.value || 1);
  return rows.map((row) => {
    const value = Number(row.metricValues?.[0]?.value || 0);
    return {
      [key]: value,
      pct: Math.round((value / (total || 1)) * 100),
      barPct: Math.round((value / max) * 100),
      _dims: row.dimensionValues || [],
    };
  });
};

// Keep GA's channel classifications; expose the recorded source for unclassified traffic.
const buildTrafficChannels = (rows, total) => {
  const missing = new Set(['', '(not set)', '(none)', 'unassigned']);
  const counts = new Map();
  for (const row of rows) {
    const [group = '', source = '', medium = ''] = (row.dimensionValues || []).map(d => (d.value || '').trim());
    const channel = missing.has(group.toLowerCase())
      ? [source, medium].filter(value => !missing.has(value.toLowerCase())).join(' / ') || 'Source unavailable'
      : group;
    counts.set(channel, (counts.get(channel) || 0) + Number(row.metricValues?.[0]?.value || 0));
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;
  return sorted.slice(0, 10).map(([channel, sessions]) => ({
    channel,
    sessions,
    pct: Math.round((sessions / (total || 1)) * 100),
    barPct: Math.round((sessions / max) * 100),
  }));
};

export const getSummary = async (req, res) => {
  const propertyId = process.env.GA4_PROPERTY_ID || '503219826';
  try {
    const today = toISO(new Date());
    const allTime = !isISO(req.query.from);
    const from = allTime ? GA_MIN_DATE : req.query.from;
    const to = isISO(req.query.to) ? req.query.to : today;

    // Previous period of equal length (skipped for "all time")
    const spanDays = Math.max(1, Math.round((parseISO(to) - parseISO(from)) / DAY_MS) + 1);
    let prevRange = null;
    if (!allTime) {
      const prevTo = new Date(parseISO(from).getTime() - DAY_MS);
      const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * DAY_MS);
      prevRange = { startDate: toISO(prevFrom), endDate: toISO(prevTo) };
    }
    const range = { startDate: from, endDate: to };

    // Trend granularity: daily up to ~3 months, monthly beyond that
    const monthly = allTime || spanDays > 92;
    const trendDim = monthly ? 'yearMonth' : 'date';

    const safe = (p) => p.catch((e) => {
      console.warn('[GA API Summary] sub-report failed:', e.message);
      return null;
    });
    const metricList = SUMMARY_METRICS.map((name) => ({ name }));

    const [curReport, prevReport, trendReport, countryReport, pagesReport, channelReport, deviceReport] =
      await Promise.all([
        runGAReport({ dateRanges: [range], metrics: metricList }),
        prevRange ? safe(runGAReport({ dateRanges: [prevRange], metrics: metricList })) : null,
        safe(runGAReport({
          dateRanges: [range],
          dimensions: [{ name: trendDim }],
          metrics: [
            { name: 'activeUsers' }, { name: 'sessions' }, { name: 'eventCount' },
            { name: 'keyEvents' }, { name: 'screenPageViews' },
          ],
          orderBys: [{ dimension: { dimensionName: trendDim }, desc: false }],
          limit: 400,
        })),
        safe(runGAReport({
          dateRanges: [range],
          dimensions: [{ name: 'country' }, { name: 'countryId' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: 10,
        })),
        safe(runGAReport({
          dateRanges: [range],
          dimensions: [{ name: 'pageTitle' }],
          metrics: [{ name: 'screenPageViews' }],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 10,
        })),
        safe(runGAReport({
          dateRanges: [range],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'sessionSource' }, { name: 'sessionMedium' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 250000,
        })),
        safe(runGAReport({
          dateRanges: [range],
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        })),
      ]);

    const cur = readMetricRow(curReport);
    const prev = prevReport ? readMetricRow(prevReport) : null;

    const metrics = {
      ...cur,
      activeUsersFormatted: formatCompact(cur.activeUsers),
      sessionsFormatted: formatCompact(cur.sessions),
      eventCountFormatted: formatCompact(cur.eventCount),
      keyEventsFormatted: formatCompact(cur.keyEvents),
      pageViews: cur.screenPageViews,
      pageViewsFormatted: formatCompact(cur.screenPageViews),
      newUsersFormatted: formatCompact(cur.newUsers),
    };

    const changes = Object.fromEntries(
      SUMMARY_METRICS.map((m) => [m, prev ? pctChange(cur[m], prev[m]) : null])
    );

    const trend = (trendReport?.rows || []).map((row) => {
      const raw = row.dimensionValues?.[0]?.value || '';
      let label = raw;
      if (monthly && raw.length === 6) label = `${MONTHS[Number(raw.slice(4, 6)) - 1]} ${raw.slice(2, 4)}`;
      else if (raw.length === 8) label = `${raw.slice(6, 8)}/${raw.slice(4, 6)}`;
      const v = row.metricValues || [];
      return {
        date: label,
        current: Number(v[0]?.value || 0),
        sessions: Number(v[1]?.value || 0),
        eventCount: Number(v[2]?.value || 0),
        keyEvents: Number(v[3]?.value || 0),
        pageViews: Number(v[4]?.value || 0),
      };
    });

    const countries = withShares(countryReport?.rows || [], cur.activeUsers, 'activeUsers')
      .map(({ _dims, ...r }) => ({ country: _dims[0]?.value || 'Unknown', countryCode: _dims[1]?.value || '', ...r }));

    const pageViews = withShares(pagesReport?.rows || [], cur.screenPageViews, 'views')
      .map(({ _dims, ...r }) => ({ title: _dims[0]?.value || 'Untitled Page', ...r }));

    const trafficChannels = buildTrafficChannels(channelReport?.rows || [], cur.sessions);

    const deviceRows = deviceReport?.rows || [];
    const deviceTotal = deviceRows.reduce((a, r) => a + Number(r.metricValues?.[0]?.value || 0), 0);
    const devices = withShares(deviceRows, deviceTotal, 'activeUsers')
      .map(({ _dims, ...r }) => ({ device: _dims[0]?.value || 'other', ...r }));

    return res.json({
      metrics,
      changes,
      range: { from, to, allTime, previous: prevRange, granularity: monthly ? 'month' : 'day' },
      trend,
      countries,
      pageViews,
      trafficChannels,
      devices,
      propertyId,
      propertyName: 'www.studentlife.dk',
      fetchedAt: new Date().toISOString(),
      isLive: true,
      permissionPending: false,
    });
  } catch (err) {
    console.warn('[GA API Summary] Live query error:', err.message);
    return res.json({
      metrics: {
        activeUsers: 0, activeUsersFormatted: '0',
        sessions: 0, sessionsFormatted: '0',
        eventCount: 0, eventCountFormatted: '0',
        keyEvents: 0, keyEventsFormatted: '0',
        pageViews: 0, pageViewsFormatted: '0',
        newUsers: 0, newUsersFormatted: '0',
        engagementRate: 0, averageSessionDuration: 0,
      },
      changes: {},
      trend: [],
      countries: [],
      pageViews: [],
      trafficChannels: [],
      devices: [],
      propertyId,
      propertyName: 'www.studentlife.dk',
      isLive: false,
      permissionPending: true,
      error: err.message,
    });
  }
};

// ---------- Detailed breakdown reports (tabbed table on the GA page) ----------
const REPORTS = {
  pages: {
    dimensions: ['hostName', 'pagePath', 'pageTitle'],
    metrics: ['screenPageViews', 'activeUsers', 'userEngagementDuration', 'keyEvents', 'bounceRate'],
    orderBy: 'screenPageViews',
  },
  landing: {
    dimensions: ['hostName', 'landingPage'],
    metrics: ['sessions', 'activeUsers', 'engagementRate', 'keyEvents', 'averageSessionDuration'],
    orderBy: 'sessions',
  },
  sources: {
    dimensions: ['sessionSourceMedium'],
    metrics: ['sessions', 'activeUsers', 'engagementRate', 'keyEvents', 'averageSessionDuration'],
    orderBy: 'sessions',
  },
  events: {
    dimensions: ['eventName'],
    metrics: ['eventCount', 'totalUsers', 'eventCountPerUser', 'keyEvents'],
    orderBy: 'eventCount',
  },
  cities: {
    dimensions: ['city', 'countryId'],
    metrics: ['activeUsers', 'sessions', 'engagementRate', 'screenPageViews'],
    orderBy: 'activeUsers',
  },
  demographics: {
    dimensions: ['userAgeBracket', 'userGender'],
    metrics: ['activeUsers', 'sessions', 'engagementRate'],
    orderBy: 'activeUsers',
  },
  browsers: {
    dimensions: ['browser', 'operatingSystem'],
    metrics: ['activeUsers', 'sessions', 'engagementRate'],
    orderBy: 'activeUsers',
  },
};

export const getReport = async (req, res) => {
  const type = req.query.type;
  const def = REPORTS[type];
  if (!def) return res.status(400).json({ error: `Unknown report type. Use one of: ${Object.keys(REPORTS).join(', ')}` });

  try {
    const from = isISO(req.query.from) ? req.query.from : GA_MIN_DATE;
    const to = isISO(req.query.to) ? req.query.to : toISO(new Date());
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const report = await runGAReport({
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: def.dimensions.map((name) => ({ name })),
      ...(['cities', 'demographics', 'sources'].includes(type) ? {
        dimensionFilter: {
          notExpression: {
            filter: {
              fieldName: { cities: 'city', demographics: 'userAgeBracket', sources: 'sessionSource' }[type],
              inListFilter: { values: ['', '(not set)', '(data not available)', 'unknown', type === 'cities' ? 'Unknown city' : 'Unknown age'], caseSensitive: false },
            },
          },
        },
      } : {}),
      metrics: def.metrics.map((name) => ({ name })),
      orderBys: [{ metric: { metricName: def.orderBy }, desc: true }],
      limit,
      metricAggregations: ['TOTAL'],
    });

    const rows = (report?.rows || []).map((row) => {
      const out = {};
      def.dimensions.forEach((d, i) => { out[d] = row.dimensionValues?.[i]?.value ?? ''; });
      def.metrics.forEach((m, i) => { out[m] = Number(row.metricValues?.[i]?.value || 0); });
      return out;
    });

    const totalVals = report?.totals?.[0]?.metricValues || [];
    const totals = Object.fromEntries(def.metrics.map((m, i) => [m, Number(totalVals[i]?.value || 0)]));

    return res.json({
      type,
      dimensions: def.dimensions,
      metrics: def.metrics,
      rows,
      totals,
      rowCount: report?.rowCount ?? rows.length,
      range: { from, to },
    });
  } catch (err) {
    console.warn(`[GA API Report:${type}]`, err.message);
    return res.status(502).json({ error: err.message, type, rows: [] });
  }
};
