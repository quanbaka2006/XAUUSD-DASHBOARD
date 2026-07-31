const express = require('express');
const { rateLimit } = require('express-rate-limit');
const slowDown = require('express-slow-down');
const helmet = require('helmet');
const { MongoClient } = require('mongodb');
const path = require('path');

try { require('dotenv').config({ quiet: true }); } catch {}

const { createScreenCloneLicenseRouter } = require('./licenseCore');
const {
  hashPassword,
  signAdminSession,
  timingSafeEqual,
  verifyAdminSession,
  verifyPassword
} = require('./security');

const PORT = Number.parseInt(process.env.PORT, 10) || 5100;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MONGODB_URI = process.env.SCREENCLONE_MONGODB_URI || '';
const DATABASE_NAME = process.env.SCREENCLONE_DB_NAME || 'screenclone_license';
const ADMIN_USERNAME = String(process.env.SCREENCLONE_ADMIN_USERNAME || 'owner').trim().toLowerCase();
const ADMIN_PASSWORD_HASH = process.env.SCREENCLONE_ADMIN_PASSWORD_HASH || '';
const ADMIN_SESSION_SECRET = process.env.SCREENCLONE_ADMIN_SESSION_SECRET || '';
const ALLOWED_HOSTS = new Set(
  String(process.env.SCREENCLONE_ALLOWED_HOSTS || 'license.alphagoldhub.com,localhost,127.0.0.1')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
);
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
  ALLOWED_HOSTS.add(String(process.env.RENDER_EXTERNAL_HOSTNAME).trim().toLowerCase());
}

let mongoClient = null;
let database = null;

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value);
}

async function connectDatabase() {
  if (!MONGODB_URI) {
    if (IS_PRODUCTION) throw new Error('SCREENCLONE_MONGODB_URI is required in production');
    console.warn('[ScreenClone] MongoDB is not configured; using local development storage.');
    return;
  }
  mongoClient = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 10
  });
  await mongoClient.connect();
  database = mongoClient.db(DATABASE_NAME);
  await Promise.all([
    database.collection('customers').createIndex({ username: 1 }, { unique: true }),
    database.collection('screenclone_audit_logs').createIndex({ createdAt: -1 }),
    database.collection('screenclone_audit_logs').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    )
  ]);
  console.log(`[ScreenClone] Connected to isolated database: ${DATABASE_NAME}`);
}

async function loadCustomers() {
  if (!database) return [];
  return database.collection('customers').find({}).sort({ createdAt: -1 }).toArray();
}

async function logActivity(actor, action, target, details, ip) {
  if (!database) return;
  const createdAt = new Date();
  await database.collection('screenclone_audit_logs').insertOne({
    actor,
    action,
    target,
    details,
    ip,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 180 * 24 * 60 * 60 * 1000)
  });
}

function adminConfigurationError() {
  if (!ADMIN_PASSWORD_HASH.startsWith('pbkdf2-sha512$')) return 'SCREENCLONE_ADMIN_PASSWORD_HASH is missing';
  if (ADMIN_SESSION_SECRET.length < 32) return 'SCREENCLONE_ADMIN_SESSION_SECRET must contain at least 32 characters';
  return '';
}

function requireAdmin(request, response, next) {
  const authorization = request.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = verifyAdminSession(token, ADMIN_SESSION_SECRET);
  if (!session || session.sub !== ADMIN_USERNAME) {
    return response.status(401).json({ success: false, error: 'Phiên quản trị không hợp lệ hoặc đã hết hạn.' });
  }
  request.user = { username: session.sub, role: 'SuperAdmin' };
  return next();
}

function ownerGuard(request, response, next) {
  return next();
}

