import React from 'react';
import {
  Activity,
  Radio,
  Share2,
  RefreshCw,
  Database,
  Terminal,
  Server,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Trophy,
  ShieldCheck,
  Lock,
  User,
  Square,
  Play,
  LogOut,
} from 'lucide-react';
import { SystemStatus } from '../types';
import { useAdminAuth } from '../context/AdminAuthContext';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  systemStatus: SystemStatus | null;
  wsConnected: boolean;
  onManualSync: () => void;
  isSyncing: boolean;
  liveMatchCount: number;
  onOpenAdminModal: () => void;
  onToggleScraper?: () => void;
  isScraperToggling?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  systemStatus,
  wsConnected,
  onManualSync,
  isSyncing,
  liveMatchCount,
  onOpenAdminModal,
  onToggleScraper,
  isScraperToggling = false,
}) => {
  const { adminUser, googleUser, isAuthenticated, isGoogleAuthenticated, databaseInfo, logoutGoogle } = useAdminAuth();
  const isScraperRunning = systemStatus?.syncEngine?.isRunning ?? true;
  const scraplingOnline = systemStatus?.scraplingService?.status === 'ONLINE';
  const fbConfigured = Boolean(systemStatus?.facebookPublisher?.config?.pageId);
  const selectedLeaguesCount = systemStatus?.dailyLeagueSelection?.selectedCount ?? 0;
  const isDailyLeaguesConfigured = Boolean(systemStatus?.dailyLeagueSelection?.isConfigured && selectedLeaguesCount > 0);

  const navTabs = [
    { id: 'live', label: 'Live Matches', count: liveMatchCount, icon: Radio },
    { id: 'today', label: "Today's Schedule", icon: Activity },
    { id: 'fixtures', label: 'Fixtures & Results', icon: CalendarIcon },
    {
      id: 'leagues',
      label: 'League Selection',
      icon: Trophy,
      badge: isDailyLeaguesConfigured ? `${selectedLeaguesCount} Today` : 'Blackout',
    },
    { id: 'facebook', label: 'Facebook Publisher', icon: Share2, badge: fbConfigured ? 'Configured' : 'Setup' },
    { id: 'api', label: 'API & WebSockets', icon: Terminal },
    { id: 'monitoring', label: 'System Health', icon: Server },
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30 shadow-lg text-slate-100">
      {/* Top Banner Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Title */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-emerald-500/20 shadow-md">
              <Zap className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-bold tracking-tight text-white">ScoreFlow</h1>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Flashscore Scrapling
                </span>
              </div>
              <p className="text-xs text-slate-400">Live Sports Scores API & Facebook Live Publisher</p>
            </div>
          </div>

          {/* Service Status Badges */}
          <div className="hidden md:flex items-center space-x-3 text-xs">
            {/* WebSocket Status */}
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border ${
                wsConnected
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40'
                  : 'bg-amber-950/40 text-amber-300 border-amber-800/40'
              }`}
              title={wsConnected ? 'WebSocket connected: receiving real-time live events' : 'WebSocket disconnected'}
            >
              <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="font-medium">WS {wsConnected ? 'Live' : 'Connecting'}</span>
            </div>

            {/* Python Scrapling Status */}
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border ${
                !isScraperRunning
                  ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                  : scraplingOnline
                  ? 'bg-blue-950/40 text-blue-300 border-blue-800/40'
                  : 'bg-amber-950/40 text-amber-300 border-amber-800/40'
              }`}
              title={
                !isScraperRunning
                  ? 'Scrapling is STOPPED / PAUSED. Click "Resume Scrapling" to start.'
                  : `Python Scrapling v${systemStatus?.scraplingService?.scrapling_version || '0.4.15'}`
              }
            >
              <Activity className="w-3.5 h-3.5" />
              <span>
                Scrapling:{' '}
                {!isScraperRunning
                  ? 'Stopped'
                  : scraplingOnline
                  ? `${systemStatus?.scraplingService?.latency_ms ?? 25}ms`
                  : 'TS Fallback'}
              </span>
            </div>

            {/* Daily Leagues Today Badge */}
            <button
              id="header-daily-leagues-status-btn"
              onClick={() => setActiveTab('leagues')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                isDailyLeaguesConfigured
                  ? 'bg-amber-950/40 text-amber-300 border-amber-800/40 hover:bg-amber-900/40'
                  : 'bg-rose-950/40 text-rose-300 border-rose-800/40 hover:bg-rose-900/40 animate-pulse'
              }`}
              title="Daily League Selection: Controls which games are posted and shown for today"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {isDailyLeaguesConfigured
                  ? `${selectedLeaguesCount} Leagues Today`
                  : 'No Leagues Selected'}
              </span>
            </button>

            {/* Facebook Status */}
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full border ${
                fbConfigured
                  ? 'bg-indigo-950/40 text-indigo-300 border-indigo-800/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>FB: {fbConfigured ? 'Connected' : 'Not Connected'}</span>
            </div>

            {/* Database Engine Status */}
            <button
              id="header-db-status-btn"
              onClick={onOpenAdminModal}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full border bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700 transition-all cursor-pointer"
              title={`PostgreSQL: ${databaseInfo?.databaseUrlMasked || 'gamescores_8n73'}`}
            >
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium">PostgreSQL</span>
            </button>

            {/* Google / Admin Identity & Sign Out */}
            {isGoogleAuthenticated && googleUser ? (
              <div className="flex items-center space-x-2">
                <div
                  onClick={onOpenAdminModal}
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-xl border bg-emerald-950/40 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/50 transition-all cursor-pointer font-medium"
                  title={`Google Account: ${googleUser.email}`}
                >
                  <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center p-0.5 shrink-0 shadow-sm">
                    {googleUser.picture ? (
                      <img src={googleUser.picture} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                    )}
                  </div>
                  <span className="truncate max-w-[130px] font-semibold text-xs">
                    {googleUser.name || googleUser.email.split('@')[0]}
                  </span>
                </div>

                <button
                  id="header-sign-out-btn"
                  onClick={logoutGoogle}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-xs font-semibold cursor-pointer"
                  title="Sign Out from Google"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : isAuthenticated ? (
              <div className="flex items-center space-x-2">
                <button
                  id="header-admin-auth-btn"
                  onClick={onOpenAdminModal}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border bg-emerald-950/40 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/50 transition-all cursor-pointer font-medium"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Admin: {adminUser?.username}</span>
                </button>
                <button
                  id="header-sign-out-btn"
                  onClick={logoutGoogle}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-xs font-semibold cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <button
                id="header-admin-auth-btn"
                onClick={onOpenAdminModal}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20 transition-all cursor-pointer font-medium"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Sign In</span>
              </button>
            )}

            {/* Manual Sync Trigger */}
            <button
              id="manual-sync-button"
              onClick={onManualSync}
              disabled={isSyncing}
              className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:bg-slate-800 disabled:text-slate-500 text-slate-200 font-medium px-3 py-1.5 rounded-lg transition-all shadow-sm active:scale-95 text-xs cursor-pointer"
              title="Trigger an immediate one-off score sync"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
              <span>{isSyncing ? 'Syncing...' : 'Sync Live'}</span>
            </button>

            {/* Scraper Control (Stop / Resume Scrapling) */}
            <button
              id={isScraperRunning ? "stop-scrapling-button" : "resume-scrapling-button"}
              onClick={onToggleScraper}
              disabled={isScraperToggling}
              className={`flex items-center space-x-1.5 font-semibold px-3 py-1.5 rounded-lg transition-all shadow-sm active:scale-95 text-xs cursor-pointer border ${
                isScraperRunning
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 hover:bg-rose-500/25 active:bg-rose-500/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-emerald-900/30 shadow-md animate-pulse'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={
                isScraperRunning
                  ? 'Click to stop live Flashscore background score scraping'
                  : 'Click to start/resume live Flashscore background score scraping'
              }
            >
              {isScraperToggling ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : isScraperRunning ? (
                <Square className="w-3.5 h-3.5 fill-current text-rose-400" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current text-white" />
              )}
              <span>
                {isScraperToggling
                  ? 'Updating...'
                  : isScraperRunning
                  ? 'Stop Scrapling'
                  : 'Resume Scrapling'}
              </span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-1 overflow-x-auto py-2 border-t border-slate-800/60 no-scrollbar">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`nav-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    className={`ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      isActive ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-emerald-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {tab.badge && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};

function CalendarIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}
