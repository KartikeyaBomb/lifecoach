# LifeCoach

Minimal MVP for a private AI productivity coach whose real interface is a daily
outbound phone call at 8:30 PM CT.

## Product Flow

### Phase 1: Goal Discovery

The user enters a phone number and one initial goal dump. After that, daily
phone calls clarify the user's real goals through a dynamic coaching
conversation.

The coach should use expert productivity judgment and blend proven systems when
useful, including SMART goals, OKRs, milestone planning, implementation
intentions, habit design, weekly review loops, and constraint analysis.

Phase 1 ends only when both the user and coach agree on a finalized goal plan
during a call.

### Phase 2: Execution

The finalized goals become read-only in the web app. Daily phone calls continue
at 8:30 PM CT and focus on the user's actions, patterns, blockers, energy, and
next commitments.

The coach should be reflective, direct, adaptive, and willing to recommend
schedule changes, habit changes, environmental changes, dropping low-value work,
or reopening goal discovery if the original goals no longer fit.

## Finalized Goal Shape

Only these should be visible in the web app:

- Long-term goals
- Short-term goals
- Why each goal matters
- Milestones

Everything else belongs in private coach memory for future calls, not in the UI.

## Backend Contract To Build Next

This frontend currently stores the setup state locally. The production backend
should own these transitions:

- `POST /api/intake` saves phone number and initial goals, then schedules Phase 1.
- `POST /api/calls/daily` triggers the 8:30 PM CT outbound call.
- `POST /api/calls/transcript` stores call transcript and private coach memory.
- `POST /api/goals/finalize` moves the user from Phase 1 to Phase 2 after call agreement.
- `POST /api/goals/reopen` moves the user back to Phase 1 after call agreement.
- `GET /api/status` returns current phase, next call time, and read-only finalized goals.

## Official Setup Path

Recommended first real stack:

- Twilio Programmable Voice for outbound calls.
- OpenAI Realtime API for live speech-to-speech coaching.
- A small Node backend for scheduling, state, memory, and call webhooks.
- A database such as Postgres or SQLite for users, goals, memories, transcripts,
  and call status.

## Daily Scheduling

The local API process schedules one outbound AI coach call per day:

```bash
APP_TIMEZONE=America/Chicago
DAILY_CALL_TIME=20:30
MAX_CALL_MINUTES=5
```

The scheduler only runs while the API server is running:

```bash
npm run dev:api
```

On Railway, the service must run the API process:

```bash
npm start
```

Set `PUBLIC_BASE_URL` to the Railway public HTTPS URL for this service. The
scheduler starts only when required env vars are present and `PUBLIC_BASE_URL`
is set. If you change `DAILY_CALL_TIME`, Railway restarts the service; the app
will still place the call if it comes up within 10 minutes after the scheduled
time, and logs the next scheduled call on startup.

You can manually trigger today's scheduled coach call with:

```bash
curl -X POST -H "Authorization: Bearer $LIFECOACH_ADMIN_TOKEN" https://your-railway-url.up.railway.app/api/coach-call
```

This endpoint is limited to one successful trigger per `APP_TIMEZONE` day. On
Railway, set `DATABASE_URL` so that daily limit survives deploys and restarts.

For more durable production scheduling, move the trigger into a deployed worker
or managed cron job so the call is not tied to a single web process timer.

Twilio is pay-as-you-go for voice calls. OpenAI Realtime is billed by model/audio
usage. Trial credits may help while testing, but production phone calls are not
free forever.

## Security

Endpoints that can spend money or expose private memory require:

```bash
Authorization: Bearer $LIFECOACH_ADMIN_TOKEN
```

Protected endpoints:

- `POST /api/test-call`
- `POST /api/coach-call`
- `POST /api/twiml/coach`
- `GET /api/memory`

The Twilio media WebSocket also requires `STREAM_AUTH_TOKEN` in the generated
stream URL. Set both tokens in Railway variables and keep them private.

## Local Development

```bash
npm install
npm run dev
```

Run the API server in a second terminal:

```bash
npm run dev:api
```

Check the backend status:

```bash
curl http://localhost:8787/api/status
```

Start one Twilio test call:

```bash
npm run test:call
```

The test call uses Twilio's `twiml` parameter directly, so it does not need
ngrok yet.

## Streamed Coach Call

To test Twilio Media Streams locally, expose the API server with ngrok:

```bash
ngrok http 8787
```

Copy the HTTPS forwarding URL into `.env.local`:

```bash
PUBLIC_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

Restart the API server after changing `.env.local`, then start one streamed call:

```bash
npm run test:coach-call
```

The streamed call currently proves that Twilio can reach the backend WebSocket.
You should hear the connection message, and the API terminal should print dots
as audio frames arrive. The next milestone is bridging those audio frames to
OpenAI Realtime and sending the coach's audio back into the call.

## Memory

Completed AI calls are saved to Postgres when `DATABASE_URL` is present. If
`DATABASE_URL` is missing, the app falls back to local JSON:

```bash
data/lifecoach-memory.json
```

The `data/` directory is ignored by git because it may contain private
transcripts and coaching memory.

On Railway, add a Postgres service to the project, then add the Postgres
connection string to the LifeCoach service as:

```bash
DATABASE_URL=postgresql://...
```

The app creates its own `calls` and `memories` tables on first use.

Check memory status:

```bash
curl -H "Authorization: Bearer $LIFECOACH_ADMIN_TOKEN" http://localhost:8787/api/memory
```
