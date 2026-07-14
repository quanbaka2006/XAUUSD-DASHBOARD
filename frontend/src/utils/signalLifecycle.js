export function isDisplayableSignal(signal) {
  return Boolean(signal && (signal.action === 'buy' || signal.action === 'sell') && signal.entry > 0);
}

export function isFinishedSignal(signal) {
  return signal?.status === 'finished' || signal?.status === 'sl' || signal?.status === 'closed';
}

export function getSignalIdentity(signal) {
  if (!isDisplayableSignal(signal)) return null;
  return signal.signalId || [
    signal.symbol || signal.ticker,
    signal.timeframe || signal.interval,
    signal.action,
    signal.sourceCandleTime || signal.timestamp,
    signal.indicator || signal.indicatorSystem
  ].join(':');
}

export function getTrackedSignalForIndicator(trackedSignals, symbol, timeframe, indicator) {
  const timeframeSignals = trackedSignals?.[symbol]?.[timeframe];
  if (!timeframeSignals || isDisplayableSignal(timeframeSignals)) return null;
  return timeframeSignals[indicator] || null;
}

export function putTrackedSignalForIndicator(trackedSignals, symbol, timeframe, indicator, signal) {
  const existingTimeframeSignals = trackedSignals?.[symbol]?.[timeframe];
  return {
    ...(trackedSignals || {}),
    [symbol]: {
      ...(trackedSignals?.[symbol] || {}),
      [timeframe]: {
        ...(!isDisplayableSignal(existingTimeframeSignals) ? existingTimeframeSignals : {}),
        [indicator]: signal
      }
    }
  };
}

export function removeTrackedSignalsForIndicator(trackedSignals, indicator) {
  return Object.fromEntries(Object.entries(trackedSignals || {}).map(([symbol, timeframeSignals]) => [
    symbol,
    Object.fromEntries(Object.entries(timeframeSignals || {}).map(([timeframe, indicatorSignals]) => {
      if (!indicatorSignals || isDisplayableSignal(indicatorSignals)) return [timeframe, indicatorSignals];
      const { [indicator]: _removed, ...remaining } = indicatorSignals;
      return [timeframe, remaining];
    }))
  ]));
}

const TIMEFRAME_SECONDS = Object.freeze({ M1: 60, M5: 300, M15: 900, H1: 3600 });

function getCandidateAvailableAt(signal) {
  const createdAt = signal?.createdAt ? new Date(signal.createdAt).getTime() : NaN;
  if (Number.isFinite(createdAt)) return createdAt;
  const sourceTime = Number(signal?.timestamp || (signal?.sourceCandleTime * 1000) || 0);
  const closeDelay = (TIMEFRAME_SECONDS[signal?.timeframe] || 0) * 1000;
  return sourceTime + closeDelay;
}

export function mapLedgerSignalForDisplay(signal, { restoredFromHistory = false } = {}) {
  if (!signal) return null;
  const terminalStatuses = new Set([
    'TP2_HIT', 'SL_HIT', 'EXPIRED', 'INVALIDATED', 'CLOSED_BY_REVERSAL', 'AMBIGUOUS'
  ]);
  const terminal = terminalStatuses.has(signal.status);
  const finishedAt = signal.closedAt ? new Date(signal.closedAt).getTime() : null;
  return {
    ...signal,
    sl: signal.originalSl,
    tp: signal.tp1,
    tps: [signal.tp1, signal.tp2],
    timestamp: Number(signal.sourceCandleTime) * 1000,
    sourceEventId: signal.sourceEventId || signal.signalId,
    restoredFromHistory,
    status: terminal ? 'finished' : signal.status === 'TP1_HIT' ? 'tp1' : 'running',
    result: terminal ? signal.status : null,
    finishedAt,
    hitTps: [
      signal.status === 'TP1_HIT' || signal.status === 'TP2_HIT',
      signal.status === 'TP2_HIT'
    ]
  };
}

export function advanceSignalWithPrice(signal, livePrice, now = Date.now()) {
  if (livePrice === null || livePrice === undefined || livePrice === '' ||
      !isDisplayableSignal(signal) || isFinishedSignal(signal) || !Number.isFinite(Number(livePrice))) return signal;
  const price = Number(livePrice);
  const tp1 = signal.tps?.[0] ?? signal.tp1 ?? signal.tp;
  const tp2 = signal.tps?.[1] ?? signal.tp2 ?? tp1;
  const hitTps = Array.isArray(signal.hitTps) ? [...signal.hitTps] : [false, false];
  const finish = (result, nextHits) => ({
    ...signal,
    status: 'finished',
    result,
    finishedAt: now,
    hitTps: nextHits
  });

  if (signal.action === 'buy') {
    if (signal.sl !== undefined && price <= signal.sl) return finish('SL_HIT', hitTps);
    if (Number.isFinite(tp2) && price >= tp2) return finish('TP2_HIT', [true, true]);
    if (Number.isFinite(tp1) && price >= tp1 && !hitTps[0]) {
      return { ...signal, status: 'tp1', hitTps: [true, false], tp1HitAt: now };
    }
  } else {
    if (signal.sl !== undefined && price >= signal.sl) return finish('SL_HIT', hitTps);
    if (Number.isFinite(tp2) && price <= tp2) return finish('TP2_HIT', [true, true]);
    if (Number.isFinite(tp1) && price <= tp1 && !hitTps[0]) {
      return { ...signal, status: 'tp1', hitTps: [true, false], tp1HitAt: now };
    }
  }
  return signal;
}

export function selectDisplayedSignal(existing, candidate) {
  if (!isDisplayableSignal(existing)) return isDisplayableSignal(candidate) ? candidate : existing;
  if (!isDisplayableSignal(candidate)) return existing;

  const sameIdentity = getSignalIdentity(existing) === getSignalIdentity(candidate);
  if (sameIdentity) {
    if (isFinishedSignal(existing)) return existing;
    const existingTp1Hit = existing.status === 'tp1' || Boolean(existing.hitTps?.[0]);
    const candidateTerminal = isFinishedSignal(candidate);
    const mergedHitTps = [
      existingTp1Hit || Boolean(candidate.hitTps?.[0]),
      Boolean(existing.hitTps?.[1]) || Boolean(candidate.hitTps?.[1])
    ];
    return {
      ...existing,
      ...candidate,
      status: candidateTerminal
        ? candidate.status
        : existingTp1Hit ? 'tp1' : candidate.status || existing.status,
      hitTps: mergedHitTps
    };
  }

  if (!isFinishedSignal(existing)) return existing;
  const finishedAt = Number(existing.finishedAt || existing.closedAt || existing.timestamp || 0);
  return getCandidateAvailableAt(candidate) > finishedAt ? candidate : existing;
}
