# Library fixes — App 0.22.0

User-approved behavior, 2026-10-07. This change covers functional fixes; the visual redesign is a later task.

## Changes

- Add settings → reset information, with cancellation and explicit final confirmation. Reset is scoped to the local browser library, not a remote account. Books, copies, authors, images, book/shelf links, loans, recognition drafts, metadata sources and catalog cache clear in one transaction. Shelf image references clear alongside images. Collection definitions, people, settings and the separate credential database remain. No personal database was reset during development.
- Put image scan, barcode scan and search together in the book editor. Cover-image upload remains a storage action. The image entry now reviews a single cover/spine rather than entering the old bulk-add screen; bulk scan code and existing drafts remain stored.
- Default barcode identifier to Danacode, auto-detect valid ISBNs, preserve raw digits and leading zeros. A successful upload stays in the scanner for review and explicit search; unreadable uploads display an error and allow another upload.
- Run ZXing when native BarcodeDetector returns no match, not just when it throws. Support common linear native formats, local 90° rotation, bounded full-image resolutions and a center-crop retry. Allow image MIME types and common phone image filenames with missing MIME metadata.
- Expose series selection, creation and book number in add/edit. Use existing schema and backup fields. Display/group by series, order numbers numerically, search series names and filter series.
- Move price into extra details in add/edit. The same editor displays the stored copy price; existing currency/minor-unit storage is unchanged.
- Local OCR loads Hebrew only, improves contrast, tries 0/90/270/180° rotations, preserves extra text detail in local-only JPEG preparation, joins spatially distant title/author in single-book mode, and handles adjacent title lines with validated literal evidence. Shelf grouping remains a separate mode.
- Review title/author before applying OCR. Search starts only after clicking the search-by-details button. Existing ISBNs cannot override this title/author query. Manual corrections retain original OCR evidence with user-overridden fields.

## Validation

- `npm run check`: typecheck, lint, 205 unit tests, 4 Node tests, frontend and gateway builds passed.
- Targeted reset/OCR tests: all 4 passed, including transaction rollback on an injected image-deletion failure.
- Mutation check: inverting the single-cover branch caused the two cover regressions to fail; source was restored and all 4 targeted tests passed again.
- Chrome browser suite: 19 passed, including a real synthetic rotated EAN-13 with a native detector returning no result, a non-ISBN linear barcode with native support absent, failed-upload/retry, series persistence/numeric ordering, price placement, reset cancel/confirm, OCR review/search and stored-ISBN editing.
- WebKit with iPhone emulation: 4 interface/barcode/reset/series checks passed, plus Hebrew OCR rotation check. OCR checks cover a rotated spine and an upside-down cover.
- Production PWA: 8 passed, including local Hebrew OCR under CSP online/offline, OCR provenance in backup, mocked Gemini/Groq privacy gates, cover redirects, full-table backup/restore and update protection.
- Mobile screenshots were inspected for series, price and scanner review. No new dependency versions or paid services were introduced.

Physical iPhone Safari/Android Chrome and real user barcode/cover/spine images remain NOT RUN. Synthetic images and desktop WebKit do not establish physical-phone or live recognition accuracy. Danacode decoding does not establish live catalog coverage: the existing NLI manual search link remains available when configured providers cannot search that identifier. No public deployment was performed.

## Review

Correctness: reviewed cancellation/request sequences, scanner busy reset, identifier-vs-text queries, retained manual correction evidence, and atomic reset references. Fixed 180° dimensions and disabled scanner entries during catalog resolution.

Readability/architecture: reused existing series, copy-price, metadata and backup storage; extracted OCR application from the editor callback. Reset has one named transaction boundary. No schema migration or new service is needed.

Security: React still renders OCR as text. No real provider key or personal photo is committed. Consent and Free gates remain; reset does not access credential storage. The reset warning lists the approved related deletions.

Performance: image pixel/byte bounds and OCR timeout/cancellation remain enforced; local OCR uses higher text resolution only on the explicit local path, and releases canvas backing storage between orientations. Decoder fallback is loaded lazily and reused. The existing large Excel chunk warning is unchanged.
