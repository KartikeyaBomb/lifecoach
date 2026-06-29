import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const storePath = path.resolve(process.cwd(), 'data', 'lifecoach-memory.json')

const emptyStore = {
  version: 1,
  phase: 'discovery',
  memories: [],
  calls: [],
}

function ensureStoreDir() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
}

export function readMemoryStore() {
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

export function writeMemoryStore(store) {
  ensureStoreDir()
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`)
}

export function formatMemoryForPrompt() {
  const store = readMemoryStore()
  const recentMemories = store.memories.slice(-12)

  if (!recentMemories.length) {
    return 'No prior saved memory yet. Treat this as the first real coaching call.'
  }

  return recentMemories
    .map((memory) => `- ${memory.text}`)
    .join('\n')
}

export function saveCompletedCall({ callSid, streamSid, startedAt, endedAt, turns }) {
  const cleanTurns = turns.filter((turn) => turn.text?.trim())
  const summary = summarizeTurns(cleanTurns)
  const store = readMemoryStore()

  store.calls.push({
    id: callSid || streamSid || randomUUID(),
    callSid,
    streamSid,
    startedAt,
    endedAt,
    turns: cleanTurns,
    summary,
  })

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

function cloneEmptyStore() {
  return JSON.parse(JSON.stringify(emptyStore))
}

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
