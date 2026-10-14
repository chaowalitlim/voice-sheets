// Turns a spoken sentence into structured log entries using Claude.
// Stateless: nothing is stored or logged; the transcript is only sent to the
// Anthropic API for this one request.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LOGS, LOG_IDS, ENTRY_FIELDS, NUMERIC_FIELDS } from './shared/logs.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

let client;
const getClient = () => (client ??= new Anthropic());

const nullable = (type, description) => ({
  anyOf: [{ type }, { type: 'null' }],
  description,
});

const entryProperties = {
  log: { type: 'string', enum: LOG_IDS, description: 'Which log this entry belongs to.' },
  summary: { type: 'string', description: 'One short human-readable confirmation, e.g. "$45.00 on Fuel at Shell, Oct 13".' },
  ...Object.fromEntries(
    Object.entries(ENTRY_FIELDS).map(([key, desc]) => [
      key,
      nullable(NUMERIC_FIELDS.has(key) ? 'number' : 'string', desc),
    ]),
  ),
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      description: 'One entry per distinct item the speaker logged. Usually one.',
      items: {
        type: 'object',
        properties: entryProperties,
        required: Object.keys(entryProperties),
        additionalProperties: false,
      },
    },
    clarification: nullable(
      'string',
      'Only if the speech cannot be logged at all (no recognisable item): a short question to ask the user. Otherwise null.',
    ),
  },
  required: ['entries', 'clarification'],
  additionalProperties: false,
};

const EntrySchema = z
  .object({
    log: z.enum(LOG_IDS),
    summary: z.string(),
    ...Object.fromEntries(
      Object.keys(ENTRY_FIELDS).map((key) => [
        key,
        NUMERIC_FIELDS.has(key) ? z.number().nullable() : z.string().nullable(),
      ]),
    ),
  })
  .strict();

const ResultSchema = z.object({
  entries: z.array(EntrySchema),
  clarification: z.string().nullable(),
});

const SYSTEM_PROMPT = `You convert short spoken notes into rows for the user's Google Sheet.
The text comes from speech recognition, so expect missing punctuation, homophones and numbers spelled out ("forty five bucks" = 45). The speaker may use any language (e.g. Thai or English); write field values in the speaker's language, but keep enum values (log, kind, action, priority, status) exactly as specified.

Available logs:
${LOG_IDS.map((id) => `- ${id}: ${LOGS[id].hint}`).join('\n')}

Rules:
- Pick the single best log for each entry. If the user has preselected a log, use it unless the speech clearly belongs elsewhere.
- Split the speech into multiple entries only when it clearly describes separate items ("coffee 4 dollars and lunch 12").
- Fill only fields that apply to the chosen log; set every other field to null. Never invent amounts, quantities or places that were not said.
- "Spent", "paid", "bought" mean kind=Expense; "received", "earned", "got paid", "refund" mean kind=Income.
- Dates must be YYYY-MM-DD, resolved against the provided current date and time zone.
- If nothing loggable was said, return an empty entries array and a short clarification question.`;

export async function parseUtterance({ text, today, timeZone, currency, preferredLog }) {
  const context = [
    `Today: ${today}${timeZone ? ` (time zone ${timeZone})` : ''}`,
    `Default currency: ${currency || 'USD'}`,
    `Preselected log: ${preferredLog && LOG_IDS.includes(preferredLog) ? preferredLog : 'none (auto-detect)'}`,
  ].join('\n');

  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `${context}\n\n<speech>\n${text}\n</speech>`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new ParseError('The AI declined to process this entry.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ParseError('That was too long to parse. Try logging fewer items at once.', 422);
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new ParseError('The AI returned no result.', 502);

  let json;
  try {
    json = JSON.parse(textBlock.text);
  } catch {
    throw new ParseError('The AI returned malformed output.', 502);
  }
  const result = ResultSchema.safeParse(json);
  if (!result.success) throw new ParseError('The AI returned an unexpected shape.', 502);
  return result.data;
}

export class ParseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export { OUTPUT_SCHEMA };
