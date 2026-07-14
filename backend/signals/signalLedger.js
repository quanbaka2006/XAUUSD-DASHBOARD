'use strict';

const defaultStore = require('./mongoSignalStore');
const {
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
    if (signal.isOpen) activeBySymbol.set(signal.symbol, signal);
    else activeBySymbol.delete(signal.symbol);
  }

  async function initialize() {
    try {
      await store.ensureIndexes(db);
      const [active, count] = await Promise.all([
        store.loadActive(db, 'XAUUSD'),
        store.countSignals(db, 'XAUUSD')
      ]);
      activeBySymbol.clear();
      if (active) remember(active);
      knownSignalCount = count;
      initializedAt = new Date();
      ready = true;
      lastError = null;
      return { activeSignal: active, signalCount: count, initializedAt };
    } catch (error) {
      ready = false;
      lastError = error.message;
      throw error;
    }
  }

  async function getActive(symbol = 'XAUUSD') {
    assertReady();
    const normalized = store.normalizeSymbol(symbol);
    const active = await store.loadActive(db, normalized);
    if (active) remember(active);
    else activeBySymbol.delete(normalized);
    return active;
  }

  async function getHistory(symbol = 'XAUUSD', limit = 20) {
    assertReady();
    return store.loadHistory(db, store.normalizeSymbol(symbol), store.normalizeLimit(limit));
  }

  async function snapshot(symbol = 'XAUUSD', limit = 20) {
    assertReady();
    const normalized = store.normalizeSymbol(symbol);
    const [activeSignal, history] = await Promise.all([
      getActive(normalized),
      getHistory(normalized, limit)
    ]);
    return {
      ready: true,
      symbol: normalized,
      activeSignal,
      history,
      generatedAt: new Date()
    };
  }

  async function publishSignal(input, now = new Date()) {
    assertReady();
    const candidate = createSignalDocument(input, now);
    const existingIdentity = await store.findById(db, candidate.signalId);
    if (existingIdentity) return { signal: existingIdentity, created: false, idempotent: true };

    const active = await getActive(candidate.symbol);
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
        const concurrentActive = await store.loadActive(db, candidate.symbol);
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
    const active = activeBySymbol.get('XAUUSD') || null;
    return {
      ready,
      persistenceBackend: 'mongodb',
      error: lastError,
      initializedAt,
      signalCount: knownSignalCount,
      activeSignalId: active?.signalId || null,
      activeStatus: active?.status || null
    };
  }

  return {
    initialize,
    getActive,
    getHistory,
    snapshot,
    publishSignal,
    transitionSignalById,
    reconfirmSignalById,
    health
  };
}

module.exports = { SignalLedgerError, createSignalLedger };
