'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isXauSessionOpenAt,
  isXauBucketFullyOpenAt,
  providerTimeToUnixSeconds,
  crossesScheduledSessionClose,
  analyzeMissingBuckets
} = require('../marketData/xauSession');

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

test('uses OANDA XAU/USD daily New York session hours across daylight saving time', () => {
  assert.equal(isXauSessionOpenAt(unix('2026-07-14T20:58:00Z')), true);
  assert.equal(isXauSessionOpenAt(unix('2026-07-14T20:59:00Z')), false);
  assert.equal(isXauSessionOpenAt(unix('2026-07-14T22:04:00Z')), false);
  assert.equal(isXauSessionOpenAt(unix('2026-07-14T22:05:00Z')), true);

  assert.equal(isXauSessionOpenAt(unix('2026-01-13T21:58:00Z')), true);
  assert.equal(isXauSessionOpenAt(unix('2026-01-13T21:59:00Z')), false);
  assert.equal(isXauSessionOpenAt(unix('2026-01-13T23:05:00Z')), true);
});

test('keeps the weekend closed from Friday close until Sunday open', () => {
  assert.equal(isXauSessionOpenAt(unix('2026-07-17T20:58:00Z')), true);
  assert.equal(isXauSessionOpenAt(unix('2026-07-17T20:59:00Z')), false);
  assert.equal(isXauSessionOpenAt(unix('2026-07-18T18:00:00Z')), false);
  assert.equal(isXauSessionOpenAt(unix('2026-07-19T22:04:00Z')), false);
  assert.equal(isXauSessionOpenAt(unix('2026-07-19T22:05:00Z')), true);
});

test('separates scheduled market closure from unexpected missing live candles', () => {
  const scheduledBoundary = analyzeMissingBuckets([
    { time: unix('2026-07-14T20:58:00Z') },
    { time: unix('2026-07-14T22:06:00Z') }
  ]);
  assert.deepEqual(scheduledBoundary, {
    missingRealBuckets: 67,
    scheduledClosedBuckets: 66,
    unexpectedMissingBuckets: 1
  });

  const feedOutage = analyzeMissingBuckets([
    { time: unix('2026-07-14T19:00:00Z') },
    { time: unix('2026-07-14T19:03:00Z') }
  ]);
  assert.deepEqual(feedOutage, {
    missingRealBuckets: 2,
    scheduledClosedBuckets: 0,
    unexpectedMissingBuckets: 2
  });
});

test('normalizes provider timestamps and recognizes only scheduled discontinuities', () => {
  assert.equal(providerTimeToUnixSeconds(1_789_500_000_123), 1_789_500_000);
  assert.equal(providerTimeToUnixSeconds(1_789_500_000), 1_789_500_000);
  assert.equal(
    providerTimeToUnixSeconds('2026-07-14T22:05:00.000Z'),
    unix('2026-07-14T22:05:00Z')
  );
  assert.equal(providerTimeToUnixSeconds('invalid'), null);

  assert.equal(crossesScheduledSessionClose(
    unix('2026-07-14T20:58:00Z'),
    unix('2026-07-14T22:05:00Z')
  ), true);
  assert.equal(crossesScheduledSessionClose(
    unix('2026-07-14T19:00:00Z'),
    unix('2026-07-14T19:03:00Z')
  ), false);

  assert.equal(isXauBucketFullyOpenAt(unix('2026-07-14T19:00:00Z'), 3600), true);
  assert.equal(isXauBucketFullyOpenAt(unix('2026-07-14T20:00:00Z'), 3600), false);
});
