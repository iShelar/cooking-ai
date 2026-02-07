# Netlify share link preview (recipe image & description)

When someone shares a recipe link (`/share/TOKEN`), the **first response** is always HTML with **recipe-specific** Open Graph meta, so link previews (Facebook, Twitter, Slack, WhatsApp, etc.) show the recipe image, title, and description instead of the site favicon and site description.

## How it works

- **Netlify function** `share-preview` handles `GET /share/:token`.
- **Every request** gets 200 HTML with `og:title`, `og:description`, `og:image` from the shared recipe in Firestore. Browsers then redirect to `/?share=TOKEN` via meta refresh + script so the SPA loads; crawlers keep the meta for the preview.
- No User-Agent detection: the first byte response is always the one with recipe meta, so caching and any crawler see the correct preview.

## If you still see the old preview (favicon / site description)

Platforms **cache** link previews. After deploying the function, you must **refresh the cache** or new shares will keep showing the old preview:

1. **Facebook:** [Sharing Debugger](https://developers.facebook.com/tools/debug/) — paste your share URL, click **Scrape Again**.
2. **Twitter/X:** [Card Validator](https://cards-dev.twitter.com/validator) — paste the URL to re-fetch.
3. **LinkedIn:** [Post Inspector](https://www.linkedin.com/post-inspector/) — enter the URL and inspect.
4. **Slack / Discord / WhatsApp:** Often use their own cache; re-sharing after 24–48h or using a **new** share URL (new token) can show the updated preview.

## Required: Netlify environment variable

The function reads the shared recipe from Firestore using the **Firebase Admin SDK**. You must set one env var in Netlify:

1. In Netlify: **Site → Site configuration → Environment variables**
2. Add a variable:
   - **Key:** `FIREBASE_SERVICE_ACCOUNT_JSON`
   - **Value:** The **entire** JSON content of your Firebase service account key (the one that can read Firestore). Paste it as a single line or multi-line string.

To get the key: Firebase Console → Project settings → Service accounts → Generate new private key. Copy the JSON and use it as the value (you can minify it to one line).

**Security:** Treat this key as a secret. Never commit it; only set it in Netlify (or your CI) as an env var.

## Build & deploy

- Build publishes `dist`; functions live in `netlify/functions`.
- `netlify.toml` rewrites `/share/*` to the function first, then `/*` to `/index.html` for the SPA.
- **Important:** Do not add a catch-all in `public/_redirects` (e.g. `/* /index.html 200`). Netlify merges `_redirects` with `netlify.toml`, and that catch-all can match `/share/*` first and serve the default HTML instead of the function, so link previews stay generic. Redirects are centralized in `netlify.toml` for this reason.
