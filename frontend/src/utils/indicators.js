// Math Helpers for Indicators

export const SIGNAL_ALGORITHM_VERSION = '3.0.0';

export function getStableDisplayStrength({ symbol, timeframe, indicator, timestamp }) {
  const input = `${symbol || ''}:${timeframe || ''}:${indicator || ''}:${timestamp || 0}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 90 + ((hash >>> 0) % 9);
}

export function calculateEMA(data, period) {
  if (!Number.isInteger(period) || period <= 0 || data.length < period) return [];
  const emaData = [];
  const k = 2 / (period + 1);
  let emaVal = 0;
  for (let i = 0; i < period; i++) emaVal += data[i].close;
  emaVal /= period;
  emaData.push({ time: data[period - 1].time, value: emaVal });

  for (let i = period; i < data.length; i++) {
    emaVal = data[i].close * k + emaVal * (1 - k);
    emaData.push({ time: data[i].time, value: emaVal });
  }
  return emaData;
}

export function calculateSMA(data, period) {
  if (!Number.isInteger(period) || period <= 0 || data.length < period) return [];
  const smaData = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) smaData.push({ time: data[i].time, value: sum / period });
  }
  return smaData;
}

export function calculateRSI(data, period = 14) {
  const rsiData = [];
  if (data.length < period + 1) return rsiData;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const toRsi = () => {
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    if (avgGain === 0) return 0;
    return 100 - (100 / (1 + avgGain / avgLoss));
  };
  rsiData.push({ time: data[period].time, value: toRsi() });
  
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    
    rsiData.push({ time: data[i].time, value: toRsi() });
  }
  return rsiData;
}

export function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const macdData = [];
  if (data.length < slowPeriod) return macdData;
  
  const fastEma = calculateEMA(data, fastPeriod);
  const slowEma = calculateEMA(data, slowPeriod);
  
  const fastByTime = new Map(fastEma.map((item) => [item.time, item.value]));
  const macdLines = slowEma.map((slow) => ({
    time: slow.time,
    close: fastByTime.get(slow.time) - slow.value
  }));
  const signalLines = calculateEMA(macdLines, signalPeriod);
  const macdByTime = new Map(macdLines.map((item) => [item.time, item.close]));
  return signalLines.map((signal) => ({
    time: signal.time,
    macd: macdByTime.get(signal.time),
    signal: signal.value,
    histogram: macdByTime.get(signal.time) - signal.value
  }));
}

export function calculateSMC(history) {
  const result = { bos: null, choch: null };
  if (history.length < 15) return result;
  
  let swingHighs = [];
  let swingLows = [];
  
  for (let i = 2; i < history.length - 2; i++) {
    const high = history[i].high;
    const low = history[i].low;
    if (high > history[i-1].high && high > history[i-2].high && high > history[i+1].high && high > history[i+2].high) {
      swingHighs.push({ index: i, price: high, time: history[i].time });
    }
    if (low < history[i-1].low && low < history[i-2].low && low < history[i+1].low && low < history[i+2].low) {
      swingLows.push({ index: i, price: low, time: history[i].time });
    }
  }
  
  let trend = null;
  let highIdx = 0;
  let lowIdx = 0;
  let activeHigh = null;
  let activeLow = null;
  const brokenHighs = new Set();
  const brokenLows = new Set();
  for (let i = 0; i < history.length; i++) {
    while (highIdx < swingHighs.length && swingHighs[highIdx].index + 2 <= i) activeHigh = swingHighs[highIdx++];
    while (lowIdx < swingLows.length && swingLows[lowIdx].index + 2 <= i) activeLow = swingLows[lowIdx++];
    if (activeHigh && !brokenHighs.has(activeHigh.index) && history[i].close > activeHigh.price) {
      if (trend === 'bearish') result.choch = activeHigh.price;
      else result.bos = activeHigh.price;
      trend = 'bullish';
      brokenHighs.add(activeHigh.index);
    }
    if (activeLow && !brokenLows.has(activeLow.index) && history[i].close < activeLow.price) {
      if (trend === 'bullish') result.choch = activeLow.price;
      else result.bos = activeLow.price;
      trend = 'bearish';
      brokenLows.add(activeLow.index);
    }
  }
  return result;
}

export function calculateIndicatorData(data, type, period) {
  if (type === 'EMA') {
    return calculateEMA(data, period);
  } else if (type === 'SMA') {
    return calculateSMA(data, period);
  }
  return [];
}

export function calculateATR(data, period) {
  if (!Number.isInteger(period) || period <= 0 || data.length < period) return [];
  const tr = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      const h_l = data[i].high - data[i].low;
      const h_pc = Math.abs(data[i].high - data[i - 1].close);
      const l_pc = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(h_l, h_pc, l_pc));
    }
  }
  const atr = [];
  let currentAtr = 0;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  currentAtr = sum / period;
  atr.push({ time: data[period - 1].time, value: currentAtr });
  for (let i = period; i < data.length; i++) {
    currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
    atr.push({ time: data[i].time, value: currentAtr });
  }
  return atr;
}

export function calculateUTBotSignals(data, keyValue = 2, atrPeriod = 10) {
  const atrValues = calculateATR(data, atrPeriod);
  if (atrValues.length === 0) return [];
  const atrMap = {};
  atrValues.forEach(item => {
    atrMap[item.time] = item.value;
  });
  const result = [];
  let xLoss = null;
  let position = 0;
  for (let i = 0; i < data.length; i++) {
    const candle = data[i];
    const time = candle.time;
    const src = candle.close;
    const atrVal = atrMap[time];
    if (atrVal === undefined) {
      result.push({ time, buy: false, sell: false, trailingStop: null });
      continue;
    }
    const nLoss = atrVal * keyValue;
    let nextLoss = xLoss;
    if (xLoss === null) {
      nextLoss = src - nLoss;
    } else {
      const prevLoss = xLoss;
      const prevClose = data[i - 1].close;
      if (src > prevLoss && prevClose > prevLoss) {
        nextLoss = Math.max(prevLoss, src - nLoss);
      } else if (src < prevLoss && prevClose < prevLoss) {
        nextLoss = Math.min(prevLoss, src + nLoss);
      } else if (src > prevLoss) {
        nextLoss = src - nLoss;
      } else {
        nextLoss = src + nLoss;
      }
    }
    let buy = false;
    let sell = false;
    let nextPosition = position;
    if (xLoss !== null) {
      const prevLoss = xLoss;
      const prevClose = data[i - 1].close;
      if (prevClose <= prevLoss && src > prevLoss) {
        nextPosition = 1;
        buy = true;
      } else if (prevClose >= prevLoss && src < prevLoss) {
        nextPosition = -1;
        sell = true;
      }
    }
    xLoss = nextLoss;
    position = nextPosition;
    result.push({
      time,
      buy,
      sell,
      trailingStop: xLoss
    });
  }
  return result;
}

export function calculateZenTrendLines(data, fastPeriod = 20, slowPeriod = 50) {
  const fastEma = calculateEMA(data, fastPeriod);
  const slowEma = calculateEMA(data, slowPeriod);
  const slowByTime = new Map(slowEma.map((item) => [item.time, item.value]));
  return fastEma
    .filter((fast) => slowByTime.has(fast.time))
    .map((fast) => ({
      time: fast.time,
      fast: fast.value,
      slow: slowByTime.get(fast.time),
      trend: fast.value >= slowByTime.get(fast.time) ? 'bullish' : 'bearish'
    }));
}

export function calculateChandelierExit(data, length = 22, mult = 3.0, useClose = true) {
  const atrValues = calculateATR(data, length);
  if (atrValues.length === 0) return [];
  const atrMap = {};
  atrValues.forEach(item => {
    atrMap[item.time] = item.value;
  });

  const result = [];
  let dir = 1;
  let prevLongStop = null;
  let prevShortStop = null;

  for (let i = 0; i < data.length; i++) {
    const candle = data[i];
    const time = candle.time;
    const atrVal = atrMap[time];

    if (atrVal === undefined || i < length) {
      result.push({ time, longStop: null, shortStop: null, dir: 1, buy: false, sell: false });
      continue;
    }

    let highestVal = -Infinity;
    let lowestVal = Infinity;
    for (let j = 0; j < length; j++) {
      const idx = i - j;
      const c = data[idx];
      const h = useClose ? c.close : c.high;
      const l = useClose ? c.close : c.low;
      if (h > highestVal) highestVal = h;
      if (l < lowestVal) lowestVal = l;
    }

    const atrOffset = atrVal * mult;
    let currentLongStop = highestVal - atrOffset;
    let currentShortStop = lowestVal + atrOffset;

    const prevClose = data[i - 1].close;
    if (prevLongStop !== null) {
      currentLongStop = prevClose > prevLongStop ? Math.max(currentLongStop, prevLongStop) : currentLongStop;
    }
    if (prevShortStop !== null) {
      currentShortStop = prevClose < prevShortStop ? Math.min(currentShortStop, prevShortStop) : currentShortStop;
    }

    let nextDir = dir;
    if (candle.close > prevShortStop && prevShortStop !== null) {
      nextDir = 1;
    } else if (candle.close < prevLongStop && prevLongStop !== null) {
      nextDir = -1;
    }

    let buy = false;
    let sell = false;
    if (nextDir === 1 && dir === -1) buy = true;
    if (nextDir === -1 && dir === 1) sell = true;

    dir = nextDir;
    prevLongStop = currentLongStop;
    prevShortStop = currentShortStop;

    result.push({
      time,
      longStop: dir === 1 ? currentLongStop : null,
      shortStop: dir === -1 ? currentShortStop : null,
      dir,
      buy,
      sell
    });
  }
  return result;
}

export function calculateTrendlinesWithBreaks(data, length = 14, k = 1.0) {
  const atrValues = calculateATR(data, length);
  const atrMap = {};
  atrValues.forEach(item => {
    atrMap[item.time] = item.value;
  });

  const pivHighs = Array(data.length).fill(null);
  const pivLows = Array(data.length).fill(null);

  for (let i = length; i < data.length - length; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= length; j++) {
      if (data[i].high < data[i - j].high || data[i].high <= data[i + j].high) isHigh = false;
      if (data[i].low > data[i - j].low || data[i].low >= data[i + j].low) isLow = false;
    }
    if (isHigh) pivHighs[i] = data[i].high;
    if (isLow) pivLows[i] = data[i].low;
  }

  const result = [];
  let upper = null;
  let lower = null;
  let slopePh = 0;
  let slopePl = 0;
  let singleUpper = 0;
  let singleLower = 0;

  for (let i = 0; i < data.length; i++) {
    const time = data[i].time;
    const atrVal = atrMap[time] || 0.1;
    const currentSlope = atrVal / length * k;

    let ph = null;
    let pl = null;
    if (i >= 2 * length) {
      ph = pivHighs[i - length];
      pl = pivLows[i - length];
    }

    if (ph !== null) {
      slopePh = currentSlope;
      upper = ph;
    } else if (upper !== null) {
      upper = upper - slopePh;
    }

    if (pl !== null) {
      slopePl = currentSlope;
      lower = pl;
    } else if (lower !== null) {
      lower = lower + slopePl;
    }

    let buy = false;
    let sell = false;
    
    if (i >= 2 * length) {
      const srcVal = data[i].close;
      const prevSingleUpper = singleUpper;
      const prevSingleLower = singleLower;

      if (srcVal > upper && upper !== null) {
        singleUpper = 0;
      } else if (ph !== null) {
        singleUpper = 1;
      }

      if (srcVal < lower && lower !== null) {
        singleLower = 0;
      } else if (pl !== null) {
        singleLower = 1;
      }

      if (prevSingleUpper === 1 && srcVal > upper && upper !== null) {
        buy = true;
      }
      if (prevSingleLower === 1 && srcVal < lower && lower !== null) {
        sell = true;
      }
    }

    result.push({
      time,
      upper,
      lower,
      buy,
      sell,
      breakoutTime: buy || sell ? time : null,
      buyAtBreakout: buy,
      sellAtBreakout: sell
    });
  }
  return result;
}

const SWING_RISK_SETTINGS = {
  'XAUUSD': { buffer: 0.2, decimals: 2 },
  'WTIUSD': { buffer: 0.02, decimals: 2 },
  'XAGUSD': { buffer: 0.01, decimals: 4 },
  'BTCUSD': { buffer: 5, decimals: 2 },
  'ETHUSD': { buffer: 0.5, decimals: 2 }
};

const TIMEFRAME_SECONDS = { M1: 60, M5: 300, M15: 900, H1: 3600 };

const SIGNAL_BLOCK_MESSAGES = {
  'market-data-not-ready': 'Dữ liệu thị trường chưa sẵn sàng',
  'insufficient-history': 'Chưa đủ lịch sử nến',
  'insufficient-indicator-warmup': 'Chỉ báo chưa đủ dữ liệu warm-up',
  'no-confirmed-signal': 'Chưa có tín hiệu đã xác nhận',
  'synthetic-trigger-blocked': 'Trigger nằm trên nến synthetic nên đã bị chặn',
  'recent-gap-fill': 'Có gap-fill gần trigger nên đang chờ dữ liệu thật',
  'confirmed-swing-not-found': 'Chưa tìm thấy swing thật đã xác nhận'
};

export function getSignalBlockMessage(reason) {
  return SIGNAL_BLOCK_MESSAGES[reason] || reason || 'Chưa có trigger M5';
}

export function isSyntheticCandle(candle) {
  return Boolean(candle?.synthetic);
}

export function isGapFillCandle(candle) {
  return candle?.syntheticReason === 'gap-fill';
}

export function getSignalAnalysisHistory(history) {
  if (!Array.isArray(history) || history.length < 2) return [];
  return history.slice(0, -1).filter((candle) => !isGapFillCandle(candle));
}

function inferIntervalSeconds(history) {
  const frequencies = new Map();
  for (let index = 1; index < (history || []).length; index += 1) {
    const difference = history[index].time - history[index - 1].time;
    if (!Number.isFinite(difference) || difference <= 0) continue;
    frequencies.set(difference, (frequencies.get(difference) || 0) + 1);
  }
  return [...frequencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function isContiguousWindow(window, intervalSeconds) {
  if (!Number.isFinite(intervalSeconds)) return false;
  return window.every((candle, index) => index === 0 || candle.time - window[index - 1].time === intervalSeconds);
}

export function findConfirmedSwing(history, action, beforeTime = Infinity, strength = 2, lookback = 100, intervalSeconds = null) {
  const source = (history || []).filter((candle) => !isGapFillCandle(candle));
  const expectedInterval = intervalSeconds || inferIntervalSeconds(source);
  const lastEligibleIndex = source.findLastIndex((candle) => candle.time < beforeTime);
  const firstIndex = Math.max(strength, lastEligibleIndex - lookback + 1);
  for (let index = lastEligibleIndex - strength; index >= firstIndex; index -= 1) {
    const window = source.slice(index - strength, index + strength + 1);
    if (window.length !== strength * 2 + 1 || window.some(isSyntheticCandle) ||
        !isContiguousWindow(window, expectedInterval)) continue;
    const candidate = source[index];
    if (action === 'buy') {
      const isSwingLow = window.every((candle, windowIndex) => windowIndex === strength || candidate.low < candle.low);
      if (isSwingLow) return { type: 'low', price: candidate.low, time: candidate.time };
    } else if (action === 'sell') {
      const isSwingHigh = window.every((candle, windowIndex) => windowIndex === strength || candidate.high > candle.high);
      if (isSwingHigh) return { type: 'high', price: candidate.high, time: candidate.time };
    }
  }
  return null;
}

export function calculateSwingRisk({ history, action, entry, triggerTime, symbol, timeframe = 'M1' }) {
  const settings = SWING_RISK_SETTINGS[symbol] || { buffer: 0.01, decimals: 2 };
  const swing = findConfirmedSwing(history, action, triggerTime, 2, 100, TIMEFRAME_SECONDS[timeframe]);
  if (!swing) return null;
  const sl = action === 'buy'
    ? Number((swing.price - settings.buffer).toFixed(settings.decimals))
    : Number((swing.price + settings.buffer).toFixed(settings.decimals));
  const riskDistance = Number(Math.abs(entry - sl).toFixed(settings.decimals));
  if (!Number.isFinite(riskDistance) || riskDistance <= settings.buffer ||
      (action === 'buy' && sl >= entry) || (action === 'sell' && sl <= entry)) return null;
  const direction = action === 'buy' ? 1 : -1;
  const tp1 = Number((entry + direction * riskDistance).toFixed(settings.decimals));
  const tp2 = Number((entry + direction * riskDistance * 2).toFixed(settings.decimals));
  return {
    sl,
    tp1,
    tp2,
    swing,
    buffer: settings.buffer,
    riskDistance,
    riskReward: { tp1: 1, tp2: 2, minimumRequired: 1.5, valid: true }
  };
}

export function getCurrentSignal({
  history,
  selectedSymbol,
  selectedTimeframe,
  selectedIndicatorSystem,
  zenFastPeriod,
  zenSlowPeriod,
  utBotKeyValue,
  utBotAtrPeriod,
  chandelierAtrPeriod,
  chandelierAtrMultiplier,
  trendlineLength,
  trendlineSlopeMult,
  livePrice,
  dataReady = true
}) {
  const parameters = selectedIndicatorSystem === 'zen'
    ? { fastPeriod: zenFastPeriod, slowPeriod: zenSlowPeriod }
    : selectedIndicatorSystem === 'utbot'
      ? { keyValue: utBotKeyValue, atrPeriod: utBotAtrPeriod }
      : selectedIndicatorSystem === 'chandelier'
        ? { atrPeriod: chandelierAtrPeriod, atrMultiplier: chandelierAtrMultiplier }
        : selectedIndicatorSystem === 'trendline'
          ? { length: trendlineLength, slopeMultiplier: trendlineSlopeMult }
          : {};
  const signalIdentity = {
    symbol: selectedSymbol || null,
    timeframe: selectedTimeframe || null,
    indicator: selectedIndicatorSystem || null,
    parameters,
    algorithmVersion: SIGNAL_ALGORITHM_VERSION,
    riskModel: 'confirmed-swing-rr-v1'
  };
  const staleSignal = (blockedReason = 'no-confirmed-signal') => ({
    ...signalIdentity,
    action: 'stale',
    entry: 0,
    sl: 0,
    tp: 0,
    tps: [],
    signalStrength: 0,
    blockedReason,
    sourceCandleTime: null,
    timestamp: Date.now()
  });
  if (!dataReady) return staleSignal('market-data-not-ready');
  if (!history || history.length < 2) return staleSignal('insufficient-history');

  // Active candles and gap-fill candles can be displayed, but cannot participate in signals.
  const closedHistory = getSignalAnalysisHistory(history);
  const realClosedHistory = closedHistory.filter((candle) => !isSyntheticCandle(candle));
  const minimumHistory = {
    zen: Math.max(zenFastPeriod || 20, zenSlowPeriod || 50) + 1,
    utbot: (utBotAtrPeriod || 10) + 2,
    chandelier: (chandelierAtrPeriod || 22) + 2,
    trendline: 2 * (trendlineLength || 14) + 2
  }[selectedIndicatorSystem] || Infinity;
  if (closedHistory.length < minimumHistory) return staleSignal('insufficient-indicator-warmup');

  let rawSignal = null;
  const decimalPlaces = (selectedSymbol === 'XAGUSD') ? 4 : 2;
  const candleByTime = new Map(closedHistory.map((candle) => [candle.time, candle]));

  if (selectedIndicatorSystem === 'zen') {
    const zenData = calculateZenTrendLines(closedHistory, zenFastPeriod, zenSlowPeriod);
    if (zenData.length === 0) return staleSignal();
    const last = zenData[zenData.length - 1];
    const action = last.trend === 'bullish' ? 'buy' : 'sell';

    let crossoverIdx = -1;
    const currentTrend = last.trend;
    for (let i = zenData.length - 2; i >= 0; i--) {
      if (zenData[i].trend !== currentTrend) {
        crossoverIdx = i + 1;
        break;
      }
    }
    if (crossoverIdx === -1) return staleSignal();
    const entryCandle = candleByTime.get(zenData[crossoverIdx].time);
    if (!entryCandle) return staleSignal();
    const entry = Number(entryCandle.close.toFixed(decimalPlaces));

    const diffPercent = Math.abs(last.fast - last.slow) / last.slow * 100;
    const signalStrength = Math.min(95, Math.max(65, Math.round(65 + diffPercent * 50)));

    rawSignal = {
      action,
      entry,
      signalStrength,
      triggerCandle: entryCandle,
      timestamp: zenData[crossoverIdx].time * 1000
    };
  }

  if (selectedIndicatorSystem === 'utbot') {
    const utData = calculateUTBotSignals(closedHistory, utBotKeyValue, utBotAtrPeriod);
    if (utData.length === 0) return staleSignal();
    
    let triggerIdx = -1;
    for (let i = utData.length - 1; i >= 0; i--) {
      if (utData[i].buy || utData[i].sell) {
        triggerIdx = i;
        break;
      }
    }

    if (triggerIdx === -1) return staleSignal();
    {
      const trigger = utData[triggerIdx];
      const action = trigger.buy ? 'buy' : 'sell';
      const entry = Number(closedHistory[triggerIdx].close.toFixed(decimalPlaces));
      const age = utData.length - 1 - triggerIdx;
      const signalStrength = Math.max(60, Math.min(94, 90 - age));

      rawSignal = {
        action,
        entry,
        signalStrength,
        triggerCandle: closedHistory[triggerIdx],
        timestamp: trigger.time * 1000
      };
    }
  }

  if (selectedIndicatorSystem === 'chandelier') {
    const chData = calculateChandelierExit(closedHistory, chandelierAtrPeriod, chandelierAtrMultiplier);
    if (chData.length === 0) return staleSignal();

    let triggerIdx = -1;
    for (let i = chData.length - 1; i >= 0; i--) {
      if (chData[i].buy || chData[i].sell) {
        triggerIdx = i;
        break;
      }
    }

    if (triggerIdx === -1) return staleSignal();
    {
      const trigger = chData[triggerIdx];
      const action = trigger.buy ? 'buy' : 'sell';
      const entry = Number(closedHistory[triggerIdx].close.toFixed(decimalPlaces));
      const age = chData.length - 1 - triggerIdx;
      const signalStrength = Math.max(60, Math.min(94, 90 - age));

      rawSignal = {
        action,
        entry,
        signalStrength,
        triggerCandle: closedHistory[triggerIdx],
        timestamp: trigger.time * 1000
      };
    }
  }

  if (selectedIndicatorSystem === 'trendline') {
    const tlData = calculateTrendlinesWithBreaks(closedHistory, trendlineLength, trendlineSlopeMult);
    if (tlData.length === 0) return staleSignal();

    let triggerIdx = -1;
    for (let i = tlData.length - 1; i >= 0; i--) {
      if (tlData[i].buy || tlData[i].sell) {
        triggerIdx = i;
        break;
      }
    }

    if (triggerIdx === -1) return staleSignal();
    {
      const trigger = tlData[triggerIdx];
      const action = trigger.buy ? 'buy' : 'sell';
      const entry = Number(closedHistory[triggerIdx].close.toFixed(decimalPlaces));
      const age = tlData.length - 1 - triggerIdx;
      const signalStrength = Math.max(60, Math.min(94, 85 - age));

      rawSignal = {
        action,
        entry,
        signalStrength,
        triggerCandle: closedHistory[triggerIdx],
        timestamp: trigger.time * 1000
      };
    }
  }

  if (!rawSignal || rawSignal.action === 'stale') {
    return staleSignal();
  }

  if (!rawSignal.triggerCandle || isSyntheticCandle(rawSignal.triggerCandle)) {
    return staleSignal('synthetic-trigger-blocked');
  }
  const triggerTime = rawSignal.timestamp / 1000;
  const triggerContext = history.slice(0, -1).filter((candle) => candle.time <= triggerTime).slice(-5);
  if (triggerContext.some(isGapFillCandle)) {
    return staleSignal('recent-gap-fill');
  }

  const swingRisk = calculateSwingRisk({
    history: closedHistory,
    action: rawSignal.action,
    entry: rawSignal.entry,
    triggerTime,
    symbol: selectedSymbol,
    timeframe: selectedTimeframe
  });
  if (!swingRisk) return staleSignal('confirmed-swing-not-found');
  const { sl, tp1, tp2 } = swingRisk;

  // --- Calculate hitTps by scanning from signal timestamp to present ---
  let hitTps = [false, false];
  let finalStatus = 'running';
  
  if (rawSignal.timestamp > 0) {
    const signalTime = rawSignal.timestamp / 1000;
    // Find the first candle that includes or comes after the signal time
    let startIdx = realClosedHistory.findIndex(c => c.time === signalTime);
    if (startIdx === -1) {
      startIdx = realClosedHistory.findIndex(c => c.time >= signalTime);
    }
    
    if (startIdx !== -1) {
      let maxSince = rawSignal.entry;
      let minSince = rawSignal.entry;
      
      // Include the live price as well in case the current candle hasn't closed yet
      const currentLivePrice = typeof livePrice !== 'undefined' ? livePrice : null;
      if (currentLivePrice) {
        if (currentLivePrice > maxSince) maxSince = currentLivePrice;
        if (currentLivePrice < minSince) minSince = currentLivePrice;
      }
      
      for (let i = startIdx; i < realClosedHistory.length; i++) {
        if (realClosedHistory[i].high > maxSince) maxSince = realClosedHistory[i].high;
        if (realClosedHistory[i].low < minSince) minSince = realClosedHistory[i].low;
      }
      
      if (rawSignal.action === 'buy') {
        if (minSince <= sl) {
          finalStatus = 'sl';
        } else if (maxSince >= tp2) {
          hitTps = [true, true];
          finalStatus = 'finished';
        } else if (maxSince >= tp1) {
          hitTps = [true, false];
          finalStatus = 'tp1';
        }
      } else if (rawSignal.action === 'sell') {
        if (maxSince >= sl) {
          finalStatus = 'sl';
        } else if (minSince <= tp2) {
          hitTps = [true, true];
          finalStatus = 'finished';
        } else if (minSince <= tp1) {
          hitTps = [true, false];
          finalStatus = 'tp1';
        }
      }
    }
  }
  // --- end hitTps logic ---
  const { triggerCandle: _triggerCandle, ...publicSignal } = rawSignal;

  return {
    ...signalIdentity,
    ...publicSignal,
    signalStrength: getStableDisplayStrength({
      symbol: selectedSymbol,
      timeframe: selectedTimeframe,
      indicator: selectedIndicatorSystem,
      timestamp: rawSignal.timestamp
    }),
    sourceCandleTime: rawSignal.timestamp / 1000,
    sl,
    tp: tp1,
    tps: [tp1, tp2],
    swing: swingRisk.swing,
    swingBuffer: swingRisk.buffer,
    riskDistance: swingRisk.riskDistance,
    riskReward: swingRisk.riskReward,
    dataQuality: {
      trigger: 'real',
      realCandles: realClosedHistory.length,
      syntheticWarmupCandles: closedHistory.length - realClosedHistory.length,
      gapFillExcluded: history.slice(0, -1).filter(isGapFillCandle).length
    },
    hitTps,
    status: finalStatus
  };
}

export function getTimeframeBias(history, fastPeriod = 20, slowPeriod = 50) {
  const rawClosed = Array.isArray(history) ? history.slice(0, -1) : [];
  const analysis = rawClosed.filter((candle) => !isGapFillCandle(candle));
  const latest = analysis[analysis.length - 1];
  const dataQuality = {
    latestReal: Boolean(latest && !isSyntheticCandle(latest)),
    syntheticWarmupCandles: analysis.filter(isSyntheticCandle).length,
    recentGapFill: rawClosed.slice(-5).some(isGapFillCandle)
  };
  if (!latest || !dataQuality.latestReal) {
    return { direction: 'neutral', state: 'wait', evidence: 'Chưa có nến thật đã đóng', dataQuality };
  }
  if (dataQuality.recentGapFill) {
    return { direction: 'neutral', state: 'wait', evidence: 'Có gap-fill trong 5 nến gần nhất', dataQuality };
  }
  const fast = calculateEMA(analysis, fastPeriod).at(-1)?.value;
  const slow = calculateEMA(analysis, slowPeriod).at(-1)?.value;
  if (!Number.isFinite(fast) || !Number.isFinite(slow)) {
    return { direction: 'neutral', state: 'wait', evidence: 'Chưa đủ EMA warm-up', dataQuality };
  }
  if (latest.close > fast && fast > slow) {
    return {
      direction: 'bullish', state: 'confirmed',
      evidence: `Close > EMA${fastPeriod} > EMA${slowPeriod}`,
      sourceCandleTime: latest.time, dataQuality
    };
  }
  if (latest.close < fast && fast < slow) {
    return {
      direction: 'bearish', state: 'confirmed',
      evidence: `Close < EMA${fastPeriod} < EMA${slowPeriod}`,
      sourceCandleTime: latest.time, dataQuality
    };
  }
  return {
    direction: 'neutral', state: 'wait',
    evidence: `EMA${fastPeriod}/EMA${slowPeriod} chưa đồng thuận`,
    sourceCandleTime: latest.time, dataQuality
  };
}

export function buildConfluenceDecision({ h1Bias, m15Bias, m5Signal, m5AgeCandles, feedStale = false }) {
  if (feedStale) return { decision: 'wait', reason: 'Feed đang stale' };
  if (!h1Bias || h1Bias.direction === 'neutral') {
    return { decision: 'wait', reason: h1Bias?.evidence || 'H1 chưa có bias' };
  }
  if (!m15Bias || m15Bias.direction !== h1Bias.direction) {
    return { decision: 'wait', reason: 'M15 chưa đồng thuận với H1' };
  }
  if (!m5Signal || m5Signal.action === 'stale') {
    return { decision: 'wait', reason: getSignalBlockMessage(m5Signal?.blockedReason) };
  }
  const expectedAction = h1Bias.direction === 'bullish' ? 'buy' : 'sell';
  if (m5Signal.action !== expectedAction) {
    return { decision: 'wait', reason: 'M5 trigger ngược hướng H1' };
  }
  if (!Number.isFinite(m5AgeCandles) || m5AgeCandles > 2) {
    return { decision: 'wait', reason: 'M5 trigger đã quá 2 nến' };
  }
  if (!m5Signal.riskReward?.valid || m5Signal.riskReward.tp2 < 1.5) {
    return { decision: 'wait', reason: 'Risk/Reward dưới 1:1.5' };
  }
  return {
    decision: expectedAction,
    reason: 'H1, M15 và M5 đồng thuận',
    signal: m5Signal
  };
}

export function getMultiTimeframeConfluence({
  histories,
  selectedIndicatorSystem = 'utbot',
  zenFastPeriod = 20,
  zenSlowPeriod = 50,
  utBotKeyValue = 2,
  utBotAtrPeriod = 10,
  chandelierAtrPeriod = 22,
  chandelierAtrMultiplier = 3,
  trendlineLength = 14,
  trendlineSlopeMult = 1,
  dataReady = true,
  feedStale = false
}) {
  const h1 = getTimeframeBias(histories?.H1 || []);
  const m15Bias = getTimeframeBias(histories?.M15 || []);
  const m15 = {
    ...m15Bias,
    state: h1.direction !== 'neutral' && m15Bias.direction === h1.direction ? 'ready' : 'wait'
  };
  const m5Signal = getCurrentSignal({
    history: histories?.M5 || [],
    selectedSymbol: 'XAUUSD',
    selectedTimeframe: 'M5',
    selectedIndicatorSystem,
    zenFastPeriod,
    zenSlowPeriod,
    utBotKeyValue,
    utBotAtrPeriod,
    chandelierAtrPeriod,
    chandelierAtrMultiplier,
    trendlineLength,
    trendlineSlopeMult,
    dataReady
  });
  const latestM5RealTime = getSignalAnalysisHistory(histories?.M5 || [])
    .filter((candle) => !isSyntheticCandle(candle))
    .at(-1)?.time;
  const m5AgeCandles = Number.isFinite(latestM5RealTime) && Number.isFinite(m5Signal.sourceCandleTime)
    ? Math.max(0, Math.floor((latestM5RealTime - m5Signal.sourceCandleTime) / TIMEFRAME_SECONDS.M5))
    : Infinity;
  const m5 = {
    direction: m5Signal.action === 'buy' ? 'bullish' : m5Signal.action === 'sell' ? 'bearish' : 'neutral',
    state: m5Signal.action !== 'stale' && m5AgeCandles <= 2 ? 'confirmed' : 'wait',
    evidence: m5Signal.action === 'stale'
      ? getSignalBlockMessage(m5Signal.blockedReason)
      : `${m5Signal.indicator?.toUpperCase()} ${m5Signal.action.toUpperCase()} (${m5AgeCandles} nến trước)`,
    sourceCandleTime: m5Signal.sourceCandleTime,
    ageCandles: m5AgeCandles,
    dataQuality: m5Signal.dataQuality
  };
  const result = buildConfluenceDecision({ h1Bias: h1, m15Bias: m15, m5Signal, m5AgeCandles, feedStale });
  return { h1, m15, m5, ...result };
}

