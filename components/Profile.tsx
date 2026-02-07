import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { reauthenticate, updateUserPassword, signOut } from '../services/authService';

interface ProfileProps {
  user: User;
  onBack: () => void;
  onOpenSettings?: () => void;
}

const Profile: React.FC<ProfileProps> = ({ user, onBack, onOpenSettings }) => {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password needs to be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await reauthenticate(currentPassword);
      await updateUserPassword(newPassword);
      setSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Oops! Something went wrong. Try again?";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-[#fcfcf9] pb-24">
      <header className="px-6 pt-8 pb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-xl text-stone-600 hover:bg-stone-100"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-2xl font-bold text-stone-800 tracking-tight">Profile</h1>
      </header>

      <div className="px-6 space-y-6">
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-3">Account</h2>
          <div className="space-y-2">
            <p className="text-stone-500 text-sm">Email</p>
            <p className="text-stone-800 font-medium">{user.email ?? '—'}</p>
          </div>
        </section>

        {onOpenSettings && (
          <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-stone-50 transition-colors"
            >
              <span className="font-medium text-stone-800">Settings</span>
              <svg className="w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
          <button
            type="button"
            onClick={() => {
              setShowPasswordForm(!showPasswordForm);
              setError('');
              setSuccess('');
            }}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-stone-50 transition-colors"
          >
            <span className="font-medium text-stone-800">Update password</span>
            <svg
              className={`w-5 h-5 text-stone-400 transition-transform ${showPasswordForm ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showPasswordForm && (
            <form onSubmit={handleUpdatePassword} className="px-6 pb-6 pt-2 border-t border-stone-100 space-y-4">
              <div>
                <label htmlFor="current-password" className="block text-sm font-medium text-stone-700 mb-1">
                  Current password
                </label>
                <input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full bg-stone-100 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-stone-800"
                />
              </div>
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-stone-700 mb-1">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full bg-stone-100 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-stone-800"
                />
                <p className="mt-1 text-xs text-stone-400">At least 6 characters</p>
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-stone-700 mb-1">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full bg-stone-100 rounded-xl py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-stone-800"
                />
              </div>
              {error && (
                <div className="bg-red-50 text-red-700 text-sm py-2 px-3 rounded-xl">{error}</div>
              )}
              {success && (
                <div className="bg-emerald-50 text-emerald-700 text-sm py-2 px-3 rounded-xl">{success}</div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 text-white font-semibold py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-60 transition-all"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Updating...
                  </span>
                ) : (
                  'Update password'
                )}
              </button>
            </form>
          )}
        </section>

        <button
          type="button"
          onClick={handleSignOut}
          className="w-full py-3 text-stone-500 font-medium hover:text-stone-700 hover:bg-stone-100 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  );
};

export default Profile;
