# Pricing Backend — Zoho Catalyst

The serverless backend behind the pricing widgets and the standalone web client.
It's a small [Zoho Catalyst](https://catalyst.zoho.com/) project with two
Node 20 functions, a datastore, and a hosted web app:

| Piece | What it is |
|-------|------------|
| **`cheatsheet-api`** | Public function — reads the cheat sheet and records usage (write). Used by the cross-origin CRM widgets. |
| **`cheatsheet-read`** | Authenticated function — read-only. Used by the same-origin hosted web client, behind login. |
| **`SalaryCheatSheet`** | Data Store table holding crowd-sourced salary ranges per role + seniority. |
| **`client/`** | A standalone, CRM-free pricing calculator, hosted on Catalyst (see *Web client* below). |

`catalyst.json` declares both functions and the client, so `catalyst deploy` ships
everything together.

## The cheat sheet

Rather than ship a static salary table that goes stale, the backend **learns from
usage**. Each row is a `Role` + `Seniority` pair with a typical salary range, a
usage `Counter`, and a last-updated date.

- `GET /` → all rows, ordered by usage.
- `POST /upsert` → `{ Role, Seniority, MinSalary?, MaxSalary? }`. Creates the row if
  the pair is new (seeding the range from the caller), otherwise just bumps the
  counter and refreshes the date. Existing curated ranges are never overwritten.

The widgets only *trust* a suggestion once a role has been priced **a few times
recently** — a simple "enough recent signal" gate that keeps one-off outliers from
becoming the recommendation.

**Schema:** `Role` · `Country` · `Seniority` · `MinSalary` (int) · `MaxSalary`
(int) · `Counter` (int) · `UpdatedDate` (`YYYY-MM-DD`).

## Security model

This is the most interesting part of the backend — two clients with two different
trust models:

### Cross-origin widgets → public function, hardened at the app layer
The CRM widgets are served from Zoho's widget host, so they're **cross-origin** and
can't carry a Catalyst session. Their endpoint (`cheatsheet-api`) therefore stays
public, with two app-level guards:

1. **Shared-key gate on writes.** `POST` routes require a matching `key` — and it's
   sent **in the request body, not a header**. This is deliberate: a custom header
   (or a JSON content-type) makes the request "non-simple," which triggers a CORS
   `OPTIONS` **preflight** — and Catalyst's gateway answers preflights with no CORS
   headers, so the browser blocks the real call. Sending the key in the body with
   `Content-Type: text/plain` keeps the request CORS-"simple," so no preflight
   fires. (A failure that otherwise looks exactly like "the server is unreachable.")
   The server reads its copy of the key from the **`WIDGET_KEY` environment
   variable** and fails closed if it's unset — the secret never lives in source.
2. **CORS allowlist.** The response echoes the origin only for recognized Zoho
   widget hosts.

This is honest *obscurity, not authentication* — the key is visible in the widget's
page source — and it's documented as such. It deters drive-by writes; it is not a
real auth boundary for a determined caller.

### Same-origin web client → real authentication
The hosted web client *can* carry a Catalyst session, so it reads through a
separate, **authenticated** function (`cheatsheet-read`) whose Security Rule
requires login. Anonymous requests are rejected by the platform before any code
runs. This keeps a real auth boundary where one is possible, without breaking the
widgets that structurally can't have one.

> Set `cheatsheet-read`'s Security Rule to `{ "methods": ["GET"],
> "authentication": "required" }` in the Catalyst Console, per environment — it's
> the actual access boundary and isn't expressed in code.

## Web client (manual mode)

`client/` is a standalone build of the pricing calculator with **no CRM
integration** — a read-only calculator that reads the cheat sheet via
`cheatsheet-read` (same-origin, so no CORS and no key). It shares the widgets'
pricing logic and is served at the Catalyst project root.

> **`client-package.json` `name` is account-bound.** Catalyst locks a hosted web
> client to the name it was first registered under and won't rename it, so this
> field must match the client registered in *your* Catalyst project.

## Deploy

Bound to a Catalyst project via `catalyst init`. Then:

```
catalyst deploy                              # functions + client
catalyst deploy --only functions:cheatsheet-api   # one function
catalyst deploy --only client                     # just the web client
```

Set the `WIDGET_KEY` environment variable (per environment) before relying on
writes, and set the `cheatsheet-read` Security Rule as noted above.

## Layout

```
functions/cheatsheet-api/     public read + write function
functions/cheatsheet-read/    authenticated read-only function
client/                       standalone web client (index.html + client-package.json)
catalyst.json                 declares the functions and client
```
