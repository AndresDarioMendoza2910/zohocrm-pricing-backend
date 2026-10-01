# Nessteams Pricing Backend (Catalyst)

The shared serverless API behind both pricing widgets
(`nessteams-pricing-wizard`, `nessteams-pricing-button`). A Zoho **Catalyst
Advanced I/O Function** (Node 20) named `cheatsheet-api`, backed by the
`SalaryCheatSheet` Data Store table.

This project also hosts a **manual-mode web client** (`client/`) — a standalone,
Catalyst-served copy of the pricing simulator with no Zoho CRM integration (see
"Web client" below). The web client reads through a second, **authenticated**
function, `cheatsheet-read` (read-only), so the Catalyst-hosted app sits behind a
real auth wall without disturbing the PUBLIC `cheatsheet-api` the cross-origin
Sigma widgets depend on.

## Functions
- **`cheatsheet-api`** — PUBLIC (open). Shared, read+write API for the Sigma
  widgets (cross-origin) and the source of truth for writes. Endpoints below.
- **`cheatsheet-read`** — AUTHENTICATED, read-only. Used only by the
  Catalyst-hosted web client (same-origin). Exposes just `GET /` (same response
  shape as `cheatsheet-api`'s `GET /`). Its Catalyst Security Rule must be
  `{ "methods": ["GET"], "authentication": "required" }` — set in the console,
  per environment (see "Access & security").

## `cheatsheet-api` endpoints
- `GET  /`          → all roles, ordered by `Counter` DESC
- `POST /upsert`    → match on Role + Seniority; bump `Counter` if found, else
  insert a new row (`Counter = 1`, `Country = "Panama"`, today's `UpdatedDate`).
  Body: `{ Role, Seniority, MinSalary?, MaxSalary? }`. **This is what the widgets
  call on save** (creates new roles + bumps existing ones).
- `POST /increment` → (legacy) bump `Counter` for a given `ROWID`. No longer
  called by the widgets — kept for backward compatibility only.

## Access & security

### `cheatsheet-read` (web client) — real authentication
The Catalyst-hosted web client reads through `cheatsheet-read`, whose Catalyst
**Security Rule** must be set to require authentication. Because security rules
for functions are **console-managed** (there is no CLI/project file for them —
only the API Gateway uses `catalyst-user-rules.json`, which we do NOT enable),
this MUST be set in the console, **once per environment**:

> Catalyst Console → your project → **Serverless → Functions** →
> **cheatsheet-read** → **Security Rules** → set the JSON to
> `{ "methods": ["GET"], "authentication": "required" }` → **Save**.

Do this in **Development** now and again in **Production** before launch — the
setting does NOT carry across environments. New functions default to
`"authentication": "optional"`, which is the bypass we are closing.

The web client also runs a **client-side auth guard** (Catalyst Web SDK
`isUserAuthenticated()` → redirect to `/__catalyst/auth/login`). That is UX only
— it stops anonymous visitors seeing an empty shell. The server-side Security
Rule on `cheatsheet-read` is the actual boundary.

### `cheatsheet-api` (Sigma widgets) — PUBLIC, app-level hardening
`cheatsheet-api` stays **PUBLIC (open)** in Catalyst access control, hardened at
the app level rather than with Catalyst authentication. (True per-user auth would
require serving the widget same-origin from Catalyst; we host on Sigma instead —
see `../MEMORY.md`.) Do NOT flip this one to authenticated: the cross-origin
Sigma widgets carry no Catalyst session and would break.

Two guards:
1. **Shared-key gate on writes** — `POST /upsert` and `/increment` require a
   matching `key` field **in the request body** (`{ key: ... }`); mismatch →
   `401`. `GET /` (read) is left open. `WIDGET_KEY` is the constant at the top of
   `functions/cheatsheet-api/index.js`.
2. **CORS allowlist** — `Access-Control-Allow-Origin` is echoed only for Zoho
   origins (`.zappsusercontent.com`, `.zohostatic.com`, `.zoho.*`), not `*`.
   Rejected origins are logged as `Origin not in allowlist: <origin>`.

> ⚠ **Why the key is in the BODY, not a header.** A custom request header (or a
> JSON `Content-Type`) makes the call a "non-simple" CORS request, forcing an
> `OPTIONS` **preflight**. Catalyst's gateway answers preflights itself with **no
> CORS headers**, so the browser blocks the real call ("not reaching the
> server"). Putting the key in the body and sending writes as
> `Content-Type: text/plain` keeps the request "simple" → no preflight → it works
> cross-origin from the Sigma-hosted widget. (`readBody` JSON-parses regardless
> of content type.)
>
> ⚠ **This is obscurity, not authentication.** The key is embedded in the widget
> HTML (visible via browser DevTools), so it deters drive-by writes but does not
> stop a determined caller. CORS only constrains browsers, not direct (e.g. curl)
> calls — the body-key gate is the real server-side check.
>
> **The key must match in three places:** `WIDGET_KEY` here and `CS_KEY` in both
> widgets' `widget.html`. Change all three together. Current value:
> `nss-cheatsheet-7Qx3v9Kp2Lr8`.
>
> If the allowlist ever misses the live widget origin, the cheat sheet fails to
> load — check the function logs for the rejected `Origin` and add it to
> `ALLOWED_ORIGIN_SUFFIXES`.

## Web client (manual mode)
`client/` is a standalone, Catalyst-hosted build of the pricing simulator. Unlike
the Sigma widgets it has **no Zoho CRM integration**: there is no embedded record
to read or write, so it is a read-only calculator. Its only backend dependency is
`cheatsheet-read`, called with a **relative** `GET /server/cheatsheet-read`
(same-origin on the Catalyst domain → the Hosted-Login session cookie rides along
automatically, so no CORS and no shared key). It never writes — there is no save
button and no `/upsert`/`/increment` call. Access is gated by
`cheatsheet-read`'s `authentication: required` Security Rule (see "Access &
security").

It shares the widgets' pricing logic: `MULT = 1.25`,
`price = r125(salary × 1.25 + max(margin, floor))`, with `TIER_FLOORS` at a
**flat 1000** for every tier (2026-06-16 business decision). The old "all
seniority levels" comparison table was removed — the seniority buttons still
drive the salary defaults and cheat-sheet filtering.

- `client/index.html` — the web client UI
- `client/client-package.json` — `homepage: index.html`
- `client/favicon.ico`

`catalyst.json` declares `client.source: "client"`, so `catalyst deploy` ships
the client and the function together. Catalyst serves the client at the project
root and the function under `/server/cheatsheet-api`.

## SalaryCheatSheet schema
`Role` (text) · `Country` (text) · `Seniority` (text) · `MinSalary` (int) ·
`MaxSalary` (int) · `Counter` (int) · `UpdatedDate` (date `YYYY-MM-DD`) · `ROWID`.

> `MinSalary`/`MaxSalary` are **int** — keep whole numbers. `UpdatedDate` is
> **date** — `YYYY-MM-DD` only.

## Deploy
Bound to the **Pricing-Calculator** Catalyst project via `.catalystrc`
(Development + Production envs). From this folder:

```
catalyst deploy
```

> ⚠ **Deploy order.** `GET` (read) is open, so the cheat sheet keeps loading
> across versions. Only `POST` writes are gated (key in body). Roll out together:
> `catalyst deploy` here **and** upload both new widget zips to Sigma, then
> hard-refresh CRM. An older widget that sends the key as the `X-Widget-Key`
> header (the earlier, broken approach) will fail entirely cross-origin — it must
> be replaced with the body-key build.

Function URL (development):
```
https://pricing-calculator-916648406.development.catalystserverless.com/server/cheatsheet-api/
```

`catalyst deploy` ships the `cheatsheet-api` and `cheatsheet-read` functions
**and** the manual-mode `client/` web client (see "Web client" above). To deploy
in isolation: `catalyst deploy --only functions` /
`catalyst deploy --only functions:cheatsheet-read` / `catalyst deploy --only client`.

> ⚠ **After first deploying `cheatsheet-read`, set its Security Rule in the
> console** (`authentication: required`, methods `["GET"]`) — see "Access &
> security". A freshly deployed function defaults to `optional`, so until you
> set this the read endpoint is still open. Repeat in **Production** before
> launch; the rule does not carry across environments.

> Currently deployed to **development** only. Promoting to production carries
> code/metadata but NOT Data Store rows — migrate via
> `catalyst datastore:export` / `:import --production`. See
> `../legacy/HANDOFF.md` for the full procedure.
