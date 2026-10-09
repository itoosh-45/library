# Catalog and book editor update — 0.25.7

The Israeli books catalog (ICL / infocenters.co.il) is now a provider in the existing catalog picker. Searches use the existing authenticated Oracle catalog service; selected editions supply the available bibliographic fields and a front cover. Covers are fetched through a bounded authenticated proxy because the upstream does not support browser CORS. Open Library remains an existing metadata and cover provider.

Groq now returns only a title and author names, including each book in shelf mode. Existing review and catalog lookup complete metadata after user review. Recognition evidence required by the existing backup format is constructed locally from those names. Strict parsing rejects additional model fields. Gemini behavior is unchanged.

Publication date inputs are 60% wide on both mobile and desktop. Modal headings remain outside the scrollable content. A reference-counted document lock prevents background scrolling while nested dialogs are open and restores the previous position on final close. Mobile height and padding account for the dynamic viewport and safe areas.

## Validation and review

- Type checking, lint, 238 unit tests, 21 gateway tests, application and gateway builds passed before publication preparation. Chrome regressions cover date width, expanded editor content, reachable close, background locking and restored scroll. The same regression passed in Windows WebKit.
- All 34 development-browser cases and all 21 production PWA cases passed across the initial run and focused reruns. Reruns corrected provider mocks for the additional catalog and new Groq schema; a development-server startup timeout was rerun successfully. The production checks include offline covers, backup/restore, update preservation and CSP.
- Live authenticated public service: ICL title and ISBN searches, selected edition, and JPEG cover download passed. ISBN 9789655643657 resolved to הארי פוטר והילד המקולל; the cover response was 200, image/jpeg, 49,566 bytes.
- Server deployed as `library-goodreads:6` in the existing `/opt/library-goodreads` deployment. Only the catalog container was replaced, retaining the existing connection, resources and quota database. Health check passed. Other server services were unchanged.
- Correctness: search covers bind to their own record, details are validated before application, and selecting a catalog edition follows the existing save/review paths. Backup round trips retain ICL provenance without credentials.
- Security: fixed upstream host and approved cover path; no execution of upstream scripts; authentication, origin checks, quotas, bounded response sizes and rejected redirects. Groq image text is treated as data and returned names are validated.
- Maintainability: ICL parsing is isolated in its own adapter and uses the existing service and provider interfaces. No new dependencies, database schema or backup version.
- Performance: bounded ten-result catalog searches and serialized authenticated service calls; covers capped at 4 MiB, then prepared for local storage. Existing quota migration preserves reservations.
- Product/design: Hebrew provider labels and existing catalog selection controls are retained; the editor close control stays reachable without changing the existing visual design.

## Remaining limits

ICL provides legacy HTML rather than a documented API. Markup changes can require adapter maintenance; failure remains visible and other providers can still return results. Hebrew catalog coverage and available covers vary by edition. Groq provider accuracy was not tested with a real image call in this change. Desktop WebKit does not establish behavior in the user's installed iPhone application; a physical-device check remains open.
