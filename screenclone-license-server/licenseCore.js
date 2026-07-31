const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const DEVICE_ID_PATTERN = /^[a-f0-9]{64}$/;
const CLIENT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/;
const LICENSE_TYPE = 'screenclone-license';
const MAX_DEVICE_LABEL_LENGTH = 80;
const MAX_METADATA_LENGTH = 64;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDeviceId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DEVICE_ID_PATTERN.test(normalized) ? normalized : '';
}

function cleanText(value, maxLength = MAX_METADATA_LENGTH) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function compareVersions(left, right) {
  const parse = (value) => String(value || '0.0.0')
    .split(/[+-]/, 1)[0]
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) > (b[index] || 0)) return 1;
    if ((a[index] || 0) < (b[index] || 0)) return -1;
  }
  return 0;
}

function tokenDigest(token, pepper) {
  return crypto.createHmac('sha256', pepper).update(String(token || ''), 'utf8').digest('hex');
}

function createLicenseSigner(privateKeyPem) {
  if (!privateKeyPem) return null;
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ec') {
    throw new Error('SCREENCLONE license key must be an EC private key');
  }

  const publicKey = crypto.createPublicKey(privateKey);
  const details = publicKey.asymmetricKeyDetails || {};
  if (details.namedCurve && !['prime256v1', 'P-256'].includes(details.namedCurve)) {
    throw new Error('SCREENCLONE license key must use the P-256 curve');
  }

  const jwk = publicKey.export({ format: 'jwk' });
  const publicX963 = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url')
  ]);
  const fingerprint = crypto.createHash('sha256').update(publicX963).digest('hex');

  return {
    publicKeyX963Base64: publicX963.toString('base64'),
    fingerprint,
    sign(payload) {
      const payloadSegment = base64url(JSON.stringify(payload));
      const signature = crypto.sign(
        'sha256',
        Buffer.from(payloadSegment, 'ascii'),
        { key: privateKey, dsaEncoding: 'der' }
      );
      return `${payloadSegment}.${signature.toString('base64url')}`;
    }
  };
}

function readPrivateKeyFromEnvironment(environment = process.env) {
  if (environment.SCREENCLONE_LICENSE_PRIVATE_KEY_B64) {
    return Buffer.from(environment.SCREENCLONE_LICENSE_PRIVATE_KEY_B64, 'base64').toString('utf8');
  }
  if (environment.SCREENCLONE_LICENSE_PRIVATE_KEY_FILE) {
    return fs.readFileSync(environment.SCREENCLONE_LICENSE_PRIVATE_KEY_FILE, 'utf8');
  }
  return '';
}

