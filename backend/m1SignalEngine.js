const path = require('path');
const { pathToFileURL } = require('url');

const SYSTEMS = ['zen', 'utbot', 'chandelier', 'trendline'];
const LABELS = {
  zen: 'MTF Trend PA',
  utbot: 'UT Bot',
  chandelier: 'Chandelier',
  trendline: 'Trendlines'
};
const CONFIG = Object.freeze({
  zenFastPeriod: 20,
  zenSlowPeriod: 50,
  utBotKeyValue: 2,
  utBotAtrPeriod: 10,
  chandelierAtrPeriod: 22,
  chandelierAtrMultiplier: 3,
  trendlineLength: 14,
  trendlineSlopeMult: 1
});
const MAX_RECORDS = 50;

const indicatorsUrl = pathToFileURL(
  path.join(__dirname, '../frontend/src/utils/indicators.js')
).href;

let indicatorsPromise = null;
function loadIndicators() {
  if (!indicatorsPromise) indicatorsPromise = import(indicatorsUrl);
  return indicatorsPromise;
}

function signalIdentity(signal) {
  if (!signal || signal.triggered === false || !['buy', 'sell'].includes(signal.action)) return null;
  const timestamp = Number(signal.timestamp);
  return Number.isFinite(timestamp) && timestamp > 0 ? `${signal.action}:${timestamp}` : null;
}

function normalizeRecords(records) {
  return [...records]
    .sort((a, b) => Number(b.signalTime) - Number(a.signalTime) || Number(b.recordedAt) - Number(a.recordedAt))
    .slice(0, MAX_RECORDS);
}

function marketSettlement(record, exitPrice, closeTime, reason) {
  const entry = Number(record.entry);
  const exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return record;
  const direction = record.action === 'sell' ? entry - exit : exit - entry;
  const outcome = Math.abs(direction) < 0.005 ? 'breakeven' : direction > 0 ? 'win' : 'loss';
  return {
    ...record,
    outcome,
    status: 'market_close',
    closeTime: Number(closeTime),
    exitPrice: exit,
    closeReason: reason,
    expiryReason: null
  };
}

function evaluatePrice(record, price, timestamp) {
  if (record.outcome !== 'running') return record;
  const numericPrice = Number(price);
  const sl = Number(record.sl);
  const tp1 = Number(record.tps?.[0]);
  const tp2 = Number(record.tps?.[1] ?? record.tps?.[0]);
  let hitTp1 = Boolean(record.hitTp1);

  if (record.action === 'buy') {
    if (numericPrice <= sl) return { ...record, outcome: 'loss', status: 'sl', closeTime: timestamp, exitPrice: sl };
    if (numericPrice >= tp2) return { ...record, outcome: 'win', status: 'finished', hitTp1: true, closeTime: timestamp, exitPrice: tp2 };
    if (numericPrice >= tp1) hitTp1 = true;
  } else {
    if (numericPrice >= sl) return { ...record, outcome: 'loss', status: 'sl', closeTime: timestamp, exitPrice: sl };
    if (numericPrice <= tp2) return { ...record, outcome: 'win', status: 'finished', hitTp1: true, closeTime: timestamp, exitPrice: tp2 };
    if (numericPrice <= tp1) hitTp1 = true;
  }

  if (hitTp1 !== record.hitTp1) return { ...record, hitTp1, status: 'tp1' };
  return record;
}

function evaluateCandle(record, candle) {
  if (record.outcome !== 'running' || !candle) return record;
  const candleTime = Number(candle.time) * 1000;
  if (!candleTime || candleTime < Number(record.signalTime)) return record;
  const sl = Number(record.sl);
  const tp1 = Number(record.tps?.[0]);
  const tp2 = Number(record.tps?.[1] ?? record.tps?.[0]);
  const high = Number(candle.high);
  const low = Number(candle.low);
  let hitTp1 = Boolean(record.hitTp1);

  // Conservative rule when candle ordering is unavailable: SL wins ties.
  if (record.action === 'buy') {
    if (low <= sl) return { ...record, outcome: 'loss', status: 'sl', closeTime: candleTime, exitPrice: sl };
    if (high >= tp2) return { ...record, outcome: 'win', status: 'finished', hitTp1: true, closeTime: candleTime, exitPrice: tp2 };
    if (high >= tp1) hitTp1 = true;
  } else {
    if (high >= sl) return { ...record, outcome: 'loss', status: 'sl', closeTime: candleTime, exitPrice: sl };
    if (low <= tp2) return { ...record, outcome: 'win', status: 'finished', hitTp1: true, closeTime: candleTime, exitPrice: tp2 };
    if (low <= tp1) hitTp1 = true;
  }

  if (hitTp1 !== record.hitTp1) return { ...record, hitTp1, status: 'tp1' };
  return record;
}

class M1SignalEngine {
  constructor({ loadRecords, saveRecords, broadcast, logger = console, loadIndicatorModule = loadIndicators }) {
    this.loadRecords = loadRecords;
    this.saveRecords = saveRecords;
    this.broadcast = broadcast;
    this.logger = logger;
    this.loadIndicatorModule = loadIndicatorModule;
    this.records = [];
    this.baselines = {};
    this.baselineReady = false;
    this.baselineRequested = false;
    this.initialized = false;
    this.queue = Promise.resolve();
  }

