# Data Access

The mini program now uses Tencent CloudBase as the domestic backend.

- Frontend API calls go through `src/client/cloudbase.ts`.
- Page-facing data helpers stay in `src/db/api.ts`.
- Business data is read and written through the `dbApi` CloudBase cloud function.
- Direct client access to sensitive collections should be avoided; cloud functions must enforce `OPENID` ownership.
