# WeChat white screen fix - 2026-05-25

## Symptom

- The workbench tab rendered correctly.
- The `service` and `profile` tabs showed only the native navigation bar and tab bar.
- WeChat DevTools logs showed `routeTo switchTab timeout`.

## Root Cause

`AuthContext` recreated `refreshProfile` and the context value on every provider render. The profile page calls `refreshProfile` from `useEffect` and `useDidShow`. When profile data changed, the provider rerendered, the function identity changed, and the profile page could retrigger loading repeatedly. In WeChat tab switching this could delay page lifecycle completion and cause the tab to appear blank.

## Fix

- Updated `src/contexts/AuthContext.tsx`.
- Wrapped auth actions and `refreshProfile` with `useCallback`.
- Wrapped the context value with `useMemo`.

## Verification

- `tsgo --noEmit -p tsconfig.check.json`: passed.
- `pnpm run build:weapp`: passed.
- `dist` scan found no `process.env`, `process.platform`, or `Luna auth diagnostic` leftovers.
- Cleared WeChat DevTools `WeappCache/WeappCompileCache` and reopened the project.
- Manually switched to `service` and `profile`; both pages rendered normally.
- Latest WeChat DevTools logs showed no `routeTo switchTab timeout`, `App render failed`, `ReferenceError`, or `TypeError`.
