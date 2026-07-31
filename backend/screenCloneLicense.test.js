const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  compareVersions,
  createLicenseSigner,
  normalizeDeviceId,
  tokenDigest
} = require('./screenCloneLicense');

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
