# Shared guest token (same UID for everyone)

To give all guest users the **same** Firebase UID (e.g. `guest`) so they share one set of data (recipes, inventory, etc.), the Python backend issues a [custom token](https://firebase.google.com/docs/auth/admin/create-custom-tokens) for that UID. The app calls `GET /api/guest-token` and signs in with `signInWithCustomToken`.

## How it works

The Python backend endpoint `GET /api/guest-token` (in `server/main.py`) uses Firebase Admin SDK to create a custom token for the UID `guest` (must match `SHARED_GUEST_UID` in `services/authService.ts`).

**Prerequisites:**
- Place your Firebase service account JSON at `server/serviceAccountKey.json` (or set `FIREBASE_SERVICE_ACCOUNT_JSON` env var)
- The backend must be running (`cd server && python main.py`)

The endpoint is intentionally **unauthenticated** — it's called by users who haven't signed in yet (the "Continue as Guest" flow on the login screen).

## Firestore rules

Allow the `guest` user to read/write their data. Your rules likely already use `request.auth.uid`; ensure the path `users/guest/...` is allowed when `request.auth.uid == 'guest'`. For example:

```
match /users/{userId}/recipes/{recipeId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

Then when a user signs in with the guest custom token, `request.auth.uid` will be `guest` and they can access `users/guest/...`.

## Security note

Anyone who can call the `/api/guest-token` endpoint gets a token that signs them in as `guest`. So all guests share the same data. Use this only if that's intended (e.g. kiosk or single shared account). To restrict who can get the token, add checks (e.g. rate limiting, CORS, or allow only from your app origin).
