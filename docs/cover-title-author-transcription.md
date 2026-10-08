# Cover title and author transcription — 0.25.4

Approved scope: the simple cover/spine scan asks Gemini and Groq only for literal Hebrew title lines and authors. The application joins title lines and maps these two fields into the existing validated recognition/evidence format. It does not infer ISBN, Danacode, publisher, coordinates or external bibliographic facts. Empty results remain empty. The user edits the result and explicitly chooses catalog search or use without search; no automatic book save.

Barcode scanning, the advanced full single-book route and shelf recognition retain their existing schemas. Local Hebrew OCR remains available as fallback. The primary and approved backup models, personal credentials, Free verification, consent, quota and timeout limits are unchanged. No live inference requests or paid resources were used for this release.

## Review

- Correctness: strict exact two-field shape, bounded strings/arrays, Hebrew text, duplicate-author and URL rejection; the existing recognition validator still runs. Selected-field application preserves existing identifiers. Full-route unit tests remain in the suite.
- Readability: one named transcription module contains the prompt, schema and mapper; the provider routes select it only for cover mode.
- Architecture: existing provider router, review/save and backup contracts are reused; no new dependencies or storage schema.
- Security: external output is untrusted and validated, image instructions cannot change the task, credentials remain outside library exports; private research data is not in tracked fixtures.
- Performance: successful transcription uses one provider request; fixed array/string bounds and existing deadlines remain. No extra catalog request before approval.

## Verification and limits

234 unit tests, 19 service tests, typecheck, lint and production/gateway builds passed. Browser checks cover the two-field request, one successful request, editing and explicit search, Groq fallback, malformed Gemini backup and existing book details. Four production PWA checks cover CSP, mocked Gemini/Groq, malformed recovery and actual local Hebrew OCR. An inverted exact-shape condition was caught by tests and restored byte-for-byte.

Two user-supplied manual research outputs pass the actual product mapper and evidence validator. This is compatibility evidence, not an application API accuracy test. Actual provider recognition and physical iPhone/Android behavior remain unverified.

The previous main CI run hit a race when two test processes initialized the same fresh SQLite WAL ledger. This release initializes the test ledger before testing simultaneous reservations, matching the deployed initialized ledger. The reservation assertions remain unchanged. Production quota code is unchanged; this does not claim to change concurrent first-time initialization behavior, which fails closed.
