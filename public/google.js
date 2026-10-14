// Google sign-in (Google Identity Services token flow) and Sheets API calls.
// All requests go straight from the browser to Google with the user's token.

import { LOGS } from '/shared/logs.js';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'openid',
  'email',
  'profile',
].join(' ');

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let pending = null;

function waitForGis() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function check() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - started > 10_000) return reject(new Error('Could not load Google sign-in.'));
      setTimeout(check, 50);
    })();
  });
}

export async function initAuth(clientId) {
  await waitForGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (resp.error) return p.reject(new Error(resp.error_description || resp.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/spreadsheets')) {
        return p.reject(new Error('Please allow access to Google Sheets so rows can be added.'));
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in) - 60) * 1000;
      p.resolve(accessToken);
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(err?.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Sign-in failed.'));
    },
  });
}

// Opens the Google consent/account popup. Must be called from a user gesture.
export function signIn({ hint, silent } = {}) {
  if (!tokenClient) return Promise.reject(new Error('Google sign-in is not ready yet.'));
  if (pending) return pending.promise;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  pending = { resolve, reject, promise };
  tokenClient.requestAccessToken({ prompt: silent ? '' : undefined, login_hint: hint });
  return promise;
}

export async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  // Expired: re-request without the consent screen.
  return signIn({ silent: true });
}

export function signOut() {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  tokenExpiresAt = 0;
}

async function gfetch(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    accessToken = null;
    throw new Error('Your Google session expired. Please try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Google API error (${res.status})`;
    if (res.status === 404) throw new Error('Spreadsheet not found. Check the link and that you have access.');
    if (res.status === 403) throw new Error(`No permission for this spreadsheet. ${msg}`);
    throw new Error(msg);
  }
  return body;
}

export function getUserInfo() {
  return gfetch('https://www.googleapis.com/oauth2/v3/userinfo');
}

// --- Spreadsheet helpers ---------------------------------------------------

export function parseSpreadsheetId(input) {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{25,}$/.test(s)) return s;
  return null;
}

export function spreadsheetUrl(id, sheetId) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit${sheetId != null ? `#gid=${sheetId}` : ''}`;
}

export async function getSpreadsheet(id) {
  const data = await gfetch(
    `${SHEETS}/${encodeURIComponent(id)}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title)`,
  );
  return {
    id: data.spreadsheetId,
    title: data.properties.title,
    tabs: Object.fromEntries(data.sheets.map((s) => [s.properties.title, s.properties.sheetId])),
  };
}

export async function createSpreadsheet(title = 'Voice Log') {
  const data = await gfetch(SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: Object.values(LOGS).map((log) => ({ properties: { title: log.tab } })),
    }),
  });
  const sheet = {
    id: data.spreadsheetId,
    title: data.properties.title,
    tabs: Object.fromEntries(data.sheets.map((s) => [s.properties.title, s.properties.sheetId])),
  };
  for (const logId of Object.keys(LOGS)) {
    await formatTab(sheet.id, sheet.tabs[LOGS[logId].tab], logId);
  }
  return sheet;
}

const NUMBER_FORMATS = {
  date: { type: 'DATE', pattern: 'yyyy-mm-dd' },
  datetime: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm' },
  currency: { type: 'NUMBER', pattern: '#,##0.00' },
  number: { type: 'NUMBER', pattern: '#,##0.##' },
};

// Writes the header row and applies column formatting to a tab.
async function formatTab(spreadsheetId, sheetId, logId) {
  const log = LOGS[logId];
  const cols = log.columns.length;
  const requests = [
    {
      updateCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
        rows: [{ values: log.columns.map((c) => ({ userEnteredValue: { stringValue: c.header } })) }],
        fields: 'userEnteredValue',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: cols },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            backgroundColor: { red: 0.059, green: 0.463, blue: 0.431 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,backgroundColor,verticalAlignment)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    ...log.columns
      .map((c, i) => [c, i])
      .filter(([c]) => NUMBER_FORMATS[c.format])
      .map(([c, i]) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
          cell: { userEnteredFormat: { numberFormat: NUMBER_FORMATS[c.format] } },
          fields: 'userEnteredFormat.numberFormat',
        },
      })),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: cols },
        properties: { pixelSize: 140 },
        fields: 'pixelSize',
      },
    },
  ];
  await gfetch(`${SHEETS}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}

// Makes sure the tab for `logId` exists with a header row. Returns its sheetId.
export async function ensureTab(sheet, logId) {
  const title = LOGS[logId].tab;
  if (sheet.tabs[title] != null && sheet.formatted?.has(title)) return sheet.tabs[title];

  if (sheet.tabs[title] == null) {
    const res = await gfetch(`${SHEETS}/${sheet.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    sheet.tabs[title] = res.replies[0].addSheet.properties.sheetId;
    await formatTab(sheet.id, sheet.tabs[title], logId);
  } else {
    // Existing tab: only add headers if it is empty.
    const head = await gfetch(
      `${SHEETS}/${sheet.id}/values/${encodeURIComponent(`'${title}'!A1:A1`)}`,
    );
    if (!head.values?.length) await formatTab(sheet.id, sheet.tabs[title], logId);
  }
  (sheet.formatted ??= new Set()).add(title);
  return sheet.tabs[title];
}

export async function appendRow(sheet, logId, values) {
  const title = LOGS[logId].tab;
  const range = encodeURIComponent(`'${title}'!A1`);
  const res = await gfetch(
    `${SHEETS}/${sheet.id}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [values] }) },
  );
  return res.updates?.updatedRange;
}
