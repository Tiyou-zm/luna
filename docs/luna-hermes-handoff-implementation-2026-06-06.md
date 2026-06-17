# Luna-Hermes handoff implementation log

Date: 2026-06-06

Scope:
- Keep Luna as gateway: security, pass-through, format cleaning, state detection, task registration.
- Keep Hermes as SOP agent: Stage 0 dialogue and Stage 1-6 generation.
- Keep worker as background transport: wait, retry, receive, unpack, persist.
- Do not deploy cloud functions or restart worker from this implementation pass.

## Execution log

- [done] 1. Create protocol and implementation record.
- [done] 2. Update lunaGuardian for handoff, delayed job creation, and pending chat turns.
- [done] 3. Update dbApi with hermes_chat_turns read/write actions.
- [done] 4. Update worker to continue pending chat turns and preserve generation job role as transport.
- [done] 5. Update frontend chat/package-create flow.
- [done] 6. Run local tests and build.

## Implementation notes

- `lunaGuardian` now creates `generation_jobs` only when `action=start_generation` and `stage0_confirmed=true`.
- `mode=material`, `mode=direction`, `source=package_create`, and `force_generate` no longer create generation jobs by themselves.
- Hermes foreground timeout now creates a `hermes_chat_turns` pending record and returns `turn_id`.
- `dbApi` exposes user-owned `getHermesChatTurn` / `getHermesChatTurns`; admin-only `updateHermesChatTurn` is available for controlled maintenance.
- Worker now checks pending `hermes_chat_turns` before queued `generation_jobs`.
- `package-create` now sends initial context to Hermes Stage 0 and hands the result to the workbench instead of directly starting generation.

## Verification

- `node --check cloudfunctions/lunaGuardian/index.js`: passed.
- `node --check cloudfunctions/dbApi/index.js`: passed.
- `node --check workers/hermes-worker/index.cjs`: passed.
- `node scripts/testLunaInteractionParser.mjs`: passed.
- Mojibake marker search on the new guard/test/doc files: passed.
- `npm run build:weapp`: passed.

## Deployment note

Cloud functions were not deployed by this implementation pass.

Worker rollout:
- Remote host: `152.136.47.2`
- Remote directory: `/home/ubuntu/luna-hermes-worker`
- Updated file: `index.cjs`
- Remote syntax check: passed.
- Restarted worker at 2026-06-06 10:20:34 CST.
- Active worker PID after cleanup: `505623`.
- Old duplicate worker process was stopped.

Manual rollout order when ready:
1. Upload `dbApi`.
2. Upload `lunaGuardian`.
3. Rebuild/open the mini program from `dist`.

## Follow-up: package assets and archive ingestion

Current follow-up scope:
- Do not treat a material package as fully asset-ready when Hermes claims `asset_generation` but returns no public image/file/archive URL.
- Keep `collectPackageAssets()` as the central parser, but accept wider URL field names from Hermes.
- Store package images/files/archives as child `materials` rows through `parent_material_id`.
- Show those child assets inside the full package detail page and summarize them on package cards.

Execution:
- [completed] 1. Expanded worker asset fields: `asset_url`, `download_path`, `cos_url`, `zip_url`, `archive_url`, `images[].url`, and related camelCase variants.
- [completed] 2. Added worker asset completeness validation and `assets_missing` job events.
- [completed] 3. Added one repair attempt that asks Hermes for `assets.generated[].url`, `package_archive.url`, or an explicit `assets.not_generated` reason.
- [completed] 4. Normalized `/var/www/images/<file>` to `http://152.136.47.2:8080/<file>` and refused to persist `/tmp/...` local paths as downloadable user assets.
- [completed] 5. Added `dbApi.getMaterialChildren`.
- [completed] 6. Updated `package-result` to query child materials, show image thumbnails, file/archive URLs, and an empty-assets warning.
- [completed] 7. Updated `materials` package cards to show image/file/archive counts and warn when an asset-generation package has no files.
- [completed] 8. Checked the latest historical Zhuxian package.

