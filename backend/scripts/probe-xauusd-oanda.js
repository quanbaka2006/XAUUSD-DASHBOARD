#!/usr/bin/env node

/**
 * Phase 1A read-only probe for OANDA spot XAU_USD market data.
 *
 * This script does not write files and is not connected to server.js. It checks
 * whether the configured provider can supply a current price and enough valid M1
 * candles to replace the synthetic production history in a later phase.
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
} catch (_) {
  // Environment variables may be injected by the runtime instead.
}

const INTERNAL_SYMBOL = 'XAUUSD';
const OANDA_INSTRUMENT = 'XAU_USD';
const FINNHUB_SYMBOL = 'OANDA:XAU_USD';
const REQUIRED_COMPLETE_CANDLES = 500;
const REQUEST_TIMEOUT_MS = 15000;
const STREAM_SAMPLE_MS = 8000;

function parseArgs(argv) {
  const result = { provider: 'finnhub', count: REQUIRED_COMPLETE_CANDLES };
  for (const arg of argv) {
    if (arg.startsWith('--provider=')) result.provider = arg.slice('--provider='.length).toLowerCase();
    if (arg.startsWith('--count=')) result.count = Number.parseInt(arg.slice('--count='.length), 10);
  }
  if (!['finnhub', 'oanda'].includes(result.provider)) {
    throw new Error('provider must be finnhub or oanda');
  }
  if (!Number.isInteger(result.count) || result.count < 10 || result.count > 5000) {
    throw new Error('count must be an integer between 10 and 5000');
  }
  return result;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = { parseError: true, preview: text.slice(0, 160) };
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFinnhubCandles(body) {
  if (!body || body.s !== 'ok') return [];
  const fields = ['t', 'o', 'h', 'l', 'c'];
  if (!fields.every((key) => Array.isArray(body[key]))) return [];
  const size = Math.min(...fields.map((key) => body[key].length));
  const candles = [];
  for (let i = 0; i < size; i += 1) {
    candles.push({
      time: Number(body.t[i]),
      open: Number(body.o[i]),
      high: Number(body.h[i]),
      low: Number(body.l[i]),
      close: Number(body.c[i]),
      complete: true
    });
  }
  return candles;
}

function normalizeOandaCandles(body) {
  if (!body || !Array.isArray(body.candles)) return [];
  return body.candles
    .filter((item) => item && item.m)
    .map((item) => ({
      time: Math.floor(Date.parse(item.time) / 1000),
      open: Number(item.m.o),
      high: Number(item.m.h),
      low: Number(item.m.l),
      close: Number(item.m.c),
      complete: item.complete === true
    }));
}

function analyzeCandles(input) {
  const candles = input.filter((item) => item.complete !== false);
  let invalidNumbers = 0;
  let invalidOhlc = 0;
  let nonAscending = 0;
  let duplicates = 0;
  let oneMinuteSteps = 0;
  let gaps = 0;
  let largestGapSeconds = 0;
  const seen = new Set();

  candles.forEach((candle, index) => {
    const values = [candle.time, candle.open, candle.high, candle.low, candle.close];
    if (!values.every(Number.isFinite)) invalidNumbers += 1;
    if (
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close) ||
      candle.high < candle.low
    ) {
      invalidOhlc += 1;
    }
    if (seen.has(candle.time)) duplicates += 1;
    seen.add(candle.time);
    if (index > 0) {
      const delta = candle.time - candles[index - 1].time;
      if (delta <= 0) nonAscending += 1;
      if (delta === 60) oneMinuteSteps += 1;
      if (delta > 60) {
        gaps += 1;
        largestGapSeconds = Math.max(largestGapSeconds, delta);
      }
    }
  });

  const first = candles[0];
  const last = candles[candles.length - 1];
  return {
    count: candles.length,
    requiredCount: REQUIRED_COMPLETE_CANDLES,
    enoughForWarmup: candles.length >= REQUIRED_COMPLETE_CANDLES,
    firstTime: first ? new Date(first.time * 1000).toISOString() : null,
    lastTime: last ? new Date(last.time * 1000).toISOString() : null,
    latestAgeSeconds: last ? Math.max(0, Math.round(Date.now() / 1000 - last.time)) : null,
    invalidNumbers,
    invalidOhlc,
    nonAscending,
    duplicates,
    oneMinuteSteps,
    gaps,
    largestGapSeconds,
    validStructure: invalidNumbers === 0 && invalidOhlc === 0 && nonAscending === 0 && duplicates === 0
  };
}

function safeError(body) {
  if (!body) return null;
  if (typeof body.error === 'string') return body.error.slice(0, 240);
  if (typeof body.errorMessage === 'string') return body.errorMessage.slice(0, 240);
  if (body.parseError) return 'Provider returned non-JSON content';
  return null;
}

async function sampleFinnhubWebSocket(token) {
  const WebSocket = require('ws');
  return new Promise((resolve) => {
    const url = `wss://ws.finnhub.io?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    const startedAt = Date.now();
    let messages = 0;
    let prices = 0;
    let providerTimestamp = null;
    let providerError = null;
    let connected = false;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_) {}
      resolve({
        connected,
        sampleMs: Date.now() - startedAt,
        messages,
        prices,
        available: prices > 0,
        providerTimestamp,
        error: providerError
      });
    };

    const timer = setTimeout(finish, STREAM_SAMPLE_MS);
    socket.on('open', () => {
      connected = true;
      socket.send(JSON.stringify({ type: 'subscribe', symbol: FINNHUB_SYMBOL }));
    });
    socket.on('message', (raw) => {
      messages += 1;
      try {
        const body = JSON.parse(raw.toString());
        if (body.type === 'error') providerError = String(body.msg || body.error || 'Provider stream error').slice(0, 240);
        if (body.type === 'trade' && Array.isArray(body.data)) {
          const matching = body.data.filter((item) => item.s === FINNHUB_SYMBOL && Number.isFinite(Number(item.p)));
          prices += matching.length;
          const last = matching[matching.length - 1];
          if (last && last.t) providerTimestamp = new Date(Number(last.t)).toISOString();
        }
      } catch (_) {
        providerError = 'Provider stream returned invalid JSON';
      }
    });
    socket.on('error', (error) => {
      providerError = String(error.message || error).slice(0, 240);
    });
    socket.on('close', finish);
  });
}

async function probeFinnhub(count) {
  const token = process.env.FINNHUB_TOKEN;
  if (!token) throw new Error('FINNHUB_TOKEN is not configured');
  const headers = { 'X-Finnhub-Token': token, Accept: 'application/json' };
  const quoteUrl = new URL('https://finnhub.io/api/v1/quote');
  quoteUrl.searchParams.set('symbol', FINNHUB_SYMBOL);

  // Request a wide enough range for 500 market-open M1 candles without making
  // assumptions about weekends or holidays.
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.max(count * 60 * 4, 3 * 24 * 60 * 60);
  const candleUrl = new URL('https://finnhub.io/api/v1/forex/candle');
  candleUrl.searchParams.set('symbol', FINNHUB_SYMBOL);
  candleUrl.searchParams.set('resolution', '1');
  candleUrl.searchParams.set('from', String(from));
  candleUrl.searchParams.set('to', String(to));

  const [quote, history, stream] = await Promise.all([
    fetchJson(quoteUrl, { headers }),
    fetchJson(candleUrl, { headers }),
    sampleFinnhubWebSocket(token)
  ]);
  const candles = normalizeFinnhubCandles(history.body);
  return {
    provider: 'finnhub-oanda-adapter',
    instrument: FINNHUB_SYMBOL,
    internalSymbol: INTERNAL_SYMBOL,
    quote: {
      httpStatus: quote.status,
      durationMs: quote.durationMs,
      available: quote.ok && Number.isFinite(Number(quote.body && quote.body.c)) && Number(quote.body.c) > 0,
      providerTimestamp: quote.body && quote.body.t ? new Date(Number(quote.body.t) * 1000).toISOString() : null,
      error: quote.ok ? null : safeError(quote.body)
    },
    stream,
    history: {
      httpStatus: history.status,
      durationMs: history.durationMs,
      providerStatus: history.body && history.body.s ? history.body.s : null,
      error: history.ok ? safeError(history.body) : safeError(history.body),
      analysis: analyzeCandles(candles)
    }
  };
}

async function probeOanda(count) {
  const token = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error('OANDA_API_TOKEN and OANDA_ACCOUNT_ID are required');
  }
  const environment = (process.env.OANDA_ENVIRONMENT || 'practice').toLowerCase();
  if (!['practice', 'live'].includes(environment)) {
    throw new Error('OANDA_ENVIRONMENT must be practice or live');
  }
  const apiHost = environment === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const candleUrl = new URL(`https://${apiHost}/v3/instruments/${OANDA_INSTRUMENT}/candles`);
  candleUrl.searchParams.set('price', 'M');
  candleUrl.searchParams.set('granularity', 'M1');
  // OANDA may include the current incomplete candle, so request one extra item
  // when possible and evaluate complete candles only.
  candleUrl.searchParams.set('count', String(Math.min(5000, count + 1)));
  candleUrl.searchParams.set('smooth', 'false');

  const pricingUrl = new URL(`https://${apiHost}/v3/accounts/${encodeURIComponent(accountId)}/pricing`);
  pricingUrl.searchParams.set('instruments', OANDA_INSTRUMENT);

  const [pricing, history] = await Promise.all([
    fetchJson(pricingUrl, { headers }),
    fetchJson(candleUrl, { headers })
  ]);
  const prices = pricing.body && Array.isArray(pricing.body.prices) ? pricing.body.prices : [];
  const xauPrice = prices.find((item) => item.instrument === OANDA_INSTRUMENT);
  const bestBid = xauPrice && xauPrice.bids && xauPrice.bids[0] ? Number(xauPrice.bids[0].price) : null;
  const bestAsk = xauPrice && xauPrice.asks && xauPrice.asks[0] ? Number(xauPrice.asks[0].price) : null;
  const candles = normalizeOandaCandles(history.body);

  return {
    provider: `oanda-v20-${environment}`,
    instrument: OANDA_INSTRUMENT,
    internalSymbol: INTERNAL_SYMBOL,
    pricing: {
      httpStatus: pricing.status,
      durationMs: pricing.durationMs,
      available: pricing.ok && Number.isFinite(bestBid) && Number.isFinite(bestAsk),
      tradeable: xauPrice ? xauPrice.tradeable !== false : null,
      spread: Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? Number((bestAsk - bestBid).toFixed(6)) : null,
      providerTimestamp: xauPrice && xauPrice.time ? xauPrice.time : null,
      error: pricing.ok ? null : safeError(pricing.body)
    },
    history: {
      httpStatus: history.status,
      durationMs: history.durationMs,
      error: history.ok ? null : safeError(history.body),
      analysis: analyzeCandles(candles)
    }
  };
}

function evaluate(result) {
  const price = result.quote || result.pricing;
  const realtimeAvailable = Boolean(price.available || (result.stream && result.stream.available));
  const analysis = result.history.analysis;
  const pass = Boolean(
    realtimeAvailable &&
    result.history.httpStatus >= 200 && result.history.httpStatus < 300 &&
    analysis.enoughForWarmup &&
    analysis.validStructure
  );
  return {
    decision: pass ? 'GO_FOR_PHASE_1B' : 'NO_GO',
    reasons: [
      realtimeAvailable ? null : 'Current/realtime OANDA XAU/USD price is unavailable',
      analysis.enoughForWarmup ? null : `Only ${analysis.count}/${analysis.requiredCount} complete M1 candles are available`,
      analysis.validStructure ? null : 'Candle structure validation failed',
      result.history.httpStatus === 403 ? 'The configured plan/token does not authorize candle history' : null
    ].filter(Boolean)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = args.provider === 'oanda'
    ? await probeOanda(args.count)
    : await probeFinnhub(args.count);
  const report = { ...result, gate: evaluate(result) };
  console.log(JSON.stringify(report, null, 2));
  if (report.gate.decision !== 'GO_FOR_PHASE_1B') process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    decision: 'NO_GO',
    error: error.name === 'AbortError' ? 'Provider request timed out' : error.message
  }, null, 2));
  process.exitCode = 1;
});
