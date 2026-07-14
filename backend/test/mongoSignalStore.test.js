'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COLLECTION_NAME,
  normalizeLimit,
  ensureIndexes,
  loadActive,
  loadHistory,
  replaceSignal
} = require('../signals/mongoSignalStore');

function fakeCursor(documents) {
  let rows = [...documents];
  let maximum = Infinity;
  const cursor = {
    sort(specification) {
      const direction = specification.createdAt || 1;
      rows.sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime()));
      return cursor;
    },
    limit(count) {
      maximum = count;
      return cursor;
    },
    async toArray() {
      return rows.slice(0, maximum);
    }
  };
  return cursor;
}

test('creates identity, single-open, and history indexes', async () => {
  const captured = [];
  let droppedIndex = null;
  const db = {
    collection(name) {
      assert.equal(name, COLLECTION_NAME);
      return {
        async dropIndex(name) { droppedIndex = name; },
        async createIndex(keys, options) { captured.push({ keys, options }); }
      };
    }
  };
  await ensureIndexes(db);
  assert.equal(droppedIndex, 'one_open_scalping_signal_per_symbol');
  assert.equal(captured.length, 3);
  assert.equal(captured[0].options.unique, true);
  assert.equal(captured[1].options.unique, true);
  assert.deepEqual(captured[1].keys, { symbol: 1, timeframe: 1 });
  assert.deepEqual(captured[1].options.partialFilterExpression, { isOpen: true });
});

test('creates indexes when the legacy collection does not exist yet', async () => {
  const captured = [];
  const db = {
    collection() {
      return {
        async dropIndex() {
          const error = new Error('namespace not found');
          error.code = 26;
          error.codeName = 'NamespaceNotFound';
          throw error;
        },
        async createIndex(keys, options) { captured.push({ keys, options }); }
      };
    }
  };

  await ensureIndexes(db);
  assert.equal(captured.length, 3);
});

test('bounds history limits to a safe range', () => {
  assert.equal(normalizeLimit(undefined), 20);
  assert.equal(normalizeLimit(0), 1);
  assert.equal(normalizeLimit(500), 100);
});

test('restores the open signal without exposing Mongo _id', async () => {
  const db = {
    collection() {
      return {
        async findOne(filter) {
          assert.deepEqual(filter, { symbol: 'XAUUSD', timeframe: 'M5', isOpen: true });
          return { _id: 'mongo-id', signalId: 'SIG-1', symbol: 'XAUUSD', timeframe: 'M5', isOpen: true };
        }
      };
    }
  };
  assert.deepEqual(await loadActive(db, 'XAUUSD', 'M5'), {
    signalId: 'SIG-1', symbol: 'XAUUSD', timeframe: 'M5', isOpen: true
  });
});

test('loads newest signal history first and applies the bounded limit', async () => {
  const rows = [
    { _id: 1, signalId: 'old', symbol: 'XAUUSD', createdAt: new Date('2026-07-14T01:00:00Z') },
    { _id: 2, signalId: 'new', symbol: 'XAUUSD', createdAt: new Date('2026-07-14T02:00:00Z') }
  ];
  const db = { collection: () => ({ find: () => fakeCursor(rows) }) };
  const history = await loadHistory(db, 'XAUUSD', 'M1', 1);
  assert.deepEqual(history.map((signal) => signal.signalId), ['new']);
  assert.equal(Object.hasOwn(history[0], '_id'), false);
});

test('uses optimistic revision when replacing a signal', async () => {
  let captured;
  const replacement = { _id: 'ignored', signalId: 'SIG-1', revision: 2, status: 'TP1_HIT' };
  const db = {
    collection() {
      return {
        async findOneAndReplace(filter, document, options) {
          captured = { filter, document, options };
          return { ...document, _id: 'mongo-id' };
        }
      };
    }
  };
  const saved = await replaceSignal(db, replacement, 1);
  assert.deepEqual(captured.filter, { signalId: 'SIG-1', revision: 1 });
  assert.equal(Object.hasOwn(captured.document, '_id'), false);
  assert.equal(captured.options.returnDocument, 'after');
  assert.equal(saved.status, 'TP1_HIT');
});
