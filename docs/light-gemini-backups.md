# Lighter Gemini backups — 0.25.6

Approved request order: gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-3.5-flash. A successful result stops the chain; each approved model is attempted at most once. HTTP 429 and access/input errors retain the existing stop behavior. Groq and local OCR remain the next existing routes when available. The simple cover request still asks only for literal title lines and author names, followed by explicit review/search/save.

Previous 3.8, 3.7 and 3.6 recognition model IDs remain accepted for stored evidence and backups. They are not active request targets. This avoids invalidating existing books and exports when changing the live routing constants.

Official documentation checked on 2026-10-09: [3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) and [3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) support image input and structured output; the [standard API pricing](https://ai.google.dev/gemini-api/docs/pricing) lists a Free tier. This does not establish availability or quotas for the user's project. Personal key/Free verification and consent remain required. No actual provider inference requests or paid resources were used in this release.

Review: correctness uses an explicit expected three-model order and legacy/new evidence backup round trips; readability follows the canonical model constants; architecture reuses the existing router, validation and retry limits; security retains quota/access stops, credential exclusion and untrusted-output validation; performance does not add attempts, timeouts or parallel requests. No dependencies, database migrations or server changes.

Validation and publication evidence are recorded privately. Live provider availability/accuracy and physical-phone verification remain NOT RUN; a mocked browser result is not an availability claim.
