# Project instructions

## Canonical project

This repository, https://github.com/itoosh-45/library, is the canonical application project. Build and maintain all new application code, experiments, tests and planning here. Do not create another application repository or develop future features in a detached chat outputs folder. The current checkout is outputs/library-app in the continuation workspace.

The product is a personal Hebrew/RTL library app. Follow the approved project plan and existing local design. Completed local stages: 3–7, including book/copy editing, collections, search/filtering/sorting/statistics, people and atomic copy loans/returns with retained history. Stage 8 is in progress locally: App 0.6.0, schema 2, JSON v4 backup/restore protects metadataSources and accepts v1–v3 with visible missing-entity warnings. Candidate selection and live Open Library lookup work locally; NLI diagnostics now return HTTP 200 with an ignored material_type filter and an observed JSON-LD shape. A loopback catalog gateway and NLI/Google adapters are built and fixture-tested; normalized live NLI results, Google key/quota and public gateway deployment remain unverified. See docs/phase-08-progress.md. Cycle 3 physical-phone/user-query checks remain open; cycle 4 requires all live-provider and user evidence. Do not silently omit persistent entities. The user explicitly authorized local construction while remaining feasibility checks are deferred; do not reintroduce gate 1 as a blocker. Deferred checks remain open and must not be labeled PASS.

## Boundaries

- Critical spending lock (user instruction, 2026-10-02): never pay, renew or extend a subscription, purchase or add credits, or use any credit card directly or indirectly. This overrides the general project authorization and deployment/model plans. Do not enable billing, automatic top-ups, paid upgrades or a fallback that charges a payment method. Use only available resources without a new charge; when credits run out, stop work rather than replenish them or bypass the limit. Carry this rule into any continuation chat.

- The user's 2026-10-02 autonomous-work instruction in DECISIONS.md overrides user-dependent gate stops: continue independent implementation even without replies; surface required user tests as questions; keep missing evidence BLOCKED/NOT RUN. Merge each newly tested stage to main without asking. All actions within WORK_PLAN.md are authorized; do not repeat routine approvals. Do not treat missing credentials or actual access as present, and do not claim complete without evidence. No additional agents without explicit authorization.

- The user authorized replacing the camera experiment on main with application source. Preserve existing history. No force push or private feasibility history import.
- GitHub Pages serves the preserved camera experiment from camera-demo-archive. Updating application source on main is not authorization to publish the unfinished product. Product deployment is a separate step.
- Never commit personal book data, photos, API keys, server secrets, exports or raw OCR responses. Keep local data under ignored private/ or use clearly synthetic fixtures.
- Gemini keys are personal per user, memory only. No owner key, persistence or paid fallback. Primary 3.8 Flash, one automatic backup attempt to 3.7 Flash with a visible reason, within the approved limits. The user accepted the backup model and waived its proposed live test; do not ask for it again.
- No n8n backup; do not change its services as part of app development.
- The original project plan was kept byte-identical in the private feasibility workspace; record approved extensions here rather than silently changing historical evidence.

## Work and validation

Stage 9 scanner is built locally in App 0.7.0: lazy native/ZXing decoding, camera cancellation and manual/image alternatives feed the catalog draft with explicit approval. See docs/phase-09-progress.md for local test evidence and outstanding physical-device checks. Stage 10 is the next independent implementation step; cycle 5 is not complete without its evidence.

Use npm run check and npm run test:browser as appropriate. Run targeted checks for changed behavior. Synthetic fixtures, desktop browsers and CI do not establish live provider accuracy, physical phone behavior or deployment success.

Respond in Hebrew. Ask one question at a time only when needed. Use commit identity itoosh-45 <321763872+itoosh-45@users.noreply.github.com>. After committing, report the repository URL and author. Do not spawn subagents without an explicit user request.
