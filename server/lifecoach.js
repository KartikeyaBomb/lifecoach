import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import twilio from 'twilio'

const requiredEnv = [
  'OPENAI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'USER_PHONE_NUMBER',
  'LIFECOACH_ADMIN_TOKEN',
  'STREAM_AUTH_TOKEN',
]

// Loads local env vars for development without overwriting real process env.
export function loadEnv(file = '.env.local') {
  const envPath = path.resolve(process.cwd(), file)

  if (!fs.existsSync(envPath)) {
    return
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf('=')
    if (separator === -1) continue

    const key = trimmed.slice(0, separator).trim()
    const value = cleanEnvValue(trimmed.slice(separator + 1))

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

// Collects all runtime configuration used by calls, scheduling, and the API.
export function getConfig() {
  loadEnv()

  const maxCallMinutes = Number(readEnv('MAX_CALL_MINUTES') || 5)

  return {
    openAiApiKey: readEnv('OPENAI_API_KEY'),
    twilioAccountSid: readEnv('TWILIO_ACCOUNT_SID'),
    twilioAuthToken: readEnv('TWILIO_AUTH_TOKEN'),
    twilioPhoneNumber: readEnv('TWILIO_PHONE_NUMBER'),
    userPhoneNumber: readEnv('USER_PHONE_NUMBER'),
    publicBaseUrl: normalizePublicBaseUrl(readEnv('PUBLIC_BASE_URL')),
    adminToken: readEnv('LIFECOACH_ADMIN_TOKEN'),
    streamAuthToken: readEnv('STREAM_AUTH_TOKEN'),
    realtimeModel: readEnv('OPENAI_REALTIME_MODEL') || 'gpt-realtime-2',
    realtimeVoice: readEnv('OPENAI_REALTIME_VOICE') || 'marin',
    appTimezone: readEnv('APP_TIMEZONE') || 'America/Chicago',
    dailyCallTime: readEnv('DAILY_CALL_TIME') || '20:30',
    maxCallMs: maxCallMinutes * 60 * 1000,
    port: Number(readEnv('PORT') || 8787),
  }
}

// Reports whether all required secrets and phone settings are present.
export function validateConfig(config = getConfig()) {
  const missing = requiredEnv.filter((key) => !readEnv(key))

  return {
    ok: missing.length === 0,
    missing,
    configured: {
      openAiApiKey: Boolean(config.openAiApiKey),
      twilioAccountSid: Boolean(config.twilioAccountSid),
      twilioAuthToken: Boolean(config.twilioAuthToken),
      twilioPhoneNumber: Boolean(config.twilioPhoneNumber),
      userPhoneNumber: Boolean(config.userPhoneNumber),
      publicBaseUrl: Boolean(config.publicBaseUrl),
      adminToken: Boolean(config.adminToken),
      streamAuthToken: Boolean(config.streamAuthToken),
      realtimeModel: config.realtimeModel,
      realtimeVoice: config.realtimeVoice,
      appTimezone: config.appTimezone,
      dailyCallTime: config.dailyCallTime,
      maxCallMinutes: Math.round(config.maxCallMs / 60000),
    },
  }
}

function readEnv(key) {
  return cleanEnvValue(process.env[key] || '')
}

function cleanEnvValue(value) {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function normalizePublicBaseUrl(value) {
  if (!value) return ''

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return `https://${value}`
}

// Creates an authenticated Twilio client from the current config.
export function makeTwilioClient(config = getConfig()) {
  return twilio(config.twilioAccountSid, config.twilioAuthToken)
}

// Starts a simple non-streaming Twilio call to prove outbound calling works.
export async function createTestCall() {
  const config = getConfig()
  const validation = validateConfig(config)

  if (!validation.ok) {
    throw new Error(`Missing required env vars: ${validation.missing.join(', ')}`)
  }

  const client = makeTwilioClient(config)
  const call = await client.calls.create({
    to: config.userPhoneNumber,
    from: config.twilioPhoneNumber,
    twiml: [
      '<Response>',
      '<Say voice="alice">',
      'This is LifeCoach. Your daily call system is connected.',
      '</Say>',
      '<Pause length="1"/>',
      '<Say voice="alice">',
      'Next we will connect this call to your AI productivity coach.',
      '</Say>',
      '</Response>',
    ].join(''),
  })

  return {
    sid: call.sid,
    status: call.status,
    to: config.userPhoneNumber,
    from: config.twilioPhoneNumber,
  }
}

// Builds an absolute public URL that Twilio can call back into.
export function makePublicUrl(pathname) {
  const config = getConfig()

  if (!config.publicBaseUrl) {
    throw new Error('PUBLIC_BASE_URL is required for streamed coach calls')
  }

  return new URL(pathname, config.publicBaseUrl).toString()
}

// Builds the authenticated websocket URL for Twilio Media Streams.
export function makeStreamUrl() {
  const config = getConfig()

  if (!config.streamAuthToken) {
    throw new Error('STREAM_AUTH_TOKEN is required for streamed coach calls')
  }

  const streamUrl = new URL(makePublicUrl('/api/call-stream'))
  streamUrl.protocol = streamUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  streamUrl.searchParams.set('token', config.streamAuthToken)

  return streamUrl.toString()
}

// Generates the TwiML that tells Twilio to connect the call audio to this server.
export function createCoachTwiMl() {
  const response = new twilio.twiml.VoiceResponse()

  response.say({ voice: 'alice' }, 'LifeCoach is connecting.')

  const connect = response.connect()
  connect.stream({
    name: 'lifecoach-coach-call',
    statusCallback: makePublicUrl('/api/twilio/stream-status'),
    statusCallbackMethod: 'POST',
    url: makeStreamUrl(),
  })

  return response.toString()
}

// Starts the real AI coach call and connects it to the Twilio media stream.
export async function createStreamedCoachCall() {
  const config = getConfig()
  const validation = validateConfig(config)

  if (!validation.ok) {
    throw new Error(`Missing required env vars: ${validation.missing.join(', ')}`)
  }

  if (!config.publicBaseUrl) {
    throw new Error('PUBLIC_BASE_URL is required for streamed coach calls')
  }

  const client = makeTwilioClient(config)
  const call = await client.calls.create({
    to: config.userPhoneNumber,
    from: config.twilioPhoneNumber,
    twiml: createCoachTwiMl(),
    timeLimit: Math.round(config.maxCallMs / 1000),
  })

  return {
    sid: call.sid,
    status: call.status,
    to: config.userPhoneNumber,
    from: config.twilioPhoneNumber,
    webhookUrl: makePublicUrl('/api/twiml/coach'),
    streamUrl: makeStreamUrl(),
  }
}

// Forces an active Twilio call to end after the configured max call length.
export async function endCall(callSid) {
  const client = makeTwilioClient()
  const call = await client.calls(callSid).update({ status: 'completed' })

  return {
    sid: call.sid,
    status: call.status,
  }
}
