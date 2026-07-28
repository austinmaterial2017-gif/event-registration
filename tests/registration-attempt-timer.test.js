import test from "node:test";
import assert from "node:assert/strict";
import {
  createRegistrationAttemptTimer,
  formatRegistrationAttemptTime
} from "../public/js/registration-attempt-timer.js";

function fakeClock(start = 1_000_000) {
  let now = start;
  let callback = null;
  return {
    now: () => now,
    advance(milliseconds) {
      now += milliseconds;
      if (callback) callback();
    },
    setInterval(fn) {
      callback = fn;
      return 1;
    },
    clearInterval() {
      callback = null;
    }
  };
}

test("registration timer starts at five minutes using authoritative server time", () => {
  const clock = fakeClock();
  const ticks = [];
  const timer = createRegistrationAttemptTimer({
    limitMinutes: 5,
    serverNow: new Date(clock.now()).toISOString(),
    onTick: (value) => ticks.push(value),
    onExpire: () => assert.fail("must not expire"),
    clock
  });

  timer.start();
  assert.equal(ticks[0].label, "05:00");
  assert.equal(ticks[0].urgent, false);
  assert.equal(timer.remainingMs(), 300_000);
});

test("last minute becomes urgent and expiry happens once", () => {
  const clock = fakeClock();
  const ticks = [];
  let expired = 0;
  const timer = createRegistrationAttemptTimer({
    limitMinutes: 5,
    serverNow: new Date(clock.now()).toISOString(),
    onTick: (value) => ticks.push(value),
    onExpire: () => { expired += 1; },
    clock
  });

  timer.start();
  clock.advance(240_000);
  assert.equal(ticks.at(-1).label, "01:00");
  assert.equal(ticks.at(-1).urgent, true);
  clock.advance(60_000);
  clock.advance(10_000);
  assert.equal(expired, 1);
  assert.equal(timer.remainingMs(), 0);
});

test("zero disables the attempt timer and stop prevents expiry", () => {
  const disabledClock = fakeClock();
  let disabledExpired = 0;
  createRegistrationAttemptTimer({
    limitMinutes: 0,
    serverNow: new Date(disabledClock.now()).toISOString(),
    onExpire: () => { disabledExpired += 1; },
    clock: disabledClock
  }).start();
  disabledClock.advance(600_000);
  assert.equal(disabledExpired, 0);

  const stoppedClock = fakeClock();
  let stoppedExpired = 0;
  const stopped = createRegistrationAttemptTimer({
    limitMinutes: 1,
    serverNow: new Date(stoppedClock.now()).toISOString(),
    onExpire: () => { stoppedExpired += 1; },
    clock: stoppedClock
  });
  stopped.start();
  stopped.stop();
  stoppedClock.advance(60_000);
  assert.equal(stoppedExpired, 0);
});

test("time labels round up partial seconds", () => {
  assert.equal(formatRegistrationAttemptTime(299_001), "05:00");
  assert.equal(formatRegistrationAttemptTime(59_001), "01:00");
  assert.equal(formatRegistrationAttemptTime(0), "00:00");
});
