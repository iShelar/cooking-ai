# Shared guest token (same UID for everyone)

To give all guest users the **same** Firebase UID (e.g. `guest`) so they share one set of data (recipes, inventory, etc.), you need a backend that issues a [custom token](https://firebase.google.com/docs/auth/admin/create-custom-tokens) for that UID. The app calls your endpoint and signs in with `signInWithCustomToken`.

## 1. Firebase Cloud Function example

Create a callable or HTTP function in your Firebase project that returns a custom token for the UID `guest` (must match `SHARED_GUEST_UID` in `services/authService.ts`).

**Option A – HTTP function (callable from the app with `fetch`)**

```js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const GUEST_UID = 'guest';

exports.getGuestToken = functions.https.onRequest(async (req, res) => {
  try {
    const token = await admin.auth().createCustomToken(GUEST_UID);
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

**Option B – Callable function** (if you prefer `httpsCallable` from the client instead of `fetch`)

```js
exports.getGuestToken = functions.https.onCall(async (data, context) => {
  const token = await admin.auth().createCustomToken('guest');
  return { token };
});
```

If you use Callable, the app would call it with the Firebase JS SDK instead of `fetch`; the current app uses `fetch(VITE_GUEST_TOKEN_URL)` and expects `{ token: string }`.

## 2. Deploy and set env

1. Deploy the function: `firebase deploy --only functions`
2. Copy the HTTP function URL (e.g. `https://us-central1-YOUR_PROJECT.cloudfunctions.net/getGuestToken`).
3. In the app’s `.env.local` set:
   ```env
   VITE_GUEST_TOKEN_URL=https://us-central1-YOUR_PROJECT.cloudfunctions.net/getGuestToken
   ```

## 3. Firestore rules

Allow the `guest` user to read/write their data. Your rules likely already use `request.auth.uid`; ensure the path `users/guest/...` is allowed when `request.auth.uid == 'guest'`. For example:

```
match /users/{userId}/recipes/{recipeId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

Then when a user signs in with the guest custom token, `request.auth.uid` will be `guest` and they can access `users/guest/...`.

## 4. Security note

Anyone who can call your endpoint gets a token that signs them in as `guest`. So all guests share the same data. Use this only if that’s intended (e.g. kiosk or single shared account). To restrict who can get the token, add checks in the function (e.g. API key, rate limit, or allow only from your app origin).
