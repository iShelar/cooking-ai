import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  signInWithCustomToken,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  User,
  UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

/** Fixed UID used when signing in as shared guest (custom token). Must match the UID your backend uses in createCustomToken(uid). */
export const SHARED_GUEST_UID = 'guest';

export function signUp(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signIn(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

/** Sign in anonymously. Each device gets its own persistent UID until they sign in with email. */
export function signInAsAnonymous(): Promise<UserCredential> {
  return signInAnonymously(auth);
}

/**
 * Sign in as shared guest (same UID for everyone). Requires a backend that returns a custom token for SHARED_GUEST_UID.
 * Set VITE_GUEST_TOKEN_URL to your endpoint that returns { token: string }. Example Cloud Function:
 *   const token = await admin.auth().createCustomToken('guest');
 *   res.json({ token });
 */
export async function signInAsSharedGuest(): Promise<UserCredential> {
  const url = import.meta.env.VITE_GUEST_TOKEN_URL as string | undefined;
  if (!url?.trim()) {
    return signInAnonymously(auth);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error("We couldn't sign you in as guest. Try again?");
  const body = (await res.json()) as { token?: string };
  const token = body?.token;
  if (!token || typeof token !== 'string') throw new Error("Something went wrong. Try again?");
  return signInWithCustomToken(auth, token);
}

/** Keys we keep on sign-out (preference and language / onboarding state for the device). */
const KEEP_ON_SIGNOUT = new Set([
  'cookai_dietary_survey_shown',
  'cookai_voice_language_prompt_shown',
  'cookai_recipe_onboarding_tip_shown',
  'cookai_add_recipe_button_tutorial_shown',
]);

/** Clear app-specific localStorage (cookai_*) on sign-out, but keep preference and language/onboarding flags. */
export function clearAppStorageOnSignOut(): void {
  if (typeof localStorage === 'undefined') return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('cookai_') && !KEEP_ON_SIGNOUT.has(key)) keys.push(key);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

export function signOut(): Promise<void> {
  clearAppStorageOnSignOut();
  return firebaseSignOut(auth);
}

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** Re-authenticate with current password (required before updating password). */
export function reauthenticate(currentPassword: string): Promise<UserCredential> {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error("You need to be signed in to change your password.");
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  return reauthenticateWithCredential(user, credential);
}

/** Update password. Call reauthenticate(currentPassword) first. */
export function updateUserPassword(newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("You need to be signed in to change your password.");
  return updatePassword(user, newPassword);
}
