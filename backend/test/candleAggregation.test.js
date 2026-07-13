'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompletedM1, aggregateCandles, buildTimeframes } = require('../marketData/candleAggregation');
const { parseMidCandles, midpointFromPrice } = require('../marketData/oandaXau');

function candle(time, close, overrides = {}) {
  return { time, open: close, high: close + 1, low: close - 1, close, complete: true, ...overrides };
}

test('normalizes completed M1 candles, de-duplicates and rejects malformed rows', () => {
  const result = normalizeCompletedM1([
    candle(120, 3),
    candle(0, 1),
    candle(60, 2, { complete: false }),
    candle(0, 1.5),
    candle(61, 2),
    candle(180, 4, { high: 3 })
  ]);
  assert.deepEqual(result.map((item) => [item.time, item.close]), [[0, 1.5], [120, 3]]);
});

test('aggregates only full contiguous buckets with correct OHLC', () => {
  const source = [
    candle(0, 10, { open: 9, high: 11, low: 8 }),
    candle(60, 12, { high: 13 }),
    candle(120, 11, { low: 9 }),
    candle(180, 14, { high: 15 }),
    candle(240, 13, { low: 10 }),
    candle(300, 20)
  ];
  assert.deepEqual(aggregateCandles(source, 300), [
    { time: 0, open: 9, high: 15, low: 8, close: 13 }
  ]);
});

test('builds M1/M5/M15/H1 from the same completed M1 source', () => {
  const source = Array.from({ length: 60 }, (_, i) => candle(i * 60, 2000 + i));
  const result = buildTimeframes(source);
  assert.equal(result.M1.length, 60);
  assert.equal(result.M5.length, 12);
  assert.equal(result.M15.length, 4);
  assert.equal(result.H1.length, 1);
});

test('parses only complete OANDA midpoint candles', () => {
  const body = {
    instrument: 'XAU_USD',
    candles: [
      { complete: true, time: '2026-07-13T00:00:00.000000000Z', m: { o: '2400', h: '2402', l: '2399', c: '2401' } },
      { complete: false, time: '2026-07-13T00:01:00.000000000Z', m: { o: '2401', h: '2403', l: '2400', c: '2402' } }
    ]
  };
  const result = parseMidCandles(body);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    time: Date.parse('2026-07-13T00:00:00.000Z') / 1000,
    open: 2400,
    high: 2402,
    low: 2399,
    close: 2401,
    complete: true
  });
});

test('uses OANDA bid/ask midpoint and preserves spread metadata', () => {
  const result = midpointFromPrice({
    type: 'PRICE', instrument: 'XAU_USD', time: '2026-07-13T00:00:00Z',
    bids: [{ price: '2400.10' }], asks: [{ price: '2400.30' }]
  });
  assert.equal(result.price, 2400.2);
  assert.ok(Math.abs(result.spread - 0.2) < 1e-10);
});
