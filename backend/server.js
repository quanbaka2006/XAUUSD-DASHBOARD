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
const { createM1SignalEngine } = require('./m1SignalEngine');
const { rateLimit } = require('express-rate-limit');
const slowDown = require('express-slow-down');
const vpsManager = require('./vpsManager');
const net = require('net');
const {
  createActiveM1Candle,
  mergeClosedM1Candles,
  minuteBucket,
  normalizeYahooM1Candles,
  sanitizeCheckpoint
} = require('./marketDataContinuity');


// Load .env file for local development
try { require('dotenv').config(); } catch(e) {}

// Initialize MetaApi SDK
const MetaApi = require('metaapi.cloud-sdk').default;
const METAAPI_TOKEN = process.env.METAAPI_TOKEN || '';
let metaApi = null;
if (METAAPI_TOKEN) {
  metaApi = new MetaApi(METAAPI_TOKEN);
  console.log('[MetaApi] SDK initialized successfully.');
} else {
  console.warn('[MetaApi] WARNING: METAAPI_TOKEN is not configured. Auto-execution features will be disabled.');
}

// Encryption/Decryption Helpers for MT5 Passwords
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.warn('[Security] WARNING: ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Encryption might fail or use unsafe fallbacks.');
}

function encryptPassword(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[Encryption] Failed to encrypt:', err.message);
    throw new Error('Encryption failed');
  }
}

function decryptPassword(encryptedText) {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Decryption] Failed to decrypt:', err.message);
    throw new Error('Decryption failed');
  }
}

// ==========================================
// API Keys & Secrets — MUST be set via environment variables (never hardcode)
// ==========================================
const FINNHUB_TOKEN = process.env.FINNHUB_TOKEN || '';
if (!FINNHUB_TOKEN) {
  console.warn('[Finnhub] WARNING: FINNHUB_TOKEN not set. Commodity prices will use Yahoo Finance fallback (higher delay).');
}

// Security Secrets — no hardcoded fallback. If WEBHOOK_SECRET is unset the webhook
// fails closed (rejects everything) instead of trusting a publicly-known value.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
if (!WEBHOOK_SECRET) {
  console.warn('[Security] WARNING: WEBHOOK_SECRET not set — the TradingView webhook will reject all requests until it is configured.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[Security] WARNING: JWT_SECRET not set — using a random secret. All users will be logged out on every restart/deploy. Set JWT_SECRET in Render for stable sessions.');
}

// Allowed browser origins for CORS (comma-separated env override supported)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://alphagoldhub.com,https://www.alphagoldhub.com,https://xauusd-dashboard-izrr.onrender.com,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:3001')
  .split(',').map(o => o.trim()).filter(Boolean);

// Allow same-origin / server-to-server (no Origin header) + whitelisted origins
function corsOriginCheck(origin, callback) {
  if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
  return callback(null, false);
}

// ==========================================
// Password Hashing (PBKDF2) & Token JWT Utils
// ==========================================
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 100000; // raised from 10000; verifyPassword reads iterations from each stored hash so old hashes still work
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

// CORS setup — restricted to known origins instead of wildcard
app.use(cors({
  origin: corsOriginCheck,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));

// 50KB accommodates the bounded 50-record website signal history payload.
app.use(express.json({ limit: '50kb' }));

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

function generateRefCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && req.user.role === 'SuperAdmin') {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Chỉ Super Admin mới có quyền thực hiện thao tác này.' });
  });
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && (req.user.role === 'SuperAdmin' || req.user.role === 'Administrator')) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Bạn không có quyền truy cập tính năng này.' });
  });
}

function requireAdminOrEmployee(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user && (req.user.role === 'SuperAdmin' || req.user.role === 'Administrator' || req.user.role === 'Employee')) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Bạn không có quyền truy cập tính năng này.' });
  });
}


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] }
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

// Keyless spot-metal fallback. Unlike Yahoo's GC=F/SI=F contracts, these are
// spot XAU/XAG quotes, so they do not introduce a futures-basis price gap.
const GOLD_API_SYMBOLS = {
  'XAUUSD': 'XAU',
  'XAGUSD': 'XAG'
};

// Binance stream symbols (true 1s real-time)
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
let lastRealPrices = {};

// Spread Compensation Tracker (Finnhub OANDA vs Yahoo GC)
const sourceOffsets = { XAUUSD: 0, XAGUSD: 0 };

// Track timestamp of last received real price tick per symbol
const lastTickTimestamp = {
  'XAUUSD': 0,
  'WTIUSD': 0,
  'XAGUSD': 0,
  'BTCUSD': 0,
  'ETHUSD': 0
};
const FEED_STALE_AFTER_MS = 30 * 1000;
const recoveringM1Symbols = new Set();

// Check if market is closed (either weekend or inactivity holiday/early close)
function isSymbolClosedDynamic(sym) {
  const isCrypto = sym.includes('BTC') || sym.includes('ETH');
  if (isCrypto) return false;

  // 1. Hardcoded weekend hours
  if (isMarketClosed()) return true;

  // 2. Freeze immediately when the backend feed is stale. Missing minutes are
  // backfilled before realtime candle construction resumes.
  if (!lastTickTimestamp[sym] || Date.now() - lastTickTimestamp[sym] > FEED_STALE_AFTER_MS) {
    return true;
  }
  return false;
}

// Tracks whether the synthetic history has been aligned to the first live streaming price
const hasAlignedHistory = {
  'XAUUSD': false,
  'WTIUSD': false,
  'XAGUSD': false,
  'BTCUSD': false,
  'ETHUSD': false
};

// ==========================================
// Drawings Store (in-memory, per user+symbol)
// Key: `${username}:${symbol}`, Value: drawings[]
// ==========================================
const drawingsStore = new Map();

const SIGNAL_SETTINGS = {
  'XAUUSD': { sl: 10.0, tp1: 5.0, tp2: 7.5 },
  'WTIUSD': { sl: 1.0, tp1: 0.5, tp2: 0.75 },
  'XAGUSD': { sl: 0.4, tp1: 0.2, tp2: 0.3 },
  'BTCUSD': { sl: 600.0, tp1: 300.0, tp2: 450.0 },
  'ETHUSD': { sl: 30.0, tp1: 15.0, tp2: 22.5 }
};

SYMBOLS.forEach((sym) => {
  const settings = SIGNAL_SETTINGS[sym] || { sl: 10.0, tp1: 5.0, tp2: 7.5 };
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
    'M1':  { ticker: sym, interval: 'M1',  action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() },
    'M5':  { ticker: sym, interval: 'M5',  action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() },
    'M15': { ticker: sym, interval: 'M15', action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() },
    'H1':  { ticker: sym, interval: 'H1',  action: 'stale', entry: 0, sl: 0, tp: 0, confidence: 0, timestamp: Date.now() }
  };
  candleHistory[sym] = { 'M1': [], 'M5': [], 'M15': [], 'H1': [] };
  activeCandles[sym] = { 'M1': null, 'M5': null, 'M15': null, 'H1': null };
});

// ==========================================
// Historical Candle Generator
// ==========================================
const CHART_HISTORY_LIMIT = 200;

