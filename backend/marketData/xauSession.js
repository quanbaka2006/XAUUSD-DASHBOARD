'use strict';

const NEW_YORK_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function getNewYorkSessionTime(unixSeconds) {
  const parts = Object.fromEntries(
    NEW_YORK_PARTS.formatToParts(new Date(unixSeconds * 1000))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    weekday: parts.weekday,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

// OANDA publishes XAU/USD trading hours in New York time as
// Sunday-Friday 18:05-16:59. This function intentionally uses IANA timezone
// conversion so daylight-saving changes are handled by the runtime.
function isXauSessionOpenAt(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return false;
  const { weekday, minuteOfDay } = getNewYorkSessionTime(unixSeconds);
  const openMinute = 18 * 60 + 5;
  const closeMinute = 16 * 60 + 59;
  if (weekday === 'Sat') return false;
  if (weekday === 'Sun') return minuteOfDay >= openMinute;
  if (weekday === 'Fri') return minuteOfDay < closeMinute;
  return minuteOfDay < closeMinute || minuteOfDay >= openMinute;
}

function isXauBucketFullyOpenAt(unixSeconds, intervalSeconds = 60) {
  if (!Number.isFinite(unixSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds < 60) {
    return false;
  }
  for (let offset = 0; offset < intervalSeconds; offset += 60) {
    if (!isXauSessionOpenAt(unixSeconds + offset)) return false;
  }
  return true;
}

function providerTimeToUnixSeconds(value) {
  if (Number.isFinite(value)) return Math.floor(value > 1e11 ? value / 1000 : value);
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return null;
}

function crossesScheduledSessionClose(activeTime, expectedTime, intervalSeconds = 60) {
  if (!Number.isFinite(activeTime) || !Number.isFinite(expectedTime)) return false;
  if (expectedTime - activeTime <= intervalSeconds) return false;
  return !isXauSessionOpenAt(activeTime + intervalSeconds);
}

function analyzeMissingBuckets(candles, intervalSeconds = 60) {
  const times = [...new Set((candles || [])
    .map((candle) => Number(candle?.time))
    .filter(Number.isFinite))]
    .sort((a, b) => a - b);
  let scheduledClosedBuckets = 0;
  let unexpectedMissingBuckets = 0;

  for (let index = 1; index < times.length; index += 1) {
    for (let time = times[index - 1] + intervalSeconds; time < times[index]; time += intervalSeconds) {
      if (isXauBucketFullyOpenAt(time, intervalSeconds)) unexpectedMissingBuckets += 1;
      else scheduledClosedBuckets += 1;
    }
  }

  return {
    missingRealBuckets: scheduledClosedBuckets + unexpectedMissingBuckets,
    scheduledClosedBuckets,
    unexpectedMissingBuckets
  };
}

module.exports = {
  getNewYorkSessionTime,
  isXauSessionOpenAt,
  isXauBucketFullyOpenAt,
  providerTimeToUnixSeconds,
  crossesScheduledSessionClose,
  analyzeMissingBuckets
};
