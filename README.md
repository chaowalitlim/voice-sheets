# Voice Sheets

Log things into **your own Google Sheet** by speaking. Tap the mic and say:

- “Spent $45 on gas yesterday”
- “Received $350 consulting fee”
- “Used 3 boxes of nitrile gloves at site B”
- “Drove 42 miles from the office to the Chonburi plant for an inspection”
- “Ran 5 km this morning”
- “Remind me to renew the car insurance by Friday, high priority”

The AI picks out the date, amount, category, merchant and other fields. You can review and edit them, and then the app adds a formatted row to the right tab of your spreadsheet.

## Log types

Each log type has its own tab, created automatically with a bold, frozen header row and formatted columns.

| Tab | Columns |
|---|---|
| Expenses | Date · Type (Expense/Income) · Amount · Currency · Category · Merchant / Payer · Notes · Logged At |
| Inventory | Date · Item · Action · Quantity · Unit · Location · Notes · Logged At |
| Mileage | Date · Distance · Unit · From · To · Purpose · Notes · Logged At |
| Habits | Date · Habit · Value · Unit · Notes · Logged At |
| To-Do | Created · Task · Due · Priority · Status · Notes · Logged At |

To add or change a log type, edit `shared/logs.js`. The AI prompt, schema and sheet layout are all generated from that file.

## Privacy model

```
 Browser ──(your Google OAuth token)──▶ Google Sheets API      ← all spreadsheet reads/writes
    │
    └──(transcript text only)──▶ this server ──▶ Claude API    ← parsing, nothing stored
```

- **Your spreadsheet never touches the server.** The browser calls the Google Sheets API directly with your own access token, using Google Identity Services.
- **The app has no database.** The server is stateless. It receives only the sentence you spoke, plus today's date, your time zone and your default currency. It forwards these to Claude, returns the parsed fields and keeps nothing. Request bodies are never logged.
- **The server verifies your Google token** with Google's `tokeninfo` endpoint, so only signed-in users of *your* OAuth client can use your AI credits. It does not store the token and does not use it for anything else.
- **Speech recognition** uses the browser's built-in Web Speech API. Chrome and Edge send audio to their vendor's speech service for this. Safari may process speech on the device.
- **The browser's `localStorage` holds only** the linked spreadsheet ID and your settings.

## Setup

### 1. Google OAuth client (about 5 minutes)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. **APIs & Services → Library**: enable **Google Sheets API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, or **Internal** if you're on Google Workspace.
   - Add the scope `.../auth/spreadsheets`.
   - While the app is in *Testing*, add your Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `http://localhost:3000`, plus your production URL later (for example `https://voice.example.com`)
   - You don't need a redirect URI, because the app uses the popup token flow.
5. Copy the **Client ID**.

### 2. Anthropic API key

Create a key at <https://platform.claude.com> → API Keys.

### 3. Run it

```bash
cp .env.example .env      # then fill in ANTHROPIC_API_KEY and GOOGLE_CLIENT_ID
npm install
npm start                 # http://localhost:3000
```

Set `ALLOWED_EMAILS=you@gmail.com` in `.env` to make it a personal app that nobody else can use.

### 4. Use it

1. Sign in with Google.
2. Paste a spreadsheet URL, or click **Create a new “Voice Log” spreadsheet**.
3. Pick a log type, or leave **Auto-detect** on. Tap the mic and speak.
4. Review the card and tap **Add to sheet**. If you want rows added right away, turn on **Settings → Add rows immediately**.

You can also type into the text box instead of speaking. Pick your speech language in Settings; Thai (`th-TH`) and several other languages are included.

## Deploying

The app is a single Node 20+ process with no database, so any Node host works: Render, Railway, Fly.io, Cloud Run, a VPS, and so on.

- Set `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID` and, optionally, `ALLOWED_EMAILS` as environment variables.
- **Serve it over HTTPS.** Browsers only allow microphone access on `https://` or `localhost`.
- Add the production origin to the OAuth client's **Authorized JavaScript origins**.
- To let people outside your test-user list sign in, publish the OAuth consent screen. The `spreadsheets` scope is "sensitive", so Google requires app verification for a public app. For personal or team use, *Testing* mode with listed test users (up to 100) or an *Internal* Workspace app works fine.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Used to parse speech. |
| `GOOGLE_CLIENT_ID` | — | Required. OAuth Web client ID. |
| `ALLOWED_EMAILS` | *(anyone)* | Comma-separated allowlist of Google accounts. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for parsing. |
| `RATE_LIMIT_PER_MIN` | `20` | Parse requests per user per minute. |
| `PORT` | `3000` | HTTP port. |

## Project layout

```
server.js          Express server: static files, /config.js, /api/parse (auth + rate limit)
parse.js           Claude call with a strict JSON schema → validated entries
shared/logs.js     Log types, columns and field descriptions (used by server and browser)
public/index.html  UI
public/app.js      Speech capture, review cards, settings
public/google.js   Google sign-in + Sheets API (create sheet, add/format tabs, append rows)
test/              Parser tests against a mock Anthropic API (npm test)
```