function generateHistory() {
  const now = Math.floor(Date.now() / 1000);

  SYMBOLS.forEach((sym) => {
    Object.keys(INTERVAL_SECONDS).forEach((tf) => {
      const seconds = INTERVAL_SECONDS[tf];
      let price = currentPrices[sym];
      const list = [];
      for (let i = 1; i <= CHART_HISTORY_LIMIT; i++) {
        const time = (Math.floor(now / seconds) - i) * seconds;
        const change = (Math.random() - 0.49) * (defaultPrices[sym] * 0.0006);
        const close = price;
        const open = price - change;
        const high = Math.max(open, close) + Math.random() * (defaultPrices[sym] * 0.0003);
        const low  = Math.min(open, close) - Math.random() * (defaultPrices[sym] * 0.0003);
        list.push({ time, open, high, low, close });
        price = open;
      }
      list.reverse();
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
  const previousTickAt = lastTickTimestamp[sym] || 0;
  lastTickTimestamp[sym] = Date.now();
  const price = parseFloat(newPrice.toFixed(sym.includes('BTC') ? 2 : 4));

  // Align synthetic history to the first live price from external stream (e.g. websocket)
  if (historyInitialized && !hasAlignedHistory[sym]) {
    const oldPrice = currentPrices[sym];
    const offset = price - oldPrice;
    
    // Only shift if there is a meaningful difference to prevent unnecessary work
    if (Math.abs(offset) > 0.001) {
      console.log(`[Init] Aligning historical candles for ${sym} (offset: ${offset.toFixed(4)}, seed: ${oldPrice}, live: ${price})`);
      
      // Shift historical candles
      if (candleHistory[sym]) {
        Object.keys(candleHistory[sym]).forEach(tf => {
          if (Array.isArray(candleHistory[sym][tf])) {
            candleHistory[sym][tf].forEach(c => {
              c.open = parseFloat((c.open + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
              c.high = parseFloat((c.high + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
              c.low = parseFloat((c.low + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
              c.close = parseFloat((c.close + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
            });
          }
          
          // Also shift active candle if it exists
          if (activeCandles[sym] && activeCandles[sym][tf]) {
            const ac = activeCandles[sym][tf];
            ac.open = parseFloat((ac.open + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
            ac.high = parseFloat((ac.high + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
            ac.low = parseFloat((ac.low + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
            ac.close = parseFloat((ac.close + offset).toFixed(sym === 'XAGUSD' ? 4 : 2));
          }
        });
      }
    }
    hasAlignedHistory[sym] = true;
  }

  currentPrices[sym] = price;
  lastRealPrices[sym] = price;

  // If XAUUSD resumes after a stale period, pause candle construction until the
  // missing M1 bars have been recovered. This prevents one giant bridge candle.
  if (
    sym === 'XAUUSD'
    && historyInitialized
    && marketStateReady
    && previousTickAt > 0
    && Date.now() - previousTickAt > FEED_STALE_AFTER_MS
  ) {
    requestXauM1Recovery('feed_resumed', true);
  }
}

// ==========================================
// BINANCE & KRAKEN WebSockets — Real-time 1s feeds
// ==========================================
let binanceWs = null;
let binanceConnected = false;
let binanceRetryDelay = 5000;

function connectBinance() {
  const streams = Object.values(BINANCE_STREAMS).map(s => `${s}@miniTicker`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  binanceWs = new WebSocket(url);

  binanceWs.on('open', () => {
    binanceConnected = true;
    binanceRetryDelay = 5000;
    console.log('[Binance WS] Connected — streaming BTC/ETH/XAUUSD real-time');
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

  let is451Error = false;

  binanceWs.on('close', (code) => {
    binanceConnected = false;
    if (is451Error) {
      console.warn(`[Binance WS] Connection permanently disabled due to 451 Region Block. Using Fallback.`);
      return; // Stop reconnecting
    }
    binanceRetryDelay = Math.min(binanceRetryDelay * 2, 60000);
    console.warn(`[Binance WS] Disconnected (${code}) — reconnecting in ${binanceRetryDelay/1000}s...`);
    setTimeout(connectBinance, binanceRetryDelay);
  });

  binanceWs.on('error', (err) => {
    if (err.message && err.message.includes('451')) {
      is451Error = true;
      console.error('[Binance WS] IP is blocked by Binance (Error 451). Switching to Kraken/Yahoo fallbacks.');
    } else {
      console.error('[Binance WS] Error:', err.message);
    }
    binanceConnected = false;
    binanceWs.terminate();
  });
}

connectBinance();

let krakenWs = null;
let krakenConnected = false;
let krakenRetryDelay = 5000;

function connectKraken() {
  const url = 'wss://ws.kraken.com';
  krakenWs = new WebSocket(url);

  krakenWs.on('open', () => {
    krakenConnected = true;
    krakenRetryDelay = 5000;
    console.log('[Kraken WS] Connected — streaming XAUUSD/BTCUSD/ETHUSD real-time');
    const subscribeMsg = {
      event: 'subscribe',
      pair: ['XBT/USD', 'ETH/USD'],
      subscription: {
        name: 'ticker'
      }
    };
    krakenWs.send(JSON.stringify(subscribeMsg));
  });

  krakenWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (Array.isArray(msg) && msg.length === 4 && msg[2] === 'ticker') {
        const pair = msg[3];
        const ticker = msg[1];
        if (ticker && ticker.c && ticker.c[0]) {
          const price = parseFloat(ticker.c[0]);
          if (price && price > 0) {
            const pairMap = {
              'XBT/USD': 'BTCUSD',
              'ETH/USD': 'ETHUSD'
            };
            const sym = pairMap[pair];
            if (sym) {
              applyRealPrice(sym, price);
            }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  });

  krakenWs.on('close', (code) => {
    krakenConnected = false;
    krakenRetryDelay = Math.min(krakenRetryDelay * 2, 60000);
    console.warn(`[Kraken WS] Disconnected (${code}) — reconnecting in ${krakenRetryDelay/1000}s...`);
    setTimeout(connectKraken, krakenRetryDelay);
  });

  krakenWs.on('error', (err) => {
    console.error('[Kraken WS] Error:', err.message);
    krakenConnected = false;
    krakenWs.terminate();
  });
}

connectKraken();

// ==========================================
// Custom fetch helper using native https
// ==========================================
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const reqOptions = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          ...options.headers
        }
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => {
              try {
                return Promise.resolve(JSON.parse(data));
              } catch (e) {
                return Promise.reject(new Error('Invalid JSON'));
              }
            }
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }
      req.setTimeout(10000, () => req.destroy());
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ==========================================
// Finnhub symbol mapping (hoisted for fetchFinnhubSeed)
// ==========================================
const FINNHUB_SYMBOL_MAP = {
  'OANDA:XAU_USD':   'XAUUSD',
  'OANDA:XAG_USD':   'XAGUSD',
  'OANDA:WTICO_USD': 'WTIUSD',
};
const FINNHUB_SUBSCRIBE = Object.keys(FINNHUB_SYMBOL_MAP);

// ==========================================
// Seed Fetchers (Finnhub Spot & Binance HTTP API)
// ==========================================
function fetchFinnhubSeed(sym, callback) {
  // Fallback polling also calls this function without a callback. Treat it as
  // optional so rate-limit/error responses cannot crash the whole server.
  const done = typeof callback === 'function' ? callback : () => {};

  if (!FINNHUB_TOKEN) {
    return done(null);
  }

  // Find the corresponding Finnhub symbol (e.g. OANDA:XAU_USD)
  const finnhubSym = FINNHUB_SUBSCRIBE.find(s => FINNHUB_SYMBOL_MAP[s] === sym);
  if (!finnhubSym) {
    return done(null);
  }

  const options = {
    hostname: 'finnhub.io',
    path: `/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${FINNHUB_TOKEN}`,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const price = json.c; // c is current price
        if (price && typeof price === 'number') {
          applyRealPrice(sym, price);
          console.log(`[Finnhub seed] ${sym}: $${currentPrices[sym]}`);
          return done(price);
        }
      } catch (e) {
        console.error(`[Finnhub seed] Parse error ${sym}:`, e.message);
      }
      done(null);
    });
  });

  req.on('error', (err) => {
    console.error(`[Finnhub seed] Request error ${sym}:`, err.message);
    done(null);
  });
  req.setTimeout(5000, () => req.destroy());
  req.end();
}

function fetchBinanceSeed(sym, callback) {
  const binanceStream = BINANCE_STREAMS[sym];
  if (!binanceStream) {
    return callback(null);
  }
  const binanceSymbol = binanceStream.toUpperCase(); // e.g. BTCUSDT

  const options = {
    hostname: 'api.binance.com',
    path: `/api/v3/ticker/price?symbol=${binanceSymbol}`,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const price = parseFloat(json.price);
        if (price && !isNaN(price)) {
          applyRealPrice(sym, price);
          console.log(`[Binance seed] ${sym}: $${currentPrices[sym]}`);
          return callback(price);
        }
      } catch (e) {
        console.error(`[Binance seed] Parse error ${sym}:`, e.message);
      }
      callback(null);
    });
  });

  req.on('error', (err) => {
    console.error(`[Binance seed] Request error ${sym}:`, err.message);
    callback(null);
  });
  req.setTimeout(5000, () => req.destroy());
  req.end();
}

// ==========================================
// Yahoo Finance — used ONLY as fallback seed
// ==========================================
// Real-time spot metals, no API key required: https://gold-api.com/docs
const goldApiRequestsInFlight = new Set();

function fetchGoldApiSpot(sym, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  const apiSymbol = GOLD_API_SYMBOLS[sym];
  if (!apiSymbol || goldApiRequestsInFlight.has(sym)) return done(null);

  goldApiRequestsInFlight.add(sym);
  const options = {
    hostname: 'api.gold-api.com',
    path: `/price/${apiSymbol}`,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'AlphaGoldDashboard/1.0'
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      goldApiRequestsInFlight.delete(sym);
      try {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          console.warn(`[Gold API] ${sym} returned HTTP ${res.statusCode}`);
          return done(null);
        }

        const price = Number(JSON.parse(data).price);
        if (Number.isFinite(price) && price > 0) {
          applyRealPrice(sym, price);
          return done(price);
        }
      } catch (e) {
        console.warn(`[Gold API] Invalid response for ${sym}:`, e.message);
      }
      done(null);
    });
  });

  req.on('error', (err) => {
    goldApiRequestsInFlight.delete(sym);
    console.warn(`[Gold API] Request error ${sym}:`, err.message);
    done(null);
  });
  req.setTimeout(5000, () => req.destroy(new Error('Gold API timeout')));
  req.end();
}

function fetchYahooSeed(sym, callback, apply = true) {
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
          if (apply) {
            const adjustedPrice = price + (sourceOffsets[sym] || 0);
            applyRealPrice(sym, adjustedPrice);
            console.log(`[Yahoo seed] ${sym}: GC=$${price}, Offset=${(sourceOffsets[sym]||0).toFixed(4)}, Adjusted=$${currentPrices[sym]}`);
          }
          if (callback) callback(price);
        } else {
          fallbackToPaxgIfNeeded(sym, callback);
        }
      } catch(e) {
        console.error(`[Yahoo seed] Error ${sym}:`, e.message);
        fallbackToPaxgIfNeeded(sym, callback);
      }
    });
  });
  req.on('error', () => {
    fallbackToPaxgIfNeeded(sym, callback);
  });
  req.setTimeout(8000, () => req.destroy());
  req.end();
}

async function fetchYahooM1Candles(sym) {
  const ticker = YAHOO_TICKERS[sym];
  if (!ticker) return [];
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
  const response = await fetchJson(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) throw new Error(`Yahoo chart returned HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart returned no candle data');
  return normalizeYahooM1Candles(result, currentPrices[sym]);
}

let xauM1RecoveryPromise = null;
function requestXauM1Recovery(reason, processEngine = false) {
  if (xauM1RecoveryPromise) return xauM1RecoveryPromise;

  recoveringM1Symbols.add('XAUUSD');
  xauM1RecoveryPromise = (async () => {
    const currentMinute = minuteBucket();
    const previousHistory = candleHistory.XAUUSD?.M1 || [];
    const previousLatestTime = Number(previousHistory[previousHistory.length - 1]?.time) || 0;

    try {
      const remoteCandles = await fetchYahooM1Candles('XAUUSD');
      const merged = mergeClosedM1Candles(
        previousHistory,
        remoteCandles,
        currentMinute,
        CHART_HISTORY_LIMIT
      );
      const recovered = merged.filter(candle => candle.time > previousLatestTime);
      candleHistory.XAUUSD.M1 = merged;
      const rebuiltActive = createActiveM1Candle(merged, currentPrices.XAUUSD);
      const previousActive = activeCandles.XAUUSD.M1;
      activeCandles.XAUUSD.M1 = processEngine
        && rebuiltActive
        && previousActive?.time === rebuiltActive.time
        ? {
            ...rebuiltActive,
            high: Math.max(rebuiltActive.high, Number(previousActive.high) || rebuiltActive.high),
            low: Math.min(rebuiltActive.low, Number(previousActive.low) || rebuiltActive.low)
          }
        : rebuiltActive;

      // During a live outage, replay recovered closed bars through the backend
      // engine in chronological order. Startup restoration establishes a fresh
      // baseline instead and therefore sets processEngine=false.
      if (processEngine && backendM1Engine && recovered.length > 0) {
        recovered.forEach((closedCandle) => {
          const historyThroughCandle = merged.filter(candle => candle.time <= closedCandle.time);
          const nextMinute = closedCandle.time + INTERVAL_SECONDS.M1;
          const syntheticActive = {
            time: nextMinute,
            open: closedCandle.close,
            high: closedCandle.close,
            low: closedCandle.close,
            close: closedCandle.close
          };
          backendM1Engine.onClosedCandle([...historyThroughCandle, syntheticActive], closedCandle);
        });
      }

      scheduleXauM1CheckpointSave();
      if (recovered.length > 0) {
        io.emit('history_recovered', {
          ticker: 'XAUUSD',
          interval: 'M1',
          recoveredCount: recovered.length,
          lastClosedTime: merged.at(-1)?.time || null,
          reason
        });
      }
      console.log(`[Market Data] XAUUSD M1 ${reason}: recovered ${recovered.length} closed candles.`);
      return recovered.length;
    } catch (error) {
      // Do not bridge an old candle to a new price if the recovery provider is
      // temporarily unavailable. Realtime resumes in a fresh minute and the
      // missing interval will be retried by the continuity watchdog.
      activeCandles.XAUUSD.M1 = createActiveM1Candle(previousHistory, currentPrices.XAUUSD);
      console.error(`[Market Data] XAUUSD M1 ${reason} backfill failed:`, error.message);
      return 0;
    } finally {
      recoveringM1Symbols.delete('XAUUSD');
      xauM1RecoveryPromise = null;
    }
  })();

  return xauM1RecoveryPromise;
}

let lastPaxgPrice = null;
function fallbackToPaxgIfNeeded(sym, callback) {
  if (sym !== 'XAUUSD') {
    if (callback) callback(null);
    return;
  }
  const options = {
    hostname: 'api.binance.com',
    path: '/api/v3/ticker/price?symbol=PAXGUSDT',
    method: 'GET'
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const paxgPrice = parseFloat(JSON.parse(data).price);
        if (paxgPrice && !isNaN(paxgPrice)) {
          if (lastPaxgPrice && currentPrices['XAUUSD']) {
            const delta = paxgPrice - lastPaxgPrice;
            if (delta !== 0) {
              const newPrice = currentPrices['XAUUSD'] + delta;
              applyRealPrice('XAUUSD', newPrice);
              console.log(`[PAXG Fallback] XAUUSD updated via PAXG delta: $${newPrice.toFixed(2)}`);
              if (callback) callback(newPrice);
            } else {
               lastTickTimestamp['XAUUSD'] = Date.now();
               if (callback) callback(currentPrices['XAUUSD']);
            }
          } else {
            if (!currentPrices['XAUUSD']) {
               applyRealPrice('XAUUSD', paxgPrice);
               if (callback) callback(paxgPrice);
            } else {
               if (callback) callback(currentPrices['XAUUSD']);
            }
          }
          lastPaxgPrice = paxgPrice;
        } else {
          if (callback) callback(null);
        }
      } catch(e) {
        if (callback) callback(null);
      }
    });
  });
  req.on('error', () => { if (callback) callback(null); });
  req.setTimeout(5000, () => req.destroy());
  req.end();
}

const KRAKEN_REST_MAP = {
  'BTCUSD': { pair: 'XBTUSD', resultKey: 'XXBTZUSD' },
  'ETHUSD': { pair: 'ETHUSD', resultKey: 'XETHZUSD' }
};

function fetchKrakenSeed(sym, callback) {
  const cfg = KRAKEN_REST_MAP[sym];
  if (!cfg) return callback ? callback(null) : null;

  const options = {
    hostname: 'api.kraken.com',
    path: `/0/public/Ticker?pair=${cfg.pair}`,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.error && json.error.length > 0) {
          console.error(`[Kraken seed] Error ${sym}:`, json.error);
          return callback ? callback(null) : null;
        }
        const ticker = json.result[cfg.resultKey];
        if (ticker && ticker.c && ticker.c[0]) {
          const price = parseFloat(ticker.c[0]);
          if (price && !isNaN(price)) {
            applyRealPrice(sym, price);
            console.log(`[Kraken seed] ${sym}: $${currentPrices[sym]}`);
            if (callback) callback(price);
            return;
          }
        }
      } catch (e) {
        console.error(`[Kraken seed] Parse error ${sym}:`, e.message);
      }
      if (callback) callback(null);
    });
  });

  req.on('error', (err) => {
    console.error(`[Kraken seed] Request error ${sym}:`, err.message);
    if (callback) callback(null);
  });
  req.setTimeout(5000, () => req.destroy());
  req.end();
}

function fetchKrakenMulti(symbols, callback) {
  const pairs = symbols.map(s => KRAKEN_REST_MAP[s]?.pair).filter(Boolean);
  if (pairs.length === 0) return callback ? callback() : null;

  const options = {
    hostname: 'api.kraken.com',
    path: `/0/public/Ticker?pair=${pairs.join(',')}`,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0' }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.error && json.error.length > 0) {
          if (callback) callback();
          return;
        }
        symbols.forEach(sym => {
          const cfg = KRAKEN_REST_MAP[sym];
          if (!cfg) return;
          const ticker = json.result[cfg.resultKey];
          if (ticker && ticker.c && ticker.c[0]) {
            const price = parseFloat(ticker.c[0]);
            if (price && !isNaN(price)) {
              applyRealPrice(sym, price);
            }
          }
        });
      } catch (e) {
        // ignore
      }
      if (callback) callback();
    });
  });

  req.on('error', () => {
    if (callback) callback();
  });
  req.setTimeout(5000, () => req.destroy());
  req.end();
}

// ==========================================
// Delayed History Init — wait for real prices before building candle history
// ==========================================
const seedsNeeded = new Set(SYMBOLS);
let historyInitialized = false;
let marketStateReady = false;

function onSeedReceived(sym) {
  seedsNeeded.delete(sym);
  if (seedsNeeded.size === 0 && !historyInitialized) {
    historyInitialized = true;
    initializeCandles();
  }
}

// Seed ALL symbols on startup with proper sources to avoid price jump
SYMBOLS.forEach(sym => {
  const isBinance = BINANCE_STREAMS[sym] !== undefined;
  if (isBinance) {
    // 1. Try Binance first
    fetchBinanceSeed(sym, (price) => {
      if (price) {
        onSeedReceived(sym);
      } else {
        // 2. Try Kraken (spot/PAXG) second
        fetchKrakenSeed(sym, (krakenPrice) => {
          if (krakenPrice) {
            onSeedReceived(sym);
          } else {
            // 3. Fallback to Yahoo (futures/GC=F) as last resort
            fetchYahooSeed(sym, () => onSeedReceived(sym));
          }
        });
      }
    });
  } else {
    // Prefer OANDA/Finnhub. If unavailable, use another spot feed before
    // falling all the way back to Yahoo futures (GC=F / SI=F).
    fetchFinnhubSeed(sym, (price) => {
      if (price) {
        onSeedReceived(sym);
      } else if (GOLD_API_SYMBOLS[sym]) {
        fetchGoldApiSpot(sym, (spotPrice) => {
          if (spotPrice) {
            onSeedReceived(sym);
          } else {
            fetchYahooSeed(sym, () => onSeedReceived(sym));
          }
        });
      } else {
        fetchYahooSeed(sym, () => onSeedReceived(sym));
      }
    });
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

// Yahoo/Kraken fallback polling — ENABLED for live price updates in free tier
let yahooFallbackInterval = null;
function startYahooFallback() {
  if (yahooFallbackInterval) return;
  console.log('[Spot/Yahoo/Kraken] Backend fallback activated — polling every 3s independently of browser clients...');
  yahooFallbackInterval = setInterval(() => {
    if (isMarketClosed()) return;
    
    const krakenActive = krakenConnected;
    const binanceActive = binanceWs && binanceWs.readyState === 1;

    // Check if we need to poll Kraken for BTC/ETH
    const pollSyms = [];
    if (!binanceActive && !krakenActive) {
      pollSyms.push('BTCUSD');
      pollSyms.push('ETHUSD');
    }

    if (pollSyms.length > 0) {
      fetchKrakenMulti(pollSyms);
    }

    // WTIUSD is always polled from Yahoo.
    setTimeout(() => fetchYahooSeed('WTIUSD'), 0);
    
    const now = Date.now();

    // Keep XAU/XAG on a spot feed. Gold API is used when Finnhub/OANDA is
    // unavailable or has connected but stopped delivering trades.
    ['XAUUSD', 'XAGUSD'].forEach(sym => {
      const finnhubIsFresh = finnhubConnected && (now - (lastFinnhubTickAt[sym] || 0) < 7000);
      if (!finnhubIsFresh) fetchGoldApiSpot(sym);
    });

    // Yahoo is the final fallback only: GC=F/SI=F are futures contracts and
    // can legitimately differ from the XAUUSD/XAGUSD spot price.
    if (!FINNHUB_TOKEN) {
      if (now - (lastTickTimestamp['XAUUSD'] || 0) > 15000) setTimeout(() => fetchYahooSeed('XAUUSD'), 1500);
      if (now - (lastTickTimestamp['XAGUSD'] || 0) > 15000) setTimeout(() => fetchYahooSeed('XAGUSD'), 3000);
    } else {
      // Multi-layer fallback
      if (now - (lastTickTimestamp['XAUUSD'] || 0) > 30000) {
        // Tầng 3: Finnhub chết hoàn toàn > 30s -> Dùng Yahoo + Spread Bù Trừ
        setTimeout(() => fetchYahooSeed('XAUUSD'), 1500);
      } else if (now - (lastTickTimestamp['XAUUSD'] || 0) > 15000) {
        // Tầng 2: Mất tín hiệu 15s -> Gọi Finnhub REST (để giữ nguyên giá OANDA)
        setTimeout(() => fetchFinnhubSeed('XAUUSD'), 1500);
      }
      
      if (now - (lastTickTimestamp['XAGUSD'] || 0) > 30000) {
        setTimeout(() => fetchYahooSeed('XAGUSD'), 3000);
      } else if (now - (lastTickTimestamp['XAGUSD'] || 0) > 15000) {
        setTimeout(() => fetchFinnhubSeed('XAGUSD'), 3000);
      }
    }
  }, 3000);
}

function stopYahooFallback() {
  if (yahooFallbackInterval) {
    clearInterval(yahooFallbackInterval);
    yahooFallbackInterval = null;
    console.log('[Yahoo] Fallback stopped');
  }
}

// ==========================================
// FINNHUB WebSocket — Real-time commodities
// OANDA data feed: ~2-3s delay (same source as TradingView)
// Register free at https://finnhub.io
// Set env var: FINNHUB_TOKEN=your_key_here
// ==========================================

// (FINNHUB_SYMBOL_MAP & FINNHUB_SUBSCRIBE declared above fetchFinnhubSeed)

let finnhubWs = null;
let finnhubConnected = false;
let finnhubRetryDelay = 5000;
const lastFinnhubTickAt = { XAUUSD: 0, XAGUSD: 0 };

let spreadTrackerInterval = null;
function startSpreadTracker() {
  if (spreadTrackerInterval) return;
  console.log('[Spread Tracker] Activated — monitoring Finnhub vs Yahoo offsets...');
  spreadTrackerInterval = setInterval(() => {
    if (!FINNHUB_TOKEN || !finnhubConnected) return; // Only track spread when Finnhub is healthy
    const syms = ['XAUUSD', 'XAGUSD'];
    syms.forEach(sym => {
      const finnhubPrice = currentPrices[sym];
      if (finnhubPrice) {
        // Fetch Yahoo price without applying it to the chart
        fetchYahooSeed(sym, (yahooPrice) => {
          if (yahooPrice) {
            sourceOffsets[sym] = finnhubPrice - yahooPrice;
            // console.log(`[Spread Tracker] ${sym} Spread updated: ${sourceOffsets[sym].toFixed(4)}`);
          }
        }, false);
      }
    });
  }, 120000); // Check every 2 minutes
}

function connectFinnhub() {
  if (!FINNHUB_TOKEN) {
    console.warn('[Finnhub WS] No token provided. Falling back to Yahoo.');
    startYahooFallback();
    return;
  }

  const url = `wss://ws.finnhub.io?token=${FINNHUB_TOKEN}`;
  finnhubWs = new WebSocket(url);

  finnhubWs.on('open', () => {
    console.log('[Finnhub WS] Connected — streaming XAUUSD/XAGUSD real-time');
    finnhubConnected = true;
    finnhubRetryDelay = 5000;

    FINNHUB_SUBSCRIBE.forEach(sym => {
      finnhubWs.send(JSON.stringify({'type': 'subscribe', 'symbol': sym}));
    });
    
    // Also start Yahoo fallback for WTIUSD only (since Finnhub WS doesn't have free WTIUSD)
    startYahooFallback();
    // Start the dynamic spread tracker
    startSpreadTracker();
  });

  finnhubWs.on('message', (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'trade') {
        parsed.data.forEach(trade => {
          let symbol = trade.s;
          if (FINNHUB_SYMBOL_MAP[symbol]) {
            symbol = FINNHUB_SYMBOL_MAP[symbol];
          }
          const price = parseFloat(trade.p);
          if (price) {
            lastFinnhubTickAt[symbol] = Date.now();
            applyRealPrice(symbol, price);
            lastTickTimestamp[symbol] = Date.now();
            
            // If this is the first real tick, initialize the seed
            if (!historyInitialized) {
              onSeedReceived(symbol);
            }
          }
        });
      }
    } catch (e) {}
  });

  finnhubWs.on('close', (code) => {
    finnhubConnected = false;
    console.warn(`[Finnhub WS] Disconnected (${code}) — reconnecting in ${finnhubRetryDelay/1000}s...`);
    setTimeout(connectFinnhub, finnhubRetryDelay);
    finnhubRetryDelay = Math.min(finnhubRetryDelay * 1.5, 60000);
  });

  finnhubWs.on('error', (err) => {
    console.error('[Finnhub WS] Error:', err.message);
  });
}

connectFinnhub();

// ==========================================
// 1-Second Candle Tick Loop
// Uses currentPrices (already synced by Binance WS or Yahoo)
// No random simulation — pure real prices
//
// PERFORMANCE: candle_update is throttled per-timeframe:
//   M1  → every 1s  (always)
//   M5  → every 5s  (now % 5 === 0)
//   M15 → every 15s (now % 15 === 0)
//   H1  → every 60s (now % 60 === 0)
// price_update only fires when price actually changed.
// ==========================================

// Track last broadcast second per timeframe to avoid redundant emits
const lastCandleBroadcast = {};
SYMBOLS.forEach(s => { lastCandleBroadcast[s] = {}; });

// Track last emitted price to suppress duplicate price_update events
const lastEmittedPrice = {};
let backendM1Engine = null;

setInterval(() => {
  // Guard: candles aren't ready yet (waiting on seed prices / init timeout).
  if (!historyInitialized || !marketStateReady) return;

  const now = Math.floor(Date.now() / 1000);
  const marketClosed = isMarketClosed();

  SYMBOLS.forEach((sym) => {
    if (sym === 'XAUUSD' && recoveringM1Symbols.has(sym)) return;
    const isCrypto = sym.includes('BTC') || sym.includes('ETH');
    const isCommodity = !isCrypto;

    // Market closed: freeze commodity candles dynamically (weekend or inactivity/holiday)
    if (isSymbolClosedDynamic(sym)) {
      return;
    }

    const price = currentPrices[sym];

    Object.keys(INTERVAL_SECONDS).forEach((tf) => {
      const seconds = INTERVAL_SECONDS[tf];
      const expectedTime = Math.floor(now / seconds) * seconds;
      const active = activeCandles[sym][tf];

      // Defensive guard: self-heal if slot is somehow uninitialized
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

      const isNewCandle = expectedTime > active.time;

      if (isNewCandle) {
        // New candle: archive old one
        const closedCandle = { ...active };
        candleHistory[sym][tf].push(closedCandle);
        if (candleHistory[sym][tf].length > CHART_HISTORY_LIMIT) candleHistory[sym][tf].shift();

        activeCandles[sym][tf] = {
          time:  expectedTime,
          open:  active.close,
          high:  price,
          low:   price,
          close: price
        };

        if (sym === 'XAUUSD' && tf === 'M1' && backendM1Engine) {
          const engineHistory = [
            ...candleHistory.XAUUSD.M1.map(candle => ({ ...candle })),
            { ...activeCandles.XAUUSD.M1 }
          ];
          backendM1Engine.onClosedCandle(engineHistory, closedCandle);
          scheduleXauM1CheckpointSave();
        }
      } else {
        active.close = price;
        active.high  = Math.max(active.high, price);
        active.low   = Math.min(active.low,  price);
      }

      // Throttle: only emit candle_update at the natural interval boundary
      // M1 → every second, M5 → every 5s, M15 → every 15s, H1 → every 60s
      const shouldBroadcast = isNewCandle || (now % seconds === 0) || tf === 'M1';
      if (shouldBroadcast) {
        const lastBcast = lastCandleBroadcast[sym][tf] || 0;
        // For M1: always broadcast. For others: only when the slot time changed.
        if (tf === 'M1' || activeCandles[sym][tf].time !== lastBcast) {
          lastCandleBroadcast[sym][tf] = activeCandles[sym][tf].time;
          io.emit('candle_update', {
            ticker:   sym,
            interval: tf,
            candle:   activeCandles[sym][tf]
          });
        }
      }
    });

    // price_update: only emit when price actually changed (avoids flooding)
    if (lastEmittedPrice[sym] !== price) {
      lastEmittedPrice[sym] = price;
      if (sym === 'XAUUSD' && backendM1Engine) {
        const engineHistory = activeCandles.XAUUSD.M1
          ? [...candleHistory.XAUUSD.M1.map(candle => ({ ...candle })), { ...activeCandles.XAUUSD.M1 }]
          : [];
        backendM1Engine.ensureBaseline(engineHistory);
        backendM1Engine.onPrice(price, Date.now());
      }
      io.emit('price_update', {
        ticker:       sym,
        currentPrice: price
      });
    }
  });
}, 1000);

// Detect holes independently of browser connections. A fresh price with a
// missing closed minute means candle recovery must complete before charting.
setInterval(() => {
  if (!historyInitialized || !marketStateReady || isMarketClosed()) return;
  const lastTickAt = lastTickTimestamp.XAUUSD || 0;
  if (!lastTickAt || Date.now() - lastTickAt > FEED_STALE_AFTER_MS) return;
  const currentMinute = minuteBucket();
  const history = candleHistory.XAUUSD?.M1 || [];
  const latestClosedMinute = Number(history[history.length - 1]?.time) || 0;
  if (latestClosedMinute < currentMinute - INTERVAL_SECONDS.M1) {
    requestXauM1Recovery('continuity_watchdog', true);
  }
}, 15000);

// ==========================================
// Authentication & User DB (MongoDB + Local Fallback)
// ==========================================
const { MongoClient } = require('mongodb');
const usersFilePath = path.join(__dirname, 'users.json');

const MONGODB_URI = process.env.MONGODB_URI;
let db = null;
let useMongoDB = false;
const globalSignalHistoryFilePath = path.join(__dirname, 'global_signal_history.json');
const GLOBAL_SIGNAL_HISTORY_LIMIT = 50;
const GLOBAL_SIGNAL_SYSTEMS = new Set(['zen', 'utbot', 'chandelier', 'trendline']);
const GLOBAL_SIGNAL_OUTCOMES = new Set(['running', 'win', 'loss', 'breakeven', 'expired']);

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeGlobalSignalRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 180) : '';
  const indicatorSystem = String(raw.indicatorSystem || '').toLowerCase();
  const action = String(raw.action || '').toLowerCase();
  const signalTime = optionalFiniteNumber(raw.signalTime);
  const entry = optionalFiniteNumber(raw.entry);
  const sl = optionalFiniteNumber(raw.sl);
  const outcome = GLOBAL_SIGNAL_OUTCOMES.has(raw.outcome) ? raw.outcome : 'running';
  const tps = Array.isArray(raw.tps)
    ? raw.tps.slice(0, 2).map(optionalFiniteNumber).filter(value => value !== null)
    : [];

  if (!id || raw.symbol !== 'XAUUSD' || raw.timeframe !== 'M1') return null;
  if (!GLOBAL_SIGNAL_SYSTEMS.has(indicatorSystem) || !['buy', 'sell'].includes(action)) return null;
  if (!signalTime || !entry || !sl || tps.length === 0) return null;

  return {
    id,
    symbol: 'XAUUSD',
    timeframe: 'M1',
    indicatorSystem,
    indicatorLabel: String(raw.indicatorLabel || indicatorSystem).slice(0, 40),
    action,
    entry,
    sl,
    tps,
    confidence: optionalFiniteNumber(raw.confidence) || 0,
    sourceTimestamp: optionalFiniteNumber(raw.sourceTimestamp) || signalTime,
    signalTime,
    expiresAt: optionalFiniteNumber(raw.expiresAt),
    recordedAt: optionalFiniteNumber(raw.recordedAt) || signalTime,
    outcome,
    status: String(raw.status || (outcome === 'running' ? 'running' : outcome)).slice(0, 30),
    hitTp1: Boolean(raw.hitTp1),
    closeTime: optionalFiniteNumber(raw.closeTime),
    exitPrice: optionalFiniteNumber(raw.exitPrice),
    closeReason: raw.closeReason ? String(raw.closeReason).slice(0, 30) : null,
    expiryReason: raw.expiryReason ? String(raw.expiryReason).slice(0, 30) : null
  };
}

