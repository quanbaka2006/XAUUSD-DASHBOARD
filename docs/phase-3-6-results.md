# Phase 3-6 implementation results

Date: 2026-07-14

Scope excludes Auto Trade, MT5 integration, Telegram execution, and VPS Farm.
XAUUSD realtime remains Finnhub `OANDA:XAU_USD` while direct OANDA credentials
are unavailable.

## Phase 3 - Signal contract

- Removed fabricated initial BUY/SELL signals from the frontend store.
- Renamed the display score from `confidence` to `signalStrength`. It is stable
  per signal, ranges from 90 to 98, and is not a calibrated probability.
- Signal output now includes symbol, timeframe, indicator, parameter set,
  algorithm version, risk-model version, and source candle time.
- XAUUSD signal generation fails closed while market data is not ready.
- Algorithm version is `3.4.0`.
- Every indicator emits only from its own fresh native event on the most recent
  real closed candle. Reload restores the latest event, replays later real
  candles to recover its lifecycle, and does not announce it as a new event.
- Static/ATR-style signal exits use a real-swing risk model: BUY places SL below
  a real swing low and SELL above a real swing high. A confirmed pivot is
  preferred, with the latest 20-candle real extreme as fallback. TP1/TP2 extend
  by timeframe: M1 uses
  0.5R/0.75R, M5 uses 0.75R/1.25R, M15 uses 1R/1.5R, and H1 uses 1.5R/2R.
- Synthetic warm-up candles can initialize indicators but cannot trigger a
  signal, define a swing, or count as a TP/SL hit. Gap-fill candles are excluded
  from calculations and shown as a warning instead of forcing `WAIT`.
- XAUUSD exposes H1 -> M15 -> M5 confluence as supporting context. It does not
  hard-block a valid signal on the selected timeframe.

## Phase 4 - Market-data readiness and recovery

- Completed Finnhub XAUUSD M1 candles are upserted into the existing MongoDB
  Atlas database and restored after restart or instance replacement.
- Stored candles are normalized, de-duplicated, sorted, and limited to the most
  recent 5,000 completed M1 candles. Active candles are never persisted.
- M5, M15, and H1 completed candles are accepted only from full contiguous M1
  buckets.
- XAUUSD candle updates stop after 15 seconds without a realtime price while the
  market is scheduled to be open. No flat candles are forward-filled.
- Signal readiness requires at least 500 completed M1 candles.
- The UI shows `WARMUP n/500`, `FEED STALE`, or `FINNHUB OANDA`.
- `MONGODB_URI` is the only persistence setting; no Render disk is required.
- Until enough real history has accumulated, each XAUUSD timeframe returned by
  the history API includes 500 deterministic synthetic warm-up candles before
  the first real candle. Missing internal time buckets are bridged separately.
  Synthetic candles are explicitly marked and are never written to MongoDB.
- The dashboard keeps the normal feed badge while health output reports real,
  synthetic, and usable candle counts separately.
- Synthetic and gap-fill candles remain a display/warm-up aid only. The signal
  panel reports its confirmed swing, risk distance, and TP1/TP2 R:R values.

## Phase 5 - Dashboard security

- Removed the hard-coded `gold123` bootstrap password.
- A fresh local installation creates an administrator only when
  `INITIAL_ADMIN_PASSWORD` contains at least 12 characters.
- Password hashes and JWT signatures use constant-time comparison.
- JWT header algorithm/type are validated before accepting a token.
- Referral codes use a cryptographically secure random generator.
- Every HTTP response includes `X-Request-Id`.
- `/api/debug-ws` now requires administrator authentication.
- Existing users and password hashes are not modified by these bootstrap rules.

## Phase 6 - Performance, observability, and tests

- Removed fabricated frontend spread and volume counters.
- Reduced TradingChart re-renders caused by high-frequency live-price updates.
- Added `GET /api/health`, returning service and non-secret XAUUSD market-data
  status.
- Added MongoDB persistence, aggregation, warm-up, signal-contract, indicator,
  swing-risk, data-gap guard, and confluence tests.
- Production frontend build passes. The existing main bundle remains about 699
  kB before gzip and should be code-split in a later UI-only optimization.

## Operational limitations

- Finnhub REST history is unavailable with the current plan. Deterministic
  synthetic candles provide immediate indicator warm-up, while a signal still
  requires at least one real completed candle and a real swing anchor.
- If MongoDB is temporarily unavailable, the realtime feed continues in memory,
  `/api/health` reports the persistence error, and later candle writes retry.
- H1/M15/M5 confluence can remain `WAIT` after warm-up when a layer is neutral,
  the trigger is older than two M5 candles, a recent gap exists, or the feed is
  stale. This is expected fail-closed behavior.

## Render deployment

The repository includes `render.yaml` for the existing
`xauusd-dashboard-izrr` web service and uses `/api/health` as its health-check
path. Candle persistence uses the existing `MONGODB_URI` environment variable,
so no Render persistent disk or `XAU_CANDLE_STORE_PATH` is required.
