# Safe Session Removal Design

## Goal

Add clear removal controls to the administrator session list without damaging registrations, tickets, seats, attendance history, or activity date summaries.

## User Experience

- Every draft session has a **删除场次** button beside **编辑场次**.
- Every generated session has an action beside **编辑场次**:
  - **删除场次** when the session has no related registration, seat, or attendance history.
  - **关闭场次** when history exists and permanent deletion would be unsafe.
- Destructive actions require a specific confirmation message naming the session.
- While an action is running, its button is disabled and shows progress.
- Success feedback states exactly what happened, then refreshes the selected activity.
- Failure feedback explains that the session has related records and should be closed instead.

## Draft Sessions

Draft sessions exist only inside the activity draft document. Removing one:

1. Removes the selected draft item from `draft.sessions`.
2. Removes a draft seat-plan reference if that plan targets the removed draft session.
3. Saves the updated draft through the existing draft persistence flow.
4. Leaves all other draft settings unchanged.

## Generated Sessions

The server is authoritative. A generated session can be permanently deleted only when all of these checks pass:

- No registration row contains its `sessionId`.
- No seat row belongs to its `sessionId`.
- No attendance row belongs to its `sessionId`.

If any check fails, the server rejects permanent deletion. The administrator can instead close the session by changing its status to `inactive`; historical rows remain intact.

Successful permanent deletion:

1. Removes only the matching session row.
2. Removes its private session policy entry.
3. Recalculates the event's earliest and latest session dates.
4. Writes a `DELETE_SESSION` audit record.
5. Returns a safe success projection without exposing Sheet identifiers.

## Security and Data Integrity

- The request requires an authorized administrator session.
- The operation runs through the protected internal mutation route and script lock.
- `eventId`, `sessionId`, and explicit confirmation are required.
- The backend rechecks dependencies at deletion time; the browser cannot override them.
- No registration, participant, ticket, seat, or attendance row is deleted by this feature.

## Testing

- Draft UI removes the correct draft session and persists once.
- Generated UI renders the removal action and shows pending/success feedback.
- Backend deletes an unused session and records an audit entry.
- Backend rejects deletion when registration, seat, or attendance history exists.
- Successful deletion recalculates the public activity date range.
- Existing session editing, question removal, registration, ticket, seat, and attendance tests remain green.
