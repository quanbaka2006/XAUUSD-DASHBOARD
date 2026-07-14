const TIMEFRAME_SECONDS = Object.freeze({ M1: 60, M5: 300, M15: 900, H1: 3600 });

const NEW_YORK_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function isValidCandle(candle) {
  if (!candle) return false;
  const values = [candle.time, candle.open, candle.high, candle.low, candle.close];
  return values.every(Number.isFinite) &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close);
}

function isXauSessionOpenAt(unixSeconds) {
  const parts = Object.fromEntries(
    NEW_YORK_PARTS.formatToParts(new Date(unixSeconds * 1000))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const openMinute = 18 * 60 + 5;
  const closeMinute = 16 * 60 + 59;
  if (parts.weekday === 'Sat') return false;
  if (parts.weekday === 'Sun') return minuteOfDay >= openMinute;
  if (parts.weekday === 'Fri') return minuteOfDay < closeMinute;
  return minuteOfDay < closeMinute || minuteOfDay >= openMinute;
}

function isXauBucketFullyOpenAt(unixSeconds, intervalSeconds) {
  for (let offset = 0; offset < intervalSeconds; offset += 60) {
    if (!isXauSessionOpenAt(unixSeconds + offset)) return false;
  }
  return true;
}

function seededRandom(seedValue) {
  const input = String(seedValue);
  let state = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    state ^= input.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function gaussian(random) {
  const u = Math.max(Number.EPSILON, random());
  const v = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function estimateCandleShape(candles, anchorPrice) {
  const valid = candles.filter(isValidCandle).slice(-50);
  const ranges = valid.map((candle) => candle.high - candle.low);
  const bodies = valid.map((candle) => Math.abs(candle.close - candle.open));
  const range = Math.max(median(ranges), anchorPrice * 0.00004);
  const body = Math.max(median(bodies), range * 0.28, anchorPrice * 0.000015);
  const wick = Math.max((range - median(bodies)) / 2, body * 0.25);
  return { body, wick };
}

function roundPrice(value) {
  return Number(Math.max(0.0001, value).toFixed(4));
}

function generateBrownianBridge({
  times,
  startPrice,
  endPrice,
  referenceCandles,
  seed
}) {
  if (!times.length) return [];
  const random = seededRandom(seed);
  const { body, wick } = estimateCandleShape(referenceCandles, startPrice);
  const walk = [0];
  for (let index = 1; index <= times.length; index += 1) {
    walk.push(walk[index - 1] + gaussian(random) * body * 0.7);
  }
  const finalWalk = walk[walk.length - 1];
  const candles = [];
  let open = startPrice;

  for (let index = 1; index <= times.length; index += 1) {
    const progress = index / times.length;
    const linear = startPrice + (endPrice - startPrice) * progress;
    const bridgeNoise = walk[index] - finalWalk * progress;
    const close = index === times.length ? endPrice : linear + bridgeNoise;
    const upperWick = wick * (0.3 + random() * 1.2);
    const lowerWick = wick * (0.3 + random() * 1.2);
    const roundedOpen = roundPrice(open);
    const roundedClose = roundPrice(close);
    candles.push({
      time: times[index - 1],
      open: roundedOpen,
      high: roundPrice(Math.max(roundedOpen, roundedClose) + upperWick),
      low: roundPrice(Math.min(roundedOpen, roundedClose) - lowerWick),
      close: roundedClose,
      displaySynthetic: true,
      displayReason: 'volatility-bridge'
    });
    open = roundedClose;
  }
  return candles;
}

function bridgeRealCandle(candle, displayOpen) {
  const open = roundPrice(displayOpen);
  return {
    ...candle,
    open,
    high: roundPrice(Math.max(candle.high, candle.close, open)),
    low: roundPrice(Math.min(candle.low, candle.close, open)),
    displayAdjusted: Math.abs(open - candle.open) > 1e-9,
    ...(Math.abs(open - candle.open) > 1e-9 ? { realOpen: candle.open } : {})
  };
}

export function buildDisplayCandles(rawCandles, {
  symbol = 'XAUUSD',
  timeframe = 'M1'
} = {}) {
  const intervalSeconds = TIMEFRAME_SECONDS[timeframe] || 60;
  const byTime = new Map();
  for (const candle of rawCandles || []) {
    if (isValidCandle(candle)) byTime.set(candle.time, { ...candle });
  }
  const raw = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (raw.length === 0 || symbol !== 'XAUUSD') return raw;

  const display = [{ ...raw[0] }];
  for (let index = 1; index < raw.length; index += 1) {
    const previousRaw = raw[index - 1];
    const currentRaw = raw[index];
    const previousDisplay = display[display.length - 1];
    const bridgeTimes = [];
    for (let time = previousRaw.time + intervalSeconds; time < currentRaw.time; time += intervalSeconds) {
      if (isXauBucketFullyOpenAt(time, intervalSeconds)) bridgeTimes.push(time);
    }

    if (bridgeTimes.length > 0) {
      const referenceStart = Math.max(0, index - 50);
      display.push(...generateBrownianBridge({
        times: bridgeTimes,
        startPrice: previousDisplay.close,
        endPrice: currentRaw.open,
        referenceCandles: raw.slice(referenceStart, index + 1),
        seed: `${symbol}:${timeframe}:${previousRaw.time}:${currentRaw.time}:${previousDisplay.close}:${currentRaw.open}`
      }));
    }

    const latestDisplay = display[display.length - 1];
    display.push(bridgeRealCandle(currentRaw, latestDisplay.close));
  }
  return display;
}

export function updateDisplayCandle(existingDisplayCandle, rawCandle) {
  if (!isValidCandle(rawCandle)) return existingDisplayCandle;
  if (!existingDisplayCandle || existingDisplayCandle.time !== rawCandle.time) {
    return { ...rawCandle };
  }
  return bridgeRealCandle(rawCandle, existingDisplayCandle.open);
}

export { isXauSessionOpenAt, isXauBucketFullyOpenAt };
