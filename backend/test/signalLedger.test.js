'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SIGNAL_STATUS, createSignalDocument } = require('../signals/signalContract');
const { createSignalLedger } = require('../signals/signalLedger');

const SOURCE_TIME = 1720951200;

function buyInput(overrides = {}) {
  return {
    symbol: 'XAUUSD', timeframe: 'M1', action: 'buy', sourceCandleTime: SOURCE_TIME,
    entry: 10, sl: 0, tp1: 15, tp2: 17.5,
    swing: { type: 'low', price: 0.2, time: SOURCE_TIME - 180 },
    dataQuality: { trigger: 'real', recentGapFill: false },
    signalStrength: 94,
    ...overrides
  };
}

function createMemoryStore(initialSignals = []) {
  const documents = new Map(initialSignals.map((signal) => [signal.signalId, { ...signal }]));
  return {
    documents,
    normalizeSymbol(symbol) {
      const normalized = String(symbol || 'XAUUSD').toUpperCase();
      if (normalized !== 'XAUUSD') throw new Error('unsupported symbol');
      return normalized;
    },
    normalizeTimeframe(timeframe) {
      const normalized = String(timeframe || 'M1').toUpperCase();
      if (!['M1', 'M5', 'M15', 'H1'].includes(normalized)) throw new Error('unsupported timeframe');
      return normalized;
    },
    normalizeLimit(limit) {
      return Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
    },
    async ensureIndexes() {},
    async countSignals() { return documents.size; },
    async findById(_db, signalId) { return documents.get(signalId) || null; },
    async loadOpenSignals() { return [...documents.values()].filter((signal) => signal.isOpen); },
    async loadActive(_db, _symbol, timeframe) {
      return [...documents.values()].find((signal) => signal.isOpen && signal.timeframe === timeframe) || null;
    },
    async loadHistory(_db, _symbol, timeframe, limit) {
      return [...documents.values()]
        .filter((signal) => signal.timeframe === timeframe)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
    async insertSignal(_db, signal) {
      if (documents.has(signal.signalId) || [...documents.values()].some((item) =>
        item.isOpen && item.symbol === signal.symbol && item.timeframe === signal.timeframe
      )) {
        const error = new Error('duplicate');
        error.code = 11000;
        throw error;
      }
      documents.set(signal.signalId, signal);
      return signal;
    },
    async replaceSignal(_db, signal, expectedRevision) {
      const current = documents.get(signal.signalId);
      if (!current || current.revision !== expectedRevision) return null;
      documents.set(signal.signalId, signal);
      return signal;
    }
  };
}

test('initialization restores the active MongoDB signal and exposes health', async () => {
  const restored = createSignalDocument(buyInput(), new Date('2026-07-14T01:00:00Z'));
  const store = createMemoryStore([restored]);
  const ledger = createSignalLedger({ db: {}, store });
  const initialized = await ledger.initialize();
  assert.equal(initialized.activeSignals[0].signalId, restored.signalId);
  assert.equal((await ledger.getActive()).signalId, restored.signalId);
  assert.equal(ledger.health().ready, true);
  assert.equal(ledger.health().activeSignals[0].signalId, restored.signalId);
});

test('publishes one signal, emits an event, and treats the same identity idempotently', async () => {
  const store = createMemoryStore();
  const events = [];
  const ledger = createSignalLedger({ db: {}, store, publishEvent: (event) => events.push(event) });
  await ledger.initialize();
  const first = await ledger.publishSignal(buyInput(), new Date('2026-07-14T01:00:00Z'));
  const duplicate = await ledger.publishSignal(buyInput(), new Date('2026-07-14T01:01:00Z'));
  assert.equal(first.created, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(first.signal.signalId, duplicate.signal.signalId);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'created');
});

test('fails closed when a different signal is published while one remains open', async () => {
  const ledger = createSignalLedger({ db: {}, store: createMemoryStore() });
  await ledger.initialize();
  await ledger.publishSignal(buyInput());
  await assert.rejects(
    ledger.publishSignal(buyInput({ sourceCandleTime: SOURCE_TIME + 60 })),
    { code: 'ACTIVE_SIGNAL_EXISTS' }
  );
});

test('allows one independent open signal per timeframe', async () => {
  const ledger = createSignalLedger({ db: {}, store: createMemoryStore() });
  await ledger.initialize();
  await ledger.publishSignal(buyInput());
  const m5 = await ledger.publishSignal(buyInput({ timeframe: 'M5', tp1: 17.5, tp2: 22.5 }));
  assert.equal(m5.created, true);
  assert.equal((await ledger.getActive('XAUUSD', 'M1')).timeframe, 'M1');
  assert.equal((await ledger.getActive('XAUUSD', 'M5')).timeframe, 'M5');
  assert.equal(ledger.health().activeSignals.length, 2);
});

test('persists lifecycle transitions then permits a new signal after terminal close', async () => {
  const store = createMemoryStore();
  const events = [];
  const ledger = createSignalLedger({ db: {}, store, publishEvent: (event) => events.push(event) });
  await ledger.initialize();
  const created = (await ledger.publishSignal(buyInput())).signal;
  const tp1 = await ledger.transitionSignalById(created.signalId, SIGNAL_STATUS.TP1_HIT, {
    price: 15, managedSl: 10
  });
  const closed = await ledger.transitionSignalById(created.signalId, SIGNAL_STATUS.TP2_HIT, {
    price: 17.5, resultR: 0.625
  });
  assert.equal(tp1.revision, 2);
  assert.equal(closed.isOpen, false);
  assert.equal(await ledger.getActive(), null);
  const next = await ledger.publishSignal(buyInput({ sourceCandleTime: SOURCE_TIME + 60 }));
  assert.equal(next.created, true);
  assert.deepEqual(events.map((event) => event.type), ['created', 'transition', 'transition', 'created']);
});

test('reconfirms an open signal without stacking a second position', async () => {
  const ledger = createSignalLedger({ db: {}, store: createMemoryStore() });
  await ledger.initialize();
  const created = (await ledger.publishSignal(buyInput())).signal;
  const reconfirmed = await ledger.reconfirmSignalById(created.signalId, { price: 11 });
  assert.equal(reconfirmed.status, SIGNAL_STATUS.ACTIVE);
  assert.equal(reconfirmed.reconfirmationCount, 1);
  assert.equal((await ledger.getHistory()).length, 1);
});

test('reports optimistic concurrency conflicts instead of losing an event', async () => {
  const store = createMemoryStore();
  const ledger = createSignalLedger({ db: {}, store });
  await ledger.initialize();
  const created = (await ledger.publishSignal(buyInput())).signal;
  store.replaceSignal = async () => null;
  await assert.rejects(
    ledger.transitionSignalById(created.signalId, SIGNAL_STATUS.SL_HIT, { price: 0, resultR: -1 }),
    { code: 'CONCURRENT_UPDATE' }
  );
});
