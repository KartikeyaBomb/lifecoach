import { createStreamedCoachCall, endCall, getConfig } from './lifecoach.js'

const checkEveryMs = 30 * 1000

let schedulerTimer = null
let lastScheduledDate = null

export function startDailyScheduler() {
  if (schedulerTimer) return

  const config = getConfig()
  console.log(
    `Daily scheduler active: ${config.dailyCallTime} ${config.appTimezone}, max ${Math.round(
      config.maxCallMs / 60000,
    )} minutes`,
  )

  schedulerTimer = setInterval(() => {
    runSchedulerTick().catch((error) => {
      console.log(`Scheduler error: ${error instanceof Error ? error.message : error}`)
    })
  }, checkEveryMs)

  runSchedulerTick().catch((error) => {
    console.log(`Scheduler error: ${error instanceof Error ? error.message : error}`)
  })
}

export function stopDailyScheduler() {
  if (!schedulerTimer) return

  clearInterval(schedulerTimer)
  schedulerTimer = null
}

export async function runSchedulerTick(now = new Date()) {
  const config = getConfig()
  const current = getPartsInTimezone(now, config.appTimezone)
  const scheduled = parseTime(config.dailyCallTime)
  const todayKey = `${current.year}-${current.month}-${current.day}`

  if (lastScheduledDate === todayKey) return
  if (current.hour !== scheduled.hour || current.minute !== scheduled.minute) return

  lastScheduledDate = todayKey
  console.log(`Starting scheduled LifeCoach call for ${todayKey}`)

  const call = await createStreamedCoachCall()
  console.log(`Scheduled call started: ${call.sid}`)

  setTimeout(() => {
    endCall(call.sid)
      .then((result) => {
        console.log(`Max call length reached. Ended call: ${result.sid}`)
      })
      .catch((error) => {
        console.log(`Failed to end max-length call: ${error instanceof Error ? error.message : error}`)
      })
  }, config.maxCallMs)
}

function parseTime(value) {
  const [hour, minute] = value.split(':').map(Number)

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid DAILY_CALL_TIME: ${value}`)
  }

  return { hour, minute }
}

function getPartsInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}
