const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const WebSocket = require('ws');
const crypto = require('crypto');
const helmet = require('helmet');
const hpp = require('hpp');
const { rateLimit } = require('express-rate-limit');
const slowDown = require('express-slow-down');

// Load .env file for local development
try { require('dotenv').config(); } catch(e) {}

// ==========================================
// API Keys — set via environment variables
// ==========================================
const FINNHUB_TOKEN = process.env.FINNHUB_TOKEN || 'd8iurppr01qmeaukalagd8iurppr01qmeaukalb0';
if (!FINNHUB_TOKEN) {
  console.warn('[Finnhub] WARNING: FINNHUB_TOKEN not set. Commodity prices will use Yahoo Finance fallback (higher delay).');
}

// Security Secrets
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'd8iurppr01qmeaukalagd8iurppr01qmeaukalb0';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// ==========================================
// Password Hashing (PBKDF2) & Token JWT Utils
// ==========================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 10000;
  const keylen = 64;
  const digest = 'sha512';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash.startsWith('pbkdf2$')) {
    return password === storedHash; // legacy plain-text fallback
  }
  const parts = storedHash.split('$');
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const originalHash = parts[3];
  const keylen = 64;
  const digest = 'sha512';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return hash === originalHash;
}

function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours expiry
  })).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
    
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  
  const [header, body, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
    
  if (signature !== expectedSignature) return null;
  
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

const app = express();

// Secure app with Helmet (CSP configured for Google Fonts and Socket.IO connection)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// Protect against HTTP Parameter Pollution
app.use(hpp());

// Disable Express identifier signature
app.disable('x-powered-by');

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// Limit request payloads to 10KB to prevent memory/denial of service attacks
app.use(express.json({ limit: '10kb' }));

// ==========================================
// Rate Limiters Configuration
// ==========================================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Quá nhiều yêu cầu từ IP này. Vui lòng thử lại sau 15 phút.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Quá nhiều lần đăng nhập/đăng ký sai. Vui lòng thử lại sau 15 phút.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Too many webhook requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 5,
  delayMs: (hits) => hits * 200,
});

// Apply global rate limiter to all api routes
app.use('/api/', globalLimiter);

// Express JWT Auth Middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Access token missing' });
  }
  const token = authHeader.split(' ')[1];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
  req.user = decoded;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'Administrator') {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Bạn không có quyền truy cập tính năng này.' });
  });
}


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 5000;

