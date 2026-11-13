import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CREDENTIALS_PATH = path.resolve(__dirname, '../../ga-credentials.json');
const OAUTH_TOKENS_PATH = path.resolve(__dirname, '../../ga-oauth-tokens.json');

const getClientConfig = () => {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/ga/callback',
    propertyId: process.env.GA4_PROPERTY_ID || '503219826',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  };
};

let googleAuthClient = null;
let oauth2ClientInstance = null;
let loadedOAuthTokens = null;

export const getOAuth2Client = () => {
  const { clientId, clientSecret, redirectUri } = getClientConfig();
  if (!oauth2ClientInstance) {
    oauth2ClientInstance = new OAuth2Client(clientId, clientSecret, redirectUri);
    oauth2ClientInstance.on('tokens', (tokens) => {
      // Refresh responses may omit the refresh token; keep it for future restarts.
      saveOAuthTokens({ ...loadOAuthTokens(), ...tokens });
    });
  }
  return oauth2ClientInstance;
};

export const getAuthUrl = (loginHint) => {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent',
    ...(loginHint ? { login_hint: loginHint } : {}),
    scope: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
};

export const saveOAuthTokens = (tokens) => {
  const merged = { ...loadOAuthTokens(), ...tokens };
  fs.writeFileSync(OAUTH_TOKENS_PATH, JSON.stringify(merged, null, 2));
  loadedOAuthTokens = JSON.stringify(merged);
  oauth2ClientInstance?.setCredentials(merged);
};

export const loadOAuthTokens = () => {
  if (fs.existsSync(OAUTH_TOKENS_PATH)) {
    try {
      const data = fs.readFileSync(OAUTH_TOKENS_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return null;
    }
  }
  return null;
};

export const clearOAuthTokens = () => {
  if (fs.existsSync(OAUTH_TOKENS_PATH)) {
    fs.unlinkSync(OAUTH_TOKENS_PATH);
  }
  loadedOAuthTokens = null;
  oauth2ClientInstance?.setCredentials({});
};

const getGoogleAuth = () => {
  if (!googleAuthClient && fs.existsSync(CREDENTIALS_PATH)) {
    googleAuthClient = new GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
  }
  return googleAuthClient;
};

export const isOAuthConnected = () => {
  const tokens = loadOAuthTokens();
  return !!(tokens && (tokens.access_token || tokens.refresh_token));
};

export const isServiceAccountReady = () => {
  return fs.existsSync(CREDENTIALS_PATH);
};

export const getValidAccessToken = async () => {
  // 1. Try OAuth tokens first (user login)
  const tokens = loadOAuthTokens();
  if (tokens) {
    const oauthClient = getOAuth2Client();
    const serialized = JSON.stringify(tokens);
    if (serialized !== loadedOAuthTokens) {
      oauthClient.setCredentials(tokens);
      loadedOAuthTokens = serialized;
    }
    try {
      const tokenRes = await oauthClient.getAccessToken();
      if (tokenRes?.token) {
        return tokenRes.token;
      }
    } catch (e) {
      console.warn('[GA OAuth] Token refresh failed, falling back to service account:', e.message);
    }
  }

  // 2. Fallback to Service Account
  const auth = getGoogleAuth();
  if (!auth) {
    throw new Error('Neither Google OAuth tokens nor ga-credentials.json found');
  }
  const client = await auth.getClient();
  const tokenRes = await client.getAccessToken();
  return tokenRes.token;
};

export const runGAReport = async (requestBody, propertyIdOverride) => {
  const { propertyId } = getClientConfig();
  const propId = propertyIdOverride || propertyId;
  const accessToken = await getValidAccessToken();

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'GA4 runReport query failed');
  }
  return data;
};

export const runGARealtimeReport = async (requestBody, propertyIdOverride) => {
  const { propertyId } = getClientConfig();
  const propId = propertyIdOverride || propertyId;
  const accessToken = await getValidAccessToken();

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propId}:runRealtimeReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'GA4 runRealtimeReport query failed');
  }
  return data;
};
