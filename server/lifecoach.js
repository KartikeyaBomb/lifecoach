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
]

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
    const value = trimmed.slice(separator + 1).trim()

    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

export function getConfig() {
  loadEnv()

  return {
    openAiApiKey: process.env.OPENAI_API_KEY,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    userPhoneNumber: process.env.USER_PHONE_NUMBER,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    appTimezone: process.env.APP_TIMEZONE || 'America/Chicago',
    dailyCallTime: process.env.DAILY_CALL_TIME || '20:30',
    port: Number(process.env.PORT || 8787),
  }
}

export function validateConfig(config = getConfig()) {
  const missing = requiredEnv.filter((key) => !process.env[key])

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
      appTimezone: config.appTimezone,
      dailyCallTime: config.dailyCallTime,
    },
  }
}

export function makeTwilioClient(config = getConfig()) {
  return twilio(config.twilioAccountSid, config.twilioAuthToken)
}

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

export function makePublicUrl(pathname) {
  const config = getConfig()

  if (!config.publicBaseUrl) {
    throw new Error('PUBLIC_BASE_URL is required for streamed coach calls')
  }

  return new URL(pathname, config.publicBaseUrl).toString()
}

export function makeStreamUrl() {
  const streamUrl = new URL(makePublicUrl('/api/call-stream'))
  streamUrl.protocol = streamUrl.protocol === 'https:' ? 'wss:' : 'ws:'

  return streamUrl.toString()
}

export function createCoachTwiMl() {
  const response = new twilio.twiml.VoiceResponse()

  response.say(
    { voice: 'alice' },
    'This is LifeCoach. I am connecting your live coaching session now.',
  )

  const connect = response.connect()
  connect.stream({
    name: 'lifecoach-coach-call',
    url: makeStreamUrl(),
  })

  return response.toString()
}

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
    url: makePublicUrl('/api/twiml/coach'),
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
