import http from 'node:http'
import { WebSocketServer } from 'ws'
import {
  createCoachTwiMl,
  createStreamedCoachCall,
  createTestCall,
  getConfig,
  validateConfig,
} from './lifecoach.js'

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

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`)

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
      },
      env: validateConfig(config),
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

streams.on('connection', (socket) => {
  let streamSid = 'unknown'

  socket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString())

      if (message.event === 'start') {
        streamSid = message.start?.streamSid || streamSid
        console.log(`Twilio media stream started: ${streamSid}`)
      }

      if (message.event === 'media') {
        process.stdout.write('.')
      }

      if (message.event === 'stop') {
        console.log(`\nTwilio media stream stopped: ${streamSid}`)
      }
    } catch {
      console.log('Received non-JSON stream message')
    }
  })

  socket.on('close', () => {
    console.log(`\nTwilio media stream closed: ${streamSid}`)
  })
})

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (url.pathname !== '/api/call-stream') {
    socket.destroy()
    return
  }

  streams.handleUpgrade(request, socket, head, (websocket) => {
    streams.emit('connection', websocket, request)
  })
})

server.listen(config.port, () => {
  console.log(`LifeCoach API listening on http://localhost:${config.port}`)

  if (!validation.ok) {
    console.log(`Missing env vars: ${validation.missing.join(', ')}`)
  }
})
