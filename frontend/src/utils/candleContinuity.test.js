import test from 'node:test';
import assert from 'node:assert/strict';

import { hasCandleGap } from './candleContinuity.js';

test('accepts the next expected M1 candle', () => {
  assert.equal(hasCandleGap(1_000, 1_060, 'M1'), false);
});

test('detects a missing M1 candle', () => {
  assert.equal(hasCandleGap(1_000, 1_120, 'M1'), true);
});

test('uses the selected timeframe interval', () => {
  assert.equal(hasCandleGap(1_000, 1_300, 'M5'), false);
  assert.equal(hasCandleGap(1_000, 1_301, 'M5'), true);
});

test('ignores unsupported or invalid timestamps', () => {
  assert.equal(hasCandleGap('bad', 1_120, 'M1'), false);
  assert.equal(hasCandleGap(1_000, 1_120, 'D1'), false);
});