function loadGlobalSignalHistoryFromFile() {
  try {
    if (!fs.existsSync(globalSignalHistoryFilePath)) return [];
    const records = JSON.parse(fs.readFileSync(globalSignalHistoryFilePath, 'utf8'));
    return Array.isArray(records) ? records.map(sanitizeGlobalSignalRecord).filter(Boolean) : [];
  } catch (error) {
    console.error('[Global Signal History] Local load failed:', error.message);
    return [];
  }
}

function saveGlobalSignalHistoryToFile(records) {
  try {
    fs.writeFileSync(globalSignalHistoryFilePath, JSON.stringify(records, null, 2), 'utf8');
  } catch (error) {
    console.error('[Global Signal History] Local save failed:', error.message);
  }
}

async function loadGlobalSignalHistory() {
  await dbReadyPromise;
  if (useMongoDB) {
    try {
      const document = await db.collection('global_signal_history').findOne({ _id: 'website' });
      return Array.isArray(document?.records)
        ? document.records.map(sanitizeGlobalSignalRecord).filter(Boolean)
        : [];
    } catch (error) {
      console.error('[Global Signal History] MongoDB load failed:', error.message);
    }
  }
  return loadGlobalSignalHistoryFromFile();
}

async function saveGlobalSignalHistory(records) {
  await dbReadyPromise;
  const normalized = records
    .map(sanitizeGlobalSignalRecord)
    .filter(Boolean)
    .sort((a, b) => Number(b.signalTime) - Number(a.signalTime) || Number(b.recordedAt) - Number(a.recordedAt))
    .slice(0, GLOBAL_SIGNAL_HISTORY_LIMIT);

  if (useMongoDB) {
    try {
      await db.collection('global_signal_history').updateOne(
        { _id: 'website' },
        { $set: { records: normalized, updatedAt: new Date() } },
        { upsert: true }
      );
      return normalized;
    } catch (error) {
      console.error('[Global Signal History] MongoDB save failed:', error.message);
    }
  }

  saveGlobalSignalHistoryToFile(normalized);
  return normalized;
}

