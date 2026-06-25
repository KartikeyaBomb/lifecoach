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

Twilio is pay-as-you-go for voice calls. OpenAI Realtime is billed by model/audio
usage. Trial credits may help while testing, but production phone calls are not
free forever.

## Local Development

```bash
npm install
npm run dev
```
