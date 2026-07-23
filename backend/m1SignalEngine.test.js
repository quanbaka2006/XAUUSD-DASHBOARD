const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createM1SignalEngine,
  evaluatePrice
} = require('./m1SignalEngine');

const SYSTEMS = ['zen', 'utbot', 'chandelier', 'trendline'];

function buildHistory(activeTime = 2000) {
  return Array.from({ length: 21 }, (_, index) => {
    const time = activeTime - ((20 - index) * 60);
    return { time, open: 100, high: 101, low: 99, close: 100 };
  });
}

function signal(action, timestamp, entry = 100) {
  return {
    triggered: true,
    action,
    timestamp,
    entry,
    sl: action === 'buy' ? entry - 10 : entry + 10,
    tps: action === 'buy' ? [entry + 5, entry + 10] : [entry - 5, entry - 10],
    confidence: 90
  };
}

function createHarness(seedRecords = []) {
  const currentSignals = Object.fromEntries(SYSTEMS.map(system => [
    system,
    { triggered: false, action: 'stale', timestamp: 0 }
  ]));
  let saved = seedRecords;
  const broadcasts = [];
  const engine = createM1SignalEngine({
    loadRecords: async () => saved,
    saveRecords: async (records) => {
      saved = structuredClone(records);
      return structuredClone(records);
    },
    broadcast: records => broadcasts.push(structuredClone(records)),
    logger: { log() {}, error() {} },
    loadIndicatorModule: async () => ({
      getCurrentSignal: ({ selectedIndicatorSystem }) => currentSignals[selectedIndicatorSystem]
    })
  });
  return { engine, currentSignals, broadcasts, getSaved: () => saved };
}

async function establishBaseline(engine, history) {
  await engine.initialize();
  await engine.ensureBaseline(history);
  await engine.queue;
}

test('keeps a running signal when the same indicator emits a newer identity', async () => {
  const { engine, currentSignals } = createHarness();
  const firstHistory = buildHistory(2000);
  await establishBaseline(engine, firstHistory);

  currentSignals.zen = signal('buy', 1);
  await engine.onClosedCandle(firstHistory, firstHistory.at(-2));
  const firstRecord = engine.records.find(record => record.indicatorSystem === 'zen');

  currentSignals.zen = signal('sell', 2, 101);
  const nextHistory = buildHistory(2060);
  await engine.onClosedCandle(nextHistory, {
    time: 2000,
    open: 100,
    high: 101,
    low: 99,
    close: 100
  });

  const zenRecords = engine.records.filter(record => record.indicatorSystem === 'zen');
  assert.equal(zenRecords.length, 1);
  assert.equal(zenRecords[0].id, firstRecord.id);
  assert.equal(zenRecords[0].outcome, 'running');
  assert.equal(zenRecords[0].action, 'buy');
});

test('allows all four indicator systems to run one signal in parallel', async () => {
  const { engine, currentSignals } = createHarness();
  const history = buildHistory();
  await establishBaseline(engine, history);

  SYSTEMS.forEach((system, index) => {
    currentSignals[system] = signal(index % 2 === 0 ? 'buy' : 'sell', index + 1);
  });
  await engine.onClosedCandle(history, history.at(-2));

  const running = engine.records.filter(record => record.outcome === 'running');
  assert.equal(running.length, 4);
  assert.deepEqual(
    new Set(running.map(record => record.indicatorSystem)),
    new Set(SYSTEMS)
  );
  const status = engine.getStatus();
  assert.equal(status.lockMode, 'one_per_indicator_until_sl_or_tp2');
  assert.deepEqual(status.runningBySystem, {
    zen: 1,
    utbot: 1,
    chandelier: 1,
    trendline: 1
  });
  assert.deepEqual(status.overlappingSystems, []);
});

test('opens the next signal only after the previous signal reaches TP2', async () => {
  const { engine, currentSignals } = createHarness();
  const firstHistory = buildHistory(2000);
  await establishBaseline(engine, firstHistory);

  currentSignals.zen = signal('buy', 1);
  await engine.onClosedCandle(firstHistory, firstHistory.at(-2));
  const firstId = engine.records.find(record => record.indicatorSystem === 'zen').id;

  await engine.onPrice(110, 2100000);
  assert.equal(engine.records.find(record => record.id === firstId).outcome, 'win');

  currentSignals.zen = signal('sell', 2, 110);
  const nextHistory = buildHistory(2060);
  await engine.onClosedCandle(nextHistory, {
    time: 2000,
    open: 100,
    high: 101,
    low: 99,
    close: 100
  });

  const zenRecords = engine.records.filter(record => record.indicatorSystem === 'zen');
  assert.equal(zenRecords.length, 2);
  assert.equal(zenRecords.filter(record => record.outcome === 'running').length, 1);
  assert.equal(zenRecords.find(record => record.outcome === 'running').action, 'sell');
});

test('does not expire a running signal based on elapsed time', () => {
  const record = {
    id: 'XAUUSD:M1:zen:1',
    indicatorSystem: 'zen',
    action: 'buy',
    entry: 100,
    sl: 90,
    tps: [105, 110],
    signalTime: 1,
    expiresAt: 3600001,
    outcome: 'running',
    status: 'running',
    hitTp1: false
  };
  const afterSeveralHours = evaluatePrice(record, 102, 12 * 60 * 60 * 1000);
  assert.equal(afterSeveralHours.outcome, 'running');
  assert.equal(afterSeveralHours.status, 'running');
});

test('keeps TP1 non-terminal and closes only when SL is reached', () => {
  const record = {
    id: 'XAUUSD:M1:zen:1',
    indicatorSystem: 'zen',
    action: 'buy',
    entry: 100,
    sl: 90,
    tps: [105, 110],
    signalTime: 1,
    outcome: 'running',
    status: 'running',
    hitTp1: false
  };

  const atTp1 = evaluatePrice(record, 105, 2000);
  assert.equal(atTp1.outcome, 'running');
  assert.equal(atTp1.status, 'tp1');
  assert.equal(atTp1.hitTp1, true);

  const atSl = evaluatePrice(atTp1, 90, 3000);
  assert.equal(atSl.outcome, 'loss');
  assert.equal(atSl.status, 'sl');
  assert.equal(atSl.exitPrice, 90);
});
