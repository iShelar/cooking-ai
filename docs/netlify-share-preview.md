# Netlify share link preview (recipe image & description)

When someone shares a recipe link (`/share/TOKEN`), crawlers (Facebook, Twitter, Slack, WhatsApp, etc.) get HTML with **recipe-specific** Open Graph meta so the preview shows the recipe image, title, and description instead of the site favicon and site description.

## How it works

- **Netlify function** `share-preview` handles `GET /share/:token`.
- **Crawlers** (by User-Agent): function returns 200 HTML with `og:title`, `og:description`, `og:image` from the shared recipe in Firestore.
- **Browsers**: function returns 302 to `/?share=TOKEN`; the SPA loads and shows the shared recipe using the `?share=` param.

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
- `netlify.toml` rewrites `/share/*` to the function. No other routes are affected.
