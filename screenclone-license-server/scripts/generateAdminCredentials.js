const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../security');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const toolsDirectory = path.join(repositoryRoot, '.tools');
const environmentPath = path.join(toolsDirectory, 'screenclone-admin-env.txt');
const loginPath = path.join(toolsDirectory, 'screenclone-owner-login.txt');

if (fs.existsSync(environmentPath) || fs.existsSync(loginPath)) {
  console.error('Refusing to replace existing ScreenClone owner credentials.');
  process.exit(1);
}

const username = String(process.env.SCREENCLONE_BOOTSTRAP_ADMIN_USERNAME || 'owner')
  .trim()
  .toLowerCase();
const password = process.env.SCREENCLONE_BOOTSTRAP_ADMIN_PASSWORD
  || crypto.randomBytes(24).toString('base64url');
const passwordHash = hashPassword(password);
const sessionSecret = crypto.randomBytes(48).toString('base64url');

fs.mkdirSync(toolsDirectory, { recursive: true });
fs.writeFileSync(
  environmentPath,
  `SCREENCLONE_ADMIN_USERNAME=${username}\nSCREENCLONE_ADMIN_PASSWORD_HASH=${passwordHash}\nSCREENCLONE_ADMIN_SESSION_SECRET=${sessionSecret}\n`,
  { encoding: 'utf8', mode: 0o600, flag: 'wx' }
);
fs.writeFileSync(
  loginPath,
  `ScreenClone owner login\nUsername: ${username}\nPassword: ${password}\n`,
  { encoding: 'utf8', mode: 0o600, flag: 'wx' }
);

console.log(`Deployment variables: ${environmentPath}`);
console.log(`Owner login (keep private): ${loginPath}`);
