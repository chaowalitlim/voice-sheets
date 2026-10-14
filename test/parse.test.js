// Exercises parseUtterance against a local mock of the Anthropic API so the
// request shape and response handling can be checked without a real key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let server;
let lastRequest;
let nextReply;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastRequest = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nextReply));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

after(() => server.close());

const reply = (payload, stop_reason = 'end_turn') => ({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  stop_reason, stop_details: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const empty = (log) => ({
  log, summary: '', date: null, kind: null, amount: null, currency: null, category: null,
  merchant: null, item: null, action: null, quantity: null, unit: null, location: null,
  distance: null, from: null, to: null, purpose: null, habit: null, value: null,
  task: null, due: null, priority: null, status: null, notes: null,
});

test('parses an expense and sends a well-formed request', async () => {
  const { parseUtterance } = await import('../parse.js');
  nextReply = reply({
    entries: [{ ...empty('expenses'), summary: '$45.00 on Fuel', date: '2026-10-13', kind: 'Expense', amount: 45, currency: 'USD', category: 'Fuel' }],
    clarification: null,
  });

  const out = await parseUtterance({ text: 'Spent $45 on gas yesterday', today: '2026-10-14', timeZone: 'Asia/Bangkok', currency: 'USD' });
  assert.equal(out.entries[0].amount, 45);
  assert.equal(out.entries[0].date, '2026-10-13');

  const { body, headers } = lastRequest;
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.match(body.messages[0].content, /Today: 2026-10-14/);
  assert.match(body.messages[0].content, /Spent \$45 on gas yesterday/);
});

test('rejects output that does not match the schema', async () => {
  const { parseUtterance } = await import('../parse.js');
  nextReply = reply({ entries: [{ log: 'nope' }], clarification: null });
  await assert.rejects(parseUtterance({ text: 'x', today: '2026-10-14' }), /unexpected shape/);
});

test('surfaces refusals as a 422', async () => {
  const { parseUtterance } = await import('../parse.js');
  nextReply = { ...reply({}), content: [], stop_reason: 'refusal' };
  await assert.rejects(parseUtterance({ text: 'x', today: '2026-10-14' }), (e) => e.status === 422);
});
