# App 0.25.1: server NLI catalog and inline shelf books

## Behavior

The authenticated private catalog service now queries the official National Library of Israel Search API. Its server credential is kept separately from the app and service-access token, read at startup from a readonly secret mount. Browsers send the six validated catalog search fields and the private service token; they never receive the NLI key.

Requests identify the application honestly with Accept: application/json and Library-App/0.25.1 (+https://github.com/itoosh-45/library). Normal default requests previously received 403; identified official requests returned real 200 responses. This is observed access, not a provider allowlist or a promise of permanent availability. The upstream sometimes returns 502. An observed Hebrew query failed with ten requested results but succeeded with five, so new uncached requests ask for five. No challenge solving, proxy rotation or browser impersonation is used.

Title/creator/publisher/year queries retain their conditions. ISBN and Danacode use the official general any exact search; no undocumented dedicated Danacode field is invented. Ignored-condition Errors headers stop the lookup. The tested Danacode yielded zero NLI results, while the existing Dani source supplies its exact book. NLI results without an explicitly matching identifier cannot trigger automatic identifier autofill.

The existing canonical mapper now accepts validated YYYYMMDD dates and removes $$ authority suffixes from creator names. Unsupported or conflicting fields remain warnings. Available information is applied to an editable draft; title search still requires selecting a result and saving explicitly.

Shelf books open immediately after the selected shelf, with three books in each row. Clicking the same shelf collapses them. Typing into shelf search replaces the shelf list with matching books in a vertical three-column grid; clearing the query restores the shelf selection. Existing fonts, colors, logos, hierarchy, book data and editor remain intact.

## Resource and security review

Only the isolated catalog container was replaced. The existing service retains one active upstream request, 30 requests/minute, 200 upstream requests/provider/day, durable cooldowns, bounded 24-hour cache, a 15-second deadline and a 2 MiB upstream response cap. The browser serializes private catalog calls so providers do not collide with the single active server slot. Docker retains a 192 MiB limit, 0.25 CPU, 64 PIDs, non-root user, readonly root filesystem, dropped capabilities and no-new-privileges. n8n was not modified. Pre-update resource check showed 35 GB free disk and about 10 GB available RAM; idle catalog memory was about 28 MB.

Five-axis review: correctness covers draft/save gates, empty results, failure paths and exact identifier checks; readability reuses the canonical NLI mapper and existing shelf/list components; architecture separates server credentials from browser access; security preserves authentication, origin checks, fixed upstream destinations, parameterized SQLite and bounded untrusted response validation; performance retains the existing quota/cache/resource bounds and only renders the selected shelf.

## Validation

- npm run check: typecheck/lint/build, 226 Vitest and 18 Node tests passed.
- 20 targeted desktop Chrome browser tests passed, including shelf placement/search, NLI, Dani and Goodreads draft/backup flows.
- 15 production PWA tests passed, including NLI/Dani, CSP, key exclusion, backup and offline behavior.
- Targeted NLI tests passed after reducing the upstream result count to five.
- Mutation: deliberately inverted Errors-header rejection; the NLI regression test failed; original source restored.
- One bounded visual inspection of the phone and desktop shelf screenshots passed.
- Real authenticated public service lookup for Jerusalem returned 200 and ten normalized records from the previously cached query. Real Hebrew direct adapter lookup returned 200 and five normalized records; intermittent upstream 502 remains possible.
- Private credential audit found no keys, SSH references or private server IP in scanned source/product/history; WORK_PLAN.md remained byte-identical.

Physical iPhone/Android checks and universal NLI identifier coverage remain unverified. Goodreads title scraping remains provider-blocked; connecting NLI does not change that restriction.

Official references: https://www.nli.org.il/en/research-and-teach/open-library/search-api and https://www.nli.org.il/en/research-and-teach/open-library/search-api/user-help.