// Synchronous helper for local file load (used as fallback or for migration seed)
function loadUsersFromFile() {
  try {
    if (!fs.existsSync(usersFilePath)) {
      const defaultAdminPassword = hashPassword('gold123');
      const defaultUsers = [{ username: 'admin', password: defaultAdminPassword, name: 'Admin Account', role: 'Administrator' }];
      fs.writeFileSync(usersFilePath, JSON.stringify(defaultUsers, null, 2), 'utf8');
      return defaultUsers;
    }
    return JSON.parse(fs.readFileSync(usersFilePath, 'utf8'));
  } catch (e) { return []; }
}

function saveUsersToFile(users) {
  try { fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8'); } catch (e) {}
}

async function connectDB() {
  if (!MONGODB_URI) {
    console.log('[Database] MONGODB_URI not set. Running with local users.json fallback.');
    return;
  }
  try {
    const client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    await client.connect();
    db = client.db();
    useMongoDB = true;
    console.log('[MongoDB] Connected successfully to the remote database.');

    // Auto-Migration: Seed MongoDB from users.json if empty
    const mongoCount = await db.collection('users').countDocuments();
    if (mongoCount === 0) {
      const localUsers = loadUsersFromFile();
      if (localUsers.length > 0) {
        console.log(`[MongoDB] Database is empty. Migrating ${localUsers.length} users from users.json...`);
        await db.collection('users').insertMany(localUsers);
        console.log('[MongoDB] Migration completed successfully.');
      }
    }

    // Auto-Upgrade admin & john to SuperAdmin in MongoDB if they exist
    try {
      const adminUser = await db.collection('users').findOne({ username: 'admin' });
      if (adminUser && adminUser.role !== 'SuperAdmin') {
        await db.collection('users').updateOne(
          { username: 'admin' },
          { $set: { role: 'SuperAdmin', refCode: 'gold77', telegramSupport: 'https://t.me/alphagoldhelper' } }
        );
        console.log('[Database] Auto-upgraded admin to SuperAdmin in MongoDB.');
      }
      
      const johnUser = await db.collection('users').findOne({ username: 'john' });
      if (johnUser && johnUser.role !== 'SuperAdmin') {
        await db.collection('users').updateOne(
          { username: 'john' },
          { $set: { role: 'SuperAdmin', refCode: 'john88', telegramSupport: 'https://t.me/alphagoldhelper' } }
        );
        console.log('[Database] Auto-upgraded john to SuperAdmin in MongoDB.');
      }
    } catch (dbErr) {
      console.error('[Database] Failed to auto-upgrade admins on startup:', dbErr.message);
    }
  } catch (err) {
    console.error('[MongoDB] Connection failed on startup. Falling back to local file. Error:', err.message);
  }
}
const dbReadyPromise = connectDB();

const marketCheckpointFilePath = path.join(__dirname, 'xauusd_m1_checkpoint.json');
let marketCheckpointSaveTimer = null;

async function loadXauM1Checkpoint() {
  await dbReadyPromise;
  try {
    let raw = null;
    if (useMongoDB) {
      raw = await db.collection('market_candle_checkpoints').findOne({ _id: 'XAUUSD:M1' });
    } else if (fs.existsSync(marketCheckpointFilePath)) {
      raw = JSON.parse(fs.readFileSync(marketCheckpointFilePath, 'utf8'));
    }
    return sanitizeCheckpoint(raw, minuteBucket(), CHART_HISTORY_LIMIT);
  } catch (error) {
    console.error('[Market Data] Failed to load XAUUSD M1 checkpoint:', error.message);
    return null;
  }
}

async function saveXauM1Checkpoint() {
  if (!historyInitialized) return;
  await dbReadyPromise;
  const checkpoint = {
    history: (candleHistory.XAUUSD?.M1 || []).slice(-CHART_HISTORY_LIMIT),
    active: activeCandles.XAUUSD?.M1 || null,
    lastPrice: currentPrices.XAUUSD,
    updatedAt: Date.now()
  };

  try {
    if (useMongoDB) {
      await db.collection('market_candle_checkpoints').updateOne(
        { _id: 'XAUUSD:M1' },
        { $set: checkpoint },
        { upsert: true }
      );
    } else {
      fs.writeFileSync(marketCheckpointFilePath, JSON.stringify(checkpoint), 'utf8');
    }
  } catch (error) {
    console.error('[Market Data] Failed to save XAUUSD M1 checkpoint:', error.message);
  }
}

function scheduleXauM1CheckpointSave() {
  if (marketCheckpointSaveTimer) clearTimeout(marketCheckpointSaveTimer);
  marketCheckpointSaveTimer = setTimeout(() => {
    marketCheckpointSaveTimer = null;
    saveXauM1Checkpoint().catch((error) => {
      console.error('[Market Data] Checkpoint save failed:', error.message);
    });
  }, 250);
  marketCheckpointSaveTimer.unref?.();
}

function waitForHistoryInitialization() {
  if (historyInitialized) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!historyInitialized) return;
      clearInterval(timer);
      resolve();
    }, 100);
    timer.unref?.();
  });
}

async function bootstrapMarketState() {
  try {
    await dbReadyPromise;
    await waitForHistoryInitialization();
    const checkpoint = await loadXauM1Checkpoint();
    if (checkpoint) {
      candleHistory.XAUUSD.M1 = mergeClosedM1Candles(
        [],
        checkpoint.history,
        minuteBucket(),
        CHART_HISTORY_LIMIT
      );
      activeCandles.XAUUSD.M1 = checkpoint.active
        || createActiveM1Candle(candleHistory.XAUUSD.M1, currentPrices.XAUUSD);
      console.log(`[Market Data] Restored ${candleHistory.XAUUSD.M1.length} XAUUSD M1 candles from checkpoint.`);
    }

    await requestXauM1Recovery('startup_backfill', false);
  } catch (error) {
    console.error('[Market Data] Startup recovery failed:', error.message);
  } finally {
    marketStateReady = true;
    scheduleXauM1CheckpointSave();
    console.log('[Market Data] XAUUSD M1 market state is ready.');
  }
}

