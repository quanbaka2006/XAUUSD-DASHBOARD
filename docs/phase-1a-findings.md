# Phase 1A - OANDA XAU/USD Source Probe

Status: Finnhub probe executed; production integration is unchanged.

## Candidates

### Finnhub OANDA adapter

- Symbol: `OANDA:XAU_USD`
- The existing application already uses Finnhub quote and WebSocket endpoints.
- Finnhub documents the forex candle endpoint as Premium access.
- The probe therefore tests current-price access and M1-history access separately.

### OANDA v20 direct

- Instrument: `XAU_USD`
- Candle request: midpoint (`price=M`), M1, unsmoothed.
- Direct pricing supplies bid and ask, allowing a deterministic midpoint and spread.
- Requires an OANDA v20 account ID and API token.

## Commands

The probe is read-only and prints a sanitized summary; it never prints API tokens
or full candle arrays.

```powershell
cd backend
npm run probe:xauusd:finnhub
```

To test OANDA practice directly after setting `OANDA_API_TOKEN` and
`OANDA_ACCOUNT_ID`:

```powershell
cd backend
npm run probe:xauusd:oanda
```

## Go/No-Go rule

Proceed to Phase 1B only when a candidate returns a current OANDA XAU/USD price
and at least 500 complete, ordered, unique, structurally valid M1 candles.

Yahoo `GC=F` and Binance `PAXGUSDT` are not eligible fallbacks under the market
data contract because they are different instruments.

## Current environment result

The configured Finnhub token was tested against `OANDA:XAU_USD` on 2026-07-13:

- WebSocket connected and delivered 12 matching price events in about 6 seconds.
- REST quote returned HTTP 403 (access denied).
- M1 forex-candle history returned HTTP 403 (access denied).
- Complete M1 candles available: 0/500.

The result is `NO_GO` for using the current Finnhub plan as the canonical OANDA
source for Phase 1B. Realtime streaming alone is insufficient because the signal
engine needs deterministic historical warm-up data.

The next eligible candidate is OANDA v20 direct. It cannot be measured until a
practice/live OANDA account ID and API token are supplied through environment
variables. No production code should be changed to use direct OANDA before that
probe passes.

## Official references

- OANDA v20 instrument candles and pricing:
  https://developer.oanda.com/rest-live-v20/pricing-ep/
- OANDA v20 environments and stream limits:
  https://developer.oanda.com/rest-live-v20/development-guide/
- OANDA v20 authentication:
  https://developer.oanda.com/rest-live-v20/authentication/
- Finnhub forex candle and WebSocket documentation:
  https://finnhub.io/docs/api/forex-candles
