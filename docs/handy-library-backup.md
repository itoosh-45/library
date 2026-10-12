# Handy Library backup — 0.25.8

The existing backup panel accepts the supplied Handy Library ZIP layout and adds a ZIP export button. Import defaults to adding books and skipping matches already in the destination; replacement remains an explicit alternative behind the existing protective JSON download and confirmation. No new screens or unrelated product features were added.

Exports contain only `handy_book_library.db`, `HandyLib.csv`, and referenced JPEGs under `Icons/` and `Photos/`. SQLite table definitions, column order, user_version 27 and Room identity hash are taken from the supplied file's schema; the CSV has its original 30 headers. No native JSON manifest, credentials, recognition drafts, settings or extra columns are inserted into the Handy ZIP. This format cannot represent every native entity or multiple historical loans; the existing full JSON format remains the complete native backup.

Original book-row and CSV values are retained on imported copies, including fields without a UI counterpart and fractional catalog ratings. Supported edits are mapped back into the existing Handy fields. Source icon/photo bytes remain local, and references survive cover changes, JSON restore and foreign-library JSON merges. Full JSON uses version 13 only when this optional source data exists; prior formats remain readable. IndexedDB stays at schema 2 and retains its existing name and origin. Replacement keeps destination application settings and does not affect the separate credential databases.

Duplicates use comparable ISBN-10/ISBN-13, or normalized title plus authors, volume and edition when an ISBN is unavailable. Different ISBNs are retained. Intentional duplicate rows/copy indexes within one incoming archive are retained; only matches already in the destination are skipped. Existing shelves, genres, tags and series are reused by normalized name. Parsing and graph validation precede an atomic transaction with a fingerprint check. Invalid archives, changed destination data and failed writes leave all existing tables intact.

ZIP validation checks entry names, CRCs, local/central headers, overlap, encryption and expanded byte limits before SQLite parsing. Only the supplied table names/types, book columns, version and Room identity are accepted. Integrity and foreign-key checks run before conversion. SQLite queries use fixed SQL and export values use bound parameters. SQLite/WASM and ZIP code are bundled locally and available offline; no personal backup data is sent to a server. The repository contains only schema information and synthetic test data, never the supplied books or images.

## Evidence

- Typecheck and lint passed; 246 unit tests passed, with the opt-in private fixture omitted from the normal public suite. The nine Handy tests, including the private fixture, passed separately. Existing 21 gateway tests and frontend/gateway builds passed.
- The supplied private ZIP's 1,886 books, 13 shelves and 46 JPEG files (23 icons and 23 photos) passed import/export checks. An invalid source ISBN is retained in source fields without breaking the native ISBN validator.
- Synthetic tests cover quoted Hebrew CSV and embedded newlines, both image variants, decimal ratings, copy indexes, prices, loans, repeated-import deduplication, ISBN-10/13 matching, native JSON restore, empty export, changed-target rejection, corrupt/extra ZIP files, quota rollback and source-image retention when shelf covers change.
- Production Chromium/mobile-viewport test passed offline under the existing CSP: upload, merge, repeated duplicate skipping, ZIP download, replacement, image display and persistence after reload. The final frozen build also passed native JSON/offline, update-preservation and XSS/backup checks.
- Broad development suite: 32/34 passed initially. The direct-add reload assertion also fails on unchanged main 573e07b. The Goodreads key-deletion assertion passed a focused rerun on both versions.
- Broad production suite: 16/22 passed initially. All six failures reproduced on unchanged main 573e07b with the same runtime: real external cover retrieval, immediate-save/reload assertions for danacode/NLI, Gemini key reload, Goodreads key deletion and an older Gemini recognition expectation. They remain unresolved baseline/environment evidence, not PASS. Unrelated application code and those tests were not altered.

## Remaining verification

Actual restoration of an exported ZIP inside the original Android Handy Library application has not been performed. Exact schema compatibility and local round trips do not establish that final external-app test. Physical iPhone behavior and a real Handy application test remain NOT RUN. Only the supplied Handy schema/version is supported; other versions and archive layouts are refused.
