import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import app from './firebase';
import { saveFcmToken } from './dbService';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/** Whether the current environment supports FCM (HTTPS, service worker, etc.). */
export async function isPushSupported(): Promise<boolean> {
  if (!VAPID_KEY?.trim()) return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

/** Request notification permission. Returns 'granted' | 'denied' | 'default'. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return await Notification.requestPermission();
}

/**
 * Get FCM token and save it for the user. Call after permission is granted.
 * Registers /firebase-messaging-sw.js if not already registered (FCM looks for it at root).
 */
export async function getFcmTokenAndSave(userId: string): Promise<string | null> {
  if (!VAPID_KEY?.trim()) {
    console.warn('VITE_FIREBASE_VAPID_KEY is not set; push notifications disabled.');
    return null;
  }
  try {
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
    });
    if (token) {
      await saveFcmToken(userId, token);
      return token;
    }
    return null;
  } catch (err) {
    console.warn('FCM getToken failed:', err);
    return null;
  }
}

/**
 * Enable push notifications: request permission, get token, save for user.
 * Returns the token if successful, null otherwise.
 */
export async function enablePushNotifications(userId: string): Promise<string | null> {
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') return null;
  return await getFcmTokenAndSave(userId);
}

/** Disable push notifications by clearing the stored token. */
export async function disablePushNotifications(userId: string): Promise<void> {
  await saveFcmToken(userId, null);
}
