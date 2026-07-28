export function formatRegistrationAttemptTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function createRegistrationAttemptTimer({
  limitMinutes,
  serverNow,
  onTick = () => {},
  onExpire = () => {},
  clock = {
    now: () => Date.now(),
    setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
    clearInterval: (timerId) => globalThis.clearInterval(timerId)
  }
}) {
  const limitMs = Math.max(0, Number(limitMinutes || 0) * 60_000);
  const parsedServerNow = Date.parse(serverNow);
  const offset = Number.isFinite(parsedServerNow) ? parsedServerNow - clock.now() : 0;
  let deadline = 0;
  let intervalId = null;
  let expired = false;
  let stopped = false;

  const authoritativeNow = () => clock.now() + offset;
  const remainingMs = () => deadline
    ? Math.max(0, deadline - authoritativeNow())
    : limitMs;

  function stop() {
    stopped = true;
    if (intervalId !== null) clock.clearInterval(intervalId);
    intervalId = null;
  }

  function tick() {
    if (stopped || !limitMs) return;
    const remaining = remainingMs();
    onTick({
      remainingMs: remaining,
      label: formatRegistrationAttemptTime(remaining),
      urgent: remaining <= 60_000
    });
    if (remaining > 0 || expired) return;
    expired = true;
    stop();
    onExpire();
  }

  function start() {
    stopped = false;
    if (!limitMs) {
      onTick({ remainingMs: 0, label: "", urgent: false, disabled: true });
      return;
    }
    deadline = authoritativeNow() + limitMs;
    tick();
    intervalId = clock.setInterval(tick, 250);
  }

  return { start, stop, remainingMs };
}
