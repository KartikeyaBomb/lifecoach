import { createStreamedCoachCall, endCall, getConfig } from './lifecoach.js'
import {
  completeDailyCallReservation,
  releaseDailyCallReservation,
  reserveDailyCall,
} from './daily-call-lock.js'

const checkEveryMs = 30 * 1000
const missedCallGraceMs = 10 * 60 * 1000

let schedulerTimer = null
let lastScheduledDate = null
let schedulerInFlight = false

// Starts the in-process daily scheduler for the configured local call time.
export function startDailyScheduler() {
  if (schedulerTimer) return

  const config = getConfig()
  console.log(
    `Daily scheduler active: ${config.dailyCallTime} ${config.appTimezone}, max ${Math.round(
      config.maxCallMs / 60000,
    )} minutes`,
  )
  console.log(`Next scheduled LifeCoach call: ${formatScheduleForLog(new Date(), config)}`)

  schedulerTimer = setInterval(() => {
    runSchedulerTick().catch((error) => {
      console.log(`Scheduler error: ${error instanceof Error ? error.message : error}`)
    })
  }, checkEveryMs)

  runSchedulerTick().catch((error) => {
    console.log(`Scheduler error: ${error instanceof Error ? error.message : error}`)
  })
}

// Stops the in-process scheduler, mainly useful for tests or future shutdown hooks.
export function stopDailyScheduler() {
  if (!schedulerTimer) return

  clearInterval(schedulerTimer)
  schedulerTimer = null
}

// Checks whether the current time is inside today's scheduled call window.
export async function runSchedulerTick(now = new Date()) {
  if (schedulerInFlight) return

  const config = getConfig()
  const current = getPartsInTimezone(now, config.appTimezone)
  const scheduled = parseTime(config.dailyCallTime)
  const todayKey = `${current.year}-${current.month}-${current.day}`
  const scheduledAt = getScheduledDate(now, config.appTimezone, scheduled)
  const msAfterScheduled = now.getTime() - scheduledAt.getTime()

  if (lastScheduledDate === todayKey) return
  if (msAfterScheduled < 0 || msAfterScheduled > missedCallGraceMs) return

  await triggerDailyCoachCall({ now, source: 'scheduled' })
}

// Starts today's coach call if the daily lock has not already been used.
export async function triggerDailyCoachCall({ now = new Date(), source = 'manual' } = {}) {
  if (schedulerInFlight) {
    return {
      ok: false,
      reason: 'call_in_progress',
      message: 'A LifeCoach call is already being started.',
    }
  }

  const config = getConfig()
  const current = getPartsInTimezone(now, config.appTimezone)
  const todayKey = `${current.year}-${current.month}-${current.day}`
  const reservation = await reserveDailyCall({ dateKey: todayKey, source })

  if (!reservation.reserved) {
    return {
      ok: false,
      reason: 'already_called_today',
      dateKey: todayKey,
      lock: reservation.lock,
      message: `LifeCoach call already triggered for ${todayKey}.`,
    }
  }

  schedulerInFlight = true
  let callStarted = false

  try {
    console.log(`Starting ${source} LifeCoach call for ${todayKey}`)

    const call = await createStreamedCoachCall()
    callStarted = true
    try {
      await completeDailyCallReservation({ dateKey: todayKey, callSid: call.sid })
    } catch (error) {
      console.log(`Call started, but failed to update daily call lock: ${error instanceof Error ? error.message : error}`)
    }
    lastScheduledDate = todayKey
    console.log(`${capitalize(source)} call started: ${call.sid}`)
    console.log(`Next scheduled LifeCoach call: ${formatScheduleForLog(now, config, 1)}`)

    setTimeout(() => {
      endCall(call.sid)
        .then((result) => {
          console.log(`Max call length reached. Ended call: ${result.sid}`)
        })
        .catch((error) => {
          console.log(`Failed to end max-length call: ${error instanceof Error ? error.message : error}`)
        })
    }, config.maxCallMs)

    return {
      ok: true,
      dateKey: todayKey,
      call,
    }
  } catch (error) {
    if (!callStarted) {
      await releaseDailyCallReservation(todayKey)
    }

    throw error
  } finally {
    schedulerInFlight = false
  }
}

// Parses HH:mm schedule strings and rejects invalid times.
function parseTime(value) {
  const [hour, minute] = value.split(':').map(Number)

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid DAILY_CALL_TIME: ${value}`)
  }

  return { hour, minute }
}

// Converts today's configured app-local call time into an absolute Date.
function getScheduledDate(now, timeZone, scheduled) {
  const current = getPartsInTimezone(now, timeZone)
  const offsetMs = getTimezoneOffsetMs(now, timeZone)

  return new Date(
    Date.UTC(
      Number(current.year),
      Number(current.month) - 1,
      Number(current.day),
      scheduled.hour,
      scheduled.minute,
    ) - offsetMs,
  )
}

// Computes the timezone offset needed to translate local app time to UTC.
function getTimezoneOffsetMs(date, timeZone) {
  const parts = getPartsInTimezone(date, timeZone)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour,
    parts.minute,
    parts.second,
  )

  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

// Formats the next scheduled call time for Railway/local logs.
function formatScheduleForLog(now, config, dayOffset = 0) {
  const scheduled = parseTime(config.dailyCallTime)
  const scheduledAt = getScheduledDate(now, config.appTimezone, scheduled)

  if (dayOffset) {
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + dayOffset)
  } else if (now.getTime() - scheduledAt.getTime() > missedCallGraceMs) {
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + 1)
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: config.appTimezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(scheduledAt)
}

// Capitalizes a short source label for log messages.
function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

// Extracts date and time parts as they appear in the configured app timezone.
function getPartsInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}