// ==========================================
// Symbol Configuration
// ==========================================
const SYMBOLS = ['XAUUSD', 'WTIUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];

const YAHOO_TICKERS = {
  'XAUUSD': 'GC=F',
  'WTIUSD': 'CL=F',
  'XAGUSD': 'SI=F',
  'BTCUSD': 'BTC-USD',
  'ETHUSD': 'ETH-USD'
};

// Binance stream symbols for crypto (true 1s real-time)
const BINANCE_STREAMS = {
  'BTCUSD': 'btcusdt',
  'ETHUSD': 'ethusdt'
};

const WEEKEND_FROZEN_PRICES = {
  'XAUUSD': 4325.00,
  'WTIUSD': 80.00,
  'XAGUSD': 33.00
};

const defaultPrices = {
  'XAUUSD': 4325.00,
  'WTIUSD': 80.00,
  'XAGUSD': 33.00,
  'BTCUSD': 66000.00,
  'ETHUSD': 1780.00
};

const INTERVAL_MAP = { '1': 'M1', '5': 'M5', '15': 'M15', '60': 'H1' };
const INTERVAL_SECONDS = { 'M1': 60, 'M5': 300, 'M15': 900, 'H1': 3600 };

// ==========================================
// Forex Market Hours (proper weekend detection)
// Forex/Commodity markets: Open Sunday 22:00 UTC → Close Friday 22:00 UTC
// This avoids timezone issues (Render runs UTC, user is UTC+7)
// ==========================================
function isMarketClosed() {
  const now = new Date();
  const utcDay = now.getUTCDay();    // 0=Sun, 6=Sat
  const utcHour = now.getUTCHours();

  // Saturday: always closed
  if (utcDay === 6) return true;
  // Sunday before 22:00 UTC: closed
  if (utcDay === 0 && utcHour < 22) return true;
  // Friday after 22:00 UTC: closed
  if (utcDay === 5 && utcHour >= 22) return true;
  // All other times: open
  return false;
}

// ==========================================
// Memory Structures
// ==========================================
const signals = {};
const candleHistory = {};
const activeCandles = {};
const currentPrices = { ...defaultPrices };
// Last confirmed real price from external source (anchor)
const lastRealPrices = { ...defaultPrices };

// ==========================================
// Drawings Store (in-memory, per user+symbol)
// Key: `${username}:${symbol}`, Value: drawings[]
// ==========================================
const drawingsStore = new Map();

const SIGNAL_SETTINGS = {
  'XAUUSD': { sl: 5.0, tp: 7.0 },
  'WTIUSD': { sl: 0.5, tp: 0.7 },
  'XAGUSD': { sl: 0.2, tp: 0.28 },
  'BTCUSD': { sl: 300.0, tp: 420.0 },
  'ETHUSD': { sl: 15.0, tp: 21.0 }
};

SYMBOLS.forEach((sym) => {
  const settings = SIGNAL_SETTINGS[sym] || { sl: 5.0, tp: 7.0 };
  const price = defaultPrices[sym];
  
  // Format based on asset type
  const dec = (sym === 'XAGUSD') ? 4 : 2;
  const pM1_entry = parseFloat((price * 1.0005).toFixed(dec));
  const pM1_sl = parseFloat((pM1_entry - settings.sl).toFixed(dec));
  const pM1_tp = parseFloat((pM1_entry + settings.tp).toFixed(dec));
  
  const pM5_entry = parseFloat((price * 0.9995).toFixed(dec));
  const pM5_sl = parseFloat((pM5_entry - settings.sl).toFixed(dec));
  const pM5_tp = parseFloat((pM5_entry + settings.tp).toFixed(dec));
  
  const pM15_entry = parseFloat((price * 1.001).toFixed(dec));
  const pM15_sl = parseFloat((pM15_entry + settings.sl).toFixed(dec));
  const pM15_tp = parseFloat((pM15_entry - settings.tp).toFixed(dec));
  
  const pH1_entry = parseFloat((price * 0.996).toFixed(dec));
  const pH1_sl = parseFloat((pH1_entry - settings.sl).toFixed(dec));
  const pH1_tp = parseFloat((pH1_entry + settings.tp).toFixed(dec));

  signals[sym] = {
    'M1':  { ticker: sym, interval: 'M1',  action: 'buy',   entry: pM1_entry, sl: pM1_sl, tp: pM1_tp, confidence: 84, timestamp: Date.now()-2*60*1000 },
    'M5':  { ticker: sym, interval: 'M5',  action: 'buy',   entry: pM5_entry, sl: pM5_sl, tp: pM5_tp, confidence: 76, timestamp: Date.now()-8*60*1000 },
    'M15': { ticker: sym, interval: 'M15', action: 'sell',  entry: pM15_entry, sl: pM15_sl, tp: pM15_tp, confidence: 89, timestamp: Date.now()-10*60*1000 },
    'H1':  { ticker: sym, interval: 'H1',  action: 'stale', entry: pH1_entry, sl: pH1_sl, tp: pH1_tp, confidence: 65, timestamp: Date.now()-45*60*1000 }
  };
  candleHistory[sym] = { 'M1': [], 'M5': [], 'M15': [], 'H1': [] };
  activeCandles[sym] = { 'M1': null, 'M5': null, 'M15': null, 'H1': null };
});

// ==========================================
// Historical Candle Generator
// ==========================================
function generateHistory() {
  const now = Math.floor(Date.now() / 1000);
  if (isMarketClosed()) {
    Object.assign(currentPrices, WEEKEND_FROZEN_PRICES);
    Object.assign(lastRealPrices, WEEKEND_FROZEN_PRICES);
  }

  SYMBOLS.forEach((sym) => {
    Object.keys(INTERVAL_SECONDS).forEach((tf) => {
      const seconds = INTERVAL_SECONDS[tf];
      let price = currentPrices[sym];
      const list = [];
      for (let i = 1; i <= 100; i++) {
        const time = (Math.floor(now / seconds) - i) * seconds;
        const change = (Math.random() - 0.49) * (defaultPrices[sym] * 0.0006);
        const close = price;
        const open = price - change;
        const high = Math.max(open, close) + Math.random() * (defaultPrices[sym] * 0.0003);
        const low  = Math.min(open, close) - Math.random() * (defaultPrices[sym] * 0.0003);
        list.unshift({ time, open, high, low, close });
        price = open;
      }
      candleHistory[sym][tf] = list;
    });
  });
}

// generateHistory is called AFTER Yahoo seeds arrive to avoid price spike
// (see initializeWithRealPrices below)
function initializeCandles() {
  generateHistory();
  SYMBOLS.forEach((sym) => {
    Object.keys(INTERVAL_SECONDS).forEach((tf) => {
      const seconds = INTERVAL_SECONDS[tf];
      const now = Math.floor(Date.now() / 1000);
      const time = Math.floor(now / seconds) * seconds;
      activeCandles[sym][tf] = {
        time,
        open:  currentPrices[sym],
        high:  currentPrices[sym],
        low:   currentPrices[sym],
        close: currentPrices[sym]
      };
    });
  });
  console.log('[Init] Candle history generated from real seed prices:', 
    Object.entries(currentPrices).map(([k,v]) => `${k}=${v}`).join(', '));
}

// ==========================================
// Price Update Dispatcher
// Called whenever a new real price arrives from any source
// ==========================================
function applyRealPrice(sym, newPrice) {
  if (!newPrice || typeof newPrice !== 'number' || isNaN(newPrice)) return;
  const price = parseFloat(newPrice.toFixed(sym.includes('BTC') ? 2 : 4));
  currentPrices[sym] = price;
  lastRealPrices[sym] = price;
}

// ==========================================
// BINANCE WebSocket — Real-time 1s for BTC/ETH
// ==========================================
let binanceWs = null;

function connectBinance() {
  const streams = Object.values(BINANCE_STREAMS).map(s => `${s}@miniTicker`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  binanceWs = new WebSocket(url);

  binanceWs.on('open', () => {
    console.log('[Binance WS] Connected — streaming BTC/ETH real-time');
  });

  binanceWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const ticker = msg.data;
      if (!ticker || !ticker.s || !ticker.c) return;

      // Map Binance symbol → our symbol
      const symbolMap = { 'BTCUSDT': 'BTCUSD', 'ETHUSDT': 'ETHUSD' };
      const sym = symbolMap[ticker.s];
      if (!sym) return;

      const price = parseFloat(ticker.c); // 'c' = current/last price
      applyRealPrice(sym, price);
    } catch (e) {
      // ignore parse errors
    }
  });

  binanceWs.on('close', () => {
    console.warn('[Binance WS] Disconnected — reconnecting in 3s...');
    setTimeout(connectBinance, 3000);
  });

  binanceWs.on('error', (err) => {
    console.error('[Binance WS] Error:', err.message);
    binanceWs.terminate();
  });
}

