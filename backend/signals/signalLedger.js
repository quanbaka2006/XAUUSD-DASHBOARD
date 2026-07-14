'use strict';

const defaultStore = require('./mongoSignalStore');
const {
  SUPPORTED_TIMEFRAMES,
  createSignalDocument,
  transitionSignal,
  reconfirmSignal
} = require('./signalContract');

class SignalLedgerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SignalLedgerError';
    this.code = code;
    this.details = details;
  }
}

function createSignalLedger({ db, store = defaultStore, publishEvent = () => {} }) {
  let ready = false;
  let lastError = 'not-initialized';
  let initializedAt = null;
  let knownSignalCount = 0;
  const activeBySymbol = new Map();

  function activeKey(symbol, timeframe) {
    return `${symbol}:${timeframe}`;
  }

  function assertReady() {
    if (!ready) throw new SignalLedgerError('LEDGER_NOT_READY', 'Scalping Signal Ledger is not ready');
  }

  function safePublish(payload) {
    try {
      const result = publishEvent(payload);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error('[SignalLedger] Realtime publish failed:', error.message));
      }
    } catch (error) {
      console.error('[SignalLedger] Realtime publish failed:', error.message);
    }
  }

  function remember(signal) {
    if (!signal) return;
    const key = activeKey(signal.symbol, signal.timeframe);
    if (signal.isOpen) activeBySymbol.set(key, signal);
    else activeBySymbol.delete(key);
  }

  async function initialize() {
    try {
      await store.ensureIndexes(db);
      const [activeSignals, count] = await Promise.all([
        store.loadOpenSignals(db, 'XAUUSD'),
        store.countSignals(db, 'XAUUSD')
      ]);
      activeBySymbol.clear();
      activeSignals.forEach(remember);
      knownSignalCount = count;
      initializedAt = new Date();
      ready = true;
      lastError = null;
      return { activeSignals, signalCount: count, initializedAt };
    } catch (error) {
      ready = false;
      lastError = error.message;
      throw error;
    }
  }

  async function getActive(symbol = 'XAUUSD', timeframe = 'M1') {
    assertReady();
    const normalized = store.normalizeSymbol(symbol);
    const normalizedTimeframe = store.normalizeTimeframe(timeframe);
    const active = await store.loadActive(db, normalized, normalizedTimeframe);
    if (active) remember(active);
    else activeBySymbol.delete(activeKey(normalized, normalizedTimeframe));
    return active;
  }

  async function getHistory(symbol = 'XAUUSD', timeframe = 'M1', limit = 20) {
    assertReady();
    return store.loadHistory(
      db,
      store.normalizeSymbol(symbol),
      store.normalizeTimeframe(timeframe),
      store.normalizeLimit(limit)
    );
  }

  async function snapshot(symbol = 'XAUUSD', timeframe = 'M1', limit = 20) {
    assertReady();
    const normalized = store.normalizeSymbol(symbol);
    const normalizedTimeframe = store.normalizeTimeframe(timeframe);
    const [activeSignal, history] = await Promise.all([
      getActive(normalized, normalizedTimeframe),
      getHistory(normalized, normalizedTimeframe, limit)
    ]);
    return {
      ready: true,
      symbol: normalized,
      timeframe: normalizedTimeframe,
      activeSignal,
      history,
      generatedAt: new Date()
    };
  }

  async function snapshotAll(symbol = 'XAUUSD', limit = 20) {
    assertReady();
    const normalized = store.normalizeSymbol(symbol);
    const entries = await Promise.all(SUPPORTED_TIMEFRAMES.map(async (timeframe) => [
      timeframe,
      await snapshot(normalized, timeframe, limit)
    ]));
    return {
      ready: true,
      symbol: normalized,
      timeframes: Object.fromEntries(entries),
      generatedAt: new Date()
    };
  }

  async function publishSignal(input, now = new Date()) {
    assertReady();
    const candidate = createSignalDocument(input, now);
    const existingIdentity = await store.findById(db, candidate.signalId);
    if (existingIdentity) return { signal: existingIdentity, created: false, idempotent: true };

    const active = await getActive(candidate.symbol, candidate.timeframe);
    if (active) {
      throw new SignalLedgerError(
        'ACTIVE_SIGNAL_EXISTS',
        `An open ${candidate.symbol} signal already exists`,
        { activeSignalId: active.signalId }
      );
    }

    try {
      const signal = await store.insertSignal(db, candidate);
      remember(signal);
      knownSignalCount += 1;
      safePublish({ type: 'created', signal, emittedAt: new Date() });
      return { signal, created: true, idempotent: false };
    } catch (error) {
      if (error?.code === 11000) {
        const duplicateIdentity = await store.findById(db, candidate.signalId);
        if (duplicateIdentity) return { signal: duplicateIdentity, created: false, idempotent: true };
        const concurrentActive = await store.loadActive(db, candidate.symbol, candidate.timeframe);
        if (concurrentActive) remember(concurrentActive);
        throw new SignalLedgerError(
          'ACTIVE_SIGNAL_EXISTS',
          `An open ${candidate.symbol} signal was created concurrently`,
          { activeSignalId: concurrentActive?.signalId || null }
        );
      }
      throw error;
    }
  }

  async function transitionSignalById(signalId, toStatus, metadata = {}, now = new Date()) {
    assertReady();
    const current = await store.findById(db, signalId);
    if (!current) throw new SignalLedgerError('SIGNAL_NOT_FOUND', `Signal not found: ${signalId}`);
    const next = transitionSignal(current, toStatus, metadata, now);
    const saved = await store.replaceSignal(db, next, current.revision);
    if (!saved) {
      throw new SignalLedgerError('CONCURRENT_UPDATE', `Signal changed while updating: ${signalId}`);
    }
    remember(saved);
    safePublish({
      type: 'transition',
      previousStatus: current.status,
      signal: saved,
      emittedAt: new Date()
    });
    return saved;
  }

  async function reconfirmSignalById(signalId, metadata = {}, now = new Date()) {
    assertReady();
    const current = await store.findById(db, signalId);
    if (!current) throw new SignalLedgerError('SIGNAL_NOT_FOUND', `Signal not found: ${signalId}`);
    const next = reconfirmSignal(current, metadata, now);
    const saved = await store.replaceSignal(db, next, current.revision);
    if (!saved) {
      throw new SignalLedgerError('CONCURRENT_UPDATE', `Signal changed while reconfirming: ${signalId}`);
    }
    remember(saved);
    safePublish({ type: 'reconfirmed', signal: saved, emittedAt: new Date() });
    return saved;
  }

  function health() {
    const activeSignals = [...activeBySymbol.values()].map((signal) => ({
      signalId: signal.signalId,
      timeframe: signal.timeframe,
      status: signal.status
    }));
    return {
      ready,
      persistenceBackend: 'mongodb',
      error: lastError,
      initializedAt,
      signalCount: knownSignalCount,
      activeSignals
    };
  }

  return {
    initialize,
    getActive,
    getHistory,
    snapshot,
    snapshotAll,
    publishSignal,
    transitionSignalById,
    reconfirmSignalById,
    health
  };
}

module.exports = { SignalLedgerError, createSignalLedger };
