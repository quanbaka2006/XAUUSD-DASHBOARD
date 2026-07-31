# ScreenClone

Version 1.1 introduces an isolated account and device licensing service. It
does not use AlphaGold website users, sessions, JWT secrets, or collections.
A new device must sign in,
appear in the web administration panel, and be approved before capture is
enabled. Entitlements are signed by the server with P-256; only the public key
is included in the tweak. Refresh credentials rotate after every successful
check and an administrator can revoke a device remotely.

Required server environment variables:

- `SCREENCLONE_MONGODB_URI` (a dedicated database/service account)
- `SCREENCLONE_DB_NAME=screenclone_license`
- `SCREENCLONE_LICENSE_PRIVATE_KEY_B64`
- `SCREENCLONE_TOKEN_PEPPER` (at least 32 characters)
- `SCREENCLONE_ADMIN_USERNAME`
- `SCREENCLONE_ADMIN_PASSWORD_HASH`
- `SCREENCLONE_ADMIN_SESSION_SECRET`
- `SCREENCLONE_MIN_CLIENT_VERSION=1.1.0`
- `SCREENCLONE_OFFLINE_HOURS=12` (1-24)

The private signing key must never be committed or placed in the `.deb`.

Rootless jailbreak tweak for Dopamine on iOS 15 and 16.

## Gestures

- Hold Home, then press Volume Down to enter selection mode.
- On Face ID devices, quickly press Volume Up and then Volume Down instead.
- Drag to select a region. A borderless clone is placed at the same coordinates.
- Tap a clone to copy, share, or delete it.
- In MetaTrader 5, tapping the Trade tab shows clones; the other four tabs
  hide them. The invisible bottom zones pass the touch through to the app.
- Respring to clear all clones in this initial version.

The border is visible only while selecting; the resulting clone has no border.
Secure/DRM content may be black because iOS prevents it from being captured.

## Build

Install Theos and an iOS SDK, then run:

```sh
make package THEOS_PACKAGE_SCHEME=rootless FINALPACKAGE=1
```

The package is written to `packages/` and can be installed with Sileo, Filza,
or `dpkg`.