function createStore({ getMongoDatabase, databaseReady, localFile }) {
  let localQueue = Promise.resolve();

  async function mongoDatabase() {
    if (databaseReady) await databaseReady;
    return typeof getMongoDatabase === 'function' ? getMongoDatabase() : null;
  }

  function emptyState() {
    return { accounts: {}, devices: {} };
  }

  function readLocal() {
    try {
      if (!fs.existsSync(localFile)) return emptyState();
      const parsed = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      return {
        accounts: parsed && typeof parsed.accounts === 'object' ? parsed.accounts : {},
        devices: parsed && typeof parsed.devices === 'object' ? parsed.devices : {}
      };
    } catch (error) {
      console.error('[ScreenClone License] Failed to read local store:', error.message);
      return emptyState();
    }
  }

  function mutateLocal(mutator) {
    const operation = localQueue.then(async () => {
      const state = readLocal();
      const result = await mutator(state);
      const tempFile = `${localFile}.${process.pid}.tmp`;
      fs.mkdirSync(path.dirname(localFile), { recursive: true });
      fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempFile, localFile);
      return result;
    });
    localQueue = operation.catch(() => {});
    return operation;
  }

  return {
    async initialize() {
      const database = await mongoDatabase();
      if (!database) return;
      await Promise.all([
        database.collection('screenclone_license_accounts').createIndex({ username: 1 }, { unique: true }),
        database.collection('screenclone_license_devices').createIndex({ deviceId: 1 }, { unique: true }),
        database.collection('screenclone_license_devices').createIndex({ username: 1, status: 1 }),
        database.collection('screenclone_license_devices').createIndex({ lastSeenAt: -1 })
      ]);
    },

    async getAccount(username) {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_accounts').findOne({ username });
      }
      return readLocal().accounts[username] || null;
    },

    async listAccounts() {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_accounts').find({}).toArray();
      }
      return Object.values(readLocal().accounts);
    },

    async putAccount(account) {
      const database = await mongoDatabase();
      if (database) {
        await database.collection('screenclone_license_accounts').updateOne(
          { username: account.username },
          { $set: account },
          { upsert: true }
        );
        return account;
      }
      return mutateLocal((state) => {
        state.accounts[account.username] = account;
        return account;
      });
    },

    async deleteAccount(username) {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_accounts').deleteOne({ username });
      }
      return mutateLocal((state) => {
        const existed = Boolean(state.accounts[username]);
        delete state.accounts[username];
        return { deletedCount: existed ? 1 : 0 };
      });
    },

    async getDevice(deviceId) {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_devices').findOne({ deviceId });
      }
      return readLocal().devices[deviceId] || null;
    },

    async listDevices(username = null) {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_devices')
          .find(username ? { username } : {})
          .sort({ createdAt: -1 })
          .toArray();
      }
      const devices = Object.values(readLocal().devices);
      return username ? devices.filter((device) => device.username === username) : devices;
    },

    async putDevice(device) {
      const database = await mongoDatabase();
      if (database) {
        await database.collection('screenclone_license_devices').updateOne(
          { deviceId: device.deviceId },
          { $set: device },
          { upsert: true }
        );
        return device;
      }
      return mutateLocal((state) => {
        state.devices[device.deviceId] = device;
        return device;
      });
    },

    async deleteDevice(deviceId) {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_devices').deleteOne({ deviceId });
      }
      return mutateLocal((state) => {
        const existed = Boolean(state.devices[deviceId]);
        delete state.devices[deviceId];
        return { deletedCount: existed ? 1 : 0 };
      });
    },

    async invalidateUserTokens(username) {
      const database = await mongoDatabase();
      if (database) {
        return database.collection('screenclone_license_devices').updateMany(
          { username },
          { $unset: { refreshTokenHash: '' }, $set: { tokenRotatedAt: new Date().toISOString() } }
        );
      }
      return mutateLocal((state) => {
        Object.values(state.devices).forEach((device) => {
          if (device.username === username) {
            delete device.refreshTokenHash;
            device.tokenRotatedAt = new Date().toISOString();
          }
        });
      });
    },

    async rotateDeviceToken(deviceId, expectedHash, nextHash, patch) {
      const database = await mongoDatabase();
      if (database) {
        const result = await database.collection('screenclone_license_devices').findOneAndUpdate(
          { deviceId, refreshTokenHash: expectedHash },
          { $set: { ...patch, refreshTokenHash: nextHash } },
          { returnDocument: 'after' }
        );
        return result || null;
      }
      return mutateLocal((state) => {
        const device = state.devices[deviceId];
        if (!device || !timingSafeTextEqual(device.refreshTokenHash, expectedHash)) return null;
        Object.assign(device, patch, { refreshTokenHash: nextHash });
        return { ...device };
      });
    }
  };
}

