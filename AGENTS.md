# Project instructions

## Canonical project

This repository, https://github.com/itoosh-45/library, is the canonical application project. Build and maintain all new application code, experiments, tests and planning here. Do not create another application repository or develop future features in a detached chat outputs folder. The current checkout is outputs/library-app in the continuation workspace.

The product is a personal Hebrew/RTL library app. Follow the approved project plan and existing local design. Completed local stages: 3, 4 and 5, including book/copy editing, shelves/tags/genres/series and safe basic JSON v2 backup/restore with v1 compatibility. Next stage: 6, search, filtering, sorting and statistics. Cycle 3 acceptance still requires stage 6 and its applicable checks. Extend the basic backup format to protect any new persistent entities before adding them; do not silently omit them or leave backup unusable after normal stage 5 operations. The user explicitly authorized local construction while remaining feasibility checks are deferred; do not reintroduce gate 1 as a blocker to that authorized local work. Deferred checks remain open and must not be labeled PASS.

## Boundaries

- The user authorized replacing the camera experiment on main with application source. Preserve existing history. No force push or private feasibility history import.
- GitHub Pages serves the preserved camera experiment from camera-demo-archive. Updating application source on main is not authorization to publish the unfinished product. Product deployment is a separate step.
- Never commit personal book data, photos, API keys, server secrets, exports or raw OCR responses. Keep local data under ignored private/ or use clearly synthetic fixtures.
- Gemini keys are personal per user, memory only. No owner key, persistence or paid fallback. Primary 3.8 Flash, one automatic backup attempt to 3.7 Flash with a visible reason, within the approved limits. The user accepted the backup model and waived its proposed live test; do not ask for it again.
- No n8n backup; do not change its services as part of app development.
- The original project plan was kept byte-identical in the private feasibility workspace; record approved extensions here rather than silently changing historical evidence.

## Work and validation

Use npm run check and npm run test:browser as appropriate. Run targeted checks for changed behavior. Synthetic fixtures, desktop browsers and CI do not establish live provider accuracy, physical phone behavior or deployment success.

Respond in Hebrew. Ask one question at a time only when needed. Use commit identity itoosh-45 <321763872+itoosh-45@users.noreply.github.com>. After committing, report the repository URL and author. Do not spawn subagents without an explicit user request.
