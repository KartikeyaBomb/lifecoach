import { createTestCall } from './lifecoach.js'

try {
  const call = await createTestCall()
  console.log(`Test call started: ${call.sid}`)
  console.log(`From ${call.from} to ${call.to}`)
  console.log(`Initial status: ${call.status}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
