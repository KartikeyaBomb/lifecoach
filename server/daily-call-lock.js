import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg

const lockPath = path.resolve(process.cwd(), 'data', 'daily-call-locks.json')

let pool = null
let schemaReady = false

function usingPostgres() {
  return Boolean(process.env.DATABASE_URL)
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    })
  }

  return pool
}

async function ensureSchema() {
  if (!usingPostgres() || schemaReady) return

  await getPool().query(`
    create table if not exists daily_call_locks (
      date_key text primary key,
      source text not null,
      call_sid text,
      created_at timestamptz not null default now()
    );
  `)

  schemaReady = true
}

export async function reserveDailyCall({ dateKey, source }) {
  if (usingPostgres()) {
    await ensureSchema()

    const result = await getPool().query(
      `
        insert into daily_call_locks (date_key, source)
        values ($1, $2)
        on conflict (date_key) do nothing
        returning date_key, source, call_sid, created_at
      `,
      [dateKey, source],
    )

    if (result.rowCount === 1) {
      return { reserved: true, lock: normalizeLock(result.rows[0]) }
    }

    return { reserved: false, lock: await getDailyCallLock(dateKey) }
  }

  const locks = readLocalLocks()

  if (locks[dateKey]) {
    return { reserved: false, lock: locks[dateKey] }
  }

  locks[dateKey] = {
    dateKey,
    source,
    callSid: null,
    createdAt: new Date().toISOString(),
  }
  writeLocalLocks(locks)

  return { reserved: true, lock: locks[dateKey] }
}

export async function completeDailyCallReservation({ dateKey, callSid }) {
  if (usingPostgres()) {
    await ensureSchema()
    await getPool().query('update daily_call_locks set call_sid = $1 where date_key = $2', [
      callSid,
      dateKey,
    ])
    return
  }

  const locks = readLocalLocks()

  if (locks[dateKey]) {
    locks[dateKey].callSid = callSid
    writeLocalLocks(locks)
  }
}

export async function releaseDailyCallReservation(dateKey) {
  if (usingPostgres()) {
    await ensureSchema()
    await getPool().query('delete from daily_call_locks where date_key = $1 and call_sid is null', [
      dateKey,
    ])
    return
  }

  const locks = readLocalLocks()

  if (locks[dateKey] && !locks[dateKey].callSid) {
    delete locks[dateKey]
    writeLocalLocks(locks)
  }
}

async function getDailyCallLock(dateKey) {
  if (usingPostgres()) {
    const result = await getPool().query(
      'select date_key, source, call_sid, created_at from daily_call_locks where date_key = $1',
      [dateKey],
    )

    return result.rows[0] ? normalizeLock(result.rows[0]) : null
  }

  return readLocalLocks()[dateKey] || null
}

function normalizeLock(row) {
  return {
    dateKey: row.date_key,
    source: row.source,
    callSid: row.call_sid,
    createdAt: row.created_at,
  }
}

function readLocalLocks() {
  try {
    if (!fs.existsSync(lockPath)) return {}

    return JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  } catch {
    return {}
  }
}

function writeLocalLocks(locks) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  fs.writeFileSync(lockPath, `${JSON.stringify(locks, null, 2)}\n`)
}