connectBinance();

// ==========================================
// Yahoo Finance — used ONLY as cold-start seed
// (fallback when Finnhub not configured)
// ==========================================
function fetchYahooSeed(sym, callback) {
  const ticker = YAHOO_TICKERS[sym];
  const options = {
    hostname: 'query2.finance.yahoo.com',
    path: `/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const price = JSON.parse(data).chart.result[0].meta.regularMarketPrice;
        if (price && typeof price === 'number') {
          applyRealPrice(sym, price);
          console.log(`[Yahoo seed] ${sym}: $${currentPrices[sym]}`);
          if (callback) callback(price);
        }
      } catch(e) { console.error(`[Yahoo seed] Error ${sym}:`, e.message); }
    });
  });
  req.on('error', () => {});
  req.setTimeout(8000, () => req.destroy());
  req.end();
}

// ==========================================
// Delayed History Init — wait for real prices before building candle history
// ==========================================
const seedsNeeded = new Set(SYMBOLS);
let historyInitialized = false;

function onSeedReceived(sym) {
  seedsNeeded.delete(sym);
  if (seedsNeeded.size === 0 && !historyInitialized) {
    historyInitialized = true;
    initializeCandles();
  }
}

// Seed ALL symbols from Yahoo on startup — history built after all seeds arrive
SYMBOLS.forEach(sym => {
  if (!isMarketClosed() || sym.includes('BTC') || sym.includes('ETH')) {
    fetchYahooSeed(sym, () => onSeedReceived(sym));
  } else {
    // Market closed for this commodity — remove from pending set
    onSeedReceived(sym);
  }
});

// Fallback: if seeds don't all arrive within 10s, initialize anyway
setTimeout(() => {
  if (!historyInitialized) {
    historyInitialized = true;
    console.warn('[Init] Timeout waiting for seeds — initializing with available prices');
    initializeCandles();
  }
}, 10000);

// Yahoo fallback polling — DISABLED for live price updates
// Reason: Yahoo Finance GC=F returns Gold Futures price (~$25 premium over spot XAUUSD)
// injecting futures prices creates huge spike candles.
// Yahoo is only used at server startup for initial seed.
let yahooFallbackInterval = null;
function startYahooFallback() {
  // No-op: fallback disabled to prevent futures vs spot price spikes
  // If Finnhub disconnects, prices stay at last known real value
  if (yahooFallbackInterval) return;
  console.log('[Yahoo] Fallback disabled — keeping last known Finnhub price to avoid futures price spikes');
}

// ==========================================
// FINNHUB WebSocket — Real-time commodities
// OANDA data feed: ~2-3s delay (same source as TradingView)
// Register free at https://finnhub.io
// Set env var: FINNHUB_TOKEN=your_key_here
// ==========================================

// Map Finnhub/OANDA symbols → our symbols
const FINNHUB_SYMBOL_MAP = {
  'OANDA:XAU_USD':   'XAUUSD',
  'OANDA:XAG_USD':   'XAGUSD',
  'OANDA:WTICO_USD': 'WTIUSD',
};

const FINNHUB_SUBSCRIBE = Object.keys(FINNHUB_SYMBOL_MAP);

let finnhubWs = null;
let finnhubConnected = false;
let finnhubRetryDelay = 5000; // exponential backoff: starts 5s, max 60s

function connectFinnhub() {
  if (!FINNHUB_TOKEN) {
    startYahooFallback();
    return;
  }

  const url = `wss://ws.finnhub.io?token=${FINNHUB_TOKEN}`;
  finnhubWs = new WebSocket(url);

  finnhubWs.on('open', () => {
    finnhubConnected = true;
    finnhubRetryDelay = 5000; // reset backoff on successful connect
    console.log('[Finnhub WS] Connected — streaming XAUUSD/XAGUSD/WTIUSD via OANDA (~2-3s delay)');
    // Subscribe to all commodity symbols
    FINNHUB_SUBSCRIBE.forEach(symbol => {
      finnhubWs.send(JSON.stringify({ type: 'subscribe', symbol }));
    });
    // Stop Yahoo fallback if it was running
    if (yahooFallbackInterval) {
      clearInterval(yahooFallbackInterval);
      yahooFallbackInterval = null;
      console.log('[Yahoo] Fallback stopped — Finnhub is active');
    }
  });

  finnhubWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      // msg.type === 'trade' contains live price trades
      if (msg.type === 'trade' && Array.isArray(msg.data)) {
        msg.data.forEach(trade => {
          const sym = FINNHUB_SYMBOL_MAP[trade.s];
          if (!sym) return;
          if (isMarketClosed()) return; // ignore if market closed
          const price = parseFloat(trade.p);
          if (price && price > 0) {
            applyRealPrice(sym, price);
          }
        });
      } else if (msg.type === 'ping') {
        // Keep-alive pong
        finnhubWs.send(JSON.stringify({ type: 'pong' }));
      }
    } catch(e) {
      // ignore
    }
  });

  finnhubWs.on('close', (code, reason) => {
    finnhubConnected = false;
    // Exponential backoff: double delay each time, cap at 60s
    finnhubRetryDelay = Math.min(finnhubRetryDelay * 2, 60000);
    console.warn(`[Finnhub WS] Disconnected (${code}) — reconnecting in ${finnhubRetryDelay/1000}s...`);
    startYahooFallback();
    setTimeout(connectFinnhub, finnhubRetryDelay);
  });

  finnhubWs.on('error', (err) => {
    console.error('[Finnhub WS] Error:', err.message);
    finnhubConnected = false;
    // If 429 rate-limit, wait longer before next attempt
    if (err.message && err.message.includes('429')) {
      finnhubRetryDelay = 60000;
      console.warn('[Finnhub WS] Rate limited (429) — backing off 60s');
    } else {
      finnhubRetryDelay = Math.min(finnhubRetryDelay * 2, 60000);
    }
    finnhubWs.terminate();
  });
}

