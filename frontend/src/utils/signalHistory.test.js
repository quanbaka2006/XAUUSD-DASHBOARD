import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findNewRunningSignalRecords,
  selectDashboardSignalRecord,
  toDashboardSignal
} from './signalHistory.js';

const record = (overrides = {}) => ({
  id: 'zen-1',
  symbol: 'XAUUSD',
  timeframe: 'M1',
  indicatorSystem: 'zen',
  indicatorLabel: 'MTF Trend PA',
  action: 'buy',
  entry: 4000,
  sl: 3990,
  tps: [4005, 4010],
  confidence: 90,
  signalTime: 1000,
  recordedAt: 1000,
  outcome: 'running',
  status: 'running',
  hitTp1: false,
  ...overrides
});

test('selects the running backend record before the latest settled record', () => {
  const selected = selectDashboardSignalRecord([
    record({ id: 'zen-win', signalTime: 3000, recordedAt: 3000, outcome: 'win' }),
    record({ id: 'zen-running', signalTime: 2000, recordedAt: 2000 }),
    record({ id: 'utbot-running', indicatorSystem: 'utbot', signalTime: 4000 })
  ], {
    symbol: 'XAUUSD',
    timeframe: 'M1',
    indicatorSystem: 'zen'
  });
  assert.equal(selected.id, 'zen-running');
});

test('maps backend lifecycle fields to the dashboard card shape', () => {
  const tp1 = toDashboardSignal(record({ hitTp1: true }));
  assert.equal(tp1.status, 'tp1');
  assert.deepEqual(tp1.hitTps, [true, false]);
  assert.equal(tp1.recordId, 'zen-1');
  assert.equal(tp1.backendAuthoritative, true);

  const win = toDashboardSignal(record({ outcome: 'win', status: 'finished' }));
  assert.equal(win.status, 'finished');
  assert.deepEqual(win.hitTps, [true, true]);

  const loss = toDashboardSignal(record({ outcome: 'loss', status: 'sl' }));
  assert.equal(loss.status, 'sl');
});

test('returns only unseen running records for popup notifications', () => {
  const records = [
    record({ id: 'known-running' }),
    record({ id: 'new-running', indicatorSystem: 'utbot' }),
    record({ id: 'new-settled', outcome: 'win' })
  ];
  const unseen = findNewRunningSignalRecords(records, new Set(['known-running']));
  assert.deepEqual(unseen.map(item => item.id), ['new-running']);
});
