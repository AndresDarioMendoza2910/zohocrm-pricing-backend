# Nessteams Pricing Backend (Catalyst)

The shared serverless API behind both pricing widgets
(`nessteams-pricing-wizard`, `nessteams-pricing-button`). A Zoho **Catalyst
Advanced I/O Function** (Node 20) named `cheatsheet-api`, backed by the
`SalaryCheatSheet` Data Store table.

This project also hosts a **manual-mode web client** (`client/`) — a standalone,
Catalyst-served copy of the pricing simulator with no Zoho CRM integration (see
"Web client" below).

## Endpoints
- `GET  /`          → all roles, ordered by `Counter` DESC
- `POST /upsert`    → match on Role + Seniority; bump `Counter` if found, else
  insert a new row (`Counter = 1`, `Country = "Panama"`, today's `UpdatedDate`).
  Body: `{ Role, Seniority, MinSalary?, MaxSalary? }`. **This is what the widgets
  call on save** (creates new roles + bumps existing ones).
- `POST /increment` → (legacy) bump `Counter` for a given `ROWID`. No longer
  called by the widgets — kept for backward compatibility only.

## Access & security
The function is **PUBLIC (open)** in Catalyst access control, hardened at the
app level rather than with Catalyst authentication. (True per-user auth would
require serving the widget same-origin from Catalyst; we host on Sigma instead —
see `../MEMORY.md`.)

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
`cheatsheet-api`, called with a **relative** `GET /server/cheatsheet-api`
(same-origin on the Catalyst domain → no CORS, no key). It never writes — there
is no save button and no `/upsert`/`/increment` call.

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

`catalyst deploy` ships **both** the `cheatsheet-api` function and the manual-mode
`client/` web client (see "Web client" above). To deploy one in isolation:
`catalyst deploy --only functions` or `catalyst deploy --only client`.

> Currently deployed to **development** only. Promoting to production carries
> code/metadata but NOT Data Store rows — migrate via
> `catalyst datastore:export` / `:import --production`. See
> `../legacy/HANDOFF.md` for the full procedure.
