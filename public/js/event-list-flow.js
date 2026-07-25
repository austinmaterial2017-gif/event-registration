import { getEventCapability } from "./domain.js";
import { getRegistrationAvailability } from "./registration-flow.js";

export function getVisibleActivities(activities) {
  if (!Array.isArray(activities)) return [];
  return activities
    .filter((activity) => activity && getEventCapability(activity.status).visible)
    .map((activity) => ({ ...activity, canRegister: getEventCapability(activity.status).canRegister }));
}

export function getActivityCountdown(activity, serverTimestamp) {
  const availability = getRegistrationAvailability(activity, serverTimestamp);
  if (!availability.countdownTarget || !availability.countdownKind) return null;
  return {
    kind: availability.countdownKind,
    target: availability.countdownTarget,
    remainingMs: Math.max(0, availability.countdownTarget - serverTimestamp)
  };
}
