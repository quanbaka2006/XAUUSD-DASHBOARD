'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCandleStore } = require('../marketData/candleStore');

function candle(time, close) {
  return { time, open: close, high: close + 1, low: close - 1, close };
}

test('persists and restores only normalized completed M1 candles', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xau-candles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'xauusd-m1.json');
  const store = createCandleStore({ filePath, limit: 2 });
  assert.equal(store.saveNow([
    candle(0, 2000),
    candle(60, 2001),
    candle(120, 2002),
    candle(121, 9999)
  ]), 2);
  assert.deepEqual(store.load().map((item) => item.time), [60, 120]);
});

test('fails closed for corrupt or incompatible snapshots', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xau-candles-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'xauusd-m1.json');
  const store = createCandleStore({ filePath });
  fs.writeFileSync(filePath, '{bad json', 'utf8');
  assert.deepEqual(store.load(), []);
  fs.writeFileSync(filePath, JSON.stringify({ version: 999, instrument: 'XAU_USD', candles: [] }), 'utf8');
  assert.deepEqual(store.load(), []);
});
