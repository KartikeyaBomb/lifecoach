import WebSocket from 'ws'
import { getConfig } from './lifecoach.js'
import { formatMemoryForPrompt, saveCompletedCall } from './memory-store.js'

const realtimeUrl = (model) =>
  `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`

const coachInstructions = `
You are LifeCoach, a private AI productivity coach.

This is Phase 1: goal discovery. The user has already entered initial goals in
the web app, but this call is where the real work happens.

Act like an elite productivity expert: reflective, direct, adaptive, calm, and
practical. Ask one question at a time. Use proven productivity systems when they
help, including SMART goals, OKRs, milestones, implementation intentions, habit
design, weekly reviews, constraint analysis, and environment design.

Your purpose in Phase 1 is to help the user clarify:
- Long-term goals
- Short-term goals
- Why each goal matters
- Milestones

Keep the conversation fluid. Do not finalize goals unless the user explicitly
agrees and you also believe the goals are clear enough. For now, keep the call
focused and short enough to test the system.
`.trim()

function sendJson(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

export function bridgeTwilioToOpenAi(twilioSocket) {
  const config = getConfig()
  const startedAt = new Date().toISOString()
  const turns = []
  const openAiSocket = new WebSocket(realtimeUrl(config.realtimeModel), {
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      'OpenAI-Safety-Identifier': 'lifecoach-local-user',
    },
  })

  let streamSid = null
  let callSid = null
  let openAiReady = false
  let saved = false
  const queuedAudio = []

  function flushQueuedAudio() {
    while (openAiReady && queuedAudio.length) {
      sendJson(openAiSocket, {
        type: 'input_audio_buffer.append',
        audio: queuedAudio.shift(),
      })
    }
  }

  async function saveCallMemory() {
    if (saved) return
    saved = true

    const result = await saveCompletedCall({
      callSid,
      streamSid,
      startedAt,
      endedAt: new Date().toISOString(),
      turns,
    })

    console.log(
      `Saved call memory: ${result.turnCount} turns, ${result.summary.memoryItems.length} memories`,
    )
  }

  openAiSocket.on('open', () => {
    console.log('OpenAI Realtime connected')
    openAiReady = true

    formatMemoryForPrompt()
      .then((memoryPrompt) => {
        sendJson(openAiSocket, {
          type: 'session.update',
          session: {
            type: 'realtime',
            model: config.realtimeModel,
            output_modalities: ['audio'],
            audio: {
              input: {
                format: {
                  type: 'audio/pcmu',
                },
                transcription: {
                  model: 'gpt-4o-mini-transcribe',
                },
                turn_detection: {
                  type: 'semantic_vad',
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: {
                format: {
                  type: 'audio/pcmu',
                },
                voice: config.realtimeVoice,
              },
            },
            instructions: `${coachInstructions}\n\nSaved memory to use in this call:\n${memoryPrompt}`,
          },
        })

        flushQueuedAudio()
      })
      .catch((error) => {
        console.log(`Memory prompt error: ${error instanceof Error ? error.message : error}`)
        twilioSocket.close()
      })
  })

  openAiSocket.on('message', (data) => {
    const event = JSON.parse(data.toString())

    if (event.type === 'session.updated') {
      console.log('OpenAI Realtime session updated')
      sendJson(openAiSocket, {
        type: 'response.create',
        response: {
          output_modalities: ['audio'],
          instructions:
            'Greet the user warmly in one sentence, then ask what they most want LifeCoach to help them clarify.',
        },
      })
      return
    }

    if (event.type === 'response.output_audio.delta' && streamSid) {
      sendJson(twilioSocket, {
        event: 'media',
        streamSid,
        media: {
          payload: event.delta,
        },
      })
      return
    }

    if (event.type === 'input_audio_buffer.speech_started' && streamSid) {
      sendJson(twilioSocket, {
        event: 'clear',
        streamSid,
      })
      return
    }

    if (event.type === 'response.output_audio_transcript.done') {
      console.log(`Coach: ${event.transcript}`)
      turns.push({
        role: 'coach',
        text: event.transcript,
        at: new Date().toISOString(),
      })
      return
    }

    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      console.log(`User: ${event.transcript}`)
      turns.push({
        role: 'user',
        text: event.transcript,
        at: new Date().toISOString(),
      })
      return
    }

    if (event.type === 'error') {
      console.log(`OpenAI Realtime error: ${JSON.stringify(event.error)}`)
      twilioSocket.close()
    }
  })

  openAiSocket.on('error', (error) => {
    console.log(`OpenAI Realtime socket error: ${error.message}`)
    twilioSocket.close()
  })

  openAiSocket.on('close', () => {
    console.log('OpenAI Realtime closed')
    twilioSocket.close()
  })

  twilioSocket.on('message', (data) => {
    const message = JSON.parse(data.toString())

    if (message.event === 'start') {
      streamSid = message.start?.streamSid || streamSid
      callSid = message.start?.callSid || callSid
      console.log(`Twilio media stream started: ${streamSid}`)
      return
    }

    if (message.event === 'media') {
      const payload = message.media?.payload
      if (!payload) return

      if (openAiReady) {
        sendJson(openAiSocket, {
          type: 'input_audio_buffer.append',
          audio: payload,
        })
      } else {
        queuedAudio.push(payload)
      }
      return
    }

    if (message.event === 'stop') {
      console.log(`Twilio media stream stopped: ${streamSid}`)
      saveCallMemory().catch((error) => {
        console.log(`Save memory error: ${error instanceof Error ? error.message : error}`)
      })
      openAiSocket.close()
    }
  })

  twilioSocket.on('close', () => {
    console.log(`Twilio media stream closed: ${streamSid}`)
    saveCallMemory().catch((error) => {
      console.log(`Save memory error: ${error instanceof Error ? error.message : error}`)
    })
    openAiSocket.close()
  })
}