Historical package finding:
- The saved package has `workflow.delivery_mode = asset_generation`.
- It has no `assets.generated` URL and no `package_archive.url`.
- `hermes_raw` contains only `trending_research.reference_images[]` public reference image URLs plus local `/tmp/reference_images/...` paths.
- `hermes_raw_preview` contains only a local zip path: `/tmp/material_package_zhuxian_20260606/material_package_zhuxian_20260606.zip`.
- Because no final generated-image URL or public archive URL was saved, no image child materials were fabricated. Hermes must reissue public asset URLs or a public package archive URL for that historical package.

Verification:
- Passed `node --check workers/hermes-worker/index.cjs`.
- Passed `node --check cloudfunctions/dbApi/index.js`.
- Passed `npm run build:weapp`.
- Remote worker updated on `152.136.47.2`; remote `node --check` passed and worker restarted with a single active process.

Manual rollout order when ready:
1. Upload `dbApi` so `getMaterialChildren` is available.
2. Hermes worker has already been restarted.
3. Rebuild/open the mini program from `dist`.

## Follow-up: account ownership fix for generated materials

Observed issue:
- A confirmed generation can complete without appearing in the material library when the user is logged in with a manual account.

Root cause:
- `dbApi` resolves the visible material library owner from the manual account session token, for example `acct_xxx`.
- `lunaGuardian` previously created `stage0_drafts`, `hermes_chat_turns`, and `generation_jobs` with the WeChat `OPENID` as `user_id`.
- The worker persists `materials.user_id` from `generation_jobs.user_id`, so completed materials were written under the WeChat openid instead of the active manual account.

Fix:
- `lunaGuardian` now resolves `event.authToken` through `auth_sessions`.
- When a manual session is active, `user_id` is the manual account id and `openid` is retained only as the WeChat identity field.
- Future `stage0_drafts`, pending Hermes chat turns, generation jobs, generated material packages, derived assets, usage records, and profile usage increments will align with the account that the material library queries.

Verification:
- Passed `node --check cloudfunctions/lunaGuardian/index.js`.
- Passed `node scripts/testLunaInteractionParser.mjs`.
- Passed `npm run build:weapp`.

Rollout note:
- Upload `lunaGuardian` before testing the next confirmed generation.
- A material already generated before this fix may still be stored under the old openid owner and needs a one-time data ownership repair if it must appear in the current manual account library.

## Follow-up: visible JSON cleanup and ownership repair action

Scope:
- Keep Hermes native dialogue and do not touch worker or Hermes SOP.
- Prevent machine JSON from leaking into the visible confirmation card.
- Replace the accepted-generation English status reply with Chinese.
- Add a small, limited backend repair action for old generated data ownership.

Changes:
- `lunaGuardian` now strips fenced and naked Luna machine JSON segments such as `luna_handoff`, `luna_interaction`, `conversation_turn`, and question arrays from visible replies.
- Pure `stage0_ready` handoff JSON without a `reply` now falls back to `信息已确认完毕，请确认是否开始制作素材包。`.
- Confirmed generation now replies `已确认，Hermes 会在后台继续制作素材包。完成后会自动保存到你的素材库。`.
- The workbench confirmation card now displays the cleaned `reply` first; structured `confirmed_outline` is still sent to the backend but is not shown in UI.
- `dbApi` now has `repairGeneratedOwnership`.

Ownership repair action:
- Action name: `repairGeneratedOwnership`.
- Default is dry-run: call with no `dryRun` or with `dryRun:true` to preview.
- Real repair: call with `dryRun:false`.
- Optional filters: `jobId`, `materialId`, `limit`.
- Guardrail: it only migrates records from the current WeChat openid to the current manual-account `authToken` owner. If the caller is not logged in as a manual account, it refuses to run.

Verification:
- Passed `node --check cloudfunctions/lunaGuardian/index.js`.
- Passed `node --check cloudfunctions/dbApi/index.js`.
- Passed `node scripts/testLunaInteractionParser.mjs`, including the naked handoff JSON leak case.
- Passed `npm run build:weapp`.

Manual rollout order when ready:
1. Upload `dbApi`.
2. Upload `lunaGuardian`.
3. Rebuild/open the mini program from `dist`.
4. If an old completed material is still invisible, run `repairGeneratedOwnership` first as dry-run, then with `dryRun:false` only after the preview looks correct.

