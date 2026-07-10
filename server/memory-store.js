import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const { Pool } = pg

const storePath = path.resolve(process.cwd(), 'data', 'lifecoach-memory.json')

const emptyStore = {
  version: 1,
  phase: 'discovery',
  memories: [],
  calls: [],
}

let pool = null
let schemaReady = false

// Chooses Postgres persistence when Railway provides a DATABASE_URL.
function usingPostgres() {
  return Boolean(readEnv('DATABASE_URL'))
}

// Reuses a single Postgres pool for all memory reads and writes.
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: readEnv('DATABASE_URL'),
      ssl: readEnv('DATABASE_SSL') === 'false' ? false : { rejectUnauthorized: false },
    })
  }

  return pool
}

function readEnv(key) {
  const trimmed = (process.env[key] || '').trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

// Creates the call and memory tables on first use.
async function ensureSchema() {
  if (!usingPostgres() || schemaReady) return

  await getPool().query(`
    create table if not exists calls (
      id text primary key,
      call_sid text,
      stream_sid text,
      started_at timestamptz,
      ended_at timestamptz,
      turns jsonb not null default '[]'::jsonb,
      summary jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table if not exists memories (
      id text primary key,
      call_sid text,
      text text not null,
      created_at timestamptz not null default now()
    );
  `)

  schemaReady = true
}

// Ensures the local fallback data directory exists before writing JSON.
function ensureStoreDir() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
}

// Reads recent calls and memories from Postgres or local JSON.
export async function readMemoryStore() {
  if (usingPostgres()) {
    await ensureSchema()

    const [callsResult, memoriesResult] = await Promise.all([
      getPool().query(`
        select id, call_sid, stream_sid, started_at, ended_at, turns, summary
        from calls
        order by created_at asc
        limit 25
      `),
      getPool().query(`
        select id, call_sid, text, created_at
        from memories
        order by created_at asc
        limit 80
      `),
    ])

    return {
      ...cloneEmptyStore(),
      calls: callsResult.rows.map((row) => ({
        id: row.id,
        callSid: row.call_sid,
        streamSid: row.stream_sid,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        turns: row.turns,
        summary: row.summary,
      })),
      memories: memoriesResult.rows.map((row) => ({
        id: row.id,
        callSid: row.call_sid,
        createdAt: row.created_at,
        text: row.text,
      })),
    }
  }

  try {
    if (!fs.existsSync(storePath)) return cloneEmptyStore()

    return {
      ...cloneEmptyStore(),
      ...JSON.parse(fs.readFileSync(storePath, 'utf8')),
    }
  } catch {
    return cloneEmptyStore()
  }
}

// Writes the full local JSON memory store for development fallback mode.
export function writeMemoryStore(store) {
  ensureStoreDir()
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`)
}

// Formats saved memory as prompt text for the next realtime coaching call.
export async function formatMemoryForPrompt() {
  const store = await readMemoryStore()
  const recentMemories = store.memories.slice(-12)

  if (!recentMemories.length) {
    return 'No prior saved memory yet. Treat this as the first real coaching call.'
  }

  return recentMemories.map((memory) => `- ${memory.text}`).join('\n')
}

// Saves a completed call transcript and distilled memory items.
export async function saveCompletedCall({ callSid, streamSid, startedAt, endedAt, turns }) {
  const cleanTurns = turns.filter((turn) => turn.text?.trim())
  const summary = summarizeTurns(cleanTurns)
  const call = {
    id: callSid || streamSid || randomUUID(),
    callSid,
    streamSid,
    startedAt,
    endedAt,
    turns: cleanTurns,
    summary,
  }

  if (usingPostgres()) {
    await ensureSchema()

    const client = await getPool().connect()

    try {
      await client.query('begin')
      await client.query(
        `
          insert into calls (id, call_sid, stream_sid, started_at, ended_at, turns, summary)
          values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
          on conflict (id) do update set
            ended_at = excluded.ended_at,
            turns = excluded.turns,
            summary = excluded.summary
        `,
        [
          call.id,
          callSid,
          streamSid,
          startedAt,
          endedAt,
          JSON.stringify(cleanTurns),
          JSON.stringify(summary),
        ],
      )

      for (const text of summary.memoryItems) {
        await client.query(
          `
            insert into memories (id, call_sid, text, created_at)
            values ($1, $2, $3, $4)
          `,
          [randomUUID(), callSid, text, endedAt],
        )
      }

      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }

    return {
      path: 'postgres:DATABASE_URL',
      summary,
      turnCount: cleanTurns.length,
    }
  }

  const store = await readMemoryStore()
  store.calls.push(call)

  for (const text of summary.memoryItems) {
    store.memories.push({
      id: randomUUID(),
      callSid,
      createdAt: endedAt,
      text,
    })
  }

  store.memories = store.memories.slice(-80)
  store.calls = store.calls.slice(-25)
  writeMemoryStore(store)

  return {
    path: storePath,
    summary,
    turnCount: cleanTurns.length,
  }
}

// Returns a fresh copy of the empty memory store template.
function cloneEmptyStore() {
  return JSON.parse(JSON.stringify(emptyStore))
}

// Distills raw call transcript turns into a short summary and reusable memory.
function summarizeTurns(turns) {
  const userTurns = turns.filter((turn) => turn.role === 'user')
  const coachTurns = turns.filter((turn) => turn.role === 'coach')
  const memoryItems = []

  const lastUserText = userTurns.at(-1)?.text
  const longUserText = userTurns
    .map((turn) => turn.text)
    .filter((text) => text.length > 25)
    .slice(-4)

  for (const text of longUserText) {
    memoryItems.push(`User said: ${text}`)
  }

  const commitments = [
    ...userTurns.filter((turn) => /\b(i will|i'll|commit|sunday|daily|every day|tomorrow)\b/i.test(turn.text)),
    ...coachTurns.filter((turn) => /\b(commit|review|daily compass|milestone|30-day|30 day)\b/i.test(turn.text)),
  ]
    .map((turn) => `${turn.role === 'user' ? 'User commitment/context' : 'Coach recommendation'}: ${turn.text}`)
    .slice(-6)

  memoryItems.push(...commitments)

  if (lastUserText && !memoryItems.some((item) => item.includes(lastUserText))) {
    memoryItems.push(`Latest user context: ${lastUserText}`)
  }

  return {
    shortSummary:
      memoryItems[0] || 'Call completed, but no transcript text was captured.',
    memoryItems: [...new Set(memoryItems)].slice(-10),
  }
}
