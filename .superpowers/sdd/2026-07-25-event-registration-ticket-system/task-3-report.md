# Task 3 Report — Public API Client and Safe Configuration

## Status

DONE

## Changed files

- `public/js/config.js` — contains only the public Web App endpoint placeholder.
- `public/js/api.js` — JSON POST client, endpoint validation, timeout handling, safe response parsing, normalized failures, and the explicit non-persistent demonstration adapter.
- `public/js/index-page.js` — loads activity data and server time through `listEvents()`.
- `public/js/register-page.js` — loads an event through `getEvent()` and submits through `createRegistration()` using `seatChoices`.
- `tests/api-contract.test.js` — contract and security coverage for all public API methods and controller integration.

## Verification

Command: `npm.cmd test`

Result: exit code 0; 26 tests passed, 0 failed, 0 skipped. The API contract tests were first run before implementation and failed with `ERR_MODULE_NOT_FOUND` for `public/js/api.js`, then passed after the client was implemented.

## Self-review findings

- The endpoint accepts only HTTPS and unsafe schemes are rejected before any request.
- Every request is a JSON POST envelope and uses an `AbortController` timeout.
- Malformed JSON, non-2xx responses, offline failures, timeouts, and server rejections return only `{ok:false, code, message}`; stack-like server messages are replaced with a generic Chinese message.
- Demonstration mode is enabled only by the exact placeholder and clearly states that registration is not stored or sent.
- Participant controllers now use API-returned server time. Missing or invalid server time fails registration gating closed.
- Public client and controllers use DOM node creation/text content; no `innerHTML` remains.
- No Sheet identifiers, credentials, allowlists, administrator routes, Apps Script source, or private records were added to public files.

## Concerns

None.
