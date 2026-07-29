// Math Helpers for Indicators

export function calculateEMA(data, period) {
  const emaData = [];
  if (data.length === 0) return emaData;
  
  const k = 2 / (period + 1);
  let emaVal = data[0].close;
  
  emaData.push({ time: data[0].time, value: emaVal });
  
  for (let i = 1; i < data.length; i++) {
    emaVal = data[i].close * k + emaVal * (1 - k);
    emaData.push({ time: data[i].time, value: parseFloat(emaVal.toFixed(2)) });
  }
  return emaData;
}

export function calculateSMA(data, period) {
  const smaData = [];
  if (data.length < period) return smaData;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    smaData.push({
      time: data[i].time,
      value: parseFloat((sum / period).toFixed(2))
    });
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
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = 100 - (100 / (1 + rs));
  
  rsiData.push({ time: data[period].time, value: parseFloat(rsi.toFixed(2)) });
  
  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
    rsiData.push({ time: data[i].time, value: parseFloat(rsi.toFixed(2)) });
  }
  return rsiData;
}

export function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const macdData = [];
  if (data.length < slowPeriod) return macdData;
  
  const fastEma = calculateEMA(data, fastPeriod);
  const slowEma = calculateEMA(data, slowPeriod);
  
  const macdLines = [];
  for (let i = 0; i < slowEma.length; i++) {
    const time = slowEma[i].time;
    const fastVal = fastEma.find(e => e.time === time)?.value || slowEma[i].value;
    const macdValue = parseFloat((fastVal - slowEma[i].value).toFixed(2));
    macdLines.push({ time, close: macdValue });
  }
  
  const signalLines = calculateEMA(macdLines, signalPeriod);
  
  const result = [];
  for (let i = 0; i < signalLines.length; i++) {
    const time = signalLines[i].time;
    const macdVal = macdLines.find(m => m.time === time)?.close || 0;
    const sigVal = signalLines[i].value;
    const histogram = parseFloat((macdVal - sigVal).toFixed(2));
    result.push({
      time,
      macd: macdVal,
      signal: sigVal,
      histogram
    });
  }
  return result;
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
  
  if (swingHighs.length > 0) {
    result.bos = swingHighs[swingHighs.length - 1].price;
  }
  if (swingLows.length > 0) {
    result.choch = swingLows[swingLows.length - 1].price;
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
  if (data.length < period) return atr;
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
      if (src > prevLoss && data[i - 1].close < prevLoss) {
        nextPosition = 1;
      } else if (src < prevLoss && data[i - 1].close > prevLoss) {
        nextPosition = -1;
      }
      if (nextPosition === 1 && position === -1) {
        buy = true;
      } else if (nextPosition === -1 && position === 1) {
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
  const result = [];
  fastEma.forEach(f => {
    const s = slowEma.find(item => item.time === f.time);
    if (s) {
      result.push({
        time: f.time,
        fast: f.value,
        slow: s.value,
        trend: f.value >= s.value ? 'bullish' : 'bearish'
      });
    }
  });
  return result;
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
      const srcVal = data[i - length].close;
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
      breakoutTime: i >= length ? data[i - length].time : null,
      buyAtBreakout: buy,
      sellAtBreakout: sell
    });
  }
  return result;
}

const STATIC_SIGNAL_SETTINGS = {
  'XAUUSD': { sl: 10.0, tp1: 5.0, tp2: 7.5 },
  'WTIUSD': { sl: 1.0, tp1: 0.5, tp2: 0.75 },
  'XAGUSD': { sl: 0.4, tp1: 0.2, tp2: 0.3 },
  'BTCUSD': { sl: 600.0, tp1: 300.0, tp2: 450.0 },
  'ETHUSD': { sl: 30.0, tp1: 15.0, tp2: 22.5 }
};

