const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const toolsDirectory = path.join(repositoryRoot, '.tools');
const privateKeyPath = path.join(toolsDirectory, 'screenclone-license-private.pem');
const environmentPath = path.join(toolsDirectory, 'screenclone-license-env.txt');

if (fs.existsSync(privateKeyPath) || fs.existsSync(environmentPath)) {
  console.error('Refusing to replace an existing ScreenClone signing secret.');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1'
});
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const privateKeyBase64 = Buffer.from(privatePem, 'utf8').toString('base64');
const tokenPepper = crypto.randomBytes(48).toString('base64url');
const jwk = publicKey.export({ format: 'jwk' });
const publicX963 = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url')
]);
const fingerprint = crypto.createHash('sha256').update(publicX963).digest('hex');

fs.mkdirSync(toolsDirectory, { recursive: true });
fs.writeFileSync(privateKeyPath, privatePem, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
fs.writeFileSync(
  environmentPath,
  `SCREENCLONE_LICENSE_PRIVATE_KEY_B64=${privateKeyBase64}\nSCREENCLONE_TOKEN_PEPPER=${tokenPepper}\n`,
  { encoding: 'utf8', mode: 0o600, flag: 'wx' }
);

console.log(`Private key: ${privateKeyPath}`);
console.log(`Deployment variables: ${environmentPath}`);
console.log(`Public key X9.63 (Base64): ${publicX963.toString('base64')}`);
console.log(`Public key fingerprint: ${fingerprint}`);
