'use strict';

const catalyst = require('zcatalyst-sdk-node');

/* ─────────────────────────────────────────────────────────────────────────
   Cheat Sheet API — Catalyst Advanced I/O Function (Node 20)

   GET  /          → returns all SalaryCheatSheet rows, Counter DESC
   POST /upsert    → match on Role + Seniority; bump Counter if found,
                     otherwise insert a new row (Counter = 1)
   POST /increment → (legacy) increments Counter for the given ROWID

   Mark this function PUBLIC in Catalyst Console → Functions →
   cheatsheet-api → Access Control so it works in all widget modes.
───────────────────────────────────────────────────────────────────────── */

const DEFAULT_COUNTRY = 'Panama';   // Country set on rows the widget creates

/* ── Lightweight access hardening (function stays "open" in Catalyst) ──
   1) CORS is restricted to Zoho widget origins instead of "*".
   2) Write routes (/upsert, /increment) require a shared key in the request
      BODY ({ key: ... }) — NOT a custom header. Writes use Content-Type
      text/plain so requests stay CORS "simple" and skip the OPTIONS preflight.
      (Catalyst's gateway answers preflights itself with no CORS headers, which
      would otherwise block any non-simple cross-origin call.) The GET read
      route is left open.
   NOTE: the key is embedded in the widget HTML, so this is obscurity-level
   protection (stops drive-by writes), NOT true authentication.
   Change WIDGET_KEY here AND CS_KEY in BOTH widgets together. */
const WIDGET_KEY = 'nss-cheatsheet-7Qx3v9Kp2Lr8';
const ALLOWED_ORIGIN_SUFFIXES = [
  '.zappsusercontent.com',   // Sigma widget hosting (primary)
  '.zohostatic.com',
  '.zoho.com', '.zoho.eu', '.zoho.in', '.zoho.com.au', '.zoho.jp', '.zohocloud.com',
];
function originAllowed(origin) {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_SUFFIXES.some(function (s) { return host === s.slice(1) || host.endsWith(s); });
  } catch (e) { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  /* CORS — restricted to Zoho widget origins (Sigma hosting). Echo the origin
     when allowed so the browser accepts the response. X-Widget-Key is allowed
     as a custom request header (which also triggers a preflight). */
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    console.warn('[cheatsheet-api] Origin not in allowlist:', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const url    = req.url;
  const method = req.method;

  /* Preflight — kept for completeness, though "simple" requests skip it.
     (Catalyst's gateway typically answers OPTIONS before this runs.) */
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const app  = catalyst.initialize(req);
    const zcql = app.zcql();

    /* ── GET / ── return all rows ordered by Counter DESC ── */
    if (method === 'GET' && (url === '/' || url === '')) {
      const rows = await zcql.executeZCQLQuery(
        'SELECT ROWID, Role, Country, Seniority, MinSalary, MaxSalary, Counter, UpdatedDate ' +
        'FROM SalaryCheatSheet ORDER BY Counter DESC'
      );
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: rows }));
      return;
    }

    /* ── POST /upsert ── create-if-missing, else bump Counter ──
       Body: { Role, Seniority, MinSalary?, MaxSalary? }
       "Duplicate" is decided by Role + Seniority together. */
    if (method === 'POST' && url === '/upsert') {
      const body = await readBody(req);

      /* Shared-key gate (in body, not a header → keeps the request preflight-free) */
      if (body.key !== WIDGET_KEY) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }

      const role      = String(body.Role || '').trim();
      const seniority = String(body.Seniority || '').trim();
      const minSalary = body.MinSalary;
      const maxSalary = body.MaxSalary;

      if (!role || !seniority) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Role and Seniority are required' }));
        return;
      }

      /* Find an existing row matching BOTH Role and Seniority.
         Single-quotes in the values are escaped to keep the ZCQL string safe. */
      const existing = await zcql.executeZCQLQuery(
        "SELECT ROWID, Counter FROM SalaryCheatSheet " +
        "WHERE Role = '" + esc(role) + "' AND Seniority = '" + esc(seniority) + "' LIMIT 1"
      );
      const found = existing && existing[0] && (existing[0].SalaryCheatSheet || existing[0]);

      const table = app.datastore().table('SalaryCheatSheet');

      if (found) {
        /* ── UPDATE ── bump counter, refresh date, refresh salary if sent ── */
        const newCount = (parseInt(found.Counter) || 0) + 1;
        const updateData = {
          ROWID: String(found.ROWID),
          Counter: newCount,
          UpdatedDate: today(),
        };
        if (isSet(minSalary)) updateData.MinSalary = minSalary;
        if (isSet(maxSalary)) updateData.MaxSalary = maxSalary;

        await table.updateRow(updateData);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'updated', newCount }));
        return;
      } else {
        /* ── INSERT ── brand-new role for this seniority ── */
        const insertData = {
          Role: role,
          Seniority: seniority,
          Country: DEFAULT_COUNTRY,
          Counter: 1,
          UpdatedDate: today(),
        };
        if (isSet(minSalary)) insertData.MinSalary = minSalary;
        if (isSet(maxSalary)) insertData.MaxSalary = maxSalary;

        await table.insertRow(insertData);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, action: 'created', newCount: 1 }));
        return;
      }
    }

    /* ── POST /increment ── (legacy) bump Counter by 1 by ROWID ── */
    if (method === 'POST' && url === '/increment') {
      const body    = await readBody(req);

      /* Shared-key gate (in body, not a header → keeps the request preflight-free) */
      if (body.key !== WIDGET_KEY) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
        return;
      }

      const { rowId } = body;

      /* Validate rowId is a non-empty numeric string — reject anything else */
      if (!rowId || !/^\d+$/.test(String(rowId))) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, error: 'Invalid rowId' }));
        return;
      }

      /* Read the current Counter server-side — never trust the client value */
      const existing = await zcql.executeZCQLQuery(
        'SELECT ROWID, Counter FROM SalaryCheatSheet WHERE ROWID = ' + String(rowId)
      );
      const row = existing && existing[0] && (existing[0].SalaryCheatSheet || existing[0]);

      if (!row) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: 'Row not found' }));
        return;
      }

      const newCount = (parseInt(row.Counter) || 0) + 1;
      await app.datastore().table('SalaryCheatSheet')
        .updateRow({ ROWID: String(rowId), Counter: newCount, UpdatedDate: today() });

      res.writeHead(200);
      res.end(JSON.stringify({ success: true, newCount }));
      return;
    }

    /* ── fallthrough ── */
    res.writeHead(404);
    res.end(JSON.stringify({ success: false, error: 'Not found' }));

  } catch (err) {
    /* Log full error internally; return generic message to client */
    console.error('[cheatsheet-api] Error:', err.message || err);
    res.writeHead(500);
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
};

/* Parse JSON request body */
function readBody(req) {
  return new Promise(function(resolve, reject) {
    var body = '';
    req.on('data', function(chunk) { body += chunk.toString(); });
    req.on('end',  function() {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

/* Escape single quotes so a value can't break the ZCQL string literal */
function esc(v) {
  return String(v == null ? '' : v).replace(/'/g, "''");
}

/* True when a value was actually supplied (not undefined/null/empty) */
function isSet(v) {
  return v !== undefined && v !== null && v !== '';
}

/* YYYY-MM-DD for the UpdatedDate column */
function today() {
  return new Date().toISOString().slice(0, 10);
}