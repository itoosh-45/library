# Image recognition fallback diagnostics — 0.24.1

A saved Gemini key confirms local storage and user consent, not a successful provider request. Previously, the router discarded a failed cloud request's reason, and local OCR progress replaced the fallback notice. The user could therefore see a configured key and a local result without knowing why Gemini failed.

Single-book recognition now keeps a separate diagnostic section with the actual result provider and fixed, safe failure messages. It distinguishes HTTP 400 (invalid request), 401/403 (key/access), 429 (quota/rate limit), other server errors, network errors, and a configured provider already held for quota. No response body or credential is included in diagnostics, logs, backups or GitHub. Successful fallback still completes normally.

The existing spending lock and quota policies remain: Gemini 429 pauses requests until the next provider day, Groq honors its bounded wait, and no paid retry is introduced. This change does not establish the cause of the user's live Gemini failure; the safe diagnostic shown on their next scan is still required. Provider tests use synthetic keys and intercepted responses, not live AI inference.

Validation: typecheck, lint, 216 unit tests, 15 Node gateway tests and both builds; three targeted Chromium key/fallback tests, including actual local OCR after a mocked Gemini 401; two production CSP/fallback tests. A deliberate inversion of HTTP 400 classification failed the regression test and was restored. One full-run legacy shelf-save test exceeded its five-second timeout under local load; the suite was rerun with two workers. Windows/browser fixtures do not establish physical phone or live AI accuracy.

Review covered correctness, readability, architecture, security and performance: optional structured diagnostics preserve existing callers; cancellation guards prevent stale results; no new dependency, provider request, credential storage or persistent data shape is added. Backup app-version metadata is updated to match 0.24.1.