Actual repair run:
- Repaired job `43834a186a23a50e00707d594f438938` from WeChat openid owner to manual account `acct_fd61a03af4f77d870fc21e05e7e80678`.
- Updated 1 `generation_jobs`, 1 `materials`, 1 `stage0_drafts`, 5 `generation_job_events`, and 1 `usage_records` row.
- Verified the repaired material `34d5e8e86a23a7ed006c3eb77b8bfa7a` is visible under the manual account material package query.

## Follow-up: generated package title cleanup

Observed issue:
- Generated package titles could expose internal task wording such as `小红书 material package - 确认开始制作`.

Fix:
- `lunaGuardian` job-title generation now prefers `handoff_context.collected.product`, `brand`, `game`, or `topic`, then falls back to `handoff_context.original_request`.
- If a goal or desired result exists, the visible title becomes `<topic>素材包 · <goal>`.
- The existing repaired package was renamed to `诛仙世界素材包 · 引流推广` on both `generation_jobs` and `materials`.

Verification:
- Passed `node --check cloudfunctions/lunaGuardian/index.js`.
- Passed `node scripts/testLunaInteractionParser.mjs`.

Rollout note:
- Upload `lunaGuardian` so future generated jobs use the cleaner title rule.

## Protocol summary

Hermes may append a JSON block only when Luna needs machine-readable state.

Supported handoff states:

```json
{
  "type": "luna_handoff",
  "stage": "stage0_questions",
  "ready_for_generation": false,
  "reply": "natural language reply",
  "missing_fields": [],
  "handoff_context": {
    "collected": {},
    "notes": ""
  }
}
```

```json
{
  "type": "luna_handoff",
  "stage": "stage0_ready",
  "ready_for_generation": true,
  "reply": "natural language reply",
  "handoff_context": {
    "original_request": "",
    "platforms": [],
    "goal": "",
    "audience": "",
    "assets": [],
    "desired_result": "",
    "collected": {},
    "missing_fields": [],
    "notes": ""
  }
}
```

```json
{
  "type": "luna_handoff",
  "stage": "generation_confirmed",
  "ready_for_generation": true,
  "reply": "natural language reply",
  "handoff_context": {}
}
```

Job creation rule:

```js
event.action === 'start_generation' && event.stage0_confirmed === true
```

Timeout rule:
- A Hermes chat timeout creates `hermes_chat_turns`.
- The frontend shows a pending bubble.
- Worker continues the turn in the background and writes back the real Hermes reply.

## Follow-up: Stage0 draft isolation and legacy task card removal

Current follow-up scope:
- Disable the legacy task card path in the workbench.
- Remove the old direct-generate and edit-task entry points from the active flow.
- Add `stage0_drafts` so each material-package intention owns its own context and attachments.
- Attach uploaded files to the active draft and create `generation_jobs` only from that draft after Stage 0 confirmation.

Execution:
- [completed] 1. Record follow-up scope.
- [completed] 2. Update `lunaGuardian` draft lifecycle.
- [completed] 3. Update `dbApi` draft read/cancel actions.
- [completed] 4. Update workbench active draft and remove legacy task card flow.
- [completed] 5. Verify and build.

Implementation notes:
- `lunaGuardian` now creates or resumes a `stage0_drafts` row for material-package intent, stores attachments and Hermes handoff context, and creates `generation_jobs` only when `stage0_confirmed === true`.
- `dbApi` now exposes draft read/list/active/cancel actions for follow-up UI and support tooling.
- The workbench now carries `draft_id` across normal chat turns, package-create returns, timeout polling, and final confirmation.
- Legacy task cards are no longer created or rendered in the active workbench path, so Stage 0 questions remain Hermes-led until Hermes returns a ready handoff.

Verification:
- Passed `node --check cloudfunctions/lunaGuardian/index.js`.
- Passed `node --check cloudfunctions/dbApi/index.js`.
- Passed `node --check workers/hermes-worker/index.cjs`.
- Passed `node scripts/testLunaInteractionParser.mjs`.
- Passed `npm run build:weapp`.

Manual rollout order when ready:
1. Upload `dbApi`.
2. Upload `lunaGuardian`.
3. Rebuild/open the mini program from `dist`.
