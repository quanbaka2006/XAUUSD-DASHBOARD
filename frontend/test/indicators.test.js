import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateUTBotSignals,
  calculateTrendlinesWithBreaks,
  calculateSwingRisk,
  TIMEFRAME_RISK_REWARD,
  findConfirmedSwing,
  getSignalAnalysisHistory,
  buildConfluenceDecision,
  getStableDisplayStrength,
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

test('indicator systems do not turn an unchanged state into a new signal', () => {
  const data = closes(Array(80).fill(2000));
  assert.equal(calculateUTBotSignals(data, 2, 10).some((item) => item.buy || item.sell), false);
  const history = [...data, ...closes([2000]).map((item) => ({ ...item, time: 80 * 60 }))];
  for (const selectedIndicatorSystem of ['zen', 'utbot', 'chandelier', 'trendline']) {
    const signal = getCurrentSignal({
      history,
      selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem,
      zenFastPeriod: 20, zenSlowPeriod: 50, utBotKeyValue: 2, utBotAtrPeriod: 10,
      chandelierAtrPeriod: 22, chandelierAtrMultiplier: 3,
      trendlineLength: 14, trendlineSlopeMult: 1, livePrice: 2000
    });
    assert.equal(signal.action, 'stale', selectedIndicatorSystem);
    assert.equal(signal.blockedReason, 'no-confirmed-signal', selectedIndicatorSystem);
  }
});

test('each indicator accepts only its fresh event on the latest closed candle', () => {
  const values = [
    ...Array(30).fill(2000),
    ...Array.from({ length: 8 }, (_, index) => 2000 - (index + 1) * 2),
    2020
  ];
  const closed = closes(values);
  const history = [...closed, { ...closed.at(-1), time: closed.at(-1).time + 60 }];
  for (const selectedIndicatorSystem of ['zen', 'utbot', 'chandelier', 'trendline']) {
    const signal = getCurrentSignal({
      history,
      selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem,
      zenFastPeriod: 2, zenSlowPeriod: 5, utBotKeyValue: 2, utBotAtrPeriod: 10,
      chandelierAtrPeriod: 10, chandelierAtrMultiplier: 2,
      trendlineLength: 5, trendlineSlopeMult: 1
    });
    assert.equal(signal.action, 'buy', selectedIndicatorSystem);
    assert.equal(signal.triggerType, 'fresh-indicator-event', selectedIndicatorSystem);
    assert.equal(signal.timestamp, closed.at(-1).time * 1000, selectedIndicatorSystem);
  }
});

test('trendline breakout markers are attached to the detection candle, not back-painted', () => {
  const values = Array.from({ length: 100 }, (_, i) => 2000 + Math.sin(i / 4) * 8 + i * 0.02);
  const result = calculateTrendlinesWithBreaks(closes(values), 5, 1);
  result.filter((item) => item.buy || item.sell).forEach((item) => assert.equal(item.breakoutTime, item.time));
});

test('signal display strength stays stable between 90 and 98 for the same signal', () => {
  const values = [
    ...Array(30).fill(2000),
    ...Array.from({ length: 8 }, (_, index) => 2000 - (index + 1) * 2),
    2020
  ];
  const history = closes([...values, values[values.length - 1]]);
  const signal = getCurrentSignal({
    history, selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem: 'zen',
    zenFastPeriod: 2, zenSlowPeriod: 5, utBotKeyValue: 2, utBotAtrPeriod: 10,
    chandelierAtrPeriod: 10, chandelierAtrMultiplier: 2,
    trendlineLength: 5, trendlineSlopeMult: 1, livePrice: values[values.length - 1]
  });
  assert.equal(signal.action, 'buy');
  assert.ok(signal.signalStrength >= 90 && signal.signalStrength <= 98);
  assert.equal(signal.signalStrength, getStableDisplayStrength({
    symbol: 'XAUUSD', timeframe: 'M1', indicator: 'zen', timestamp: signal.timestamp
  }));
  assert.equal(signal.algorithmVersion, '3.3.0');
  assert.equal(signal.indicator, 'zen');
  assert.equal(signal.timeframe, 'M1');
  assert.equal(signal.sourceCandleTime, signal.timestamp / 1000);
  assert.equal(signal.riskModel, 'real-swing-rr-v2');
  assert.equal(signal.riskReward.tp1, 0.5);
  assert.equal(signal.riskReward.tp2, 0.75);
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
  assert.equal(signal.algorithmVersion, '3.3.0');
});

test('recent gap-fill is reported as data quality and no longer blocks a real trigger', () => {
  const values = [
    ...Array(30).fill(2000),
    ...Array.from({ length: 8 }, (_, index) => 2000 - (index + 1) * 2),
    2020
  ];
  const closed = closes(values);
  const gap = {
    ...closed.at(-1),
    time: closed.at(-1).time + 30,
    synthetic: true,
    syntheticReason: 'gap-fill'
  };
  const active = { ...closed.at(-1), time: closed.at(-1).time + 60 };
  for (const selectedIndicatorSystem of ['zen', 'utbot', 'chandelier', 'trendline']) {
    const signal = getCurrentSignal({
      history: [...closed, gap, active],
      selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem,
      zenFastPeriod: 2, zenSlowPeriod: 5, utBotKeyValue: 2, utBotAtrPeriod: 10,
      chandelierAtrPeriod: 10, chandelierAtrMultiplier: 2,
      trendlineLength: 5, trendlineSlopeMult: 1
    });
    assert.ok(['buy', 'sell'].includes(signal.action), selectedIndicatorSystem);
    assert.equal(signal.dataQuality.recentGapFill, true, selectedIndicatorSystem);
    assert.equal(signal.dataQuality.gapFillExcluded, 1, selectedIndicatorSystem);
  }
});

