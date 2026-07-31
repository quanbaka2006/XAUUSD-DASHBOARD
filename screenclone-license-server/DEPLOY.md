# Deploy ScreenClone License separately

This service must be deployed as a new Render Web Service. Do not add its
environment variables to the AlphaGold service.

## Isolation boundary

- Root directory: `screenclone-license-server`
- Build command: `npm ci`
- Start command: `npm start`
- Health check: `/api/health`
- Custom domain: `license.alphagoldhub.com`
- Database: `screenclone_license`
- MongoDB user: a dedicated user with `readWrite` permission only on
  `screenclone_license`

The service has its own owner login, customer table, device table, audit log,
session secret, refresh-token pepper, and P-256 signing key. It imports no
AlphaGold server module and cannot read AlphaGold users unless its dedicated
MongoDB credential is incorrectly granted access.

## Secret provisioning

Generate the signing key once:

```powershell
npm.cmd run generate:key
```

Generate the owner login once:

```powershell
npm.cmd run generate:admin
```

Copy the variables from the two generated files under `.tools` into the new
Render service. Never paste them into a ticket, chat, Git commit, frontend
bundle, or the AlphaGold service.

Add `SCREENCLONE_MONGODB_URI`, `SCREENCLONE_DB_NAME=screenclone_license`,
`SCREENCLONE_MIN_CLIENT_VERSION=1.1.0`, and
`SCREENCLONE_ALLOWED_HOSTS=license.alphagoldhub.com,<render-hostname>`.

## Domain

Attach `license.alphagoldhub.com` as a custom domain on the new Render service,
then create only the DNS record requested by Render. Do not change the apex
`alphagoldhub.com` or `www` records. The admin portal will be available at
`https://license.alphagoldhub.com/admin`.

Install the licensed tweak only after `/api/health` reports HTTP 200 and its
`signingKeyFingerprint` matches `SCLicensePublicKeyFingerprint` in the tweak.