connectFinnhub();

// ==========================================
// 1-Second Candle Tick Loop
// Uses currentPrices (already synced by Binance WS or Yahoo)
// No random simulation — pure real prices
// ==========================================
setInterval(() => {
  // Guard: candles aren't ready yet (waiting on seed prices / init timeout).
  // Without this check, activeCandles[sym][tf] can still be null here and
  // the tick below would crash the whole process on startup.
  if (!historyInitialized) return;

  const now = Math.floor(Date.now() / 1000);
  const marketClosed = isMarketClosed();

  SYMBOLS.forEach((sym) => {
    const isCrypto = sym.includes('BTC') || sym.includes('ETH');
    const isCommodity = !isCrypto;

    // Market closed: freeze commodity candles
    if (isCommodity && marketClosed) {
      const frozen = WEEKEND_FROZEN_PRICES[sym];
      if (frozen) currentPrices[sym] = frozen;
    }

    const price = currentPrices[sym];

    Object.keys(INTERVAL_SECONDS).forEach((tf) => {
      const seconds = INTERVAL_SECONDS[tf];
      const expectedTime = Math.floor(now / seconds) * seconds;
      const active = activeCandles[sym][tf];

      // Defensive guard: self-heal if this specific candle slot is somehow
      // still uninitialized (e.g. partial init state), instead of crashing.
      if (!active) {
        activeCandles[sym][tf] = {
          time: expectedTime,
          open: price,
          high: price,
          low: price,
          close: price
        };
        return;
      }

      if (expectedTime > active.time) {
        // New candle: archive old one
        candleHistory[sym][tf].push({ ...active });
        if (candleHistory[sym][tf].length > 200) candleHistory[sym][tf].shift();

        activeCandles[sym][tf] = {
          time:  expectedTime,
          open:  active.close,
          high:  price,
          low:   price,
          close: price
        };
      } else {
        active.close = price;
        active.high  = Math.max(active.high, price);
        active.low   = Math.min(active.low,  price);
      }

      // Broadcast active candle updates for this specific symbol and timeframe
      io.emit('candle_update', {
        ticker:       sym,
        interval:     tf,
        candle:       activeCandles[sym][tf]
      });
    });

    // Broadcast price update once per second for this symbol (outside timeframe loop)
    io.emit('price_update', {
      ticker:       sym,
      currentPrice: price
    });
  });
}, 1000);

