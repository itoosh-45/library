# Catalog wait deadline — 0.25.5

The shared private catalog transport now labels a 429 response as a catalog-service wait and displays a fixed local clock time after which the user can retry. It does not attribute every wait to the upstream library: server busy state, conservative quota holds and daily budgets also produce 429. The same deadline and remaining duration are returned on local rejection, without extending the hold. A user-initiated request is allowed exactly at expiry; there is no automatic retry and no upstream limit bypass.

Live diagnosis: the private service had only 12 of 200 daily NLI slots consumed and its stored hold had expired. A cached public NLI query returned 200 with 10 candidates. A fresh request failed; one diagnostic request from Oracle to the official NLI endpoint returned HTTP 502 and Retry-After 60. This is evidence of a transient upstream failure, not a guarantee of recovery or a local daily-quota exhaustion. No keys, queries from personal libraries, raw provider responses or server addresses are recorded here.

Review: correctness covers initial and repeated rejection, a stable deadline, remaining milliseconds and exact expiry; readability uses one message helper; architecture retains the existing provider transport; security retains all credentials, quota and upstream restrictions; performance adds only bounded time formatting and no new requests. No dependencies, server code or container configuration change. Normal successful NLI spacing remains two seconds, while failed requests retain the server cooldown.

Validation is recorded in the private release receipt. Physical-phone and upstream recovery evidence remain unverified.
