const INTERVAL_SECONDS = Object.freeze({
  M1: 60,
  M5: 5 * 60,
  M15: 15 * 60,
  H1: 60 * 60
});

export function hasCandleGap(lastTime, nextTime, interval) {
  const expectedStep = INTERVAL_SECONDS[interval];
  const previous = Number(lastTime);
  const next = Number(nextTime);

  if (!expectedStep || !Number.isFinite(previous) || !Number.isFinite(next)) {
    return false;
  }

  return next > previous + expectedStep;
}