function createScreenCloneLicenseRouter(options) {
  const {
    loadUsers,
    verifyPassword,
    requireAdmin,
    checkAdminGuard,
    logActivity,
    getMongoDatabase,
    databaseReady,
    authLimiter,
    speedLimiter,
    environment = process.env,
    localFile = path.join(__dirname, 'screenclone_licenses.json')
  } = options;

  const router = express.Router();
  const privateKeyPem = options.privateKeyPem || readPrivateKeyFromEnvironment(environment);
  let signer = null;
  let signingError = '';
  try {
    signer = createLicenseSigner(privateKeyPem);
  } catch (error) {
    signingError = error.message;
    console.error('[ScreenClone License] Signing key rejected:', error.message);
  }

  const tokenPepper = options.tokenPepper || environment.SCREENCLONE_TOKEN_PEPPER || '';
  const minimumClientVersion = environment.SCREENCLONE_MIN_CLIENT_VERSION || '1.0.0';
  const defaultOfflineHours = clampInteger(environment.SCREENCLONE_OFFLINE_HOURS, 1, 24, 12);
  const store = createStore({ getMongoDatabase, databaseReady, localFile });
  store.initialize().catch((error) => {
    console.error('[ScreenClone License] Store initialization failed:', error.message);
  });

  function configurationError() {
    if (!signer) return signingError || 'SCREENCLONE_LICENSE_PRIVATE_KEY_B64 is not configured';
    if (tokenPepper.length < 32) return 'SCREENCLONE_TOKEN_PEPPER must contain at least 32 characters';
    return '';
  }

  async function findUser(username) {
    const users = await loadUsers();
    return users.find((user) => normalizeUsername(user.username) === username) || null;
  }

  function userExpired(user) {
    return Boolean(user.expiresAt && Date.now() > new Date(user.expiresAt).getTime());
  }

  function accountExpired(account) {
    return Boolean(account && account.expiresAt && Date.now() > new Date(account.expiresAt).getTime());
  }

  function sanitizeAccount(account, username) {
    return {
      username,
      enabled: Boolean(account && account.enabled),
      maxDevices: clampInteger(account && account.maxDevices, 1, 20, 1),
      offlineHours: clampInteger(account && account.offlineHours, 1, 24, defaultOfflineHours),
      expiresAt: account && account.expiresAt ? account.expiresAt : null,
      tokenVersion: clampInteger(account && account.tokenVersion, 1, 1000000000, 1),
      updatedAt: account && account.updatedAt ? account.updatedAt : null,
      updatedBy: account && account.updatedBy ? account.updatedBy : null
    };
  }

  function publicDevice(device) {
    return {
      deviceId: device.deviceId,
      username: device.username,
      label: device.label || '',
      model: device.model || '',
      iosVersion: device.iosVersion || '',
      clientVersion: device.clientVersion || '',
      status: device.status,
      createdAt: device.createdAt,
      approvedAt: device.approvedAt || null,
      approvedBy: device.approvedBy || null,
      revokedAt: device.revokedAt || null,
      revokedBy: device.revokedBy || null,
      lastSeenAt: device.lastSeenAt || null,
      lastIp: device.lastIp || null
    };
  }

  function issueCredentials({ account, device, nonce }) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    const offlineSeconds = account.offlineHours * 60 * 60;
    const entitlement = signer.sign({
      v: 1,
      typ: LICENSE_TYPE,
      sub: account.username,
      did: device.deviceId,
      tv: account.tokenVersion,
      iat: nowSeconds,
      nbf: nowSeconds - 30,
      exp: nowSeconds + offlineSeconds,
      nonce,
      min: minimumClientVersion
    });
    return { refreshToken, entitlement, expiresAt: nowSeconds + offlineSeconds, serverTime: nowSeconds };
  }

  function validateClientBody(body) {
    const username = normalizeUsername(body.username);
    const deviceId = normalizeDeviceId(body.deviceId);
    const clientVersion = cleanText(body.clientVersion, 32);
    const nonce = cleanText(body.nonce, 96);
    if (!username || username.length > 50 || !deviceId || !nonce || nonce.length < 16) {
      return { error: 'Yêu cầu kích hoạt không hợp lệ.' };
    }
    if (!CLIENT_VERSION_PATTERN.test(clientVersion) || compareVersions(clientVersion, minimumClientVersion) < 0) {
      return { error: 'Phiên bản ScreenClone đã cũ. Vui lòng cập nhật.', code: 'upgrade_required' };
    }
    return { username, deviceId, clientVersion, nonce };
  }

  async function requireManageUser(req, res, username) {
    if (req.user.role === 'SuperAdmin') return true;
    const target = await findUser(username);
    if (target && (normalizeUsername(target.createdBy) === normalizeUsername(req.user.username)
      || normalizeUsername(target.username) === normalizeUsername(req.user.username))) {
      return true;
    }
    res.status(403).json({ success: false, error: 'Bạn không có quyền quản lý giấy phép này.' });
    return false;
  }

  const loginMiddleware = [authLimiter, speedLimiter].filter(Boolean);
  router.post('/login', ...loginMiddleware, async (req, res) => {
    const configError = configurationError();
    if (configError) return res.status(503).json({ success: false, error: 'Máy chủ bản quyền chưa sẵn sàng.' });

    const validated = validateClientBody(req.body || {});
    if (validated.error) return res.status(400).json({ success: false, error: validated.error, code: validated.code });
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!password || password.length > 128) {
      return res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    }

    const user = await findUser(validated.username);
    if (!user || userExpired(user) || !verifyPassword(password, user.password)) {
      return res.status(401).json({ success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
    }

    const account = sanitizeAccount(await store.getAccount(validated.username), validated.username);
    if (!account.enabled || accountExpired(account)) {
      return res.status(403).json({ success: false, error: 'Tài khoản chưa được cấp quyền ScreenClone hoặc đã hết hạn.', code: 'license_disabled' });
    }

    let device = await store.getDevice(validated.deviceId);
    if (device && device.username !== validated.username) {
      return res.status(409).json({ success: false, error: 'Thiết bị này đã được liên kết với tài khoản khác.', code: 'device_bound' });
    }

    const now = new Date().toISOString();
    if (!device) {
      device = {
        deviceId: validated.deviceId,
        username: validated.username,
        label: cleanText(req.body.deviceLabel, MAX_DEVICE_LABEL_LENGTH),
        model: cleanText(req.body.model),
        iosVersion: cleanText(req.body.iosVersion),
        clientVersion: validated.clientVersion,
        status: 'pending',
        createdAt: now,
        lastSeenAt: now,
        lastIp: req.ip
      };
      await store.putDevice(device);
      await logActivity(validated.username, 'SCREENCLONE_DEVICE_REQUEST', validated.deviceId.slice(0, 12), 'Yêu cầu duyệt thiết bị mới', req.ip);
    } else {
      device = {
        ...device,
        label: cleanText(req.body.deviceLabel, MAX_DEVICE_LABEL_LENGTH) || device.label,
        model: cleanText(req.body.model) || device.model,
        iosVersion: cleanText(req.body.iosVersion) || device.iosVersion,
        clientVersion: validated.clientVersion,
        lastSeenAt: now,
        lastIp: req.ip
      };
      await store.putDevice(device);
    }

    if (device.status !== 'approved') {
      const statusCode = device.status === 'revoked' ? 403 : 202;
      const message = device.status === 'revoked'
        ? 'Thiết bị đã bị thu hồi quyền sử dụng.'
        : 'Thiết bị đang chờ quản trị viên phê duyệt.';
      return res.status(statusCode).json({ success: false, status: device.status, code: `device_${device.status}`, error: message });
    }

    const credentials = issueCredentials({ account, device, nonce: validated.nonce });
    device.refreshTokenHash = tokenDigest(credentials.refreshToken, tokenPepper);
    device.lastSeenAt = now;
    device.tokenRotatedAt = now;
    await store.putDevice(device);
    return res.json({ success: true, status: 'approved', ...credentials });
  });

  router.post('/refresh', async (req, res) => {
    const configError = configurationError();
    if (configError) return res.status(503).json({ success: false, error: 'Máy chủ bản quyền chưa sẵn sàng.' });

    const validated = validateClientBody(req.body || {});
    if (validated.error) return res.status(400).json({ success: false, error: validated.error, code: validated.code });
    const refreshToken = typeof req.body.refreshToken === 'string' ? req.body.refreshToken : '';
    if (refreshToken.length < 32 || refreshToken.length > 128) {
      return res.status(401).json({ success: false, error: 'Phiên đăng nhập không hợp lệ.', code: 'invalid_session' });
    }

    const user = await findUser(validated.username);
    const account = sanitizeAccount(await store.getAccount(validated.username), validated.username);
    const device = await store.getDevice(validated.deviceId);
    if (!user || userExpired(user) || !account.enabled || accountExpired(account)
      || !device || device.username !== validated.username || device.status !== 'approved') {
      return res.status(403).json({ success: false, error: 'Giấy phép đã hết hạn hoặc bị thu hồi.', code: 'license_revoked' });
    }

    const expectedHash = tokenDigest(refreshToken, tokenPepper);
    if (!device.refreshTokenHash || !timingSafeTextEqual(device.refreshTokenHash, expectedHash)) {
      return res.status(401).json({ success: false, error: 'Phiên đăng nhập không hợp lệ.', code: 'invalid_session' });
    }

    const credentials = issueCredentials({ account, device, nonce: validated.nonce });
    const nextHash = tokenDigest(credentials.refreshToken, tokenPepper);
    const now = new Date().toISOString();
    const rotated = await store.rotateDeviceToken(validated.deviceId, expectedHash, nextHash, {
      clientVersion: validated.clientVersion,
      lastSeenAt: now,
      lastIp: req.ip,
      tokenRotatedAt: now
    });
    if (!rotated) {
      return res.status(401).json({ success: false, error: 'Phiên đã được sử dụng hoặc thay thế.', code: 'replayed_session' });
    }
    return res.json({ success: true, status: 'approved', ...credentials });
  });

  router.get('/admin/licenses', requireAdmin, async (req, res) => {
    const users = await loadUsers();
    const accounts = await store.listAccounts();
    const devices = await store.listDevices();
    const accountMap = new Map(accounts.map((account) => [account.username, account]));
    const visibleUsers = req.user.role === 'SuperAdmin'
      ? users
      : users.filter((user) => normalizeUsername(user.createdBy) === normalizeUsername(req.user.username)
        || normalizeUsername(user.username) === normalizeUsername(req.user.username));

    const licenses = visibleUsers.map((user) => {
      const username = normalizeUsername(user.username);
      return {
        username,
        name: user.name || username,
        role: user.role,
        accountExpiresAt: user.expiresAt || null,
        license: sanitizeAccount(accountMap.get(username), username),
        devices: devices.filter((device) => device.username === username).map(publicDevice)
      };
    });
    res.json({
      success: true,
      configured: !configurationError(),
      signingKeyFingerprint: signer ? signer.fingerprint : null,
      minimumClientVersion,
      licenses
    });
  });

  router.put('/admin/accounts/:username', requireAdmin, checkAdminGuard, async (req, res) => {
    const username = normalizeUsername(req.params.username);
    if (!await requireManageUser(req, res, username)) return;
    const user = await findUser(username);
    if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản.' });

    const previous = sanitizeAccount(await store.getAccount(username), username);
    const enabled = req.body.enabled === undefined ? previous.enabled : Boolean(req.body.enabled);
    const maxDevices = clampInteger(req.body.maxDevices, 1, 20, previous.maxDevices);
    const offlineHours = clampInteger(req.body.offlineHours, 1, 24, previous.offlineHours);
    let expiresAt = previous.expiresAt;
    if (req.body.expiresAt !== undefined) {
      const parsedExpiry = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
      if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({ success: false, error: 'Ngày hết hạn không hợp lệ.' });
      }
      expiresAt = parsedExpiry ? parsedExpiry.toISOString() : null;
    }

    const entitlementChanged = previous.enabled !== enabled
      || previous.maxDevices !== maxDevices
      || previous.offlineHours !== offlineHours
      || previous.expiresAt !== expiresAt;
    const account = {
      username,
      enabled,
      maxDevices,
      offlineHours,
      expiresAt,
      tokenVersion: entitlementChanged ? previous.tokenVersion + 1 : previous.tokenVersion,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username
    };
    await store.putAccount(account);
    if (entitlementChanged) await store.invalidateUserTokens(username);
    await logActivity(req.user.username, 'SCREENCLONE_LICENSE_UPDATE', username,
      `enabled=${enabled}, maxDevices=${maxDevices}, offlineHours=${offlineHours}, expiresAt=${expiresAt || 'none'}`, req.ip);
    res.json({ success: true, license: account });
  });

  router.post('/admin/devices/:deviceId/approve', requireAdmin, async (req, res) => {
    const deviceId = normalizeDeviceId(req.params.deviceId);
    const device = deviceId ? await store.getDevice(deviceId) : null;
    if (!device) return res.status(404).json({ success: false, error: 'Không tìm thấy thiết bị.' });
    if (!await requireManageUser(req, res, device.username)) return;
    const account = sanitizeAccount(await store.getAccount(device.username), device.username);
    if (!account.enabled || accountExpired(account)) {
      return res.status(400).json({ success: false, error: 'Hãy bật giấy phép tài khoản trước khi duyệt thiết bị.' });
    }
    const devices = await store.listDevices(device.username);
    const approvedCount = devices.filter((item) => item.status === 'approved' && item.deviceId !== deviceId).length;
    if (approvedCount >= account.maxDevices) {
      return res.status(409).json({ success: false, error: `Tài khoản chỉ được phép dùng ${account.maxDevices} thiết bị.` });
    }
    const now = new Date().toISOString();
    const updated = {
      ...device,
      status: 'approved',
      approvedAt: now,
      approvedBy: req.user.username,
      revokedAt: null,
      revokedBy: null
    };
    delete updated.refreshTokenHash;
    await store.putDevice(updated);
    await logActivity(req.user.username, 'SCREENCLONE_DEVICE_APPROVE', device.username, deviceId.slice(0, 12), req.ip);
    res.json({ success: true, device: publicDevice(updated) });
  });

  router.post('/admin/devices/:deviceId/revoke', requireAdmin, async (req, res) => {
    const deviceId = normalizeDeviceId(req.params.deviceId);
    const device = deviceId ? await store.getDevice(deviceId) : null;
    if (!device) return res.status(404).json({ success: false, error: 'Không tìm thấy thiết bị.' });
    if (!await requireManageUser(req, res, device.username)) return;
    const now = new Date().toISOString();
    const updated = {
      ...device,
      status: 'revoked',
      revokedAt: now,
      revokedBy: req.user.username
    };
    delete updated.refreshTokenHash;
    await store.putDevice(updated);
    await logActivity(req.user.username, 'SCREENCLONE_DEVICE_REVOKE', device.username, deviceId.slice(0, 12), req.ip);
    res.json({ success: true, device: publicDevice(updated) });
  });

  router.post('/admin/devices/:deviceId/pending', requireAdmin, async (req, res) => {
    const deviceId = normalizeDeviceId(req.params.deviceId);
    const device = deviceId ? await store.getDevice(deviceId) : null;
    if (!device) return res.status(404).json({ success: false, error: 'Không tìm thấy thiết bị.' });
    if (!await requireManageUser(req, res, device.username)) return;
    const updated = { ...device, status: 'pending', approvedAt: null, approvedBy: null };
    delete updated.refreshTokenHash;
    await store.putDevice(updated);
    await logActivity(req.user.username, 'SCREENCLONE_DEVICE_PENDING', device.username, deviceId.slice(0, 12), req.ip);
    res.json({ success: true, device: publicDevice(updated) });
  });

  router.delete('/admin/devices/:deviceId', requireAdmin, async (req, res) => {
    const deviceId = normalizeDeviceId(req.params.deviceId);
    const device = deviceId ? await store.getDevice(deviceId) : null;
    if (!device) return res.status(404).json({ success: false, error: 'Không tìm thấy thiết bị.' });
    if (!await requireManageUser(req, res, device.username)) return;
    await store.deleteDevice(deviceId);
    await logActivity(req.user.username, 'SCREENCLONE_DEVICE_DELETE', device.username, deviceId.slice(0, 12), req.ip);
    res.json({ success: true });
  });

  router.get('/admin/health', requireAdmin, (req, res) => {
    const error = configurationError();
    res.status(error ? 503 : 200).json({
      success: !error,
      configured: !error,
      error: error || null,
      signingKeyFingerprint: signer ? signer.fingerprint : null,
      minimumClientVersion,
      defaultOfflineHours
    });
  });

  return { router, store, signer, configurationError };
}

module.exports = {
  compareVersions,
  createLicenseSigner,
  createScreenCloneLicenseRouter,
  normalizeDeviceId,
  tokenDigest
};
