import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  reauthenticateWithCredential,
  EmailAuthProvider,
  updatePassword,
  User,
  UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

export function signUp(email: string, password: string): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signIn(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth);
}

export function subscribeToAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** Re-authenticate with current password (required before updating password). */
export function reauthenticate(currentPassword: string): Promise<UserCredential> {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('You must be signed in to change your password.');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  return reauthenticateWithCredential(user, credential);
}

/** Update password. Call reauthenticate(currentPassword) first. */
export function updateUserPassword(newPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to change your password.');
  return updatePassword(user, newPassword);
}
