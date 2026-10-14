import { LOGS, LOG_IDS, NUMERIC_FIELDS } from '/shared/logs.js';
import * as G from '/google.js';

const $ = (sel) => document.querySelector(sel);

// Only small preferences live in localStorage: the linked sheet ID and
// settings. No spreadsheet contents are stored anywhere by this app.
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`vs:${key}`)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`vs:${key}`, JSON.stringify(value)); } catch {}
  },
  del(key) {
    try { localStorage.removeItem(`vs:${key}`); } catch {}
  },
};

const state = {
  user: null,
  sheet: null,
  preferredLog: store.get('preferredLog', 'auto'),
  settings: {
    lang: store.get('lang', navigator.language?.startsWith('th') ? 'th-TH' : 'en-US'),
    currency: store.get('currency', navigator.language?.startsWith('th') ? 'THB' : 'USD'),
    autoAdd: store.get('autoAdd', false),
  },
};

// --- Views -----------------------------------------------------------------

function show(view) {
  for (const id of ['signin', 'link', 'main']) $(`#view-${id}`).hidden = id !== view;
}

function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

// --- Auth ------------------------------------------------------------------

async function handleSignIn() {
  const btn = $('#sign-in');
  btn.disabled = true;
  try {
    await G.signIn({ hint: store.get('lastEmail') || undefined });
    state.user = await G.getUserInfo();
    store.set('lastEmail', state.user.email);
    renderAccount();
    await restoreSheet();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

function renderAccount() {
  $('#account').hidden = !state.user;
  if (!state.user) return;
  $('#user-email').textContent = state.user.email;
  $('#avatar').src = state.user.picture || '';
  $('#avatar').hidden = !state.user.picture;
}

function handleSignOut() {
  G.signOut();
  state.user = null;
  state.sheet = null;
  store.del('lastEmail');
  renderAccount();
  $('#previews').replaceChildren();
  show('signin');
}

// --- Spreadsheet linking ---------------------------------------------------

async function restoreSheet() {
  const saved = store.get(`sheet:${state.user.email}`);
  if (!saved) return showLink(false);
  try {
    state.sheet = await G.getSpreadsheet(saved);
    showMain();
  } catch (err) {
    showLink(false);
    $('#sheet-url').value = G.spreadsheetUrl(saved);
    alert(`Could not open your linked spreadsheet: ${err.message}`);
  }
}

function showLink(canCancel) {
  $('#cancel-link').hidden = !canCancel;
  show('link');
}

async function linkSheet(sheet) {
  state.sheet = sheet;
  store.set(`sheet:${state.user.email}`, sheet.id);
  showMain();
}

async function handleLinkSubmit(e) {
  e.preventDefault();
  const id = G.parseSpreadsheetId($('#sheet-url').value);
  if (!id) return alert('That does not look like a Google Sheets link.');
  const btn = e.submitter;
  btn.disabled = true;
  try {
    await linkSheet(await G.getSpreadsheet(id));
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function handleCreateSheet() {
  const btn = $('#create-sheet');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const sheet = await G.createSpreadsheet('Voice Log');
    sheet.formatted = new Set(Object.values(LOGS).map((l) => l.tab));
    await linkSheet(sheet);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create a new “Voice Log” spreadsheet';
  }
}

function showMain() {
  const link = $('#sheet-link');
  link.textContent = state.sheet.title;
  link.href = G.spreadsheetUrl(state.sheet.id);
  show('main');
}

// --- Log picker ------------------------------------------------------------

function renderLogPicker() {
  const picker = $('#log-picker');
  const options = [['auto', 'Auto-detect'], ...LOG_IDS.map((id) => [id, LOGS[id].label])];
  picker.replaceChildren(
    ...options.map(([id, label]) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.role = 'radio';
      b.textContent = label;
      b.setAttribute('aria-checked', String(state.preferredLog === id));
      b.addEventListener('click', () => {
        state.preferredLog = id;
        store.set('preferredLog', id);
        renderLogPicker();
      });
      return b;
    }),
  );
}

// --- Speech capture --------------------------------------------------------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;

function setupSpeech() {
  const mic = $('#mic');
  if (!SpeechRecognition) {
    mic.disabled = true;
    $('#mic-hint').textContent = 'Voice input is not supported in this browser. Try Chrome, Edge or Safari, or type below.';
    return;
  }

  mic.addEventListener('click', () => {
    if (listening) return recognition?.stop();
    startListening();
  });
}

function startListening() {
  recognition = new SpeechRecognition();
  recognition.lang = state.settings.lang;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  const transcript = $('#transcript');
  let finalText = '';

  recognition.onstart = () => {
    listening = true;
    $('#mic').classList.add('listening');
    $('#mic').setAttribute('aria-pressed', 'true');
    $('#mic-hint').textContent = 'Listening… tap again to stop';
    transcript.value = '';
    setStatus('');
  };
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    transcript.value = (finalText + interim).trim();
  };
  recognition.onerror = (event) => {
    const messages = {
      'not-allowed': 'Microphone permission was denied. Allow it in your browser settings.',
      'no-speech': 'Didn’t catch that. Tap the mic and try again.',
      'audio-capture': 'No microphone was found.',
      network: 'Speech recognition needs a network connection.',
    };
    if (event.error !== 'aborted') setStatus(messages[event.error] || `Speech error: ${event.error}`, 'error');
  };
  recognition.onend = () => {
    listening = false;
    $('#mic').classList.remove('listening');
    $('#mic').setAttribute('aria-pressed', 'false');
    $('#mic-hint').textContent = 'Tap and speak';
    const text = transcript.value.trim();
    if (text) parseAndPreview(text);
  };

  try {
    recognition.start();
  } catch {
    setStatus('Could not start the microphone.', 'error');
  }
}

// --- Parsing ---------------------------------------------------------------

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localDateTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function parseAndPreview(text) {
  const btn = $('#parse-btn');
  btn.disabled = true;
  setStatus('Understanding…', 'busy');
  try {
    const token = await G.getToken();
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text,
        today: localDate(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        currency: state.settings.currency,
        preferredLog: state.preferredLog === 'auto' ? undefined : state.preferredLog,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    if (!data.entries.length) {
      setStatus(data.clarification || 'Nothing to log there. Try again with an amount or item.', 'error');
      return;
    }
    setStatus('');
    $('#transcript').value = '';

    if (state.settings.autoAdd) {
      for (const entry of data.entries) await addEntry(entry);
    } else {
      for (const entry of data.entries) renderPreview(entry);
    }
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Preview / confirm -----------------------------------------------------

function fieldInput(column, value) {
  const label = document.createElement('label');
  label.textContent = column.header;
  let input;
  const enums = {
    kind: ['Expense', 'Income'],
    action: ['Added', 'Removed', 'Used', 'Counted'],
    priority: ['High', 'Medium', 'Low'],
    status: ['Open', 'Done'],
  };
  if (enums[column.key]) {
    input = document.createElement('select');
    for (const opt of enums[column.key]) input.add(new Option(opt, opt));
    if (value) input.value = value;
  } else {
    input = document.createElement('input');
    input.type = column.format === 'date' ? 'date' : NUMERIC_FIELDS.has(column.key) ? 'number' : 'text';
    if (input.type === 'number') input.step = 'any';
    input.value = value ?? '';
  }
  input.dataset.key = column.key;
  label.append(input);
  return label;
}

function renderPreview(entry) {
  const node = $('#preview-template').content.firstElementChild.cloneNode(true);
  const logSelect = node.querySelector('.preview-log');
  for (const id of LOG_IDS) logSelect.add(new Option(LOGS[id].label, id));
  logSelect.value = entry.log;
  node.querySelector('.preview-summary').textContent = entry.summary;

  const fields = node.querySelector('.preview-fields');
  const renderFields = () => {
    fields.replaceChildren(
      ...LOGS[logSelect.value].columns
        .filter((c) => !c.key.startsWith('_'))
        .map((c) => fieldInput(c, entry[c.key])),
    );
  };
  renderFields();

  // Keep edited values when switching log type.
  logSelect.addEventListener('change', () => {
    Object.assign(entry, readFields(fields));
    entry.log = logSelect.value;
    renderFields();
  });

  node.querySelector('.discard').addEventListener('click', () => node.remove());
  node.querySelector('.add').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const ok = await addEntry({ ...entry, ...readFields(fields), log: logSelect.value });
    if (ok) node.remove();
    else e.currentTarget.disabled = false;
  });

  $('#previews').append(node);
}

function readFields(container) {
  const out = {};
  for (const el of container.querySelectorAll('[data-key]')) {
    const v = el.value.trim();
    out[el.dataset.key] = v === '' ? null : NUMERIC_FIELDS.has(el.dataset.key) ? Number(v) : v;
  }
  return out;
}

// Text that Sheets would treat as a formula is prefixed so it stays literal.
function cell(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const s = String(value);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

async function addEntry(entry) {
  const log = LOGS[entry.log];
  if (!log) return false;
  const row = log.columns.map((c) => {
    if (c.key === '_loggedAt') return localDateTime();
    if ((c.key === 'date') && !entry.date) return localDate();
    if (c.key === 'status' && !entry.status) return 'Open';
    return cell(entry[c.key]);
  });

  setStatus(`Adding to ${log.tab}…`, 'busy');
  try {
    const sheetId = await G.ensureTab(state.sheet, entry.log);
    await G.appendRow(state.sheet, entry.log, row);
    setStatus(`Added to ${log.tab}.`, 'ok');
    addRecent(entry, sheetId);
    return true;
  } catch (err) {
    setStatus(err.message, 'error');
    return false;
  }
}

function addRecent(entry, sheetId) {
  $('#recent').hidden = false;
  const li = document.createElement('li');
  const tag = document.createElement('a');
  tag.className = 'tag';
  tag.textContent = LOGS[entry.log].label;
  tag.href = G.spreadsheetUrl(state.sheet.id, sheetId);
  tag.target = '_blank';
  tag.rel = 'noopener';
  const text = document.createElement('span');
  text.textContent = entry.summary;
  li.append(tag, text);
  $('#recent-list').prepend(li);
}

// --- Settings --------------------------------------------------------------

function setupSettings() {
  const lang = $('#lang');
  const currency = $('#currency');
  const autoAdd = $('#auto-add');
  lang.value = state.settings.lang;
  currency.value = state.settings.currency;
  autoAdd.checked = state.settings.autoAdd;
  lang.addEventListener('change', () => store.set('lang', (state.settings.lang = lang.value)));
  currency.addEventListener('change', () => store.set('currency', (state.settings.currency = currency.value)));
  autoAdd.addEventListener('change', () => store.set('autoAdd', (state.settings.autoAdd = autoAdd.checked)));
}

// --- Boot ------------------------------------------------------------------

async function main() {
  renderLogPicker();
  setupSettings();
  setupSpeech();

  $('#sign-in').addEventListener('click', handleSignIn);
  $('#sign-out').addEventListener('click', handleSignOut);
  $('#link-form').addEventListener('submit', handleLinkSubmit);
  $('#create-sheet').addEventListener('click', handleCreateSheet);
  $('#change-sheet').addEventListener('click', () => showLink(true));
  $('#cancel-link').addEventListener('click', showMain);
  $('#text-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#transcript').value.trim();
    if (text) parseAndPreview(text);
  });
  $('#transcript').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#text-form').requestSubmit();
    }
  });

  const lastEmail = store.get('lastEmail');
  if (lastEmail) $('#sign-in-label').textContent = `Continue as ${lastEmail}`;

  const clientId = window.APP_CONFIG?.googleClientId;
  if (!clientId) {
    $('#config-warning').hidden = false;
    $('#sign-in').disabled = true;
    return;
  }
  try {
    await G.initAuth(clientId);
  } catch (err) {
    $('#config-warning').textContent = err.message;
    $('#config-warning').hidden = false;
  }
}

main();
