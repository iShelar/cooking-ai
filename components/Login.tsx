import React, { useState } from 'react';
import { signIn, signUp, signOut, signInAsSharedGuest, sendVerificationEmail } from '../services/authService';

interface LoginProps {
  onSuccess: () => void;
}

const EMAIL_NOT_VERIFIED_KEY = 'cookai_login_email_not_verified';
const EMAIL_NOT_VERIFIED_MSG = 'Please verify your email before signing in. Check your inbox and spam folder for the verification link.';
const EMAIL_ALREADY_IN_USE_MSG = 'This email is already registered but not verified. Enter your password and click "Resend verification email" below to send the link again.';

const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState(() => {
    try {
      const msg = sessionStorage.getItem(EMAIL_NOT_VERIFIED_KEY);
      if (msg) {
        sessionStorage.removeItem(EMAIL_NOT_VERIFIED_KEY);
        return msg;
      }
    } catch {
      /* ignore */
    }
    return '';
  });
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const showResendVerification =
    (error === EMAIL_NOT_VERIFIED_MSG || error === EMAIL_ALREADY_IN_USE_MSG) && email && password.length >= 6;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);
    try {
      if (isSignUp) {
        const { email: signedUpEmail } = await signUp(email, password);
        setPendingVerifyEmail(signedUpEmail);
      } else {
        const userCredential = await signIn(email, password);
        if (!userCredential.user.emailVerified) {
          setError(EMAIL_NOT_VERIFIED_MSG);
          try {
            sessionStorage.setItem(EMAIL_NOT_VERIFIED_KEY, EMAIL_NOT_VERIFIED_MSG);
          } catch {
            /* ignore */
          }
          await signOut();
          return;
        }
        onSuccess();
      }
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
      const message =
        code === 'auth/email-already-in-use'
          ? EMAIL_ALREADY_IN_USE_MSG
          : err instanceof Error
            ? err.message
            : 'Oops! Something went wrong. Try again?';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email || password.length < 6) return;
    setError('');
    setSuccessMessage('');
    setResendLoading(true);
    try {
      await signIn(email, password);
      await sendVerificationEmail();
      await signOut();
      setSuccessMessage('Verification email sent. Check your inbox and spam folder.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not send. Try again.';
      setError(message);
    } finally {
      setResendLoading(false);
    }
  };

  const handleGuest = async () => {
    setError('');
    setGuestLoading(true);
    try {
      await signInAsSharedGuest();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Couldn't sign in as guest. Try again?";
      setError(message);
    } finally {
      setGuestLoading(false);
    }
  };

  if (pendingVerifyEmail) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col justify-center px-6">
        <div className="space-y-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <header className="space-y-2">
            <h1 className="text-2xl font-bold text-stone-800 tracking-tight">Check your email</h1>
            <p className="text-stone-500 text-sm">
              We&apos;ve sent a verification link to <span className="font-medium text-stone-700">{pendingVerifyEmail}</span>. Click the link to verify your account, then sign in below.
            </p>
            <p className="text-stone-400 text-xs pt-1">If you don&apos;t see it, check your spam or junk folder.</p>
          </header>
          <button
            type="button"
            onClick={() => {
              setPendingVerifyEmail(null);
              setIsSignUp(false);
            }}
            className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-2xl shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition-all"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col justify-center px-6">
      <div className="space-y-8">
        <header className="text-center space-y-4">
          <div className="flex flex-col items-center gap-3">
            <h1 className="text-3xl font-bold text-stone-800 tracking-tight">First Dish</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 text-stone-500 text-xs font-medium">
              <svg className="w-3.5 h-3.5 text-violet-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              Powered by Gemini 3
            </span>
          </div>
          <p className="text-stone-500">
            {isSignUp ? 'Create an account to get started' : 'Sign in to continue'}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-stone-700 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="w-full bg-stone-100 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm text-stone-800"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-stone-700 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              className="w-full bg-stone-100 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all text-sm text-stone-800"
            />
            {isSignUp && (
              <p className="mt-1 text-xs text-stone-400">At least 6 characters</p>
            )}
          </div>
          {successMessage && (
            <div className="bg-emerald-50 text-emerald-800 text-sm py-2.5 px-4 rounded-xl">
              {successMessage}
            </div>
          )}
          {error && (
            <div className="bg-red-50 text-red-700 text-sm py-2.5 px-4 rounded-xl space-y-2">
              <p>{error}</p>
              {showResendVerification && (
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendLoading || loading || guestLoading}
                  className="text-red-700 font-semibold text-sm underline hover:no-underline disabled:opacity-60"
                >
                  {resendLoading ? 'Sending...' : 'Resend verification email'}
                </button>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || guestLoading || resendLoading}
            className="w-full bg-emerald-600 text-white font-bold py-3.5 rounded-2xl shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-60 disabled:pointer-events-none"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {isSignUp ? 'Creating account...' : 'Signing in...'}
              </span>
            ) : isSignUp ? (
              'Create account'
            ) : (
              'Sign in'
            )}
          </button>

          <button
            type="button"
            onClick={handleGuest}
            disabled={loading || guestLoading || resendLoading}
            className="w-full bg-stone-100 text-stone-700 font-semibold py-3 rounded-2xl border border-stone-200 hover:bg-stone-200 active:scale-[0.98] transition-all disabled:opacity-60 disabled:pointer-events-none"
          >
            {guestLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-stone-500 border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              'Continue as guest'
            )}
          </button>
        </form>

        <p className="text-center text-sm text-stone-500">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError('');
              setSuccessMessage('');
              setPendingVerifyEmail(null);
            }}
            className="text-emerald-600 font-semibold hover:underline"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Login;
