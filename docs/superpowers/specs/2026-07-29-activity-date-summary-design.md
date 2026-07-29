# Activity Date Summary Design

## Goal

Participant activity cards must show dates derived from configured session times instead of always displaying `日期待定`.

## Approved display rules

- No valid timed sessions: `日期待定`.
- One date, including multiple sessions on that date: show one localized date.
- Sessions across dates: show the earliest and latest localized dates as a range.
- Keep individual session times on the registration page; the activity card shows dates only.

## Architecture

The public activity list must remain a single lightweight request. It must not open every private activity Sheet just to calculate dates.

When an administrator saves a session, the mutation service recalculates the earliest valid `startsAt` and latest valid `endsAt` for that activity and stores those two values in the activity's existing private registration policy. Draft finalization already saves every session through the same session mutation, so generated activities receive the same summary.

`listEvents` exposes only the two safe ISO timestamps as `eventStartsAt` and `eventEndsAt`. The participant client formats them in `Asia/Kuala_Lumpur`, deduplicates same-day ranges, and falls back to `日期待定` for missing or invalid values.

## Safety and compatibility

- Do not expose participant data, Sheet IDs, or session titles in the activity list.
- Existing activities without a saved summary remain compatible and show `日期待定`.
- Editing any session refreshes the whole activity summary from authoritative session rows.
- Invalid or untimed sessions are ignored for the card summary.
- The public catalog continues to read only the registry catalog plus existing settings.

## Verification

- Unit tests cover no date, one date, same-day multiple sessions, and cross-date sessions.
- Apps Script tests prove saving sessions updates the public list summary without extra activity-Sheet reads.
- The full public-package and integration suite must pass before deployment.
