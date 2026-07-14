# Phase 3-6 implementation results

Date: 2026-07-14

Scope excludes Auto Trade, MT5 integration, Telegram execution, and VPS Farm.
XAUUSD realtime remains Finnhub `OANDA:XAU_USD` while direct OANDA credentials
are unavailable.

## Phase 3 - Signal contract

- Removed fabricated initial BUY/SELL signals from the frontend store.
- Renamed the technical score from `confidence` to `signalStrength`; it is not
  presented as a probability.
- Signal output now includes symbol, timeframe, indicator, parameter set,
  algorithm version, risk-model version, and source candle time.
- XAUUSD signal generation fails closed while market data is not ready.
- Algorithm version is `2.0.0`.

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
- The dashboard labels this mode `SIM WARMUP +500`. Health output reports real,
  synthetic, and usable candle counts separately.

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
- Added MongoDB persistence, aggregation, warm-up, signal-contract, and indicator tests.
- Production frontend build passes. The existing main bundle remains about 699
  kB before gzip and should be code-split in a later UI-only optimization.

## Operational limitations

- Finnhub REST history is unavailable with the current plan, so the first run
  must accumulate 500 real M1 candles (about 8 hours 20 minutes of continuous
  open-market data) before the global XAUUSD readiness gate opens.
- If MongoDB is temporarily unavailable, the realtime feed continues in memory,
  `/api/health` reports the persistence error, and later candle writes retry.
- Higher-timeframe indicators can remain stale after the 500-M1 gate if their
  own warm-up periods still require more completed candles.

## Render deployment

The repository includes `render.yaml` for the existing
`xauusd-dashboard-izrr` web service and uses `/api/health` as its health-check
path. Candle persistence uses the existing `MONGODB_URI` environment variable,
so no Render persistent disk or `XAU_CANDLE_STORE_PATH` is required.
