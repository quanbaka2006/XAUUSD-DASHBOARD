import test from 'node:test';
import assert from 'node:assert/strict';

import { getCurrentSignal } from './indicators.js';

const zenSignal = (closedHistory) => getCurrentSignal({
  history: [
    ...closedHistory,
    {
      ...closedHistory.at(-1),
      time: closedHistory.at(-1).time + 60
    }
  ],
  selectedSymbol: 'XAUUSD',
  selectedIndicatorSystem: 'zen',
  zenFastPeriod: 20,
  zenSlowPeriod: 50
});

test('MTF Trend PA does not retrigger every minute inside one stable trend', () => {
  const fullHistory = Array.from({ length: 260 }, (_, index) => {
    const close = 4100 - index * 0.35;
    return {
      time: 1_700_000_000 + index * 60,
      open: close + 0.1,
      high: close + 0.4,
      low: close - 0.4,
      close
    };
  });

  [250, 251, 252].forEach((end) => {
    const signal = zenSignal(fullHistory.slice(end - 200, end));
    assert.equal(signal.action, 'sell');
    assert.equal(signal.triggered, false);
  });
});

test('MTF Trend PA entry and timestamp belong to the candle that just crossed', () => {
  const history = Array.from({ length: 100 }, (_, index) => {
    const close = index < 99 ? 4100 - index * 0.2 : 4140;
    return {
      time: 1_700_000_000 + index * 60,
      open: close,
      high: close + 0.3,
      low: close - 0.3,
      close
    };
  });
  const signal = zenSignal(history);

  assert.equal(signal.action, 'buy');
  assert.equal(signal.triggered, true);
  assert.equal(signal.entry, history.at(-1).close);
  assert.equal(signal.timestamp, history.at(-1).time * 1000);
});
