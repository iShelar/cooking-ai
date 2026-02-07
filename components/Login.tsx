import React, { useState } from 'react';
import { signIn, signUp, signInAsSharedGuest } from '../services/authService';

interface LoginProps {
  onSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setError('');
    setGuestLoading(true);
    try {
      await signInAsSharedGuest();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Guest sign-in failed';
      setError(message);
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col justify-center px-6">
      <div className="space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-stone-800 tracking-tight">CookAI Assistant</h1>
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
          {error && (
            <div className="bg-red-50 text-red-700 text-sm py-2.5 px-4 rounded-xl">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || guestLoading}
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
            disabled={loading || guestLoading}
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
