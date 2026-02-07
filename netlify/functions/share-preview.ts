import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import * as admin from 'firebase-admin';

const SHARED_RECIPES_COLLECTION = 'sharedRecipes';

/** Crawlers that must get recipe meta without any redirect (they follow meta refresh and then scrape the SPA). */
const CRAWLER_PATTERNS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'Slackbot',
  'WhatsApp',
  'Discordbot',
  'LinkedInBot',
  'Pinterest',
  'TelegramBot',
  'Googlebot',
];

function isCrawler(userAgent: string): boolean {
  const ua = (userAgent || '').toLowerCase();
  return CRAWLER_PATTERNS.some((p) => ua.includes(p.toLowerCase()));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getAbsoluteImageUrl(image: string, origin: string): string {
  if (!image) return '';
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith('/')) return `${origin}${image}`;
  return `${origin}/${image}`;
}

export const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const path = event.path || '';
  const match = path.match(/^\/share\/([^/]+)/);
  const token = match?.[1]?.trim();
  if (!token) {
    return { statusCode: 404, body: 'Not found' };
  }

  const userAgent = event.headers['user-agent'] || event.headers['User-Agent'] || '';
  const origin =
    event.headers['x-forwarded-proto'] && event.headers['host']
      ? `${event.headers['x-forwarded-proto']}://${event.headers['host']}`
      : 'https://example.com';

  if (!admin.apps.length) {
    const credJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!credJson) {
      console.error('FIREBASE_SERVICE_ACCOUNT_JSON not set');
      return { statusCode: 500, body: 'Server configuration error' };
    }
    try {
      const cred = JSON.parse(credJson);
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    } catch (e) {
      console.error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON', e);
      return { statusCode: 500, body: 'Server configuration error' };
    }
  }

  const db = admin.firestore();
  const docSnap = await db.collection(SHARED_RECIPES_COLLECTION).doc(token).get();
  if (!docSnap.exists) {
    return { statusCode: 404, body: 'Recipe not found' };
  }

  const data = docSnap.data();
  const recipe = data?.recipe;
  if (!recipe || typeof recipe !== 'object') {
    return { statusCode: 404, body: 'Recipe not found' };
  }

  const title = typeof recipe.title === 'string' ? recipe.title : 'Recipe';
  const description = typeof recipe.description === 'string' ? recipe.description : '';
  const image = typeof recipe.image === 'string' ? recipe.image : '';
  const imageUrl = getAbsoluteImageUrl(image, origin);
  const spaUrl = origin + '/?share=' + encodeURIComponent(token);

  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeUrl = escapeHtml(origin + path);
  const safeSpaUrl = escapeHtml(spaUrl);

  const crawler = isCrawler(userAgent);

  // Crawlers: return recipe meta only, no redirect. Facebook etc. follow meta refresh and then scrape
  // the SPA (generic meta). So for crawlers we must not send meta refresh or they'll scrape the wrong page.
  const headMeta = `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:url" content="${safeUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImage}">`;

  const html = crawler
    ? `<!DOCTYPE html>
<html lang="en">
<head>${headMeta}
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeDesc}</p>
  <p><a href="${safeSpaUrl}">Open recipe</a></p>
</body>
</html>`
    : `<!DOCTYPE html>
<html lang="en">
<head>${headMeta}
  <meta http-equiv="refresh" content="0;url=${safeSpaUrl}">
</head>
<body>
  <p>Opening recipe…</p>
  <p><a href="${safeSpaUrl}">Open recipe</a></p>
  <script>window.location.replace(${JSON.stringify(spaUrl)});</script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
    body: html,
  };
};
