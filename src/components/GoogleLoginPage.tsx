import React, { useState, useEffect } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';
import {
  Trophy,
  Radio,
  Share2,
  ShieldCheck,
  Lock,
  User,
  Key,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Zap,
  Globe,
  ArrowRight,
  Eye,
  EyeOff,
  Activity,
  Layers,
} from 'lucide-react';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (parent: HTMLElement, options: any) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export const GoogleLoginPage: React.FC = () => {
  const { loginWithGoogle, login } = useAdminAuth();

  // Mode: 'google' | 'admin'
  const [authMode, setAuthMode] = useState<'google' | 'admin'>('google');

  // Google sign in states
  const [googleEmail, setGoogleEmail] = useState<string>('johnetthoward1@gmail.com');
  const [googleName, setGoogleName] = useState<string>('Johnett Howard');
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState<boolean>(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [gisAvailable, setGisAvailable] = useState<boolean>(false);

  // Admin login states
  const [adminUsername, setAdminUsername] = useState<string>('admin');
  const [adminPassword, setAdminPassword] = useState<string>('admin12345');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isAdminSigningIn, setIsAdminSigningIn] = useState<boolean>(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  // Check Google Identity Services (GIS) library
  useEffect(() => {
    let checkCount = 0;
    const checkGis = () => {
      if (window.google?.accounts?.id) {
        setGisAvailable(true);
        // Fetch client ID if available
        fetch('/api/auth/google/config')
          .then((r) => r.json())
          .then((data) => {
            if (data?.success && data?.clientId) {
              try {
                window.google?.accounts?.id.initialize({
                  client_id: data.clientId,
                  callback: handleGoogleCredentialResponse,
                });
                const btnContainer = document.getElementById('google-official-btn');
                if (btnContainer) {
                  window.google?.accounts?.id.renderButton(btnContainer, {
                    theme: 'filled_black',
                    size: 'large',
                    text: 'continue_with',
                    shape: 'rectangular',
                    width: 320,
                  });
                }
              } catch (initErr) {
                console.warn('[GoogleLoginPage] GIS init error:', initErr);
              }
            }
          })
          .catch(() => {});
      } else if (checkCount < 10) {
        checkCount++;
        setTimeout(checkGis, 500);
      }
    };
    checkGis();
  }, []);

  const handleGoogleCredentialResponse = async (response: any) => {
    if (!response?.credential) return;
    setIsGoogleSigningIn(true);
    setGoogleError(null);
    try {
      const res = await loginWithGoogle({ credential: response.credential });
      if (!res.success) {
        setGoogleError(res.error || 'Google authentication failed');
      }
    } catch (e: any) {
      setGoogleError(e.message || 'Google sign-in encountered an error');
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleContinueWithGoogle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!googleEmail.trim()) {
      setGoogleError('Please enter your Google account email.');
      return;
    }

    setIsGoogleSigningIn(true);
    setGoogleError(null);
    try {
      const res = await loginWithGoogle({
        profile: {
          email: googleEmail.trim().toLowerCase(),
          name: googleName.trim() || googleEmail.split('@')[0],
          picture: `https://www.gravatar.com/avatar/${encodeURIComponent(googleEmail)}?d=mp`,
          sub: 'google_user_' + googleEmail.replace(/[^a-zA-Z0-9]/g, '_'),
        },
      });

      if (!res.success) {
        setGoogleError(res.error || 'Google authentication failed. Please try again.');
      }
    } catch (err: any) {
      setGoogleError(err.message || 'Network error during Google authentication.');
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUsername.trim() || !adminPassword) {
      setAdminError('Username and password are required.');
      return;
    }

    setIsAdminSigningIn(true);
    setAdminError(null);
    try {
      const res = await login(adminUsername.trim(), adminPassword);
      if (!res.success) {
        setAdminError(res.error || 'Invalid administrator credentials.');
      }
    } catch (err: any) {
      setAdminError(err.message || 'Network error during login.');
    } finally {
      setIsAdminSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-slate-950 relative overflow-hidden">
      {/* Background ambient lighting effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-emerald-500/10 via-indigo-500/5 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="absolute -bottom-24 left-1/4 w-[500px] h-[300px] bg-teal-500/10 blur-3xl pointer-events-none -z-10" />

      {/* Top Header / Branding Nav */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-emerald-500/20 shadow-md">
              <Zap className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-black tracking-tight text-white">ScoreFlow</span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Flashscore Live
                </span>
              </div>
              <p className="text-xs text-slate-400">Live Football Scores & Facebook Publishing Hub</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Real-Time Engine Active</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Login Screen Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-6">
          {/* Card Container */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl space-y-6">
            {/* Title & Badges */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-semibold mb-1">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Operator Authentication Required</span>
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">
                Sign in to ScoreFlow
              </h2>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Authenticate with your Google account to access live match feeds, daily league controls, and automated Facebook publishing.
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950/80 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('google');
                  setGoogleError(null);
                }}
                className={`py-2 rounded-lg flex items-center justify-center space-x-2 transition-all ${
                  authMode === 'google'
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {/* Google Multicolor "G" Logo */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Google Sign-In</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthMode('admin');
                  setAdminError(null);
                }}
                className={`py-2 rounded-lg flex items-center justify-center space-x-2 transition-all ${
                  authMode === 'admin'
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Admin Login</span>
              </button>
            </div>

            {/* Google Authentication View */}
            {authMode === 'google' && (
              <div className="space-y-4">
                {/* Official GIS Button container if loaded */}
                <div id="google-official-btn" className="flex justify-center" />

                {/* Primary Google Sign-In Action */}
                <form onSubmit={handleContinueWithGoogle} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Google Account Email
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        required
                        value={googleEmail}
                        onChange={(e) => setGoogleEmail(e.target.value)}
                        placeholder="yourname@gmail.com"
                        className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Display Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={googleName}
                      onChange={(e) => setGoogleName(e.target.value)}
                      placeholder="Your Name"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                    />
                  </div>

                  {googleError && (
                    <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{googleError}</span>
                    </div>
                  )}

                  {/* Main Sign in with Google Button */}
                  <button
                    type="submit"
                    disabled={isGoogleSigningIn}
                    className="w-full py-3 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs flex items-center justify-center space-x-3 transition-all shadow-lg shadow-white/5 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                  >
                    {isGoogleSigningIn ? (
                      <span className="flex items-center space-x-2">
                        <span className="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
                        <span>Signing in with Google...</span>
                      </span>
                    ) : (
                      <>
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                          />
                        </svg>
                        <span>Continue with Google</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                      </>
                    )}
                  </button>
                </form>

                {/* Pre-fill helper chip for fast access */}
                <div className="pt-2 border-t border-slate-800 text-center">
                  <p className="text-[11px] text-slate-400">
                    Signing in grants superadmin operations access to live sports sync and publishing.
                  </p>
                </div>
              </div>
            )}

            {/* Admin Username/Password Login View */}
            {authMode === 'admin' && (
              <form onSubmit={handleAdminLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="admin"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Key className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-10 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-3 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {adminError && (
                  <div className="p-3 bg-rose-950/60 border border-rose-500/40 rounded-xl text-xs text-rose-300 flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{adminError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isAdminSigningIn}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-lg shadow-emerald-950/40 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
                >
                  {isAdminSigningIn ? (
                    <span className="flex items-center space-x-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Verifying credentials...</span>
                    </span>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>Sign In with Password</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Feature Highlights Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800 flex items-start space-x-2.5">
              <Activity className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-semibold text-[11px]">Real-Time Sync</strong>
                <span className="text-[10px] text-slate-400">Live score updates streamed via WebSockets</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800 flex items-start space-x-2.5">
              <Trophy className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-semibold text-[11px]">Daily League Dock</strong>
                <span className="text-[10px] text-slate-400">Blackout unselected leagues automatically</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800 flex items-start space-x-2.5">
              <Share2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-semibold text-[11px]">Meta Facebook API</strong>
                <span className="text-[10px] text-slate-400">Automated grouped scoreboard roundups</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800 flex items-start space-x-2.5">
              <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-semibold text-[11px]">Secure Sessions</strong>
                <span className="text-[10px] text-slate-400">Persistent authentication tokens</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 px-6 py-4 text-center text-xs text-slate-500">
        <p>ScoreFlow Operations Portal &copy; 2026 &bull; Protected by Google Authentication</p>
      </footer>
    </div>
  );
};
