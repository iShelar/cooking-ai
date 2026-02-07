/**
 * Returns a Firebase custom token for the shared guest UID.
 * Set GOOGLE_APPLICATION_CREDENTIALS to the path of your Firebase service account JSON
 * (Firebase Console → Project settings → Service accounts → Generate new private key).
 * UID must match SHARED_GUEST_UID ('guest') in the app's authService.
 */
import admin from "firebase-admin";

const GUEST_UID = "guest";

let initialized = false;

function ensureAdmin() {
  if (initialized) return;
  if (admin.apps.length > 0) {
    initialized = true;
    return;
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  initialized = true;
}

export async function getGuestToken() {
  ensureAdmin();
  return admin.auth().createCustomToken(GUEST_UID);
}
