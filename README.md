# Nessteams Pricing Backend (Catalyst)

The shared serverless API behind both pricing widgets
(`nessteams-pricing-wizard`, `nessteams-pricing-button`). A Zoho **Catalyst
Advanced I/O Function** (Node 20) named `cheatsheet-api`, backed by the
`SalaryCheatSheet` Data Store table.

## Endpoints
- `GET  /`          → all roles, ordered by `Counter` DESC
- `POST /upsert`    → match on Role + Seniority; bump `Counter` if found, else
  insert a new row (`Counter = 1`, `Country = "Panama"`, today's `UpdatedDate`)
- `POST /increment` → (legacy) bump `Counter` for a given `ROWID`

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

Function URL (development):
```
https://pricing-calculator-916648406.development.catalystserverless.com/server/cheatsheet-api/
```

This project is **function-only** — the old Catalyst-hosted web client was
retired when the widgets moved to Sigma hosting (see `../legacy/`). If you ever
need to deploy the function alone explicitly: `catalyst deploy --only functions`.

> Currently deployed to **development** only. Promoting to production carries
> code/metadata but NOT Data Store rows — migrate via
> `catalyst datastore:export` / `:import --production`. See
> `../legacy/HANDOFF.md` for the full procedure.
