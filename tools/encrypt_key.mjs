// Writes data/gemini_key.json: the site's Gemini key, encrypted with the site password (PBKDF2-SHA256 → AES-GCM).
// The browser opens it in assets/js/llm/gemini.js (unlockSiteKey). Neither the key nor the password is printed or stored.
//   GEMINI_API_KEY=… SITE_PASSWORD=… node tools/encrypt_key.mjs
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const ITER = 600000;
const key = process.env.GEMINI_API_KEY?.trim(), password = process.env.SITE_PASSWORD;
if (!key || !password) { console.error("Set GEMINI_API_KEY and SITE_PASSWORD."); process.exit(1); }

const enc = new TextEncoder(), b64 = (u) => Buffer.from(u).toString("base64");
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(key)));

// check before writing: the password opens it again
const back = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ct));
if (back !== key) { console.error("Round trip failed."); process.exit(1); }

const out = { schema: 1, kdf: "PBKDF2-SHA256", iterations: ITER, cipher: "AES-256-GCM", salt: b64(salt), iv: b64(iv), ct: b64(ct) };
writeFileSync(new URL("../data/gemini_key.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`data/gemini_key.json written (${ct.length} bytes encrypted, ${ITER} PBKDF2 iterations).`);
