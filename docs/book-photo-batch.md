# Book photos and visible catalog search — 0.25.8

The simple book editor now displays title/identifier and author search fields directly. Both nested search disclosures were removed; secondary book fields remain in their existing disclosure.

The **תמונות רבות** action opens a server-backed queue for one book per photo, up to 500 photos. The browser prepares and stores one compressed JPEG at a time, then uploads sequentially. Uploads are idempotent by image ID and hash, and resume by skipping images already present on the server. A separate consent checkbox explicitly authorizes transferring the reduced images and the already approved personal Free Gemini/Groq keys to the existing catalog server.

## Processing and review

The server processes one photo at a time without depending on browser polling. Only the three existing approved Gemini models and the existing Groq model are used. Each returns title and author names only. Model-specific quota holds are stored durably by credential fingerprint and model; provider retry hints and Gemini's Pacific daily reset are respected. Unknown Gemini quota waits conservatively rather than spinning. Billing/credit demands pause the queue without purchases. Authentication rejection pauses with a key warning; an explicit settings-key update repairs that same job without repeating completed photos.

The server searches ICL, NLI and Open Library after recognition. Source queries use existing authenticated catalog routes and quotas; source failures preserve recognized names for manual completion. A single exact title-and-author match, or equivalent identifiers across matching candidates, becomes an editable suggestion. Competing editions and uncertain results remain for individual review. These are suggestions, not calibrated confidence estimates.

The browser presents 20 items per page, grouped into ready-to-review and needs-attention. All returned candidates are available when opening a book, without another search. The original photo and proposed cover can be compared; names can be corrected, the catalog can be searched again, another result can be selected, or a photo can be explicitly retried or skipped. Retry removes prior approval. Approval and library saving are explicit actions. Existing duplicate decisions and approved-only atomic saving are reused. A failed cover download falls back to the uploaded photo. Saved rows are not added again after polling or reopening.

## Persistence and boundaries

- Server records, provider keys and image bytes are encrypted with AES-256-GCM using a key derived from the existing separate service secret. No key or raw provider error is returned in job status or logs.
- Every job also requires its own random 256-bit capability, alongside the service bearer token and existing origin checks. Job capabilities stay in the browser's separate credential database and are excluded from library backup.
- Jobs expire after seven days; users can delete server images and keys earlier. Local results and source photos remain available. A JSON restore can recover local reviews, but does not restore credentials or reconnect a remote job on another device.
- Existing library schema and backup formats remain unchanged; the existing recognition-draft/review records are reused. Source images and review provenance are included in normal full backups subject to the existing backup size limit.
- Up to ten retained jobs, 500 images/job, 1.5 MiB/image, 2 GiB total image storage and an 8 MiB metadata budget bound server use. Catalog request quotas remain independent. Upload limits respect `Retry-After`; CORS retains retry headers even for HTTP 429.
- Deployment uses `library-goodreads:7`, the existing data mount, credentials, pinned Node image and resource limits. Only the catalog container was replaced. The Nginx catalog location's body limit is 3 MiB; other application routes and server services are unchanged.

## Validation and review

Unit and gateway checks cover conservative matching, edited review preservation, backup round trips, approved-only saving, idempotency, 100-photo processing, restart recovery, quota/model switching, key repair, capability isolation, encryption at rest, pause/delete safety and automatic processing without client polling. A production browser run processed 101 synthetic photos through upload, correction, approval, cover saving and reopening. Images and provider responses were synthetic; no real Gemini/Groq image quota was consumed for these tests.

Final evidence: 241 unit cases across the full run and focused added-case run; all 28 gateway checks; type check/lint and application/gateway builds; all 22 production PWA cases; the direct-add phone flow; modal scrolling in both Chrome and Windows WebKit. The changed search layout moved the first editable field from book title to catalog query, so the scroll regression was updated to assert the new first field rather than assuming the old layout.

Public API creation, a body above the previous 1 KiB limit, upload and deletion were verified with synthetic credentials while the job stayed paused. The catalog service health and Nginx configuration check passed. Desktop/mobile screenshots were inspected; detector warnings were confined to pre-existing CSS and ref-assigned thumbnail sources.

Five-axis review: correctness uses existing draft, duplicate and save validation; readability separates provider/queue logic, catalog enrichment and browser review; architecture extends the existing catalog service and persisted drafts without new dependencies; security combines consent, two credentials, encryption, fixed upstreams and bounded data; performance prepares and sends one image at a time and pages review rows.

Physical iPhone behavior and recognition accuracy on actual book photos remain unverified. Uploads must finish while the application is open; processing continues independently afterwards. Provider or catalog availability can extend processing time, and a hard seven-day expiry ends an unfinished server queue while local uploaded sources remain.