// ==========================================
// Authentication & User DB
// ==========================================
const usersFilePath = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (!fs.existsSync(usersFilePath)) {
      // Store default admin user with hashed password (migrated from plain-text 'gold123')
      const defaultAdminPassword = hashPassword('gold123');
      const defaultUsers = [{ username: 'admin', password: defaultAdminPassword, name: 'Admin Account', role: 'Administrator' }];
      fs.writeFileSync(usersFilePath, JSON.stringify(defaultUsers, null, 2), 'utf8');
      return defaultUsers;
    }
    return JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
  } catch (e) { return []; }
}

function saveUsers(users) {
  try { fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8'); } catch (e) {}
}

// ==========================================
// REST API Endpoints
// ==========================================

// Login endpoint with rate limiter and slow down
app.post('/api/login', authLimiter, speedLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ thông tin.' });
  }
  
  if (username.length > 50 || password.length > 100) {
    return res.status(400).json({ success: false, error: 'Thông tin đăng nhập quá dài.' });
  }

  const users = loadUsers();
  const foundIdx = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  
  if (foundIdx === -1) {
    return res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
  }
  
  const found = users[foundIdx];
  
  // Verify expiration date
  if (found.expiresAt) {
    const expTime = new Date(found.expiresAt).getTime();
    if (Date.now() > expTime) {
      return res.status(403).json({ success: false, error: 'Tài khoản của bạn đã hết hạn sử dụng. Vui lòng liên hệ Hỗ trợ để gia hạn.' });
    }
  }

  const isMatch = verifyPassword(password, found.password);
  
  if (isMatch) {
    // Migrate plaintext password to hash on-the-fly
    if (!found.password.startsWith('pbkdf2$')) {
      console.log(`[Security] Migrating plaintext password to secure pbkdf2 hash for: ${found.username}`);
      found.password = hashPassword(password);
      users[foundIdx] = found;
      saveUsers(users);
    }
    
    const token = generateToken({ username: found.username, name: found.name, role: found.role });
    return res.json({ 
      success: true, 
      token, 
      user: { username: found.username, name: found.name, role: found.role } 
    });
  }
  
  res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
});

// Blocked public registration endpoint
app.post('/api/register', (req, res) => {
  res.status(403).json({ success: false, error: 'Chức năng tự đăng ký đã bị vô hiệu hóa. Vui lòng liên hệ Admin để tạo tài khoản.' });
});

