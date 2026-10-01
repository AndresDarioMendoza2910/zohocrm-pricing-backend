'use strict';

const catalyst = require('zcatalyst-sdk-node');

/* ─────────────────────────────────────────────────────────────────────────
   Cheat Sheet READ API — Catalyst Advanced I/O Function (Node 20)

   GET / → returns all SalaryCheatSheet rows, Counter DESC.

   This is the AUTHENTICATED, read-only sibling of `cheatsheet-api`. It exists
   so the Catalyst-hosted web client (client/index.html) can read the cheat
   sheet behind a real auth wall WITHOUT breaking the cross-origin Sigma widgets
   that depend on `cheatsheet-api` staying PUBLIC.

   ── SECURITY BOUNDARY ──
   Access is enforced by this function's Catalyst Security Rule, which MUST be
   set to:
       { "methods": ["GET"], "authentication": "required" }
   in the Catalyst Console (Serverless → Functions → cheatsheet-read →
   Security Rules), PER ENVIRONMENT (Development AND Production). With
   authentication:required, Catalyst rejects unauthenticated callers before this
   code runs, so:
     • The web client is served same-origin and carries the Hosted-Login
       session cookie automatically → calls succeed once signed in.
     • Anonymous visitors get 401 → no Data Store read happens.

   This function is READ-ONLY and has NO write routes and NO shared key:
   all writes continue to go through `cheatsheet-api` (/upsert, /increment).
───────────────────────────────────────────────────────────────────────── */

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const url    = req.url;
  const method = req.method;

  try {
    /* GET / → all rows, ordered by Counter DESC (same shape as cheatsheet-api) */
    if (method === 'GET' && (url === '/' || url === '')) {
      const app  = catalyst.initialize(req);
      const zcql = app.zcql();
      const rows = await zcql.executeZCQLQuery(
        'SELECT ROWID, Role, Country, Seniority, MinSalary, MaxSalary, Counter, UpdatedDate ' +
        'FROM SalaryCheatSheet ORDER BY Counter DESC'
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: rows }));
      return;
    }

    /* Anything else (including any write attempt) → 404. Writes belong to
       cheatsheet-api, not here. */
    res.writeHead(404);
    res.end(JSON.stringify({ success: false, error: 'Not found' }));

  } catch (err) {
    console.error('[cheatsheet-read] Error:', err.message || err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
};