export function getCurrentSignal({
  history,
  selectedSymbol,
  selectedIndicatorSystem,
  zenFastPeriod,
  zenSlowPeriod,
  utBotKeyValue,
  utBotAtrPeriod,
  chandelierAtrPeriod,
  chandelierAtrMultiplier,
  trendlineLength,
  trendlineSlopeMult,
  livePrice
}) {
  if (!history || history.length < 21) {
    return {
      action: 'stale',
      entry: 0,
      sl: 0,
      tp: 0,
      confidence: 0,
      timestamp: Date.now()
    };
  }

  // Use only closed candles (excluding the last one which is active and fluctuating with livePrice)
  const closedHistory = history.slice(0, -1);
  if (closedHistory.length < 20) {
    return {
      action: 'stale',
      entry: 0,
      sl: 0,
      tp: 0,
      confidence: 0,
      timestamp: Date.now()
    };
  }

  let rawSignal = null;

  if (selectedIndicatorSystem === 'zen') {
    const zenData = calculateZenTrendLines(closedHistory, zenFastPeriod, zenSlowPeriod);
    if (zenData.length < 2) return { action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() };
    const last = zenData[zenData.length - 1];
    const previous = zenData[zenData.length - 2];
    const action = last.trend === 'bullish' ? 'buy' : 'sell';
    const crossedNow = previous.trend !== last.trend;
    const entryCandle = closedHistory.find(candle => candle.time === last.time);
    const entry = Number(entryCandle?.close ?? closedHistory[closedHistory.length - 1].close);

    const diffPercent = Math.abs(last.fast - last.slow) / last.slow * 100;
    const confidence = Math.min(95, Math.max(65, Math.round(65 + diffPercent * 50)));

    rawSignal = {
      action,
      entry,
      confidence,
      timestamp: last.time * 1000,
      triggered: crossedNow
    };
  }

  if (selectedIndicatorSystem === 'utbot') {
    const utData = calculateUTBotSignals(closedHistory, utBotKeyValue, utBotAtrPeriod);
    if (utData.length === 0) return { action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() };
    
    let triggerIdx = -1;
    for (let i = utData.length - 1; i >= 0; i--) {
      if (utData[i].buy || utData[i].sell) {
        triggerIdx = i;
        break;
      }
    }

    if (triggerIdx === -1) {
      const last = utData[utData.length - 1];
      const entryCandle = closedHistory.length >= 2 ? closedHistory[closedHistory.length - 2] : closedHistory[closedHistory.length - 1];
      const action = entryCandle.close >= (last.trailingStop || entryCandle.close) ? 'buy' : 'sell';
      const entry = parseFloat(entryCandle.close.toFixed(2));
      rawSignal = {
        action,
        entry,
        confidence: 70,
        timestamp: last.time * 1000,
        triggered: false
      };
    } else {
      const trigger = utData[triggerIdx];
      const action = trigger.buy ? 'buy' : 'sell';
      const entry = parseFloat(closedHistory[triggerIdx].close.toFixed(2));
      const age = utData.length - 1 - triggerIdx;
      const confidence = Math.max(60, Math.min(94, 90 - age));

      rawSignal = {
        action,
        entry,
        confidence,
        timestamp: trigger.time * 1000,
        triggered: true
      };
    }
  }

  if (selectedIndicatorSystem === 'chandelier') {
    const chData = calculateChandelierExit(closedHistory, chandelierAtrPeriod, chandelierAtrMultiplier);
    if (chData.length === 0) return { action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() };

    let triggerIdx = -1;
    for (let i = chData.length - 1; i >= 0; i--) {
      if (chData[i].buy || chData[i].sell) {
        triggerIdx = i;
        break;
      }
    }

    if (triggerIdx === -1) {
      const last = chData[chData.length - 1];
      const entryCandle = closedHistory.length >= 2 ? closedHistory[closedHistory.length - 2] : closedHistory[closedHistory.length - 1];
      const action = last.dir === 1 ? 'buy' : 'sell';
      const entry = parseFloat(entryCandle.close.toFixed(2));
      rawSignal = {
        action,
        entry,
        confidence: 72,
        timestamp: last.time * 1000,
        triggered: false
      };
    } else {
      const trigger = chData[triggerIdx];
      const action = trigger.buy ? 'buy' : 'sell';
      const entry = parseFloat(closedHistory[triggerIdx].close.toFixed(2));
      const age = chData.length - 1 - triggerIdx;
      const confidence = Math.max(60, Math.min(94, 90 - age));

      rawSignal = {
        action,
        entry,
        confidence,
        timestamp: trigger.time * 1000,
        triggered: true
      };
    }
  }

  if (selectedIndicatorSystem === 'trendline') {
    const tlData = calculateTrendlinesWithBreaks(closedHistory, trendlineLength, trendlineSlopeMult);
    if (tlData.length === 0) return { action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() };

    let triggerIdx = -1;
    for (let i = tlData.length - 1; i >= 0; i--) {
      if (tlData[i].buy || tlData[i].sell) {
        triggerIdx = i;
        break;
      }
    }

    if (triggerIdx === -1) {
      const last = tlData[tlData.length - 1];
      const entryCandle = closedHistory.length >= 2 ? closedHistory[closedHistory.length - 2] : closedHistory[closedHistory.length - 1];
      const action = last.upper && entryCandle.close > last.upper ? 'buy' : 'sell';
      const entry = parseFloat(entryCandle.close.toFixed(2));
      rawSignal = {
        action,
        entry,
        confidence: 67,
        timestamp: last.time * 1000,
        triggered: false
      };
    } else {
      const trigger = tlData[triggerIdx];
      const action = trigger.buy ? 'buy' : 'sell';
      const entry = parseFloat(closedHistory[triggerIdx].close.toFixed(2));
      const age = tlData.length - 1 - triggerIdx;
      const confidence = Math.max(60, Math.min(94, 85 - age));

      rawSignal = {
        action,
        entry,
        confidence,
        timestamp: trigger.time * 1000,
        triggered: true
      };
    }
  }

  if (!rawSignal || rawSignal.action === 'stale') {
    return {
      action: 'stale',
      entry: 0,
      sl: 0,
      tp: 0,
      confidence: 0,
      timestamp: Date.now()
    };
  }

  // Calculate static TP / SL
  const settings = STATIC_SIGNAL_SETTINGS[selectedSymbol] || { sl: 10.0, tp1: 5.0, tp2: 7.5 };
  const decimalPlaces = (selectedSymbol === 'XAGUSD') ? 4 : 2;
  
  let sl = 0;
  let tp1 = 0;
  let tp2 = 0;
  if (rawSignal.action === 'buy') {
    sl = parseFloat((rawSignal.entry - settings.sl).toFixed(decimalPlaces));
    tp1 = parseFloat((rawSignal.entry + settings.tp1).toFixed(decimalPlaces));
    tp2 = parseFloat((rawSignal.entry + settings.tp2).toFixed(decimalPlaces));
  } else if (rawSignal.action === 'sell') {
    sl = parseFloat((rawSignal.entry + settings.sl).toFixed(decimalPlaces));
    tp1 = parseFloat((rawSignal.entry - settings.tp1).toFixed(decimalPlaces));
    tp2 = parseFloat((rawSignal.entry - settings.tp2).toFixed(decimalPlaces));
  }

  // Override confidence to a random 93-97% based on entry price and timestamp
  // This guarantees that the "random" number is stable for the same signal, 
  // but varies between different signals (93, 94, 95, 96, 97)
  let finalConfidence = 0;
  if (rawSignal.entry > 0) {
    const seed = Math.floor((rawSignal.entry * 100) + (rawSignal.timestamp / 100000)) % 5;
    finalConfidence = 93 + Math.abs(seed);
  }

  // --- Calculate hitTps by scanning from signal timestamp to present ---
  let hitTps = [false, false];
  let finalStatus = 'running';
  
  if (rawSignal.timestamp > 0) {
    const signalTime = rawSignal.timestamp / 1000;
    // Find the first candle that includes or comes after the signal time
    let startIdx = closedHistory.findIndex(c => c.time === signalTime);
    if (startIdx === -1) {
      startIdx = closedHistory.findIndex(c => c.time >= signalTime);
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
      
      for (let i = startIdx; i < closedHistory.length; i++) {
        if (closedHistory[i].high > maxSince) maxSince = closedHistory[i].high;
        if (closedHistory[i].low < minSince) minSince = closedHistory[i].low;
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

  return {
    ...rawSignal,
    confidence: finalConfidence || rawSignal.confidence,
    sl,
    tps: [tp1, tp2],
    hitTps,
    status: finalStatus
  };
}