backendM1Engine = createM1SignalEngine({
  loadRecords: loadGlobalSignalHistory,
  saveRecords: saveGlobalSignalHistory,
  broadcast: (records) => io.emit('global_signal_history_updated', { scope: 'website', records }),
  logger: console
});
backendM1Engine.initialize().catch((error) => {
  console.error('[M1 Engine] Initialization failed:', error.message);
});
bootstrapMarketState();

async function loadUsers() {
  if (useMongoDB) {
    try {
      return await db.collection('users').find({}).toArray();
    } catch (e) {
      console.error('[MongoDB] Load failed, using users.json fallback:', e.message);
      return loadUsersFromFile();
    }
  }
  return loadUsersFromFile();
}

async function saveUsers(users) {
  if (useMongoDB) {
    try {
      await db.collection('users').deleteMany({});
      if (users.length > 0) {
        await db.collection('users').insertMany(users);
      }
      return;
    } catch (e) {
      console.error('[MongoDB] Save failed, saving locally to users.json:', e.message);
      saveUsersToFile(users);
    }
  } else {
    saveUsersToFile(users);
  }
}

// ==========================================
// Audit Logs & checkAdminGuard Helpers
// ==========================================
const auditLogsFilePath = path.join(__dirname, 'audit_logs.json');

function loadAuditLogsFromFile() {
  try {
    if (!fs.existsSync(auditLogsFilePath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(auditLogsFilePath, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveAuditLogsToFile(logs) {
  try {
    fs.writeFileSync(auditLogsFilePath, JSON.stringify(logs, null, 2), 'utf8');
  } catch (e) {}
}

async function loadAuditLogs() {
  if (useMongoDB) {
    try {
      return await db.collection('audit_logs').find({}).sort({ timestamp: -1 }).toArray();
    } catch (e) {
      console.error('[MongoDB] Load audit logs failed, falling back:', e.message);
      return loadAuditLogsFromFile();
    }
  }
  return loadAuditLogsFromFile();
}

async function saveAuditLogs(logs) {
  if (useMongoDB) {
    try {
      await db.collection('audit_logs').deleteMany({});
      if (logs.length > 0) {
        await db.collection('audit_logs').insertMany(logs);
      }
      return;
    } catch (e) {
      console.error('[MongoDB] Save audit logs failed, falling back:', e.message);
      saveAuditLogsToFile(logs);
    }
  } else {
    saveAuditLogsToFile(logs);
  }
}

async function logActivity(actor, action, target, details, ip) {
  const log = {
    timestamp: new Date().toISOString(),
    actor,
    action,
    target,
    details,
    ip
  };
  const logs = await loadAuditLogs();
  logs.unshift(log);
  if (logs.length > 500) logs.pop();
  await saveAuditLogs(logs);
}

async function checkAdminGuard(req, res, next) {
  const targetUsername = (req.params.username || '').toLowerCase();
  const isSelf = req.user && req.user.username.toLowerCase() === targetUsername;

  // 1. If modifying self -> allowed immediately
  if (isSelf) {
    return next();
  }

  // Load users to check target user details
  const users = await loadUsers();
  const targetUser = users.find(u => u.username.toLowerCase() === targetUsername);

  if (!targetUser) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  // 2. If target is a SuperAdmin
  if (targetUser.role === 'SuperAdmin') {
    // A SuperAdmin cannot touch another SuperAdmin's account at all
    return res.status(403).json({ success: false, error: 'Forbidden: Bạn không thể chỉnh sửa hoặc xóa tài khoản của Super Admin khác.' });
  }

  // 3. If current user is SuperAdmin -> can modify any other regular admin/employee/user
  if (req.user.role === 'SuperAdmin') {
    return next();
  }

  // 4. Regular Administrator: can only modify users they created
  if (req.user.role === 'Administrator') {
    if (targetUser.createdBy !== req.user.username) {
      return res.status(403).json({ success: false, error: 'Forbidden: Bạn chỉ có quyền sửa hoặc xóa tài khoản do chính bạn tạo ra.' });
    }
    return next();
  }

  // 5. Employees or normal Users are blocked from modifying anyone else
  return res.status(403).json({ success: false, error: 'Forbidden: Bạn không có quyền thực hiện thao tác này.' });
}

// Telegram Bot Integration & Auto-Execution Logic
// ==========================================

const { initTelegramBot, sendTelegramNotification, broadcastManualSignalAlert } = require('./telegramBot');

initTelegramBot({
  loadUsers,
  saveUsers,
  getDb: () => db,
  getUseMongoDB: () => useMongoDB,
  vpsManager,
  decryptPassword,
  encryptPassword,
  getSignals: () => signals,
  getCurrentPrices: () => currentPrices,
  getTcpClients: () => tcpClients,
  calculateCustomSlTp
});

function calculateCustomSlTp(action, entryPrice, slPoints, tpPoints, symbol) {
  const isBuy = String(action).toLowerCase() === 'buy';
  const entry = parseFloat(entryPrice);
  if (isNaN(entry)) return { slPrice: 0, tpPrice: 0 };
  
  let pointValue = 0.01; // default
  const sym = String(symbol).toUpperCase();
  if (sym.includes('XAU') || sym.includes('GOLD')) {
    pointValue = 0.1;
  } else if (sym.includes('BTC')) {
    pointValue = 1.0;
  } else if (sym.includes('ETH')) {
    pointValue = 0.1;
  } else if (sym.includes('WTI') || sym.includes('OIL')) {
    pointValue = 0.01;
  } else if (sym.includes('XAG') || sym.includes('SILVER')) {
    pointValue = 0.01;
  } else {
    if (entry > 1000) pointValue = 1.0;
    else if (entry > 100) pointValue = 0.1;
    else pointValue = 0.01;
  }
  
  let slPrice = 0;
  let tpPrice = 0;
  
  if (slPoints && slPoints > 0) {
    slPrice = isBuy ? (entry - slPoints * pointValue) : (entry + slPoints * pointValue);
    slPrice = parseFloat(slPrice.toFixed(5));
  }
  if (tpPoints && tpPoints > 0) {
    tpPrice = isBuy ? (entry + tpPoints * pointValue) : (entry - tpPoints * pointValue);
    tpPrice = parseFloat(tpPrice.toFixed(5));
  }
  
  return { slPrice, tpPrice };
}

async function executeSignalOnAllAccounts(signal) {
  const { ticker, action, entry, sl, tp } = signal;
  console.log(`[Auto-Execution] Processing signal for ${ticker} (${action}) - Entry: ${entry}, SL: ${sl}, TP: ${tp}`);
  
  let symbol = ticker;
  if (symbol === 'BTCUSD') symbol = 'BTCUSDT';
  if (symbol === 'ETHUSD') symbol = 'ETHUSDT'; 
  
  let accounts = [];
  if (useMongoDB) {
    try {
      accounts = await db.collection('mt5_accounts').find({}).toArray();
    } catch(err) {
      console.error('[Auto-Execution] Failed to load accounts from DB:', err.message);
    }
  } else {
    const testId = process.env.TEST_MT5_ACCOUNT_ID;
    if (testId) {
      accounts = [{
        metaApiAccountId: testId,
        login: 'TEST',
        riskConfig: { mode: 'multiplier', value: 0.5 },
        name: 'Test Account',
        userId: 'admin'
      }];
    }
  }
  
  // 1. Execute via MetaApi (if configured and account is not a VPS Farm account)
  if (metaApi && accounts.length > 0) {
    const metaApiAccounts = accounts.filter(acc => !acc.useVpsFarm && acc.metaApiAccountId);
    metaApiAccounts.forEach(async (acc) => {
      try {
        const accountId = acc.metaApiAccountId;
        console.log(`[Auto-Execution] Copying trade to MT5 account ${acc.login} (${acc.name}) via MetaApi...`);
        
        let lotSize = 0.01;
        const baseLot = 0.1;
        
        if (acc.riskConfig && acc.riskConfig.mode === 'fixed') {
          lotSize = acc.riskConfig.value;
        } else if (acc.riskConfig) {
          lotSize = parseFloat((baseLot * acc.riskConfig.value).toFixed(2));
        }
        
        lotSize = Math.max(0.01, Math.min(1.0, lotSize));
        
        const account = await metaApi.metatraderAccountApi.getAccount(accountId);
        
        const connection = account.getStreamingConnection();
        await connection.connect();
        await connection.waitSynchronized();
        
        const isBuy = action.toLowerCase() === 'buy';
        
        console.log(`[Auto-Execution] Executing market ${isBuy ? 'buy' : 'sell'} order of ${lotSize} lot on ${symbol} (SL: ${sl}, TP: ${tp}) for account ${acc.login}`);
        
        let result;
        if (isBuy) {
          result = await connection.createMarketBuyOrder(
            symbol,
            lotSize,
            sl ? parseFloat(sl) : undefined,
            tp ? parseFloat(tp) : undefined,
            { comment: 'Alpha Gold Auto-Trade' }
          );
        } else {
          result = await connection.createMarketSellOrder(
            symbol,
            lotSize,
            sl ? parseFloat(sl) : undefined,
            tp ? parseFloat(tp) : undefined,
            { comment: 'Alpha Gold Auto-Trade' }
          );
        }
        
        console.log(`[Auto-Execution] Success for account ${acc.login}. Position ID: ${result.positionId}`);
        
        await sendTelegramNotification(
          acc.userId, 
          `🔔 *[ALPHA GOLD AUTO] - ĐẶT LỆNH THÀNH CÔNG*\n\n` +
          `• Tài khoản: MT5 - ${acc.login} (${acc.name})\n` +
          `• Lệnh: *${action.toUpperCase()} ${symbol}*\n` +
          `• Khối lượng: *${lotSize} lot* (${acc.riskConfig.mode === 'fixed' ? 'Cố định' : `Hệ số ${acc.riskConfig.value}`})\n` +
          `• Giá SL: ${sl || 'Không có'} | TP: ${tp || 'Không có'}\n` +
          `• Ticket: \`${result.positionId}\``
        );
        
      } catch(err) {
        console.error(`[Auto-Execution] Failed for account ${acc.login || 'unknown'}:`, err.message || err);
        await sendTelegramNotification(
          acc.userId, 
          `⚠️ *[ALPHA GOLD AUTO] - LỆNH THẤT BẠI*\n\n` +
          `• Tài khoản: MT5 - ${acc.login || 'N/A'}\n` +
          `• Lệnh: *${action.toUpperCase()} ${symbol}*\n` +
          `• Lỗi: _${err.message || err}_`
        );
      }
    });
  } else if (!metaApi) {
    console.log('[Auto-Execution] MetaApi not initialized, skipping MetaApi execution.');
  }

  // 2. Execute via VPS TCP Farm (send to all registered sockets)
  if (tcpClients.size > 0) {
    console.log(`[Auto-Execution] Broadcasting signal to ${tcpClients.size} VPS clients...`);
    try {
      const dbUsers = await loadUsers();
      tcpClients.forEach(async (socket, loginStr) => {
        try {
          // Find user who owns this MT5 account
          const user = dbUsers.find(u => u.mt5Configs && String(u.mt5Configs.id) === String(loginStr));
          if (!user) {
            console.log(`[Auto-Execution] Skip VPS client ${loginStr} - No linked user found.`);
            return;
          }

          const userSettings = user.botSettings && user.botSettings[ticker];
          if (!userSettings || !userSettings.enabled) {
            console.log(`[Auto-Execution] Skip VPS client ${loginStr} - Bot settings not enabled for ${ticker}.`);
            return;
          }

          const lotSize = userSettings.volume || 0.01;
          const { slPrice, tpPrice } = calculateCustomSlTp(action, entry, userSettings.sl, userSettings.tp, symbol);

          console.log(`[Auto-Execution] Sending TCP trade command to ${loginStr} - ${action.toUpperCase()} ${symbol} ${lotSize} lot (SL: ${slPrice}, TP: ${tpPrice})`);
          socket.write(`TRADE|${action.toUpperCase()}|${symbol}|${lotSize}|${entry}|${slPrice || 0}|${tpPrice || 0}\n`);

          await sendTelegramNotification(
            user.username,
            `🔔 *[ALPHA GOLD VPS] - GỬI TÍN HIỆU ĐẾN VPS THÀNH CÔNG*\n\n` +
            `• Tài khoản: MT5 - ${loginStr} (${user.name})\n` +
            `• Lệnh: *${action.toUpperCase()} ${symbol}*\n` +
            `• Khối lượng: *${lotSize} lot*\n` +
            `• Giá SL: ${slPrice || 'Không có'} (cài đặt: ${userSettings.sl} pts)\n` +
            `• Giá TP: ${tpPrice || 'Không có'} (cài đặt: ${userSettings.tp} pts)\n` +
            `• Trạng thái: Đã chuyển tiếp lệnh qua VPS local.`
          );
        } catch (err) {
          console.error(`[Auto-Execution] Failed to send TCP command to ${loginStr}:`, err.message);
        }
      });
    } catch (err) {
      console.error('[Auto-Execution] Error executing signals on VPS clients:', err.message);
    }
  } else {
    console.log('[Auto-Execution] No connected TCP EA clients found.');
  }
}

// ==========================================
// REST API Endpoints
// ==========================================

// REST API Endpoints
// ==========================================

// Login endpoint with rate limiter and slow down
app.post('/api/login', authLimiter, speedLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ thông tin.' });
  }
  
  if (username.length > 50 || password.length > 100) {
    return res.status(400).json({ success: false, error: 'Thông tin đăng nhập quá dài.' });
  }

  const users = await loadUsers();
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
      await saveUsers(users);
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

  const { ticker, interval, action, entry, confidence, system } = req.body;
  if (!ticker || !interval || !action) {
    return res.status(400).json({ error: 'Missing required parameters (ticker, interval, action)' });
  }

  const sym = String(ticker).toUpperCase();
  if (!SYMBOLS.includes(sym)) return res.status(400).json({ error: `Unsupported symbol: ${ticker}` });

  const tfLabel = INTERVAL_MAP[String(interval)];
  if (!tfLabel) return res.status(400).json({ error: `Unsupported interval: ${interval}` });

  const formattedAction = String(action).toLowerCase();
  if (formattedAction !== 'buy' && formattedAction !== 'sell') {
    return res.status(400).json({ error: 'Action must be buy or sell' });
  }

  const numEntry = entry !== undefined ? parseFloat(entry) : currentPrices[sym];
  const numConfidence = confidence ? parseInt(confidence, 10) : null;

  if (isNaN(numEntry) || !numEntry) {
    return res.status(400).json({ error: 'Invalid or missing entry price' });
  }

  // Calculate SL and TPs using dynamic distances
  const settings = SIGNAL_SETTINGS[sym] || { sl: 10.0, tp1: 5.0, tp2: 7.5 };
  let computedSl = 0;
  let computedTp1 = 0;
  let computedTp2 = 0;
  if (formattedAction === 'buy') {
    computedSl = numEntry - settings.sl;
    computedTp1 = numEntry + settings.tp1;
    computedTp2 = numEntry + settings.tp2;
  } else {
    computedSl = numEntry + settings.sl;
    computedTp1 = numEntry - settings.tp1;
    computedTp2 = numEntry - settings.tp2;
  }

  // Round values depending on asset type (XAGUSD needs 4 decimals, others 2)
  const decimalPlaces = (sym === 'XAGUSD') ? 4 : 2;
  const finalSl = parseFloat(computedSl.toFixed(decimalPlaces));
  const finalTp1 = parseFloat(computedTp1.toFixed(decimalPlaces));
  const finalTp2 = parseFloat(computedTp2.toFixed(decimalPlaces));
  const finalEntry = parseFloat(numEntry.toFixed(decimalPlaces));

  signals[sym][tfLabel] = {
    ticker: sym, 
    interval: tfLabel, 
    action: formattedAction,
    entry: finalEntry, 
    sl: finalSl, 
    tps: [finalTp1, finalTp2],
    confidence: numConfidence && !isNaN(numConfidence) ? numConfidence : Math.floor(Math.random() * 20) + 75,
    timestamp: Date.now(),
    system: system || 'SYSTEM'
  };

  io.emit('signal_update', signals[sym][tfLabel]);

  // Trigger auto copy trading asynchronously
  executeSignalOnAllAccounts(signals[sym][tfLabel]).catch(err => {
    console.error('[Webhook] executeSignalOnAllAccounts error:', err);
  });

  // Broadcast manual signal alerts to users with auto-trading disabled
  if (typeof broadcastManualSignalAlert === 'function') {
    broadcastManualSignalAlert(signals[sym][tfLabel]).catch(err => {
      console.error('[Webhook] broadcastManualSignalAlert error:', err);
    });
  }

  res.json({ success: true, signal: signals[sym][tfLabel] });
});

// Secured API Endpoints
app.get('/api/signals', requireAuth, (req, res) => res.json(signals));
app.get('/api/prices', requireAuth, (req, res) => res.json(currentPrices));


// User Bot Settings Endpoints
app.get('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const users = await loadUsers();
    const user = users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      botSettings: user.botSettings || {}
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const { botSettings } = req.body;
    const users = await loadUsers();
    const userIdx = users.findIndex(u => u.username === req.user.username);
    if (userIdx === -1) return res.status(404).json({ error: 'User not found' });
    
    users[userIdx].botSettings = {
      ...users[userIdx].botSettings,
      ...botSettings
    };
    
    await saveUsers(users);
    res.json({ success: true, botSettings: users[userIdx].botSettings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:symbol/:interval', requireAuth, (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const tf  = req.params.interval;
  if (!candleHistory[sym] || !candleHistory[sym][tf])
    return res.status(400).json({ error: 'Invalid symbol or interval' });
  res.set('Cache-Control', 'no-store');
  res.json({ history: candleHistory[sym][tf], active: activeCandles[sym][tf] });
});

// Website-wide signal history is read-only for clients. The backend M1 engine
// is the sole writer, so browser presence and account identity cannot affect it.
app.get('/api/global-signal-history', requireAuth, async (req, res) => {
  try {
    const records = await loadGlobalSignalHistory();
    res.json({ success: true, scope: 'website', engine: backendM1Engine?.getStatus(), records });
  } catch (error) {
    console.error('[Global Signal History] GET failed:', error.message);
    res.status(500).json({ success: false, error: 'Không thể tải lịch sử tín hiệu chung.' });
  }
});

app.get('/api/debug-ws', (req, res) => {
  const wsState = binanceWs ? binanceWs.readyState : 'NOT_INITIALIZED';
  const krakenWsState = krakenWs ? krakenWs.readyState : 'NOT_INITIALIZED';
  const wsStates = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSING', 3: 'CLOSED' };
  const xauTickAgeMs = lastTickTimestamp.XAUUSD ? Date.now() - lastTickTimestamp.XAUUSD : null;
  const marketData = {
    ready: marketStateReady,
    xauFeedStatus: xauTickAgeMs !== null && xauTickAgeMs <= FEED_STALE_AFTER_MS ? 'live' : 'stale',
    xauTickAgeMs,
    xauM1Recovering: recoveringM1Symbols.has('XAUUSD'),
    xauM1ClosedCandles: candleHistory.XAUUSD?.M1?.length || 0,
    xauM1LastClosedTime: candleHistory.XAUUSD?.M1?.at(-1)?.time || null,
    connectedBrowserClients: io.engine?.clientsCount || 0
  };
  
  const https = require('https');
  https.get('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT', (binanceRes) => {
    let data = '';
    binanceRes.on('data', c => data += c);
    binanceRes.on('end', () => {
      res.json({
        binanceWsState: wsStates[wsState] || wsState,
        krakenWsState: wsStates[krakenWsState] || krakenWsState,
        binanceApiStatus: binanceRes.statusCode,
        binanceApiData: data,
        currentPrices,
        m1Engine: backendM1Engine?.getStatus(),
        marketData,
        lastTickTimestamp,
        historyInitialized,
        isMarketClosed: isMarketClosed(),
        SYMBOLS
      });
    });
  }).on('error', (err) => {
    res.json({
      binanceWsState: wsStates[wsState] || wsState,
      krakenWsState: wsStates[krakenWsState] || krakenWsState,
      binanceApiStatus: 'ERROR',
      binanceApiError: err.message,
      currentPrices,
      m1Engine: backendM1Engine?.getStatus(),
      marketData,
      lastTickTimestamp,
      historyInitialized,
      isMarketClosed: isMarketClosed(),
      SYMBOLS
    });
  });
});

// ==========================================
// MetaTrader 5 (MT5) Auto-Execution Endpoints
// ==========================================

// Connect MT5 Account
app.post('/api/v1/accounts/connect', requireAuth, async (req, res) => {
  const { login, password, server, riskConfig, name, reliability, useVpsFarm } = req.body;
  
  if (!login || !password || !server) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc (login, password, server).' });
  }

  const isVpsFarm = !!useVpsFarm || !metaApi;

  try {
    const username = req.user.username;
    let metaApiAccountId = null;
    const reliabilityLevel = ['developer', 'standard', 'high'].includes(reliability) ? reliability : 'developer';
    
    if (!isVpsFarm && metaApi) {
      // 1. Register the account in MetaApi
      console.log(`[MetaApi] Registering account ${login} on ${server} for user ${username}...`);
      
      const account = await metaApi.metatraderAccountApi.createAccount({
        name: name || `MT5-${login}`,
        type: 'cloud-g2',
        login: String(login),
        password: password,
        server: server,
        platform: 'mt5',
        reliability: reliabilityLevel,
        magic: 777777 // Default magic number for trades
      });
      metaApiAccountId = account.id;
      console.log(`[MetaApi] Account created on MetaApi. ID: ${metaApiAccountId}`);
    } else {
      console.log(`[VPS Farm] Registering local MT5 account ${login} on ${server}...`);
    }
    
    // 2. Encrypt the password for our local MongoDB backup
    const encryptedPassword = encryptPassword(password);
    
    // 3. Save to MongoDB collection 'mt5_accounts'
    const accountDoc = {
      userId: username,
      metaApiAccountId: metaApiAccountId,
      login: String(login),
      password: encryptedPassword,
      server: server,
      reliability: reliabilityLevel,
      riskConfig: {
        mode: (riskConfig && ['multiplier', 'fixed'].includes(riskConfig.mode)) ? riskConfig.mode : 'multiplier',
        value: (riskConfig && typeof riskConfig.value === 'number') ? riskConfig.value : 0.5
      },
      name: name || `MT5-${login}`,
      status: isVpsFarm ? 'stopped' : 'deploying',
      useVpsFarm: isVpsFarm,
      createdAt: new Date()
    };
    
    if (useMongoDB) {
      await db.collection('mt5_accounts').insertOne(accountDoc);
    } else {
      console.warn('[Database] MongoDB not active. Saving connection in-memory or fallback.');
    }
    
    res.json({
      success: true,
      message: isVpsFarm 
        ? 'Đã cấu hình tài khoản MT5 trên hệ thống VPS Farm thành công!'
        : 'Kết nối tài khoản MT5 thành công! Đang tiến hành cài đặt máy chủ ảo.',
      accountId: metaApiAccountId
    });
    
  } catch (err) {
    console.error('[MT5 Connect] Connection error:', err.message || err);
    res.status(500).json({ success: false, error: `Lỗi kết nối: ${err.message || err}` });
  }
});

// Get MT5 Accounts list
app.get('/api/v1/accounts', requireAuth, async (req, res) => {
  try {
    const username = req.user.username;
    let accounts = [];
    
    if (useMongoDB) {
      accounts = await db.collection('mt5_accounts').find({ userId: username }).toArray();
    }
    
    // Map accounts to hide encrypted password
    const sanitized = accounts.map(({ _id, metaApiAccountId, login, server, reliability, riskConfig, name, status, useVpsFarm }) => ({
      id: _id,
      metaApiAccountId,
      login,
      server,
      reliability,
      riskConfig,
      name,
      status,
      useVpsFarm: !!useVpsFarm
    }));
    
    res.json({ success: true, accounts: sanitized });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete/Disconnect MT5 Account
app.delete('/api/v1/accounts/:id', requireAuth, async (req, res) => {
  const accountId = req.params.id;
  
  try {
    const username = req.user.username;
    
    let accountDoc = null;
    if (useMongoDB) {
      const { ObjectId } = require('mongodb');
      try {
        accountDoc = await db.collection('mt5_accounts').findOne({
          _id: new ObjectId(accountId),
          userId: username
        });
      } catch(e) {
        accountDoc = await db.collection('mt5_accounts').findOne({
          metaApiAccountId: accountId,
          userId: username
        });
      }
    }
    
    if (!accountDoc) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản MT5 hoặc bạn không có quyền.' });
    }
    
    if (!accountDoc.useVpsFarm && metaApi && accountDoc.metaApiAccountId) {
      console.log(`[MetaApi] Deleting account ${accountDoc.metaApiAccountId} from MetaApi...`);
      try {
        await metaApi.metatraderAccountApi.deleteAccount(accountDoc.metaApiAccountId);
      } catch(apiErr) {
        console.warn('[MetaApi] Account already deleted on MetaApi cloud or error:', apiErr.message);
      }
    } else {
      console.log(`[VPS Farm] Stopping local MT5 slot for account ${accountDoc.login}...`);
      try {
        vpsManager.stopSlot(accountDoc.login);
      } catch(vpsErr) {
        console.warn('[VPS Farm] Error stopping slot during deletion:', vpsErr.message);
      }
    }
    
    if (useMongoDB) {
      await db.collection('mt5_accounts').deleteOne({ _id: accountDoc._id });
    }
    
    res.json({ success: true, message: 'Đã ngắt kết nối và xóa tài khoản MT5 thành công!' });
    
  } catch (err) {
    console.error('[MT5 Delete] Delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update risk configuration
app.put('/api/v1/accounts/:id/risk', requireAuth, async (req, res) => {
  const accountId = req.params.id;
  const { riskConfig } = req.body;
  
  if (!riskConfig || !['multiplier', 'fixed'].includes(riskConfig.mode) || typeof riskConfig.value !== 'number') {
    return res.status(400).json({ success: false, error: 'Cấu hình rủi ro không hợp lệ.' });
  }
  
  try {
    const username = req.user.username;
    const { ObjectId } = require('mongodb');
    
    let filter = {};
    try {
      filter = { _id: new ObjectId(accountId), userId: username };
    } catch(e) {
      filter = { metaApiAccountId: accountId, userId: username };
    }
    
    if (useMongoDB) {
      const result = await db.collection('mt5_accounts').updateOne(
        filter,
        { $set: { riskConfig: { mode: riskConfig.mode, value: riskConfig.value } } }
      );
      if (result.matchedCount === 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản MT5.' });
      }
    }
    
    res.json({ success: true, message: 'Cập nhật cấu hình rủi ro thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const users = await loadUsers();
  const isSuperAdmin = req.user.role === 'SuperAdmin';
  
  // Filter users based on role
  let filteredUsers = users;
  if (!isSuperAdmin && req.user.role !== 'Employee') {
    // Regular Administrator: only see their own clients (createdBy === req.user.username) plus themselves
    filteredUsers = users.filter(u => 
      u.createdBy === req.user.username || 
      u.username.toLowerCase() === req.user.username.toLowerCase()
    );
  }
  
  // Map users to exclude passwords
  const sanitizedUsers = filteredUsers.map(({ username, name, role, expiresAt, createdBy, refCode, telegramSupport }) => ({
    username,
    name,
    role,
    expiresAt,
    createdBy,
    refCode,
    telegramSupport
  }));
  res.json({ success: true, users: sanitizedUsers, useMongoDB });
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { username, password, name, role, expiresAt, telegramSupport, refCode } = req.body;
  if (!username || !password || !name || !role ||
      typeof username !== 'string' || typeof password !== 'string' || typeof name !== 'string' || typeof role !== 'string') {
    return res.status(400).json({ success: false, error: 'Vui lòng nhập đầy đủ thông tin.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cleanName = name.trim();
  const targetRole = ['SuperAdmin', 'Administrator', 'Employee', 'User'].includes(role) ? role : 'User';

  if (targetRole === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ success: false, error: 'Forbidden: Chỉ Super Admin mới có quyền tạo tài khoản Super Admin.' });
  }

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

  const users = await loadUsers();
  if (users.some(u => u.username.toLowerCase() === cleanUsername)) {
    return res.status(400).json({ success: false, error: 'Tên đăng nhập đã tồn tại!' });
  }

  const hashedPassword = hashPassword(password);
  const newUser = {
    username: cleanUsername,
    password: hashedPassword,
    name: cleanName,
    role: targetRole,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    createdBy: req.user.username
  };

  // Generate or set refCode and telegramSupport for Admins/SuperAdmins
  if (targetRole === 'Administrator' || targetRole === 'SuperAdmin') {
    let finalRefCode = undefined;
    if (refCode && typeof refCode === 'string' && refCode.trim()) {
      const cleanRef = refCode.trim().toLowerCase();
      if (!/^[a-zA-Z0-9]+$/.test(cleanRef)) {
        return res.status(400).json({ success: false, error: 'Mã giới thiệu chỉ được chứa chữ cái và số.' });
      }
      if (users.some(u => u.refCode && u.refCode.toLowerCase() === cleanRef)) {
        return res.status(400).json({ success: false, error: 'Mã giới thiệu này đã được sử dụng!' });
      }
      finalRefCode = cleanRef;
    } else {
      finalRefCode = generateRefCode();
    }
    newUser.refCode = finalRefCode;
    newUser.telegramSupport = telegramSupport || 'https://t.me/alphagoldhelper';
  }

  users.push(newUser);
  await saveUsers(users);

  await logActivity(
    req.user.username,
    'CREATE_USER',
    cleanUsername,
    `Tạo tài khoản mới với quyền: ${targetRole}${newUser.refCode ? ` (Ref: ${newUser.refCode})` : ''}`,
    req.ip
  );

  res.json({ success: true, message: 'Tạo tài khoản mới thành công!' });
});

app.put('/api/admin/users/:username/password', requireAdmin, checkAdminGuard, async (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { password } = req.body;
  
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Mật khẩu mới không hợp lệ.' });
  }
  if (password.length < 6 || password.length > 50) {
    return res.status(400).json({ success: false, error: 'Mật khẩu phải từ 6 đến 50 ký tự.' });
  }

  const users = await loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  users[idx].password = hashPassword(password);
  await saveUsers(users);

  await logActivity(
    req.user.username,
    'CHANGE_PASSWORD',
    targetUsername,
    'Thay đổi mật khẩu tài khoản',
    req.ip
  );

  res.json({ success: true, message: `Đổi mật khẩu cho tài khoản ${targetUsername} thành công!` });
});

app.put('/api/admin/users/:username/role', requireAdmin, checkAdminGuard, async (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { role } = req.body;

  if (!role || !['SuperAdmin', 'Administrator', 'Employee', 'User'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Quyền (role) không hợp lệ.' });
  }

  if (role === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ success: false, error: 'Chỉ Super Admin mới có thể thiết lập quyền Super Admin.' });
  }

  const users = await loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  // Self role change check (prevent lockout if changing their own role)
  if (targetUsername === req.user.username.toLowerCase() && role !== req.user.role) {
    return res.status(400).json({ success: false, error: 'Bạn không thể tự thay đổi quyền của chính mình.' });
  }

  const oldRole = users[idx].role;
  users[idx].role = role;

  // Generate refCode if needed
  if ((role === 'Administrator' || role === 'SuperAdmin') && !users[idx].refCode) {
    users[idx].refCode = generateRefCode();
  }

  await saveUsers(users);

  await logActivity(
    req.user.username,
    'CHANGE_ROLE',
    targetUsername,
    `Thay đổi quyền từ ${oldRole} thành ${role}`,
    req.ip
  );

  res.json({ success: true, message: `Cập nhật quyền cho tài khoản ${targetUsername} thành công!` });
});

app.delete('/api/admin/users/:username', requireAdmin, checkAdminGuard, async (req, res) => {
  const targetUsername = req.params.username.toLowerCase();

  if (targetUsername === req.user.username.toLowerCase()) {
    return res.status(400).json({ success: false, error: 'Bạn không thể tự xóa tài khoản của chính mình!' });
  }

  const users = await loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  users.splice(idx, 1);
  await saveUsers(users);

  await logActivity(
    req.user.username,
    'DELETE_USER',
    targetUsername,
    'Xóa tài khoản thành viên',
    req.ip
  );

  res.json({ success: true, message: `Xóa tài khoản ${targetUsername} thành công!` });
});

app.put('/api/admin/users/:username/edit', requireAdmin, checkAdminGuard, async (req, res) => {
  const targetUsername = req.params.username.toLowerCase();
  const { name, role, expiresAt, telegramSupport, refCode } = req.body;
  
  const users = await loadUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === targetUsername);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng này.' });
  }

  const oldUser = { ...users[idx] };
  let details = [];

  if (name && typeof name === 'string') {
    users[idx].name = name.trim();
    details.push(`đổi tên thành "${users[idx].name}"`);
  }

  if (role && ['SuperAdmin', 'Administrator', 'Employee', 'User'].includes(role)) {
    if (role === 'SuperAdmin' && req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ success: false, error: 'Chỉ Super Admin mới có thể thiết lập quyền Super Admin.' });
    }
    if (targetUsername === req.user.username.toLowerCase() && role !== req.user.role) {
      return res.status(400).json({ success: false, error: 'Bạn không thể tự thay đổi quyền của chính mình.' });
    }
    users[idx].role = role;
    
    // Generate refCode if needed
    if ((role === 'Administrator' || role === 'SuperAdmin') && !users[idx].refCode) {
      users[idx].refCode = generateRefCode();
    }
    details.push(`đổi quyền thành ${role}`);
  }

  if (expiresAt !== undefined) {
    users[idx].expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
    details.push(`đổi hạn dùng thành ${expiresAt ? new Date(expiresAt).toLocaleDateString('vi-VN') : 'vô hạn'}`);
  }

  if (telegramSupport !== undefined) {
    users[idx].telegramSupport = telegramSupport;
    details.push(`đổi telegram support thành "${telegramSupport}"`);
  }

  if (refCode !== undefined) {
    if (refCode && typeof refCode === 'string' && refCode.trim()) {
      const cleanRef = refCode.trim().toLowerCase();
      if (!/^[a-zA-Z0-9]+$/.test(cleanRef)) {
        return res.status(400).json({ success: false, error: 'Mã giới thiệu chỉ được chứa chữ cái và số.' });
      }
      // Check duplicate refCode excluding the target user
      if (users.some(u => u.username.toLowerCase() !== targetUsername && u.refCode && u.refCode.toLowerCase() === cleanRef)) {
        return res.status(400).json({ success: false, error: 'Mã giới thiệu này đã được sử dụng!' });
      }
      users[idx].refCode = cleanRef;
      details.push(`đổi mã giới thiệu thành "${cleanRef}"`);
    } else {
      users[idx].refCode = generateRefCode();
      details.push(`đổi mã giới thiệu thành mã ngẫu nhiên "${users[idx].refCode}"`);
    }
  }

  await saveUsers(users);
  
  await logActivity(
    req.user.username,
    'EDIT_USER',
    targetUsername,
    `Cập nhật thông tin: ${details.join(', ')}`,
    req.ip
  );

  res.json({ success: true, message: `Cập nhật thông tin tài khoản ${targetUsername} thành công!` });
});

// GET /api/ref/:code — public endpoint to resolve affiliate referral link
app.get('/api/ref/:code', async (req, res) => {
  const code = (req.params.code || '').trim().toLowerCase();
  if (!code) {
    return res.status(400).json({ success: false, error: 'Mã giới thiệu không hợp lệ.' });
  }

  const users = await loadUsers();
  const owner = users.find(u => u.refCode && u.refCode.toLowerCase() === code);

  if (!owner) {
    return res.status(404).json({ success: false, error: 'Mã giới thiệu không tồn tại.' });
  }

  // Verify that the owner is an admin or superadmin
  if (owner.role !== 'Administrator' && owner.role !== 'SuperAdmin') {
    return res.status(404).json({ success: false, error: 'Mã giới thiệu không hợp lệ.' });
  }

  res.json({
    success: true,
    name: owner.name,
    telegramSupport: owner.telegramSupport || 'https://t.me/alphagoldhelper'
  });
});

// GET /api/admin/audit-logs — SuperAdmin only view of activities
app.get('/api/admin/audit-logs', requireSuperAdmin, async (req, res) => {
  const logs = await loadAuditLogs();
  res.json({ success: true, logs });
});

// DELETE /api/admin/audit-logs — SuperAdmin only clear logs
app.delete('/api/admin/audit-logs', requireSuperAdmin, async (req, res) => {
  await saveAuditLogs([]);
  await logActivity(req.user.username, 'CLEAR_LOGS', 'system', 'Xóa toàn bộ nhật ký hoạt động', req.ip);
  res.json({ success: true, message: 'Đã xóa toàn bộ nhật ký hoạt động thành công.' });
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
io.use(async (socket, next) => {
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
  const users = await loadUsers();
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
    const response = await fetchJson(`https://vnwallstreet.org/api/calendar?date=${encodeURIComponent(date)}&t=${Date.now()}`, {
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

app.get('/api/external/finnhub-calendar', requireAuth, async (req, res) => {
  const { from, to } = req.query; // YYYY-MM-DD
  if (!from || !to) {
    return res.status(400).json({ error: 'Missing from/to parameters' });
  }
  if (!FINNHUB_TOKEN) {
    return res.status(500).json({ error: 'Finnhub token is not configured on server' });
  }
  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(FINNHUB_TOKEN)}`;
    const response = await fetchJson(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: `Finnhub returned status ${response.status}` });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[Proxy Finnhub Calendar] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch calendar from Finnhub' });
  }
});

app.get('/api/external/news', requireAuth, async (req, res) => {
  const { limit = 20, start = 0, important } = req.query;
  try {
    let url = `https://vnwallstreet.org/api/news?limit=${parseInt(limit)}&start=${parseInt(start)}&t=${Date.now()}`;
    if (important === '1') {
      url += '&important=1';
    }
    const response = await fetchJson(url, {
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

// ==========================================
// MT5 VPS TCP FARM SOCKET SERVER
// ==========================================
const tcpClients = new Map();
const tcpNotifyDebounce = new Map(); // login -> { lastConnect, lastDisconnect } timestamps

const tcpServer = net.createServer((socket) => {
  console.log('[TCP Server] MT5 client connected from:', socket.remoteAddress, socket.remotePort);
  
  let registeredLogin = null;
  let buffer = '';
  
  socket.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep trailing incomplete line
    
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      
      console.log(`[TCP Server] Received from client: ${line}`);
      
      if (line.startsWith('REG|')) {
        const login = line.split('|')[1];
        if (login) {
          registeredLogin = login;
          tcpClients.set(login, socket);
          console.log(`[TCP Server] Account registered: ${login}`);
          socket.write('REG_OK\n');
          
          // Send connection notification via Telegram (debounced 60s)
          const nowConnect = Date.now();
          const debounceConnect = tcpNotifyDebounce.get(login) || {};
          if (!debounceConnect.lastConnect || (nowConnect - debounceConnect.lastConnect) > 60000) {
            debounceConnect.lastConnect = nowConnect;
            tcpNotifyDebounce.set(login, debounceConnect);
            (async () => {
              try {
                const dbUsers = await loadUsers();
                const user = dbUsers.find(u => u.mt5Configs && String(u.mt5Configs.id) === String(login));
                if (user) {
                  await sendTelegramNotification(
                    user.username,
                    `🟢 *[ALPHA GOLD VPS] - ĐÃ KẾT NỐI*\n\nTài khoản MT5 *${login}* đã kết nối thành công tới hệ thống máy chủ.`
                  );
                }
              } catch (err) {
                console.error('[TCP Server] Error sending connection notification:', err.message);
              }
            })();
          }
        }
      } else if (line === 'PING') {
        socket.write('PONG\n');
      } else if (line === 'PONG') {
        // Keepalive acknowledgment from EA — do nothing
      } else if (line.startsWith('OK|') || line.startsWith('ERR|')) {
        console.log(`[TCP Server] Feedback from client ${registeredLogin || 'unknown'}: ${line}`);
        io.emit('vps_feedback', { login: registeredLogin, message: line });
        
        // Telegram Notification for trade execution feedback
        if (registeredLogin) {
          (async () => {
            try {
              const dbUsers = await loadUsers();
              const user = dbUsers.find(u => u.mt5Configs && String(u.mt5Configs.id) === String(registeredLogin));
              if (user) {
                const parts = line.split('|');
                const status = parts[0]; // OK or ERR
                const type = parts[1];   // BUY_SUCCESS, BUY_FAILED, SELL_SUCCESS, etc.
                const sym = parts[2];    // symbol
                const detail = parts[3];  // ticket or description or closed_count
                
                let msg = '';
                if (status === 'OK') {
                  if (type === 'BUY_SUCCESS' || type === 'SELL_SUCCESS') {
                    const actionName = type === 'BUY_SUCCESS' ? 'BUY' : 'SELL';
                    msg = `✅ *[ALPHA GOLD VPS] - VÀO LỆNH THÀNH CÔNG*\n\n` +
                          `• Tài khoản: MT5 - ${registeredLogin} (${user.name})\n` +
                          `• Giao dịch: *${actionName} ${sym}*\n` +
                          `• Mã lệnh (Ticket): \`${detail}\`\n` +
                          `• Trạng thái: Lệnh đã được khớp trên MT5.`;
                  } else if (type === 'CLOSE_SUCCESS') {
                    msg = `ℹ️ *[ALPHA GOLD VPS] - ĐÃ ĐÓNG VỊ THẾ*\n\n` +
                          `• Tài khoản: MT5 - ${registeredLogin} (${user.name})\n` +
                          `• Cặp tài sản: *${sym}*\n` +
                          `• Số vị thế đã đóng: *${detail}*\n` +
                          `• Trạng thái: Đã đóng tất cả vị thế của cặp giao dịch này.`;
                  } else if (type === 'KILL_SUCCESS') {
                    msg = `⚠️ *[ALPHA GOLD VPS] - KÍCH HOẠT DỪNG KHẨN CẤP*\n\n` +
                          `• Tài khoản: MT5 - ${registeredLogin} (${user.name})\n` +
                          `• Chi tiết: _${detail}_\n` +
                          `• Trạng thái: Toàn bộ vị thế đã được đóng khẩn cấp.`;
                  }
                } else if (status === 'ERR') {
                  const actionName = type.startsWith('BUY') ? 'BUY' : 'SELL';
                  msg = `❌ *[ALPHA GOLD VPS] - LỆNH THẤT BẠI*\n\n` +
                        `• Tài khoản: MT5 - ${registeredLogin} (${user.name})\n` +
                        `• Thử thực hiện: *${actionName} ${sym}*\n` +
                        `• Lỗi từ MT5: _${detail}_\n` +
                        `• Vui lòng kiểm tra lại số dư hoặc cài đặt Live Trading trên EA.`;
                }
                
                if (msg) {
                  await sendTelegramNotification(user.username, msg);
                }
              }
            } catch (err) {
              console.error('[TCP Server] Error sending feedback notification:', err.message);
            }
          })();
        }
      }
    }
  });
  
  socket.on('close', () => {
    if (registeredLogin) {
      if (tcpClients.get(registeredLogin) === socket) {
        tcpClients.delete(registeredLogin);
        console.log(`[TCP Server] Account disconnected: ${registeredLogin}`);
        
        // Send Telegram Notification (debounced 60s)
        const nowDisconnect = Date.now();
        const debounceDisconnect = tcpNotifyDebounce.get(registeredLogin) || {};
        if (!debounceDisconnect.lastDisconnect || (nowDisconnect - debounceDisconnect.lastDisconnect) > 60000) {
          debounceDisconnect.lastDisconnect = nowDisconnect;
          tcpNotifyDebounce.set(registeredLogin, debounceDisconnect);
          (async () => {
            try {
              const dbUsers = await loadUsers();
              const user = dbUsers.find(u => u.mt5Configs && String(u.mt5Configs.id) === String(registeredLogin));
              if (user) {
                await sendTelegramNotification(
                  user.username,
                  `🔴 *[ALPHA GOLD VPS] - ĐÃ NGẮT KẾT NỐI*\n\nTài khoản MT5 *${registeredLogin}* đã ngắt kết nối khỏi hệ thống máy chủ.`
                );
              }
            } catch (err) {
              console.error('[TCP Server] Error sending disconnection notification:', err.message);
            }
          })();
        }
      } else {
        console.log(`[TCP Server] Stale socket closed for: ${registeredLogin} (ignored delete)`);
      }
    }
  });
  
  socket.on('error', (err) => {
    console.error(`[TCP Server] Socket error for ${registeredLogin || 'unknown'}:`, err.message);
  });
});

const TCP_PORT = process.env.TCP_PORT || 7788;
tcpServer.listen(TCP_PORT, '0.0.0.0', () => {
  console.log(`[TCP Server] Listening for MT5 EAs on port ${TCP_PORT}`);
});

function triggerEmergencyKillAll() {
  console.log('[TCP Server] TRIGGERING EMERGENCY KILL SWITCH FOR ALL VPS CLIENTS!');
  tcpClients.forEach((socket, login) => {
    try {
      socket.write('KILL\n');
    } catch(err) {
      console.error(`[TCP Server] Failed to send KILL to client ${login}:`, err.message);
    }
  });
}

// ==========================================
// MT5 VPS FARM REST ENDPOINTS
// ==========================================

// GET VPS System resource telemetry
app.get('/api/v1/vps/status', requireAuth, (req, res) => {
  try {
    const resources = vpsManager.getSystemResources();
    res.json({ success: true, resources });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET list of all MT5 slots with process & connection status
app.get('/api/v1/vps/slots', requireAuth, async (req, res) => {
  try {
    let dbAccounts = [];
    if (useMongoDB) {
      dbAccounts = await db.collection('mt5_accounts').find({}).toArray();
    }
    
    const slots = dbAccounts.map(acc => {
      const vpsStatus = vpsManager.getSlotStatus(acc.login);
      const isConnected = tcpClients.has(acc.login);
      
      return {
        id: acc._id,
        login: acc.login,
        name: acc.name,
        server: acc.server,
        riskConfig: acc.riskConfig,
        running: vpsStatus.running,
        pid: vpsStatus.pid,
        connected: isConnected,
        useVpsFarm: !!acc.useVpsFarm,
        status: acc.status
      };
    });
    
    res.json({ success: true, slots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// START MT5 slot process
app.post('/api/v1/vps/slots/start', requireAuth, async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ success: false, error: 'Thiếu số tài khoản login.' });
  
  try {
    let acc = null;
    if (useMongoDB) {
      acc = await db.collection('mt5_accounts').findOne({ login: String(login) });
    }
    
    if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản trong cơ sở dữ liệu.' });
    
    // Decrypt the password
    const decryptedPassword = decryptPassword(acc.password);
    
    // Update account flag in DB to indicate it uses VPS farm
    if (useMongoDB) {
      await db.collection('mt5_accounts').updateOne(
        { _id: acc._id },
        { $set: { useVpsFarm: true, status: 'running' } }
      );
    }
    
    const started = vpsManager.startSlot(acc.login, decryptedPassword, acc.server);
    if (started) {
      res.json({ success: true, message: `Khởi chạy máy chủ ảo MT5 cho tài khoản ${login} thành công.` });
    } else {
      res.status(500).json({ success: false, error: 'Lỗi khởi chạy tiến trình MT5.' });
    }
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// STOP MT5 slot process
app.post('/api/v1/vps/slots/stop', requireAuth, async (req, res) => {
  const { login } = req.body;
  if (!login) return res.status(400).json({ success: false, error: 'Thiếu số tài khoản login.' });
  
  try {
    if (useMongoDB) {
      await db.collection('mt5_accounts').updateOne(
        { login: String(login) },
        { $set: { status: 'stopped' } }
      );
    }
    
    vpsManager.stopSlot(login);
    res.json({ success: true, message: `Đã dừng máy chủ ảo MT5 cho tài khoản ${login}.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// EMERGENCY KILL SWITCH: Kill all slots and close all trades immediately
app.post('/api/v1/vps/slots/kill-all', requireAuth, async (req, res) => {
  try {
    triggerEmergencyKillAll();
    
    // Stop all slots processes
    let dbAccounts = [];
    if (useMongoDB) {
      dbAccounts = await db.collection('mt5_accounts').find({}).toArray();
      await db.collection('mt5_accounts').updateMany({}, { $set: { status: 'stopped' } });
    }
    
    dbAccounts.forEach(acc => {
      vpsManager.stopSlot(acc.login);
    });
    
    res.json({ success: true, message: 'ĐÃ KÍCH HOẠT NÚT TẮT KHẨN CẤP! Đã gửi lệnh đóng toàn bộ lệnh và đóng tất cả máy chủ ảo MT5.' });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/test-start-vps', async (req, res) => {
  try {
    const users = await loadUsers();
    const admin = users.find(u => u.username === 'admin');
    if (admin && admin.mt5Configs) {
      let pass = admin.mt5Configs.password;
      if (pass && decryptPassword) {
        try { pass = decryptPassword(pass); } catch(e){}
      }
      const started = vpsManager.startSlot(admin.mt5Configs.id, pass, admin.mt5Configs.server);
      return res.json({ success: started });
    }
    res.json({ success: false, error: 'No admin found' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
