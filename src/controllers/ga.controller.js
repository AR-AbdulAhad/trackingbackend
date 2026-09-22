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
      perMinute = (minuteReport?.rows || []).map((row) => ({
        minuteAgo: Number(row.dimensionValues?.[0]?.value || 0),
        activeUsers: Number(row.metricValues?.[0]?.value || 0),
      }));
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

export const getSummary = async (req, res) => {
  try {
    const from = req.query.from || '7daysAgo';
    const to = req.query.to || 'today';

    // 1. Fetch Primary Metrics
    const metricsReport = await runGAReport({
      dateRanges: [{ startDate: from, endDate: to }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'eventCount' },
        { name: 'keyEvents' },
        { name: 'screenPageViews' },
        { name: 'newUsers' },
      ],
    });

    const mRow = metricsReport?.rows?.[0]?.metricValues || [];
    const activeUsers = Number(mRow[0]?.value || 0);
    const sessions = Number(mRow[1]?.value || 0);
    const eventCount = Number(mRow[2]?.value || 0);
    const keyEvents = Number(mRow[3]?.value || 0);
    const pageViews = Number(mRow[4]?.value || 0);
    const newUsers = Number(mRow[5]?.value || 0);

    const metrics = {
      activeUsers,
      activeUsersFormatted: activeUsers >= 1000 ? `${(activeUsers / 1000).toFixed(1)}k` : String(activeUsers),
      sessions,
      sessionsFormatted: sessions >= 1000 ? `${(sessions / 1000).toFixed(1)}k` : String(sessions),
      eventCount,
      eventCountFormatted: eventCount >= 1000 ? `${(eventCount / 1000).toFixed(1)}k` : String(eventCount),
      keyEvents,
      keyEventsFormatted: keyEvents >= 1000 ? `${(keyEvents / 1000).toFixed(1)}k` : String(keyEvents),
      pageViews,
      pageViewsFormatted: pageViews >= 1000 ? `${(pageViews / 1000).toFixed(1)}k` : String(pageViews),
      newUsers,
    };

    // 2. Fetch Trend by Date
    let trend = [];
    try {
      const trendReport = await runGAReport({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      });

      trend = (trendReport?.rows || []).map((row) => {
        const rawDate = row.dimensionValues?.[0]?.value || '';
        const dayMonth = rawDate.length === 8 ? `${rawDate.slice(6, 8)}/${rawDate.slice(4, 6)}` : rawDate;
        return {
          date: dayMonth,
          current: Number(row.metricValues?.[0]?.value || 0),
          sessions: Number(row.metricValues?.[1]?.value || 0),
        };
      });
    } catch (e) {}

    // 3. Fetch Top Countries
    let countries = [];
    try {
      const countryReport = await runGAReport({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 10,
      });

      const maxUsers = Number(countryReport?.rows?.[0]?.metricValues?.[0]?.value || 1);
      countries = (countryReport?.rows || []).map((row) => {
        const cUsers = Number(row.metricValues?.[0]?.value || 0);
        return {
          country: row.dimensionValues?.[0]?.value || 'Unknown',
          activeUsers: cUsers,
          pct: Math.round((cUsers / (activeUsers || 1)) * 100),
          barPct: Math.round((cUsers / maxUsers) * 100),
        };
      });
    } catch (e) {}

    // 4. Fetch Page Views by Page Title
    let pageViewsList = [];
    try {
      const pagesReport = await runGAReport({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      });

      pageViewsList = (pagesReport?.rows || []).map((row) => ({
        title: row.dimensionValues?.[0]?.value || 'Untitled Page',
        views: Number(row.metricValues?.[0]?.value || 0),
      }));
    } catch (e) {}

    // 5. Fetch Traffic Channels
    let trafficChannels = [];
    try {
      const channelReport = await runGAReport({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      });

      const maxSessions = Number(channelReport?.rows?.[0]?.metricValues?.[0]?.value || 1);
      trafficChannels = (channelReport?.rows || []).map((row) => {
        const cSessions = Number(row.metricValues?.[0]?.value || 0);
        return {
          channel: row.dimensionValues?.[0]?.value || 'Direct',
          sessions: cSessions,
          pct: Math.round((cSessions / (sessions || 1)) * 100),
          barPct: Math.round((cSessions / maxSessions) * 100),
        };
      });
    } catch (e) {}

    return res.json({
      metrics,
      trend,
      countries,
      pageViews: pageViewsList,
      trafficChannels,
      propertyId: process.env.GA4_PROPERTY_ID || '503219826',
      propertyName: 'www.studentlife.dk',
      isLive: true,
      permissionPending: false,
    });
  } catch (err) {
    console.warn('[GA API Summary] Live query error:', err.message);
    return res.json({
      metrics: {
        activeUsers: 0,
        activeUsersFormatted: '0',
        sessions: 0,
        sessionsFormatted: '0',
        eventCount: 0,
        eventCountFormatted: '0',
        keyEvents: 0,
        keyEventsFormatted: '0',
        pageViews: 0,
        pageViewsFormatted: '0',
        newUsers: 0,
      },
      trend: [],
      countries: [],
      pageViews: [],
      trafficChannels: [],
      propertyId: process.env.GA4_PROPERTY_ID || '503219826',
      propertyName: 'www.studentlife.dk',
      isLive: false,
      permissionPending: true,
      serviceAccountEmail: SERVICE_ACCOUNT_EMAIL,
      error: err.message,
    });
  }
};
