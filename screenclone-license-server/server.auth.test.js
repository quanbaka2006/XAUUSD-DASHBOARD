const assert = require('node:assert/strict');
const test = require('node:test');

const { hashPassword } = require('./security');

process.env.SCREENCLONE_ADMIN_USERNAME = 'owner-test';
process.env.SCREENCLONE_ADMIN_PASSWORD_HASH = hashPassword('owner-test-password-123');
process.env.SCREENCLONE_ADMIN_SESSION_SECRET = 'z'.repeat(48);
process.env.SCREENCLONE_ALLOWED_HOSTS = '127.0.0.1,localhost';
process.env.NODE_ENV = 'test';

const { createApplication } = require('./server');

test('the isolated owner login grants only a short-lived ScreenClone admin session', async (context) => {
  const app = createApplication();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  context.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const wrong = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner-test', password: 'incorrect-password-value' })
  });
  assert.equal(wrong.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner-test', password: 'owner-test-password-123' })
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.user.role, 'Owner');
  assert.ok(loginBody.token);
  assert.ok(loginBody.expiresIn <= 1800);

  const me = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { Authorization: `Bearer ${loginBody.token}` }
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.username, 'owner-test');

  const alphaGoldToken = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { Authorization: 'Bearer an-alphagold-token-cannot-work-here' }
  });
  assert.equal(alphaGoldToken.status, 401);
});
