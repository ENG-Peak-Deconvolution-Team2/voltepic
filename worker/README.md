# VoltEPIC shared Gemini access (Cloudflare Worker)

Lets visitors get a chemist report without their own Gemini key. The Worker holds the project's key as a Cloudflare
secret; the browser never sees it.

It is deliberately narrow:

- **Origin**: answers only `https://eng-peak-deconvolution-team2.github.io` (and `127.0.0.1:8765` / `localhost:8765`
  for local testing). Origin can be forged outside a browser, so the next two limits carry the weight.
- **Input**: only the analyzer's fact packet (5–24 facts of ≤ 400 characters, four decisions, known card keys) and, for
  follow-up questions, up to 8 earlier turns and a question of ≤ 600 characters. The Worker builds the conversation
  itself with `assets/js/llm/packet.js` → `buildContents` and `data/llm.json` — the same code and text the site uses.
  A question is free text, so the shared access can be asked off-topic things inside the report rules; the rate limit
  and the question length bound what that costs.
- **Models**: `gemini-3.8-flash`, `gemini-2.5-flash`.
- **Rate**: 4 reports per minute per IP (Workers rate-limiting binding).

What is sent to Google is the same as with a visitor's own key: the facts (for library curves also chip, date and
channel; never the raw curve or the file name). The project key's tier decides Google's terms (free tier: content may
be used to improve Google's models and read by human reviewers).

## Deploy

From this folder, with a Cloudflare account:

```
npx wrangler@4 login
npx wrangler@4 secret put GEMINI_API_KEY     # paste the key when asked
npx wrangler@4 deploy                        # prints https://voltepic-gemini.<account>.workers.dev
```

Then set `SHARED` in `assets/js/llm/gemini.js` to that URL and publish the site.

## Try locally

```
npx wrangler@4 dev --port 8787 --var GEMINI_API_KEY:<key>
```

and, on the locally served site, `localStorage.setItem("voltepic.gemini.shared", "http://127.0.0.1:8787")`.
