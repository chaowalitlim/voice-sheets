// Voice Sheets server.
//
// Privacy model: this server never sees your spreadsheet. The browser talks to
// the Google Sheets API directly with your own OAuth token. The only thing
// sent here is the transcript of what you said, which is forwarded to Claude
// for parsing and then discarded. There is no database and no request logging.

import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { parseUtterance, ParseError } from './parse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 20;
const MAX_TEXT_LENGTH = 1000;

if (!GOOGLE_CLIENT_ID) {
  console.warn('GOOGLE_CLIENT_ID is not set: Google sign-in will not work until you add it to .env');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  });
  next();
});

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send(`window.APP_CONFIG = ${JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID })};`);
});

app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth: only signed-in users of this app may spend AI credits ----------

const tokenCache = new Map(); // access token -> { email, expiresAt }

async function verifyGoogleToken(accessToken) {
  const cached = tokenCache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.email;

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) return null;
  const info = await res.json();
  if (info.aud !== GOOGLE_CLIENT_ID && info.azp !== GOOGLE_CLIENT_ID) return null;
  if (!info.email || info.email_verified === 'false') return null;

  const email = info.email.toLowerCase();
  const expiresAt = Date.now() + Math.min(Number(info.expires_in) || 300, 300) * 1000;
  tokenCache.set(accessToken, { email, expiresAt });
  if (tokenCache.size > 1000) {
    for (const [k, v] of tokenCache) if (v.expiresAt <= Date.now()) tokenCache.delete(k);
  }
  return email;
}

const hits = new Map(); // email -> timestamps in the last minute

function rateLimited(email) {
  const now = Date.now();
  const recent = (hits.get(email) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(email, recent);
  return recent.length > RATE_LIMIT_PER_MIN;
}

async function requireUser(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Please sign in with Google.' });
  try {
    const email = await verifyGoogleToken(token);
    if (!email) return res.status(401).json({ error: 'Your Google session expired. Please sign in again.' });
    if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) {
      return res.status(403).json({ error: 'This account is not allowed to use this app.' });
    }
    if (rateLimited(email)) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    req.userEmail = email;
    next();
  } catch {
    res.status(502).json({ error: 'Could not verify your Google sign-in.' });
  }
}

// --- API -------------------------------------------------------------------

app.post('/api/parse', requireUser, async (req, res) => {
  const { text, today, timeZone, currency, preferredLog } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Nothing to parse.' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `Keep it under ${MAX_TEXT_LENGTH} characters.` });
  }
  if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return res.status(400).json({ error: 'Missing local date.' });
  }

  try {
    const result = await parseUtterance({
      text: text.trim(),
      today,
      timeZone: typeof timeZone === 'string' ? timeZone.slice(0, 64) : undefined,
      currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
      preferredLog: typeof preferredLog === 'string' ? preferredLog : undefined,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ParseError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(503).json({ error: 'The AI service is busy. Try again shortly.' });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic authentication failed: check ANTHROPIC_API_KEY');
      return res.status(500).json({ error: 'The server is not configured for AI parsing.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}`);
      return res.status(502).json({ error: 'The AI service returned an error.' });
    }
    // Do not log request bodies: they contain the user's transcript.
    console.error('Unexpected parse failure:', err?.name || 'Error');
    res.status(500).json({ error: 'Something went wrong while parsing.' });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Voice Sheets running at http://localhost:${PORT}`);
});
