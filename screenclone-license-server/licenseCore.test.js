const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  compareVersions,
  createLicenseSigner,
  createScreenCloneLicenseRouter,
  normalizeDeviceId,
  tokenDigest
} = require('./licenseCore');

test('P-256 license token is signed in a format the client can verify', () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const signer = createLicenseSigner(privatePem);
  const payload = {
    v: 1,
    typ: 'screenclone-license',
    sub: 'customer',
    did: 'a'.repeat(64),
    iat: 100,
    exp: 200
  };

  const token = signer.sign(payload);
  const [payloadSegment, signatureSegment] = token.split('.');
  const publicKey = crypto.createPublicKey(privateKey);
  const verified = crypto.verify(
    'sha256',
    Buffer.from(payloadSegment, 'ascii'),
    publicKey,
    Buffer.from(signatureSegment, 'base64url')
  );

  assert.equal(verified, true);
  assert.deepEqual(
    JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')),
    payload
  );
  assert.equal(Buffer.from(signer.publicKeyX963Base64, 'base64').length, 65);
  assert.match(signer.fingerprint, /^[a-f0-9]{64}$/);
});

test('device ids accept only a normalized SHA-256 hex digest', () => {
  assert.equal(normalizeDeviceId('A'.repeat(64)), 'a'.repeat(64));
  assert.equal(normalizeDeviceId('not-a-device'), '');
  assert.equal(normalizeDeviceId('a'.repeat(63)), '');
});

test('client version comparison enforces minimum releases', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  assert.equal(compareVersions('1.2.0-beta.1', '1.1.9'), 1);
});

test('refresh tokens are bound to the server-only pepper', () => {
  const first = tokenDigest('refresh-token', 'a'.repeat(32));
  const second = tokenDigest('refresh-token', 'b'.repeat(32));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(first, tokenDigest('refresh-token', 'a'.repeat(32)));
});

test('account approval, token rotation, replay blocking, and revocation work end to end', async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'screenclone-license-'));
  const localFile = path.join(temporaryDirectory, 'licenses.json');
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const users = [
    { username: 'admin', password: 'admin-secret', name: 'Admin', role: 'SuperAdmin' },
    { username: 'customer', password: 'customer-secret', name: 'Customer', role: 'User', createdBy: 'admin' }
  ];
  const app = express();
  app.use(express.json());
  const licenseModule = createScreenCloneLicenseRouter({
    loadUsers: async () => users,
    verifyPassword: (password, stored) => password === stored,
    requireAdmin: (request, response, next) => {
      request.user = { username: 'admin', role: 'SuperAdmin' };
      next();
    },
    checkAdminGuard: (request, response, next) => next(),
    logActivity: async () => {},
    getMongoDatabase: () => null,
    databaseReady: Promise.resolve(),
    privateKeyPem,
    tokenPepper: 'integration-test-pepper-value-1234567890',
    environment: {
      SCREENCLONE_MIN_CLIENT_VERSION: '1.0.0',
      SCREENCLONE_OFFLINE_HOURS: '1'
    },
    localFile
  });
  app.use('/api/screenclone', licenseModule.router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  context.after(() => {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/screenclone`;
  const request = async (route, method = 'GET', body = undefined) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };

  const licenseUpdate = await request('/admin/accounts/customer', 'PUT', {
    enabled: true,
    maxDevices: 1,
    offlineHours: 1
  });
  assert.equal(licenseUpdate.status, 200);

  const deviceId = 'c'.repeat(64);
  const loginBody = {
    username: 'customer',
    password: 'customer-secret',
    deviceId,
    deviceLabel: 'Test iPhone',
    model: 'iPhone12,1',
    iosVersion: '16.6',
    clientVersion: '1.0.0',
    nonce: 'first-nonce-1234567890'
  };
  const pending = await request('/login', 'POST', loginBody);
  assert.equal(pending.status, 202);
  assert.equal(pending.body.code, 'device_pending');

  const approved = await request(`/admin/devices/${deviceId}/approve`, 'POST', {});
  assert.equal(approved.status, 200);
  assert.equal(approved.body.device.status, 'approved');

  const login = await request('/login', 'POST', { ...loginBody, nonce: 'second-nonce-1234567890' });
  assert.equal(login.status, 200);
  assert.equal(login.body.success, true);
  assert.ok(login.body.refreshToken);
  assert.match(login.body.entitlement, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const refreshBody = {
    username: 'customer',
    deviceId,
    refreshToken: login.body.refreshToken,
    clientVersion: '1.0.0',
    nonce: 'refresh-nonce-1234567890'
  };
  const refreshed = await request('/refresh', 'POST', refreshBody);
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refreshToken, login.body.refreshToken);

  const replay = await request('/refresh', 'POST', refreshBody);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'invalid_session');

  const revoked = await request(`/admin/devices/${deviceId}/revoke`, 'POST', {});
  assert.equal(revoked.status, 200);
  const refreshAfterRevoke = await request('/refresh', 'POST', {
    ...refreshBody,
    refreshToken: refreshed.body.refreshToken,
    nonce: 'revoked-nonce-1234567890'
  });
  assert.equal(refreshAfterRevoke.status, 403);
  assert.equal(refreshAfterRevoke.body.code, 'license_revoked');
});
