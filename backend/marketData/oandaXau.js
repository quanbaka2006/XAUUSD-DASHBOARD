'use strict';

const https = require('https');
const { buildTimeframes } = require('./candleAggregation');

const INSTRUMENT = 'XAU_USD';
const HISTORY_COUNT = 5000;

function getConfig(env = process.env) {
  const environment = String(env.OANDA_ENVIRONMENT || 'practice').toLowerCase();
  const token = env.OANDA_API_TOKEN || '';
  const accountId = env.OANDA_ACCOUNT_ID || '';
  if (!['practice', 'live'].includes(environment)) {
    throw new Error('OANDA_ENVIRONMENT must be practice or live');
  }
  return {
    environment,
    token,
    accountId,
    enabled: Boolean(token && accountId),
    apiHost: environment === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com',
    streamHost: environment === 'live' ? 'stream-fxtrade.oanda.com' : 'stream-fxpractice.oanda.com'
  };
}

function requestJson({ hostname, path, token, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body;
        try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = body.errorMessage || body.error || `HTTP ${res.statusCode}`;
          reject(new Error(`OANDA request failed: ${message}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('OANDA request timed out')));
    req.end();
  });
}

function parseMidCandles(body) {
  if (!body || body.instrument !== INSTRUMENT || !Array.isArray(body.candles)) return [];
  return body.candles
    .filter((item) => item && item.complete === true && item.m)
    .map((item) => ({
      time: Math.floor(Date.parse(item.time) / 1000),
      open: Number(item.m.o),
      high: Number(item.m.h),
      low: Number(item.m.l),
      close: Number(item.m.c),
      complete: true
    }));
}

async function fetchHistory(config = getConfig()) {
  if (!config.enabled) throw new Error('OANDA market data is not configured');
  const path = `/v3/instruments/${INSTRUMENT}/candles` +
    `?price=M&granularity=M1&count=${HISTORY_COUNT}&smooth=false`;
  const body = await requestJson({ hostname: config.apiHost, path, token: config.token });
  const m1 = parseMidCandles(body);
  return {
    source: `oanda-v20-${config.environment}`,
    instrument: INSTRUMENT,
    timeframes: buildTimeframes(m1, HISTORY_COUNT)
  };
}

function midpointFromPrice(price) {
  if (!price || price.instrument !== INSTRUMENT || price.type !== 'PRICE') return null;
  const bid = price.bids && price.bids[0] ? Number(price.bids[0].price) : NaN;
  const ask = price.asks && price.asks[0] ? Number(price.asks[0].price) : NaN;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask < bid) return null;
  return {
    price: (bid + ask) / 2,
    bid,
    ask,
    spread: ask - bid,
    sourceTime: price.time || null,
    tradeable: price.tradeable !== false
  };
}

function connectPricing({ config = getConfig(), onPrice, onHeartbeat, onStatus }) {
  if (!config.enabled) return { close() {} };
  let stopped = false;
  let request = null;
  let reconnectTimer = null;
  let retryMs = 2000;

  const connect = () => {
    if (stopped) return;
    const path = `/v3/accounts/${encodeURIComponent(config.accountId)}/pricing/stream` +
      `?instruments=${INSTRUMENT}&snapshot=true`;
    request = https.request({
      hostname: config.streamHost,
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/octet-stream' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        if (onStatus) onStatus({ connected: false, error: `HTTP ${res.statusCode}` });
        scheduleReconnect();
        return;
      }
      retryMs = 2000;
      if (onStatus) onStatus({ connected: true });
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.type === 'HEARTBEAT') {
              if (onHeartbeat) onHeartbeat(message.time || null);
              continue;
            }
            const price = midpointFromPrice(message);
            if (price && onPrice) onPrice(price);
          } catch (_) {
            // Ignore a malformed line and continue the stream.
          }
        }
      });
      res.on('end', scheduleReconnect);
      res.on('error', scheduleReconnect);
    });
    request.on('error', (error) => {
      if (onStatus) onStatus({ connected: false, error: error.message });
      scheduleReconnect();
    });
    request.setTimeout(30000, () => request.destroy(new Error('OANDA stream timed out')));
    request.end();
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    if (onStatus) onStatus({ connected: false });
    const wait = retryMs;
    retryMs = Math.min(60000, retryMs * 2);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, wait);
  };

  connect();
  return {
    close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (request) request.destroy();
    }
  };
}

module.exports = { INSTRUMENT, HISTORY_COUNT, getConfig, fetchHistory, parseMidCandles, midpointFromPrice, connectPricing };