// TradingView Webhook: receives signals (secured with WEBHOOK_SECRET)
app.post('/api/webhook', webhookLimiter, (req, res) => {
  const secret = req.headers['x-webhook-secret'] || req.body.secret || req.query.secret;
  if (!secret || secret !== WEBHOOK_SECRET) {
    console.warn(`[Security] Unauthorized webhook access attempt from IP: ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid webhook secret' });
  }

  const { ticker, interval, action, entry, confidence } = req.body;
  if (!ticker || !interval || !action || entry === undefined) {
    return res.status(400).json({ error: 'Missing required parameters (ticker, interval, action, entry)' });
  }

  const sym = String(ticker).toUpperCase();
  if (!SYMBOLS.includes(sym)) return res.status(400).json({ error: `Unsupported symbol: ${ticker}` });

  const tfLabel = INTERVAL_MAP[String(interval)];
  if (!tfLabel) return res.status(400).json({ error: `Unsupported interval: ${interval}` });

  const formattedAction = String(action).toLowerCase();
  if (formattedAction !== 'buy' && formattedAction !== 'sell') {
    return res.status(400).json({ error: 'Action must be buy or sell' });
  }

  const numEntry = parseFloat(entry);
  const numConfidence = confidence ? parseInt(confidence, 10) : null;

  if (isNaN(numEntry)) {
    return res.status(400).json({ error: 'Invalid numeric parameters' });
  }

  // Calculate SL and TP using hardcoded distances (SL 5 prices, TP 7 prices for Gold)
  const settings = SIGNAL_SETTINGS[sym] || { sl: 5.0, tp: 7.0 };
  let computedSl = 0;
  let computedTp = 0;
  if (formattedAction === 'buy') {
    computedSl = numEntry - settings.sl;
    computedTp = numEntry + settings.tp;
  } else {
    computedSl = numEntry + settings.sl;
    computedTp = numEntry - settings.tp;
  }

  // Round values depending on asset type (XAGUSD needs 4 decimals, others 2)
  const decimalPlaces = (sym === 'XAGUSD') ? 4 : 2;
  const finalSl = parseFloat(computedSl.toFixed(decimalPlaces));
  const finalTp = parseFloat(computedTp.toFixed(decimalPlaces));
  const finalEntry = parseFloat(numEntry.toFixed(decimalPlaces));

  signals[sym][tfLabel] = {
    ticker: sym, 
    interval: tfLabel, 
    action: formattedAction,
    entry: finalEntry, 
    sl: finalSl, 
    tp: finalTp,
    confidence: numConfidence && !isNaN(numConfidence) ? numConfidence : Math.floor(Math.random() * 20) + 75,
    timestamp: Date.now()
  };

  io.emit('signal_update', signals[sym][tfLabel]);
  res.json({ success: true, signal: signals[sym][tfLabel] });
});

// Secured API Endpoints
app.get('/api/signals', requireAuth, (req, res) => res.json(signals));
app.get('/api/prices', requireAuth, (req, res) => res.json(currentPrices));

app.get('/api/history/:symbol/:interval', requireAuth, (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const tf  = req.params.interval;
  if (!candleHistory[sym] || !candleHistory[sym][tf])
    return res.status(400).json({ error: 'Invalid symbol or interval' });
  res.json({ history: candleHistory[sym][tf], active: activeCandles[sym][tf] });
});

// ==========================================
// Drawings Cloud Sync — REST Endpoints
// ==========================================

// GET /api/drawings/:symbol — load drawings for current user + symbol
app.get('/api/drawings/:symbol', requireAuth, (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  if (!SYMBOLS.includes(sym)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const key = `${req.user.username}:${sym}`;
  const drawings = drawingsStore.get(key) || [];
  res.json({ success: true, symbol: sym, drawings });
});

// POST /api/drawings/:symbol — save drawings for current user + symbol (full replace)
app.post('/api/drawings/:symbol', requireAuth, (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  if (!SYMBOLS.includes(sym)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  const { drawings } = req.body;
  if (!Array.isArray(drawings)) {
    return res.status(400).json({ error: 'drawings must be an array' });
  }
  // Validate each drawing object to prevent injection
  const validTypes = ['trendline', 'horizontal', 'rectangle', 'fib'];
  const sanitized = drawings.filter(d =>
    d && validTypes.includes(d.type) &&
    typeof d.start === 'object' &&
    typeof d.start.price === 'number'
  ).slice(0, 100); // max 100 drawings per symbol

  const key = `${req.user.username}:${sym}`;
  drawingsStore.set(key, sanitized);

  // Broadcast to other sockets of the same user (last-write-wins)
  req.app.get('io').to(`user:${req.user.username}`).emit('drawings:updated', {
    symbol: sym,
    drawings: sanitized
  });

  res.json({ success: true, count: sanitized.length });
});

// ==========================================
// Admin User Management API Routes
// ==========================================

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  // Map users to exclude passwords
  const sanitizedUsers = users.map(({ username, name, role, expiresAt }) => ({ username, name, role, expiresAt }));
  res.json({ success: true, users: sanitizedUsers });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, name, role, expiresAt } = req.body;
  if (!username || !password || !name || !role ||
      typeof username !== 'string' || typeof password !== 'string' || typeof name !== 'string' || typeof role !== 'string') {
    return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ thông tin.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanName = name.trim();
  const targetRole = role === 'Administrator' ? 'Administrator' : 'User';

  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    return res.status(400).json({ success: false, error: 'Tên đăng nhập phải từ 3 đến 30 ký tự.' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ success: false, error: 'Tên đăng nhập chỉ được chứa ký tự chữ, số và dấu gạch dưới.' });
  }
  if (password.length < 6 || password.length > 50) {
    return res.status(400).json({ success: false, error: 'Mật khẩu phải từ 6 đến 50 ký tự.' });
  }
  if (cleanName.length < 2 || cleanName.length > 50) {
    return res.status(400).json({ success: false, error: 'Họ tên phải từ 2 đến 50 ký tự.' });
  }

  const users = loadUsers();
  if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
    return res.status(400).json({ success: false, error: 'Tên đăng nhập đã tồn tại!' });
  }

  const hashedPassword = hashPassword(password);
  users.push({
    username: cleanUsername,
    password: hashedPassword,
    name: cleanName,
    role: targetRole,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
  });
  saveUsers(users);

  res.json({ success: true, message: 'Tạo tài khoản mới thành công!' });
});

app.put('/api/admin/users/:username/password', requireAdmin, (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { password } = req.body;
  
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Mật khẩu mới không hợp lệ.' });
  }
  if (password.length < 6 || password.length > 50) {
    return res.status(400).json({ success: false, error: 'Mật khẩu phải từ 6 đến 50 ký tự.' });
  }

  const users = loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  users[idx].password = hashPassword(password);
  saveUsers(users);

  res.json({ success: true, message: `Đổi mật khẩu cho tài khoản ${targetUsername} thành công!` });
});

app.put('/api/admin/users/:username/role', requireAdmin, (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { role } = req.body;

  if (!role || (role !== 'User' && role !== 'Administrator')) {
    return res.status(400).json({ success: false, error: 'Quyền (role) không hợp lệ.' });
  }

  const users = loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  // Self role change check (prevent lockout if changing their own role)
  if (targetUsername === req.user.username.toLowerCase() && role !== 'Administrator') {
    return res.status(400).json({ success: false, error: 'Bạn không thể tự hạ quyền Administrator của chính mình.' });
  }

  users[idx].role = role;
  saveUsers(users);

  res.json({ success: true, message: `Cập nhật quyền cho tài khoản ${targetUsername} thành công!` });
});

app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const targetUsername = req.params.username.toLowerCase();

  if (targetUsername === req.user.username.toLowerCase()) {
    return res.status(400).json({ success: false, error: 'Bạn không thể tự xóa tài khoản của chính mình!' });
  }

  const users = loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  users.splice(idx, 1);
  saveUsers(users);

  res.json({ success: true, message: `Xóa tài khoản ${targetUsername} thành công!` });
});

app.put('/api/admin/users/:username/edit', requireAdmin, (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { name, role, expiresAt } = req.body;
  
  const users = loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  if (name && typeof name === 'string') {
    users[idx].name = name.trim();
  }

  if (role && (role === 'User' || role === 'Administrator')) {
    if (targetUsername === req.user.username.toLowerCase() && role !== 'Administrator') {
      return res.status(400).json({ success: false, error: 'Bạn không thể tự hạ quyền Administrator của chính mình.' });
    }
    users[idx].role = role;
  }

  if (expiresAt !== undefined) {
    users[idx].expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
  }

  saveUsers(users);
  res.json({ success: true, message: `Cập nhật thông tin tài khoản ${targetUsername} thành công!` });
});


// Stale signal checker
const STALE_TIMEOUT_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  SYMBOLS.forEach((sym) => {
    Object.keys(signals[sym]).forEach((tf) => {
      const sig = signals[sym][tf];
      if (sig.action !== 'stale' && (now - sig.timestamp > STALE_TIMEOUT_MS)) {
        sig.action = 'stale';
        console.log(`Signal ${sym} (${tf}) → STALE`);
        io.emit('signal_update', sig);
      }
    });
  });
}, 5000);

// ==========================================
// Socket.IO Connection & Auth Middleware
// ==========================================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.warn(`[Socket Security] Connection rejected from socket ID ${socket.id}: No token provided.`);
    return next(new Error('Authentication error: Token missing'));
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    console.warn(`[Socket Security] Connection rejected from socket ID ${socket.id}: Invalid or expired token.`);
    return next(new Error('Authentication error: Invalid or expired token'));
  }
  
  // Security check: Verify user expiration status
  const users = loadUsers();
  const foundUser = users.find(u => u.username.toLowerCase() === decoded.username.toLowerCase());
  if (foundUser && foundUser.expiresAt) {
    const expTime = new Date(foundUser.expiresAt).getTime();
    if (Date.now() > expTime) {
      console.warn(`[Socket Security] Connection rejected: Account expired for user ${decoded.username}`);
      return next(new Error('Authentication error: Account expired'));
    }
  }
  
  socket.user = decoded;
  next();
});

io.on('connection', (socket) => {
  console.log(`[Socket] Authenticated client connected: ${socket.id} (${socket.user.username})`);
  socket.emit('initial_signals', signals);

  // Join user-specific room for targeted drawings broadcast
  socket.join(`user:${socket.user.username}`);

  // Handle drawings:save — saves drawings and broadcasts to other devices of same user
  socket.on('drawings:save', (payload) => {
    try {
      const sym = (payload?.symbol || '').toUpperCase();
      if (!SYMBOLS.includes(sym)) return;
      if (!Array.isArray(payload?.drawings)) return;

      const validTypes = ['trendline', 'horizontal', 'rectangle', 'fib'];
      const sanitized = payload.drawings.filter(d =>
        d && validTypes.includes(d.type) &&
        typeof d.start === 'object' &&
        typeof d.start.price === 'number'
      ).slice(0, 100);

      const key = `${socket.user.username}:${sym}`;
      drawingsStore.set(key, sanitized);

      // Broadcast to OTHER sockets of same user (not back to sender)
      socket.to(`user:${socket.user.username}`).emit('drawings:updated', {
        symbol: sym,
        drawings: sanitized
      });
    } catch (e) {
      // ignore malformed payload
    }
  });

  socket.on('disconnect', () => console.log(`[Socket] Client disconnected: ${socket.id}`));
});

// ==========================================
// Proxy Economic Calendar & News from VnWallStreet
// ==========================================
app.get('/api/external/calendar', requireAuth, async (req, res) => {
  const { date } = req.query; // YYYY/MM/DD
  if (!date || typeof date !== 'string') {
    return res.status(400).json({ error: 'Missing date parameter' });
  }
  try {
    const response = await fetch(`https://vnwallstreet.org/api/calendar?date=${encodeURIComponent(date)}&t=${Date.now()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `External API returned status ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[Proxy Calendar] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch calendar data from external source' });
  }
});

app.get('/api/external/news', requireAuth, async (req, res) => {
  const { limit = 20, start = 0, important } = req.query;
  try {
    let url = `https://vnwallstreet.org/api/news?limit=${parseInt(limit)}&start=${parseInt(start)}&t=${Date.now()}`;
    if (important === '1') {
      url += '&important=1';
    }
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `External API returned status ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[Proxy News] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch news data from external source' });
  }
});

// Serve static frontend in production
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dist/index.html')));

// Make io accessible from req.app for REST drawing endpoints
app.set('io', io);

// Global Error Handler to hide stack traces in production
app.use((err, req, res, next) => {
  console.error('[Error Handler] Uncaught error:', err.message);
  res.status(500).json({ error: 'Đã xảy ra lỗi nội bộ hệ thống. Vui lòng thử lại sau.' });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