function createApplication() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  }));
  app.use((request, response, next) => {
    const host = String(request.hostname || '').toLowerCase();
    if (IS_PRODUCTION && !ALLOWED_HOSTS.has(host)) {
      return response.status(421).json({ success: false, error: 'Host không được phép.' });
    }
    return next();
  });
  app.use(express.json({ limit: '24kb', strict: true }));

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Quá nhiều lần đăng nhập. Hãy thử lại sau.' }
  });
  const loginSlowdown = slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: 3,
    delayMs: (hits) => Math.min(5000, hits * 500)
  });
  app.use('/api/', globalLimiter);

  app.post('/api/admin/login', loginLimiter, loginSlowdown, async (request, response) => {
    const configError = adminConfigurationError();
    if (configError) return response.status(503).json({ success: false, error: 'Quản trị chưa được cấu hình.' });
    const username = normalizeUsername(request.body && request.body.username);
    const password = request.body && typeof request.body.password === 'string' ? request.body.password : '';
    const usernameMatches = timingSafeEqual(username, ADMIN_USERNAME);
    const passwordMatches = verifyPassword(password, ADMIN_PASSWORD_HASH);
    if (!usernameMatches || !passwordMatches) {
      await logActivity(username || 'unknown', 'ADMIN_LOGIN_FAILED', 'owner', 'Invalid credentials', request.ip);
      return response.status(401).json({ success: false, error: 'Tên quản trị hoặc mật khẩu không chính xác.' });
    }
    const token = signAdminSession({ sub: ADMIN_USERNAME, role: 'Owner' }, ADMIN_SESSION_SECRET);
    await logActivity(ADMIN_USERNAME, 'ADMIN_LOGIN', 'owner', 'Successful owner login', request.ip);
    return response.json({ success: true, token, expiresIn: 1800, user: { username: ADMIN_USERNAME, role: 'Owner' } });
  });

  app.get('/api/admin/me', requireAdmin, (request, response) => {
    response.json({ success: true, user: request.user });
  });

  app.get('/api/admin/customers', requireAdmin, async (request, response) => {
    const customers = (await loadCustomers()).map(({ password, _id, ...customer }) => customer);
    response.json({ success: true, customers });
  });

  app.post('/api/admin/customers', requireAdmin, async (request, response) => {
    if (!database) return response.status(503).json({ success: false, error: 'Database chưa sẵn sàng.' });
    const username = normalizeUsername(request.body && request.body.username);
    const name = String((request.body && request.body.name) || '').trim().slice(0, 80);
    const password = request.body && typeof request.body.password === 'string' ? request.body.password : '';
    if (!validUsername(username) || !name || password.length < 12 || password.length > 128) {
      return response.status(400).json({ success: false, error: 'Tên đăng nhập, tên hiển thị hoặc mật khẩu không hợp lệ. Mật khẩu cần ít nhất 12 ký tự.' });
    }
    try {
      const now = new Date().toISOString();
      await database.collection('customers').insertOne({
        username,
        name,
        password: hashPassword(password),
        role: 'User',
        createdBy: ADMIN_USERNAME,
        createdAt: now,
        updatedAt: now
      });
      await logActivity(ADMIN_USERNAME, 'CUSTOMER_CREATE', username, `Created customer ${name}`, request.ip);
      return response.status(201).json({ success: true });
    } catch (error) {
      if (error && error.code === 11000) {
        return response.status(409).json({ success: false, error: 'Tên đăng nhập đã tồn tại.' });
      }
      throw error;
    }
  });

  app.put('/api/admin/customers/:username', requireAdmin, async (request, response) => {
    if (!database) return response.status(503).json({ success: false, error: 'Database chưa sẵn sàng.' });
    const username = normalizeUsername(request.params.username);
    const update = { updatedAt: new Date().toISOString() };
    if (request.body.name !== undefined) {
      const name = String(request.body.name || '').trim().slice(0, 80);
      if (!name) return response.status(400).json({ success: false, error: 'Tên hiển thị không hợp lệ.' });
      update.name = name;
    }
    if (request.body.password) {
      update.password = hashPassword(request.body.password);
    }
    const result = await database.collection('customers').updateOne({ username }, { $set: update });
    if (!result.matchedCount) return response.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    await logActivity(ADMIN_USERNAME, 'CUSTOMER_UPDATE', username, 'Updated customer credentials', request.ip);
    response.json({ success: true });
  });

  const licenseModule = createScreenCloneLicenseRouter({
    loadUsers: loadCustomers,
    verifyPassword,
    requireAdmin,
    checkAdminGuard: ownerGuard,
    logActivity,
    authLimiter: loginLimiter,
    speedLimiter: loginSlowdown,
    databaseReady: Promise.resolve(),
    getMongoDatabase: () => database,
    environment: process.env,
    localFile: path.join(__dirname, 'data', 'licenses.json')
  });
  app.use('/api/license', licenseModule.router);

  app.delete('/api/admin/customers/:username', requireAdmin, async (request, response) => {
    if (!database) return response.status(503).json({ success: false, error: 'Database chưa sẵn sàng.' });
    const username = normalizeUsername(request.params.username);
    const result = await database.collection('customers').deleteOne({ username });
    if (!result.deletedCount) return response.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });
    const devices = await licenseModule.store.listDevices(username);
    await Promise.all(devices.map((device) => licenseModule.store.deleteDevice(device.deviceId)));
    await licenseModule.store.deleteAccount(username);
    await logActivity(ADMIN_USERNAME, 'CUSTOMER_DELETE', username, 'Deleted customer and device bindings', request.ip);
    response.json({ success: true });
  });

  app.get('/api/admin/audit', requireAdmin, async (request, response) => {
    if (!database) return response.json({ success: true, logs: [] });
    const logs = await database.collection('screenclone_audit_logs')
      .find({})
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray();
    response.json({ success: true, logs });
  });

  app.get('/api/health', async (request, response) => {
    let databaseReady = false;
    try {
      databaseReady = Boolean(database && await database.command({ ping: 1 }));
    } catch {}
    const licenseError = licenseModule.configurationError();
    const adminError = adminConfigurationError();
    const healthy = databaseReady && !licenseError && !adminError;
    response.status(healthy ? 200 : 503).json({
      success: healthy,
      service: 'screenclone-license',
      databaseReady,
      licenseConfigured: !licenseError,
      adminConfigured: !adminError,
      signingKeyFingerprint: licenseModule.signer ? licenseModule.signer.fingerprint : null
    });
  });

  const publicDirectory = path.join(__dirname, 'public');
  app.use('/assets', express.static(publicDirectory, { fallthrough: false, maxAge: '1h' }));
  app.get(['/admin', '/'], (request, response) => {
    response.sendFile(path.join(publicDirectory, 'index.html'));
  });

  app.use((request, response) => response.status(404).json({ success: false, error: 'Not found' }));
  app.use((error, request, response, next) => {
    console.error('[ScreenClone] Request failed:', error.message);
    if (response.headersSent) return next(error);
    return response.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ.' });
  });
  return app;
}

async function start() {
  await connectDatabase();
  const app = createApplication();
  return app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ScreenClone] License service listening on port ${PORT}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[ScreenClone] Startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApplication, start };
