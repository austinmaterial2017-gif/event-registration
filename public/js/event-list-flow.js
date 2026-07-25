import { getEventCapability } from "./domain.js";

export function getVisibleActivities(activities) {
  if (!Array.isArray(activities)) return [];
  return activities
    .filter((activity) => activity && getEventCapability(activity.status).visible)
    .map((activity) => ({ ...activity, canRegister: getEventCapability(activity.status).canRegister }));
}
