'use strict';

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

function withoutMongoId(document) {
  if (!document) return null;
  const { _id, ...signal } = document;
  return signal;
}

async function ensureIndexes(db) {
  const signals = collection(db);
  await signals.createIndex(
    { signalId: 1 },
    { unique: true, name: 'unique_scalping_signal_id' }
  );
  await signals.createIndex(
    { symbol: 1 },
    {
      unique: true,
      partialFilterExpression: { isOpen: true },
      name: 'one_open_scalping_signal_per_symbol'
    }
  );
  await signals.createIndex(
    { symbol: 1, createdAt: -1 },
    { name: 'scalping_signal_history' }
  );
}

async function findById(db, signalId) {
  if (!signalId) return null;
  return withoutMongoId(await collection(db).findOne({ signalId: String(signalId) }));
}

async function loadActive(db, symbol = 'XAUUSD') {
  return withoutMongoId(await collection(db).findOne({ symbol: normalizeSymbol(symbol), isOpen: true }));
}

async function loadHistory(db, symbol = 'XAUUSD', limit = DEFAULT_HISTORY_LIMIT) {
  const rows = await collection(db)
    .find({ symbol: normalizeSymbol(symbol) })
    .sort({ createdAt: -1 })
    .limit(normalizeLimit(limit))
    .toArray();
  return rows.map(withoutMongoId);
}

async function countSignals(db, symbol = 'XAUUSD') {
  return collection(db).countDocuments({ symbol: normalizeSymbol(symbol) });
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
  normalizeLimit,
  withoutMongoId,
  ensureIndexes,
  findById,
  loadActive,
  loadHistory,
  countSignals,
  insertSignal,
  replaceSignal
};
