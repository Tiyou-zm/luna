# Full Page Smoke Test

Date: 2026-05-26

## Scope

This pass focused on page rendering, navigation, and local mini program stability. Hermes generation, chat submission, upload file picker, and WeChat payment were intentionally not triggered.

## Fixes

- Added `src/utils/async.ts` with a small `withTimeout` helper.
- Added timeout and fallback handling to first-screen remote reads in:
  - `src/pages/orders/index.tsx`
  - `src/pages/usage-records/index.tsx`
  - `src/pages/materials/index.tsx`
  - `src/pages/compute-recharge/index.tsx`
  - `src/pages/package-result/index.tsx`
  - `src/pages/admin-finance/index.tsx`
- Fixed non-admin `admin-finance` loading behavior so it can show the no-access state instead of staying on a spinner.

## Commands

```powershell
& C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe node_modules\@typescript\native-preview\bin\tsgo.js --noEmit -p tsconfig.check.json
pnpm run build:weapp
```

Both checks passed.

## WeChat DevTools Verification

Verified in the WeChat DevTools simulator after clearing the compile cache and reopening the project:

- `pages/chat/index`
- `pages/features/index`
- `pages/service/index`
- `pages/profile/index`
- `pages/pricing/index`
- `pages/orders/index`
- `pages/materials/index`
- `pages/monitor/index`
- `pages/account-security/index`
- `pages/settings/index`
- `pages/about/index`
- `pages/compute-recharge/index`
- `pages/usage-records/index`
- `pages/package-create/index`

Screenshots were saved in the project root with names like `page-orders-rendered.png`, `page-materials-results.png`, `page-settings-confirmed.png`, and `wechat-final-open-noargs.png`.

## Not Triggered

- Hermes communication
- Material package generation submit
- Customer service message submit
- File upload picker / COS write
- WeChat payment

## Remaining Verification Gap

The following pages build successfully and exist in `dist/`, but were not fully opened through a stable UI route in this pass:

- `pages/login/index`
- `pages/admin-finance/index`
- `pages/package-result/index`

Recommended next step: add a local-only debug route launcher or use the official WeChat mini program automation runner so these routes can be opened directly without changing `dist/app.json`.
