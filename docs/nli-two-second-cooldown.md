# App 0.25.2: two-second NLI spacing

Successful uncached NLI searches now wait two seconds in both the private server quota ledger and browser transport, replacing ten seconds. Other providers retain their existing spacing. Cached results remain immediate. Failed requests retain their minute cooldown, provider Retry-After holds remain honored, and the daily budget and one-active-upstream limit are unchanged.

Review: correctness is tested at 1999/2000 milliseconds on client and server and after failures; readability uses the existing transport with an explicit cooldown argument; architecture retains the canonical NLI adapter and durable ledger; authentication, secret isolation and upstream destinations are unchanged; concurrency, daily quota and Docker resource limits are unchanged.

Validation is recorded in the private release receipt. No physical-phone or improved NLI upstream availability claim is made.
