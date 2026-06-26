import { createStreamedCoachCall } from './lifecoach.js'

try {
  const call = await createStreamedCoachCall()
  console.log(`Streamed coach call started: ${call.sid}`)
  console.log(`From ${call.from} to ${call.to}`)
  console.log(`Initial status: ${call.status}`)
  console.log(`Webhook URL: ${call.webhookUrl}`)
  console.log(`Stream URL: ${call.streamUrl}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
