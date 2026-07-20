export const M1_INDICATOR_SYSTEMS = Object.freeze([
  'zen',
  'utbot',
  'chandelier',
  'trendline'
]);

export function getM1IndicatorConfigSignature(system, state) {
  if (system === 'zen') return `${state.zenFastPeriod}:${state.zenSlowPeriod}`;
  if (system === 'utbot') return `${state.utBotKeyValue}:${state.utBotAtrPeriod}`;
  if (system === 'chandelier') return `${state.chandelierAtrPeriod}:${state.chandelierAtrMultiplier}`;
  if (system === 'trendline') return `${state.trendlineLength}:${state.trendlineSlopeMult}`;
  return '';
}

export function getM1SignalIdentity(signal) {
  if (!signal || signal.triggered === false || !['buy', 'sell'].includes(signal.action)) return null;
  const sourceTimestamp = Number(signal.timestamp);
  if (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0) return null;
  return `${signal.action}:${sourceTimestamp}`;
}

export function advanceM1SignalBaseline(previous, signal, configSignature) {
  const identity = getM1SignalIdentity(signal);
  const next = { identity, configSignature };

  // A missing baseline or a settings change establishes a new starting point.
  // Neither case is a newly generated realtime signal.
  if (!previous || previous.configSignature !== configSignature) {
    return { shouldPublish: false, next };
  }

  return {
    shouldPublish: Boolean(identity && identity !== previous.identity),
    next
  };
}

export function createM1PublishedSignal(signal, history, now = Date.now()) {
  const activeCandleTime = Number(history?.[history.length - 1]?.time) * 1000;
  const publishedAt = Number.isFinite(activeCandleTime) && activeCandleTime > 0
    ? activeCandleTime
    : Number(now);

  return {
    ...signal,
    sourceTimestamp: Number(signal.timestamp),
    timestamp: publishedAt,
    status: 'running',
    hitTps: [false, false]
  };
}