  enqueue(work) {
    this.queue = this.queue.catch((error) => {
      this.logger.error('[M1 Engine] Previous task failed:', error.message);
    }).then(work);
    return this.queue;
  }

  async initialize() {
    if (this.initialized) return;
    const records = await this.loadRecords();
    this.records = normalizeRecords(Array.isArray(records) ? records : []);
    this.initialized = true;
    this.logger.log(`[M1 Engine] Initialized with ${this.records.length} website records.`);
  }

  calculateSignal(getCurrentSignal, system, history) {
    return getCurrentSignal({
      history,
      selectedSymbol: 'XAUUSD',
      selectedIndicatorSystem: system,
      ...CONFIG
    });
  }

  ensureBaseline(history) {
    if (this.baselineReady || this.baselineRequested || !Array.isArray(history) || history.length < 21) return;
    this.baselineRequested = true;
    return this.enqueue(async () => {
      await this.initialize();
      const { getCurrentSignal } = await this.loadIndicatorModule();
      SYSTEMS.forEach((system) => {
        this.baselines[system] = signalIdentity(this.calculateSignal(getCurrentSignal, system, history));
      });
      this.baselineReady = true;
      this.logger.log('[M1 Engine] Realtime baseline established for all four systems.');
    });
  }

  onClosedCandle(history, closedCandle) {
    if (!Array.isArray(history) || history.length < 21) return;
    this.ensureBaseline(history);
    return this.enqueue(async () => {
      await this.initialize();
      if (!this.baselineReady) return;
      const { getCurrentSignal } = await this.loadIndicatorModule();
      let changed = false;

      this.records = this.records.map((record) => {
        const next = evaluateCandle(record, closedCandle);
        if (JSON.stringify(next) !== JSON.stringify(record)) changed = true;
        return next;
      });

      for (const system of SYSTEMS) {
        const signal = this.calculateSignal(getCurrentSignal, system, history);
        const identity = signalIdentity(signal);
        const previousIdentity = this.baselines[system];
        this.baselines[system] = identity;
        if (!identity || identity === previousIdentity) continue;

        const publicationTime = Number(history[history.length - 1]?.time) * 1000 || Date.now();
        const activeRecord = this.records.find(record =>
          record.indicatorSystem === system && record.outcome === 'running'
        );
        if (activeRecord) {
          this.logger.log(
            `[M1 Engine] ${LABELS[system]} ignored ${signal.action.toUpperCase()} `
            + `because ${activeRecord.id} is still running.`
          );
          continue;
        }

        const id = `XAUUSD:M1:${system}:${publicationTime}`;
        if (this.records.some(record => record.id === id)) continue;
        this.records.push({
          id,
          symbol: 'XAUUSD',
          timeframe: 'M1',
          indicatorSystem: system,
          indicatorLabel: LABELS[system],
          action: signal.action,
          entry: Number(signal.entry),
          sl: Number(signal.sl),
          tps: Array.isArray(signal.tps) ? signal.tps.map(Number) : [],
          confidence: Number(signal.confidence) || 0,
          sourceTimestamp: Number(signal.timestamp),
          signalTime: publicationTime,
          expiresAt: null,
          recordedAt: Date.now(),
          outcome: 'running',
          status: 'running',
          hitTp1: false,
          closeTime: null,
          exitPrice: null,
          closeReason: null,
          expiryReason: null
        });
        changed = true;
        this.logger.log(`[M1 Engine] ${LABELS[system]} published ${signal.action.toUpperCase()} at ${signal.entry}.`);
      }

      if (changed) await this.persist();
    });
  }

  onPrice(price, timestamp = Date.now()) {
    if (!Number.isFinite(Number(price)) || Number(price) <= 0) return;
    return this.enqueue(async () => {
      await this.initialize();
      let changed = false;
      this.records = this.records.map((record) => {
        const next = evaluatePrice(record, Number(price), Number(timestamp));
        if (JSON.stringify(next) !== JSON.stringify(record)) changed = true;
        return next;
      });
      if (changed) await this.persist();
    });
  }

  async persist() {
    this.records = normalizeRecords(this.records);
    this.records = await this.saveRecords(this.records);
    this.broadcast(this.records);
  }

  getStatus() {
    const runningBySystem = Object.fromEntries(
      SYSTEMS.map(system => [
        system,
        this.records.filter(record =>
          record.indicatorSystem === system && record.outcome === 'running'
        ).length
      ])
    );
    return {
      mode: 'backend',
      lockMode: 'one_per_indicator_until_sl_or_tp2',
      initialized: this.initialized,
      baselineReady: this.baselineReady,
      systems: [...SYSTEMS],
      runningSignals: Object.values(runningBySystem).reduce((total, count) => total + count, 0),
      runningBySystem,
      overlappingSystems: Object.entries(runningBySystem)
        .filter(([, count]) => count > 1)
        .map(([system]) => system),
      storedSignals: this.records.length
    };
  }
}

function createM1SignalEngine(options) {
  return new M1SignalEngine(options);
}

module.exports = {
  CONFIG,
  SYSTEMS,
  createM1SignalEngine,
  evaluateCandle,
  evaluatePrice,
  marketSettlement,
  signalIdentity
};
