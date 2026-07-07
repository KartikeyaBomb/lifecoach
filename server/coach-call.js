import { triggerDailyCoachCall } from './scheduler.js'

try {
  const result = await triggerDailyCoachCall({ source: 'manual-script' })

  if (!result.ok) {
    console.log(result.message)
    process.exit(0)
  }

  const { call } = result
  console.log(`Streamed coach call started: ${call.sid}`)
  console.log(`From ${call.from} to ${call.to}`)
  console.log(`Initial status: ${call.status}`)
  console.log(`Webhook URL: ${call.webhookUrl}`)
  console.log(`Stream URL configured: ${Boolean(call.streamUrl)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
