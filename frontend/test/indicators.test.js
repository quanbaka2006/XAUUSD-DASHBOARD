import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateUTBotSignals,
  calculateTrendlinesWithBreaks,
  getCurrentSignal
} from '../src/utils/indicators.js';

const closes = (values) => values.map((close, index) => ({
  time: index * 60,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close
}));

test('SMA and EMA use standard warm-up and preserve precision', () => {
  const data = closes([1, 2, 3, 4, 5]);
  assert.deepEqual(calculateSMA(data, 3).map((item) => item.value), [2, 3, 4]);
  assert.deepEqual(calculateEMA(data, 3).map((item) => item.value), [2, 3, 4]);

  const precise = calculateEMA(closes([1.001, 1.002, 1.004]), 2);
  assert.ok(Math.abs(precise[1].value - 1.0031666666666665) < 1e-12);
});

test('RSI handles rising, falling, and flat boundary cases', () => {
  assert.equal(calculateRSI(closes([1, 2, 3, 4]), 3)[0].value, 100);
  assert.equal(calculateRSI(closes([4, 3, 2, 1]), 3)[0].value, 0);
  assert.equal(calculateRSI(closes([2, 2, 2, 2]), 3)[0].value, 50);
});

test('MACD starts only after slow and signal warm-up and remains finite', () => {
  const result = calculateMACD(closes(Array.from({ length: 40 }, (_, i) => 100 + i)), 12, 26, 9);
  assert.equal(result.length, 7);
  result.forEach((item) => {
    assert.ok(Number.isFinite(item.macd));
    assert.ok(Number.isFinite(item.signal));
    assert.ok(Number.isFinite(item.histogram));
  });
});

test('UT Bot and signal selection do not force a BUY/SELL without a crossing', () => {
  const data = closes(Array(80).fill(2000));
  assert.equal(calculateUTBotSignals(data, 2, 10).some((item) => item.buy || item.sell), false);
  const signal = getCurrentSignal({
    history: [...data, ...closes([2000]).map((item) => ({ ...item, time: 80 * 60 }))],
    selectedSymbol: 'XAUUSD', selectedIndicatorSystem: 'utbot',
    zenFastPeriod: 20, zenSlowPeriod: 50, utBotKeyValue: 2, utBotAtrPeriod: 10,
    chandelierAtrPeriod: 22, chandelierAtrMultiplier: 3,
    trendlineLength: 14, trendlineSlopeMult: 1, livePrice: 2000
  });
  assert.equal(signal.action, 'stale');
});

test('trendline breakout markers are attached to the detection candle, not back-painted', () => {
  const values = Array.from({ length: 100 }, (_, i) => 2000 + Math.sin(i / 4) * 8 + i * 0.02);
  const result = calculateTrendlinesWithBreaks(closes(values), 5, 1);
  result.filter((item) => item.buy || item.sell).forEach((item) => assert.equal(item.breakoutTime, item.time));
});

test('Zen returns its computed strength instead of a fabricated 93-97 score', () => {
  const values = [
    ...Array.from({ length: 40 }, (_, i) => 2000 - i * 0.1),
    ...Array.from({ length: 50 }, (_, i) => 1996 + i * 0.1)
  ];
  const history = closes([...values, values[values.length - 1]]);
  const signal = getCurrentSignal({
    history, selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem: 'zen',
    zenFastPeriod: 5, zenSlowPeriod: 10, utBotKeyValue: 2, utBotAtrPeriod: 10,
    chandelierAtrPeriod: 22, chandelierAtrMultiplier: 3,
    trendlineLength: 14, trendlineSlopeMult: 1, livePrice: values[values.length - 1]
  });
  assert.equal(signal.action, 'buy');
  assert.ok(signal.signalStrength >= 65 && signal.signalStrength < 93);
  assert.equal(signal.algorithmVersion, '2.0.0');
  assert.equal(signal.indicator, 'zen');
  assert.equal(signal.timeframe, 'M1');
  assert.equal(signal.sourceCandleTime, signal.timestamp / 1000);
  assert.equal(Object.hasOwn(signal, 'confidence'), false);
});

test('XAUUSD signal generation fails closed while market data is warming up', () => {
  const history = closes(Array.from({ length: 600 }, (_, i) => 2000 + Math.sin(i / 8)));
  const signal = getCurrentSignal({
    history,
    selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem: 'zen',
    zenFastPeriod: 5, zenSlowPeriod: 10, utBotKeyValue: 2, utBotAtrPeriod: 10,
    chandelierAtrPeriod: 22, chandelierAtrMultiplier: 3,
    trendlineLength: 14, trendlineSlopeMult: 1, dataReady: false
  });
  assert.equal(signal.action, 'stale');
  assert.equal(signal.signalStrength, 0);
  assert.equal(signal.algorithmVersion, '2.0.0');
});