test('cold start rejects a trigger that had already closed before page load', () => {
  const values = [...Array(30).fill(2000), 1990, 2010];
  const closed = closes(values);
  const history = [...closed, { ...closed.at(-1), time: closed.at(-1).time + 60 }];
  const common = {
    history,
    selectedSymbol: 'XAUUSD', selectedTimeframe: 'M1', selectedIndicatorSystem: 'zen',
    zenFastPeriod: 2, zenSlowPeriod: 5, utBotKeyValue: 2, utBotAtrPeriod: 10,
    chandelierAtrPeriod: 10, chandelierAtrMultiplier: 2,
    trendlineLength: 5, trendlineSlopeMult: 1
  };
  const triggerAvailableAt = (closed.at(-1).time + 60) * 1000;
  assert.equal(getCurrentSignal({
    ...common,
    minimumTriggerAvailableAt: triggerAvailableAt
  }).blockedReason, 'historical-trigger');
  assert.equal(getCurrentSignal({
    ...common,
    minimumTriggerAvailableAt: triggerAvailableAt - 1
  }).action, 'buy');
});

test('gap-fill candles are excluded and synthetic candles cannot become confirmed swings', () => {
  const history = closes([12, 11, 10, 11, 12, 13, 14]);
  history.splice(3, 0, { ...history[2], time: 150, synthetic: true, syntheticReason: 'gap-fill' });
  history.push({ ...history.at(-1), time: 420 }); // active candle
  const analysis = getSignalAnalysisHistory(history);
  assert.equal(analysis.some((item) => item.syntheticReason === 'gap-fill'), false);

  const swing = findConfirmedSwing(analysis, 'buy', 360);
  assert.equal(swing.time, 120);
  const syntheticCandidate = analysis.map((item) => item.time === 120 ? { ...item, synthetic: true } : item);
  assert.equal(findConfirmedSwing(syntheticCandidate, 'buy', 360), null);
});

test('swing-based M1 risk places SL beyond the swing and returns 0.5R/0.75R targets', () => {
  const history = closes([12, 11, 10, 11, 12, 13, 14]);
  const risk = calculateSwingRisk({ history, action: 'buy', entry: 14, triggerTime: 360, symbol: 'XAUUSD' });
  assert.equal(risk.swing.price, 9.5);
  assert.equal(risk.sl, 9.3);
  assert.equal(risk.riskDistance, 4.7);
  assert.equal(risk.tp1, 16.35);
  assert.equal(risk.tp2, 17.52);
  assert.deepEqual(risk.riskReward, { tp1: 0.5, tp2: 0.75, valid: true });
});

test('swing targets extend progressively by timeframe', () => {
  const history = closes([12, 11, 10, 11, 12, 13, 14]);
  for (const timeframe of ['M1', 'M5', 'M15', 'H1']) {
    const scaledHistory = history.map((candle) => ({
      ...candle,
      time: candle.time * ({ M1: 1, M5: 5, M15: 15, H1: 60 }[timeframe])
    }));
    const risk = calculateSwingRisk({
      history: scaledHistory,
      action: 'buy',
      entry: 14,
      triggerTime: 6 * ({ M1: 60, M5: 300, M15: 900, H1: 3600 }[timeframe]),
      symbol: 'XAUUSD',
      timeframe
    });
    assert.deepEqual(
      { tp1: risk.riskReward.tp1, tp2: risk.riskReward.tp2 },
      TIMEFRAME_RISK_REWARD[timeframe]
    );
  }
});

test('confirmed swing cannot cross a missing timeframe bucket', () => {
  const history = closes([12, 11, 10, 11, 12]);
  history[3] = { ...history[3], time: 240 };
  history[4] = { ...history[4], time: 300 };
  assert.equal(findConfirmedSwing(history, 'buy', 360, 2, 100, 60), null);
});

test('confluence requires H1, M15 and a fresh aligned M5 trigger', () => {
  const bullish = { direction: 'bullish', state: 'confirmed', evidence: 'bullish' };
  const buySignal = { action: 'buy', riskReward: { valid: true, tp2: 2 } };
  assert.equal(buildConfluenceDecision({
    h1Bias: bullish, m15Bias: bullish, m5Signal: buySignal, m5AgeCandles: 1
  }).decision, 'buy');
  assert.equal(buildConfluenceDecision({
    h1Bias: bullish,
    m15Bias: { direction: 'bearish' },
    m5Signal: buySignal,
    m5AgeCandles: 1
  }).decision, 'wait');
  assert.equal(buildConfluenceDecision({
    h1Bias: bullish, m15Bias: bullish, m5Signal: buySignal, m5AgeCandles: 3
  }).decision, 'wait');
});
