# VoltEPIC's mailbox (Cloudflare Worker)

Carries the chemist report between the site and the project's lab PC without anything connecting to the PC. The site
leaves a request here; the PC (`relay/server.mjs`) collects it over outbound HTTPS, asks the AI-LAB model and leaves the
answer; the site asks for it every 3 s.

```
browser ── POST /jobs ──▶ mailbox ◀── POST /pc/next ── lab PC ──▶ AI-LAB model
browser ── GET /jobs/:id ─▶ mailbox ◀── POST /pc/done/:id ─┘
```

What it checks:

- **Visitors**: only `https://eng-peak-deconvolution-team2.github.io` (and `127.0.0.1:8765` / `localhost:8765` for
  local testing); only the analyzer's chemist-report evidence file (version `chemist_report…`, four decisions, four
  analyte branches; a question ≤ 600 characters, the report given ≤ 4,000, at most 2 earlier attempts), ≤ 80 KB; a
  Cloudflare Turnstile token checked with `TURNSTILE_SECRET`; 4 requests a minute per IP (`CF-Connecting-IP`); at most
  6 requests waiting; **one chemist report an hour for the whole site**: the report's request opens the hour and gets a session id, and
  its rewrite, a rewrite of the report and the questions on it (at most 5 calls) must carry it. Origin can be forged outside a browser; the token and the limits carry the weight.
- **The lab PC**: `Authorization: Bearer <PC_SECRET>`, compared in constant time.
- **Timing**: the PC asks every 3 s; silent for 20 s it is off and new requests get the offline message. A visitor who
  stops asking for 60 s has left: a waiting request is removed, a running one is stopped by the PC's next progress report
  (every 15 s). A running request with no progress for 90 s ends with an error. Answers are kept 15 min.
- **State**: one Durable Object (`Kuyruk`, SQLite storage); it does its housekeeping at the start of each call, so no
  timer keeps it awake. A request id is a random UUID; only its holder can read the answer.

The PC never receives a connection, so it needs no open port and no tunnel. The evidence file (with the chip name; never
the raw curve, the blank curve or the file name) passes through Cloudflare.

## Deploy

From this folder, with a Cloudflare account:

```
npx wrangler@4 login
npx wrangler@4 deploy                          # prints https://voltepic-relay.<account>.workers.dev
npx wrangler@4 secret put TURNSTILE_SECRET     # the Turnstile widget's secret key
npx wrangler@4 secret put PC_SECRET            # the same value as PC_SECRET in relay/.env
```

Then set `SERVER` in `assets/js/llm/relay.js` and `MAILBOX_URL` in `relay/.env` to that address, add it to the
`connect-src` of the pages' Content-Security-Policy, and publish the site.

## Try locally

```
npx wrangler@4 dev --port 8787 --ip 127.0.0.1 --persist-to "%LOCALAPPDATA%\voltepic\wrangler-state"
```

with `.dev.vars` holding `TURNSTILE_SECRET` (Cloudflare's always-pass test secret `1x0000000000000000000000000000000AA`)
and `PC_SECRET`. The state goes outside Google Drive: SQLite fails there (`SQLITE_IOERR`). Then `MAILBOX_URL` in
`relay/.env` is `http://127.0.0.1:8787`, and on the locally served site
`localStorage.setItem("voltepic.relay", "http://127.0.0.1:8787")`.
