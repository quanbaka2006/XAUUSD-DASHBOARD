'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTION_NAME,
  mergeCompletedM1,
  toDocument,
  loadM1,
  upsertM1,
  pruneM1
} = require('../marketData/mongoCandleStore');

function candle(time, close) {
  return { time, open: close, high: close + 1, low: close - 1, close };
}

function fakeCursor(documents) {
  let rows = [...documents];
  let offset = 0;
  let maximum = Infinity;
  const cursor = {
    sort(specification) {
      const direction = specification.time || 1;
      rows.sort((a, b) => direction * (a.time - b.time));
      return cursor;
    },
    skip(count) {
      offset = count;
      return cursor;
    },
    limit(count) {
      maximum = count;
      return cursor;
    },
    async toArray() {
      return rows.slice(offset, offset + maximum);
    },
    async next() {
      return rows.slice(offset, offset + maximum)[0] || null;
    }
  };
  return cursor;
}

test('merges, de-duplicates, sorts and limits completed M1 candles', () => {
  const merged = mergeCompletedM1([
    [candle(120, 2002), candle(0, 2000)],
    [candle(60, 2001), candle(120, 3002), candle(121, 9999)]
  ], 2);
  assert.deepEqual(merged.map((item) => item.time), [60, 120]);
  assert.equal(merged[1].close, 3002);
});

test('creates a scoped MongoDB candle document', () => {
  const document = toDocument(candle(60, 2001));
  assert.equal(document.instrument, 'XAU_USD');
  assert.equal(document.timeframe, 'M1');
  assert.equal(document.time, 60);
  assert.ok(document.updatedAt instanceof Date);
  assert.throws(() => toDocument(candle(61, 2001)), /valid completed M1/);
});

test('upserts by instrument, timeframe and candle time', async () => {
  let captured;
  const db = {
    collection(name) {
      assert.equal(name, COLLECTION_NAME);
      return {
        async updateOne(filter, update, options) {
          captured = { filter, update, options };
        }
      };
    }
  };
  await upsertM1(db, candle(120, 2002));
  assert.deepEqual(captured.filter, { instrument: 'XAU_USD', timeframe: 'M1', time: 120 });
  assert.equal(captured.update.$set.close, 2002);
  assert.equal(captured.options.upsert, true);
});

test('restores the latest MongoDB candles in chronological order', async () => {
  const documents = [candle(0, 2000), candle(60, 2001), candle(120, 2002)];
  const db = {
    collection(name) {
      assert.equal(name, COLLECTION_NAME);
      return { find: () => fakeCursor(documents) };
    }
  };
  const restored = await loadM1(db, 2);
  assert.deepEqual(restored.map((item) => item.time), [60, 120]);
});

test('prunes only candles older than the configured retention limit', async () => {
  const documents = [candle(0, 2000), candle(60, 2001), candle(120, 2002)];
  let deletionFilter;
  const db = {
    collection(name) {
      assert.equal(name, COLLECTION_NAME);
      return {
        find: () => fakeCursor(documents),
        async deleteMany(filter) {
          deletionFilter = filter;
          return { deletedCount: 1 };
        }
      };
    }
  };
  assert.equal(await pruneM1(db, 2), 1);
  assert.deepEqual(deletionFilter.time, { $lte: 0 });
});
