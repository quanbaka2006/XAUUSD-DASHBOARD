'use strict';

const { SUPPORTED_TIMEFRAMES } = require('./signalContract');

const COLLECTION_NAME = 'scalping_signals';
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

function collection(db) {
  if (!db || typeof db.collection !== 'function') throw new Error('MongoDB is not connected');
  return db.collection(COLLECTION_NAME);
}

function normalizeSymbol(symbol) {
  const normalized = String(symbol || 'XAUUSD').toUpperCase();
  if (normalized !== 'XAUUSD') throw new Error('Signal Ledger supports XAUUSD only');
  return normalized;
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, parsed));
}

function normalizeTimeframe(timeframe) {
  const normalized = String(timeframe || 'M1').toUpperCase();
  if (!SUPPORTED_TIMEFRAMES.includes(normalized)) {
    throw new Error('Signal timeframe must be M1, M5, M15, or H1');
  }
  return normalized;
}

function withoutMongoId(document) {
  if (!document) return null;
  const { _id, ...signal } = document;
  return signal;
}

async function ensureIndexes(db) {
  const signals = collection(db);
  try {
    await signals.dropIndex('one_open_scalping_signal_per_symbol');
  } catch (error) {
    const missingCollection = error?.code === 26 || error?.codeName === 'NamespaceNotFound';
    const missingIndex = error?.code === 27 || error?.codeName === 'IndexNotFound';
    if (!missingCollection && !missingIndex) throw error;
  }
  await signals.createIndex(
    { signalId: 1 },
    { unique: true, name: 'unique_scalping_signal_id' }
  );
  await signals.createIndex(
    { symbol: 1, timeframe: 1 },
    {
      unique: true,
      partialFilterExpression: { isOpen: true },
      name: 'one_open_scalping_signal_per_symbol_timeframe'
    }
  );
  await signals.createIndex(
    { symbol: 1, timeframe: 1, createdAt: -1 },
    { name: 'scalping_signal_timeframe_history' }
  );
}

async function findById(db, signalId) {
  if (!signalId) return null;
  return withoutMongoId(await collection(db).findOne({ signalId: String(signalId) }));
}

async function loadActive(db, symbol = 'XAUUSD', timeframe = 'M1') {
  return withoutMongoId(await collection(db).findOne({
    symbol: normalizeSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
    isOpen: true
  }));
}

async function loadOpenSignals(db, symbol = 'XAUUSD') {
  const rows = await collection(db)
    .find({ symbol: normalizeSymbol(symbol), isOpen: true })
    .sort({ timeframe: 1 })
    .toArray();
  return rows.map(withoutMongoId);
}

async function loadHistory(db, symbol = 'XAUUSD', timeframe = 'M1', limit = DEFAULT_HISTORY_LIMIT) {
  const rows = await collection(db)
    .find({ symbol: normalizeSymbol(symbol), timeframe: normalizeTimeframe(timeframe) })
    .sort({ createdAt: -1 })
    .limit(normalizeLimit(limit))
    .toArray();
  return rows.map(withoutMongoId);
}

async function countSignals(db, symbol = 'XAUUSD', timeframe = null) {
  const filter = { symbol: normalizeSymbol(symbol) };
  if (timeframe) filter.timeframe = normalizeTimeframe(timeframe);
  return collection(db).countDocuments(filter);
}

async function insertSignal(db, signal) {
  await collection(db).insertOne(signal);
  return withoutMongoId(signal);
}

async function replaceSignal(db, signal, expectedRevision) {
  const replacement = withoutMongoId(signal);
  const result = await collection(db).findOneAndReplace(
    { signalId: replacement.signalId, revision: expectedRevision },
    replacement,
    { returnDocument: 'after' }
  );
  return withoutMongoId(result?.value || result);
}

module.exports = {
  COLLECTION_NAME,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
  normalizeSymbol,
  normalizeTimeframe,
  normalizeLimit,
  withoutMongoId,
  ensureIndexes,
  findById,
  loadActive,
  loadOpenSignals,
  loadHistory,
  countSignals,
  insertSignal,
  replaceSignal
};
