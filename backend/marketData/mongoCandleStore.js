'use strict';

const { normalizeCompletedM1 } = require('./candleAggregation');

const COLLECTION_NAME = 'market_candles';
const INSTRUMENT = 'XAU_USD';
const TIMEFRAME = 'M1';

function mergeCompletedM1(sources, limit = 5000) {
  const candles = Array.isArray(sources) ? sources.flat() : [];
  return normalizeCompletedM1(candles).slice(-limit);
}

function toDocument(candle) {
  const normalized = normalizeCompletedM1([candle])[0];
  if (!normalized) throw new Error('A valid completed M1 candle is required');
  return {
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    ...normalized,
    updatedAt: new Date()
  };
}

function collection(db) {
  if (!db || typeof db.collection !== 'function') throw new Error('MongoDB is not connected');
  return db.collection(COLLECTION_NAME);
}

async function ensureIndexes(db) {
  await collection(db).createIndex(
    { instrument: 1, timeframe: 1, time: 1 },
    { unique: true, name: 'unique_instrument_timeframe_time' }
  );
}

async function loadM1(db, limit = 5000) {
  const documents = await collection(db)
    .find(
      { instrument: INSTRUMENT, timeframe: TIMEFRAME },
      { projection: { _id: 0, instrument: 0, timeframe: 0, updatedAt: 0 } }
    )
    .sort({ time: -1 })
    .limit(limit)
    .toArray();
  return normalizeCompletedM1(documents).slice(-limit);
}

async function upsertM1(db, candle) {
  const document = toDocument(candle);
  await collection(db).updateOne(
    { instrument: INSTRUMENT, timeframe: TIMEFRAME, time: document.time },
    { $set: document },
    { upsert: true }
  );
  return document;
}

async function pruneM1(db, limit = 5000) {
  const firstExpired = await collection(db)
    .find(
      { instrument: INSTRUMENT, timeframe: TIMEFRAME },
      { projection: { _id: 0, time: 1 } }
    )
    .sort({ time: -1 })
    .skip(limit)
    .limit(1)
    .next();
  if (!firstExpired) return 0;
  const result = await collection(db).deleteMany({
    instrument: INSTRUMENT,
    timeframe: TIMEFRAME,
    time: { $lte: firstExpired.time }
  });
  return result.deletedCount || 0;
}

async function upsertM1Batch(db, candles, limit = 5000) {
  const normalized = normalizeCompletedM1(candles).slice(-limit);
  if (normalized.length === 0) return 0;
  await collection(db).bulkWrite(normalized.map((candle) => {
    const document = toDocument(candle);
    return {
      updateOne: {
        filter: { instrument: INSTRUMENT, timeframe: TIMEFRAME, time: document.time },
        update: { $set: document },
        upsert: true
      }
    };
  }), { ordered: false });
  await pruneM1(db, limit);
  return normalized.length;
}

module.exports = {
  COLLECTION_NAME,
  INSTRUMENT,
  TIMEFRAME,
  mergeCompletedM1,
  toDocument,
  ensureIndexes,
  loadM1,
  upsertM1,
  upsertM1Batch,
  pruneM1
};
