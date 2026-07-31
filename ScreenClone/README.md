# ScreenClone

Rootless jailbreak tweak for Dopamine on iOS 15 and 16.

## Gestures

- Press Power + Volume Down together to enter selection mode.
- Drag to select a region. A borderless clone is placed at the same coordinates.
- Tap a clone to copy, share, or delete it.
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
