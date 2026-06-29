import http from 'node:http'
import { WebSocketServer } from 'ws'
import {
  createCoachTwiMl,
  createStreamedCoachCall,
  createTestCall,
  getConfig,
  validateConfig,
} from './lifecoach.js'
import { readMemoryStore } from './memory-store.js'
import { bridgeTwilioToOpenAi } from './realtime-bridge.js'
import { startDailyScheduler } from './scheduler.js'

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(payload, null, 2))
}

function sendXml(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/xml',
  })
  response.end(payload)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.on('data', (chunk) => {
      body += chunk.toString()
    })

    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)
  console.log(`${request.method} ${url.pathname}`)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'lifecoach-api' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    const config = getConfig()
    sendJson(response, 200, {
      phase: 'setup',
      nextCall: {
        time: config.dailyCallTime,
        timezone: config.appTimezone,
        maxMinutes: Math.round(config.maxCallMs / 60000),
      },
      env: validateConfig(config),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/memory') {
    const store = readMemoryStore()
    const latestCall = store.calls.at(-1)

    sendJson(response, 200, {
      phase: store.phase,
      memoryCount: store.memories.length,
      callCount: store.calls.length,
      latestCall: latestCall
        ? {
            id: latestCall.id,
            startedAt: latestCall.startedAt,
            endedAt: latestCall.endedAt,
            turnCount: latestCall.turns.length,
            summary: latestCall.summary.shortSummary,
          }
        : null,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/test-call') {
    try {
      const call = await createTestCall()
      sendJson(response, 200, { ok: true, call })
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/coach-call') {
    try {
      const call = await createStreamedCoachCall()
      sendJson(response, 200, { ok: true, call })
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/twiml/coach') {
    try {
      sendXml(response, 200, createCoachTwiMl())
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/twilio/stream-status') {
    const body = await readBody(request)
    console.log(`Twilio stream status: ${body}`)
    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 404, { ok: false, error: 'Not found' })
}

const config = getConfig()
const validation = validateConfig(config)

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  })
})

const streams = new WebSocketServer({ noServer: true })

streams.on('connection', (socket) => bridgeTwilioToOpenAi(socket))

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`)
  console.log(`UPGRADE ${url.pathname}`)

  if (url.pathname !== '/api/call-stream') {
    console.log(`Rejected websocket path: ${url.pathname}`)
    socket.destroy()
    return
  }

  streams.handleUpgrade(request, socket, head, (websocket) => {
    console.log('Accepted Twilio media websocket')
    streams.emit('connection', websocket, request)
  })
})

server.listen(config.port, () => {
  console.log(`LifeCoach API listening on http://localhost:${config.port}`)

  if (!validation.ok) {
    console.log(`Missing env vars: ${validation.missing.join(', ')}`)
  }

  if (validation.ok && config.publicBaseUrl) {
    startDailyScheduler()
  } else {
    console.log('Daily scheduler waiting for valid env and PUBLIC_BASE_URL')
  }
})
