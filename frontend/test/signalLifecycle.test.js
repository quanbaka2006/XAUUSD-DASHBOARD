import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSignalWithPrice,
  mapLedgerSignalForDisplay,
  selectDisplayedSignal
} from '../src/utils/signalLifecycle.js';

const buy = (overrides = {}) => ({
  signalId: 'M1-BUY-1', symbol: 'XAUUSD', timeframe: 'M1', action: 'buy',
  entry: 10, sl: 0, tps: [15, 17.5], timestamp: 1000,
  status: 'running', hitTps: [false, false], ...overrides
});

test('keeps an active signal when scanner returns WAIT or a different trigger', () => {
  const active = buy();
  assert.equal(selectDisplayedSignal(active, { action: 'stale' }), active);
  assert.equal(selectDisplayedSignal(active, buy({ signalId: 'M1-BUY-2', timestamp: 2000 })), active);
});

test('advances TP1 then finishes at TP2 while retaining all levels', () => {
  const tp1 = advanceSignalWithPrice(buy(), 15, 2000);
  assert.equal(tp1.status, 'tp1');
  assert.deepEqual(tp1.hitTps, [true, false]);
  const finished = advanceSignalWithPrice(tp1, 17.5, 3000);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.result, 'TP2_HIT');
  assert.deepEqual(finished.tps, [15, 17.5]);
});

test('does not roll TP1 backward when the same scanner candidate says running', () => {
  const tp1 = advanceSignalWithPrice(buy(), 15, 2000);
  const merged = selectDisplayedSignal(tp1, buy({ status: 'running', hitTps: [false, false] }));
  assert.equal(merged.status, 'tp1');
  assert.deepEqual(merged.hitTps, [true, false]);
});

test('finishes at SL and keeps the finished signal until a newer trigger exists', () => {
  const finished = advanceSignalWithPrice(buy(), 0, 70000);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.result, 'SL_HIT');
  assert.equal(selectDisplayedSignal(finished, buy({ signalId: 'old', timestamp: 4000 })), finished);
  assert.equal(
    selectDisplayedSignal(finished, buy({ signalId: 'new', timestamp: 20000 })).signalId,
    'new'
  );
});

test('uses candle close time when deciding whether a timeframe signal is newer', () => {
  const finished = buy({ status: 'finished', result: 'TP2_HIT', finishedAt: 310000 });
  const nextM5 = buy({ signalId: 'M5-BUY-2', timeframe: 'M5', timestamp: 20000 });
  assert.equal(selectDisplayedSignal(finished, nextM5).signalId, 'M5-BUY-2');
});

test('tracks SELL TP and SL symmetrically', () => {
  const sell = buy({
    signalId: 'M5-SELL-1', timeframe: 'M5', action: 'sell',
    sl: 20, tps: [2.5, 0.5]
  });
  assert.equal(advanceSignalWithPrice(sell, 20, 2000).result, 'SL_HIT');
  assert.equal(advanceSignalWithPrice(sell, 0.5, 2000).result, 'TP2_HIT');
});

test('maps backend terminal status to a persistent FINISHED display signal', () => {
  const mapped = mapLedgerSignalForDisplay({
    signalId: 'SIG-1', symbol: 'XAUUSD', timeframe: 'M15', action: 'buy',
    sourceCandleTime: 100, entry: 10, originalSl: 0, tp1: 20, tp2: 25,
    status: 'TP2_HIT', closedAt: '2026-07-14T01:00:00.000Z'
  });
  assert.equal(mapped.status, 'finished');
  assert.equal(mapped.result, 'TP2_HIT');
  assert.deepEqual(mapped.tps, [20, 25]);
  assert.deepEqual(mapped.hitTps, [true, true]);
});
