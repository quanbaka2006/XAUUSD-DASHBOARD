const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hashPassword,
  signAdminSession,
  verifyAdminSession,
  verifyPassword
} = require('./security');

test('customer passwords use strict salted PBKDF2 hashes', () => {
  const first = hashPassword('a-strong-customer-password');
  const second = hashPassword('a-strong-customer-password');
  assert.notEqual(first, second);
  assert.equal(verifyPassword('a-strong-customer-password', first), true);
  assert.equal(verifyPassword('wrong-password-value', first), false);
  assert.equal(verifyPassword('legacy-plaintext', 'legacy-plaintext'), false);
});

test('owner sessions are audience-bound and reject tampering', () => {
  const secret = 's'.repeat(48);
  const token = signAdminSession({ sub: 'owner', role: 'Owner' }, secret, 600);
  const verified = verifyAdminSession(token, secret);
  assert.equal(verified.sub, 'owner');
  assert.equal(verified.role, 'Owner');
  assert.equal(verified.aud, 'screenclone-admin');

  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1].slice(0, -1)}A.${parts[2]}`;
  assert.equal(verifyAdminSession(tampered, secret), null);
  assert.equal(verifyAdminSession(token, 'x'.repeat(48)), null);
});

test('short secrets and weak passwords fail closed', () => {
  assert.throws(() => hashPassword('short'), /between 12 and 128/);
  assert.throws(() => signAdminSession({ sub: 'owner', role: 'Owner' }, 'short'), /not configured/);
});
