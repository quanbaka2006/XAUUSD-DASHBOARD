'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeCompletedM1 } = require('./candleAggregation');

const STORE_VERSION = 1;

function createCandleStore({ filePath, limit = 5000, debounceMs = 250 } = {}) {
  if (!filePath) throw new Error('filePath is required');
  let saveTimer = null;
  let pendingCandles = null;

  function load() {
    try {
      if (!fs.existsSync(filePath)) return [];
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (payload.version !== STORE_VERSION || payload.instrument !== 'XAU_USD') return [];
      return normalizeCompletedM1(payload.candles).slice(-limit);
    } catch (error) {
      console.warn('[CandleStore] Ignoring unreadable XAUUSD snapshot:', error.message);
      return [];
    }
  }

  function saveNow(candles = pendingCandles || []) {
    const normalized = normalizeCompletedM1(candles).slice(-limit);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({
      version: STORE_VERSION,
      instrument: 'XAU_USD',
      savedAt: new Date().toISOString(),
      candles: normalized
    }), 'utf8');
    fs.renameSync(temporaryPath, filePath);
    pendingCandles = null;
    return normalized.length;
  }

  function scheduleSave(candles) {
    pendingCandles = candles;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { saveNow(); } catch (error) {
        console.error('[CandleStore] Failed to persist XAUUSD candles:', error.message);
      }
    }, debounceMs);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (pendingCandles) return saveNow();
    return 0;
  }

  return { load, saveNow, scheduleSave, flush };
}

module.exports = { STORE_VERSION, createCandleStore };
