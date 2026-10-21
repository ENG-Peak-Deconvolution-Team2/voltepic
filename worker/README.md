# VoltEPIC shared Gemini access (Cloudflare Worker)

Lets visitors get a chemist report without their own Gemini key. The Worker holds the project's key as a Cloudflare
secret; the browser never sees it.

It is deliberately narrow:

- **Origin**: answers only `https://eng-peak-deconvolution-team2.github.io` (and `127.0.0.1:8765` / `localhost:8765`
  for local testing). Origin can be forged outside a browser, so the next two limits carry the weight.
- **Input**: only the analyzer's chemist-report evidence file (version `kimyager_raporu…`, four decisions, four analyte
  branches) with the kind of call (`rapor` or `soru`); for a question also the report given (≤ 4,000 characters) and the
  question (≤ 600); for a rewrite at most 2 earlier attempts with their code-check findings. The Worker builds the message
  itself with `assets/js/llm/kanit.js` (`pyJson`) and `assets/js/llm/denetim.js` (`mesajRapor`, `mesajSoru`, `duzeltme`),
  and takes the system prompt from `data/kimyager_istem.json` — the same code and text the site uses. A question is free
  text, so the shared access can be asked off-topic things inside the prompt's rules; the rate limit and the question
  length bound what that costs.
- **Status (2026-10-21)**: changed to the evidence-file protocol, not deployed; `SHARED` in `gemini.js` is empty, so the
  site uses only a visitor's own key.
- **Models**: `gemini-3.8-flash`, `gemini-2.5-flash`.
- **Rate**: 4 reports per minute per IP (Workers rate-limiting binding).

What is sent to Google is the same as with a visitor's own key: the evidence file (with the chip name; never the raw
curve, the blank curve or the file name). The project key's tier decides Google's terms (free tier: content may
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
