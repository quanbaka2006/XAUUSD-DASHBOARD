import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDisplayCandles,
  isXauBucketFullyOpenAt,
  updateDisplayCandle
} from '../src/utils/displayCandles.js';

const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);

function candle(iso, open, high, low, close) {
  return { time: unix(iso), open, high, low, close };
}

test('fills missing open-session M1 buckets with a deterministic display bridge', () => {
  const raw = [
    candle('2026-07-14T19:00:00Z', 4060, 4060.8, 4059.7, 4060.5),
    candle('2026-07-14T19:04:00Z', 4062, 4062.7, 4061.8, 4062.4)
  ];
  const original = structuredClone(raw);

  const first = buildDisplayCandles(raw, { symbol: 'XAUUSD', timeframe: 'M1' });
  const second = buildDisplayCandles(raw, { symbol: 'XAUUSD', timeframe: 'M1' });

  assert.deepEqual(first, second);
  assert.deepEqual(raw, original, 'display processing must not mutate provider candles');
  assert.equal(first.length, 5);
  assert.deepEqual(
    first.filter((item) => item.displaySynthetic).map((item) => item.time),
    [
      unix('2026-07-14T19:01:00Z'),
      unix('2026-07-14T19:02:00Z'),
      unix('2026-07-14T19:03:00Z')
    ]
  );

  for (let index = 1; index < first.length; index += 1) {
    assert.equal(first[index].open, first[index - 1].close);
    assert.ok(first[index].high >= Math.max(first[index].open, first[index].close));
    assert.ok(first[index].low <= Math.min(first[index].open, first[index].close));
  }
  assert.equal(first.at(-2).close, raw.at(-1).open);
});

test('does not invent candles during the official daily XAU closure', () => {
  const raw = [
    candle('2026-07-14T20:58:00Z', 4060, 4060.6, 4059.8, 4060.4),
    candle('2026-07-14T22:05:00Z', 4063, 4063.5, 4062.8, 4063.2)
  ];

  const display = buildDisplayCandles(raw, { symbol: 'XAUUSD', timeframe: 'M1' });

  assert.equal(display.length, 2);
  assert.equal(display.some((item) => item.displaySynthetic), false);
  assert.equal(display[1].open, display[0].close);
  assert.equal(display[1].realOpen, 4063);
  assert.equal(raw[1].open, 4063);
});

test('rejects a higher-timeframe bucket that overlaps a closed session', () => {
  assert.equal(isXauBucketFullyOpenAt(unix('2026-07-14T20:45:00Z'), 900), false);
  assert.equal(isXauBucketFullyOpenAt(unix('2026-07-14T19:45:00Z'), 900), true);
});

test('visually joins consecutive real candles without replacing their raw values', () => {
  const raw = [
    candle('2026-07-14T19:00:00Z', 4060, 4060.6, 4059.8, 4060.4),
    candle('2026-07-14T19:01:00Z', 4062, 4062.5, 4061.7, 4062.2)
  ];

  const display = buildDisplayCandles(raw, { symbol: 'XAUUSD', timeframe: 'M1' });

  assert.equal(display.length, 2);
  assert.equal(display[1].open, 4060.4);
  assert.equal(display[1].low, 4060.4);
  assert.equal(display[1].realOpen, 4062);
  assert.equal(raw[1].open, 4062);
});

test('live updates keep the already bridged display open', () => {
  const existing = {
    ...candle('2026-07-14T19:01:00Z', 4060.4, 4062.5, 4060.4, 4062.2),
    displayAdjusted: true,
    realOpen: 4062
  };
  const rawUpdate = candle('2026-07-14T19:01:00Z', 4062, 4063.1, 4061.5, 4062.9);

  const display = updateDisplayCandle(existing, rawUpdate);

  assert.equal(display.open, 4060.4);
  assert.equal(display.high, 4063.1);
  assert.equal(display.low, 4060.4);
  assert.equal(display.close, 4062.9);
  assert.equal(rawUpdate.open, 4062);
});
