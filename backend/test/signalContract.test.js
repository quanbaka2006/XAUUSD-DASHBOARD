'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SIGNAL_STATUS,
  M1_RISK_REWARD,
  buildSignalId,
  createSignalDocument,
  transitionSignal,
  reconfirmSignal
} = require('../signals/signalContract');

const SOURCE_TIME = 1720951200;

function buyInput(overrides = {}) {
  return {
    symbol: 'XAUUSD',
    timeframe: 'M1',
    action: 'buy',
    sourceCandleTime: SOURCE_TIME,
    entry: 10,
    sl: 0,
    tp1: 15,
    tp2: 17.5,
    swing: { type: 'low', price: 0.2, time: SOURCE_TIME - 180, strength: 2 },
    dataQuality: { trigger: 'real', recentGapFill: false, source: 'finnhub-oanda-spot' },
    signalStrength: 94,
    ...overrides
  };
}

test('accepts the frozen M1 BUY example with 0.5R and 0.75R targets', () => {
  const signal = createSignalDocument(buyInput(), new Date('2026-07-14T01:00:00Z'));
  assert.equal(signal.entry, 10);
  assert.equal(signal.originalSl, 0);
  assert.equal(signal.riskDistance, 10);
  assert.deepEqual(signal.riskReward, M1_RISK_REWARD);
  assert.deepEqual(signal.allocation, { tp1Percent: 50, tp2Percent: 50 });
  assert.equal(signal.status, SIGNAL_STATUS.ACTIVE);
  assert.equal(signal.isOpen, true);
});

test('accepts inverse SELL geometry and derives the same R:R', () => {
  const signal = createSignalDocument(buyInput({
    action: 'sell',
    sl: 20,
    tp1: 5,
    tp2: 2.5,
    swing: { type: 'high', price: 19.8, time: SOURCE_TIME - 180, strength: 2 }
  }));
  assert.equal(signal.riskDistance, 10);
  assert.deepEqual(signal.riskReward, M1_RISK_REWARD);
});

test('builds deterministic identities from source candle and strategy version', () => {
  const identity = {
    symbol: 'XAUUSD', timeframe: 'M1', sourceCandleTime: SOURCE_TIME,
    action: 'buy', strategyVersion: '1.0.0-contract'
  };
  assert.equal(buildSignalId(identity), buildSignalId(identity));
  assert.notEqual(buildSignalId(identity), buildSignalId({ ...identity, action: 'sell' }));
});

test('rejects wrong M1 reward ratios and invalid side geometry', () => {
  assert.throws(() => createSignalDocument(buyInput({ tp1: 20, tp2: 30 })), {
    code: 'INVALID_M1_RISK_REWARD'
  });
  assert.throws(() => createSignalDocument(buyInput({ sl: 11 })), {
    code: 'INVALID_PRICE_GEOMETRY'
  });
});

test('rejects synthetic/gap data and invalid swing direction', () => {
  assert.throws(() => createSignalDocument(buyInput({
    dataQuality: { trigger: 'synthetic', recentGapFill: false }
  })), { code: 'INVALID_DATA_QUALITY' });
  assert.throws(() => createSignalDocument(buyInput({
    dataQuality: { trigger: 'real', recentGapFill: true }
  })), { code: 'INVALID_DATA_QUALITY' });
  assert.throws(() => createSignalDocument(buyInput({
    swing: { type: 'low', price: 0.2, time: SOURCE_TIME - 180, synthetic: true }
  })), { code: 'SYNTHETIC_SWING' });
  assert.throws(() => createSignalDocument(buyInput({
    swing: { type: 'high', price: 9, time: SOURCE_TIME - 180 }
  })), { code: 'INVALID_SWING_DIRECTION' });
  assert.throws(() => createSignalDocument(buyInput({
    swing: { type: 'low', price: 0.2, time: SOURCE_TIME - 180, strength: 1 }
  })), { code: 'INVALID_SWING_STRENGTH' });
});

test('advances ACTIVE to TP1 and TP2 while retaining immutable status events', () => {
  const created = createSignalDocument(buyInput(), new Date('2026-07-14T01:00:00Z'));
  const tp1 = transitionSignal(created, SIGNAL_STATUS.TP1_HIT, {
    price: 15,
    managedSl: 10,
    reason: 'tp1-price-touched'
  }, new Date('2026-07-14T01:02:00Z'));
  const tp2 = transitionSignal(tp1, SIGNAL_STATUS.TP2_HIT, {
    price: 17.5,
    resultR: 0.625,
    reason: 'tp2-price-touched'
  }, new Date('2026-07-14T01:04:00Z'));
  assert.equal(tp1.managedSl, 10);
  assert.equal(tp2.isOpen, false);
  assert.equal(tp2.resultR, 0.625);
  assert.deepEqual(tp2.statusEvents.map((event) => event.to), [
    SIGNAL_STATUS.ACTIVE,
    SIGNAL_STATUS.TP1_HIT,
    SIGNAL_STATUS.TP2_HIT
  ]);
});

test('prevents rollback and any transition after a terminal result', () => {
  const created = createSignalDocument(buyInput());
  const tp1 = transitionSignal(created, SIGNAL_STATUS.TP1_HIT, { price: 15 });
  assert.throws(() => transitionSignal(tp1, SIGNAL_STATUS.ACTIVE), { code: 'INVALID_TRANSITION' });
  const stopped = transitionSignal(created, SIGNAL_STATUS.SL_HIT, { price: 0, resultR: -1 });
  assert.throws(() => transitionSignal(stopped, SIGNAL_STATUS.TP1_HIT), { code: 'TERMINAL_SIGNAL' });
});

test('prevents lifecycle timestamps from moving backwards', () => {
  const created = createSignalDocument(buyInput(), new Date('2026-07-14T01:00:00Z'));
  assert.throws(() => transitionSignal(
    created,
    SIGNAL_STATUS.TP1_HIT,
    { price: 15 },
    new Date('2026-07-14T00:59:59Z')
  ), { code: 'NON_MONOTONIC_EVENT_TIME' });
});

test('reconfirmation keeps status and appends an auditable event', () => {
  const created = createSignalDocument(buyInput());
  const reconfirmed = reconfirmSignal(created, { price: 11 });
  assert.equal(reconfirmed.status, SIGNAL_STATUS.ACTIVE);
  assert.equal(reconfirmed.reconfirmationCount, 1);
  assert.equal(reconfirmed.statusEvents.at(-1).reason, 'same-direction-reconfirmation');
});
