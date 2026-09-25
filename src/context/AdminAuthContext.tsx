import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AdminUser, GoogleUser } from '../types';

export interface DatabaseConnectionInfo {
  isPostgres: boolean;
  dbType: string;
  databaseUrlMasked: string;
  isRenderHost: boolean;
}

interface AdminAuthContextType {
  adminUser: AdminUser | null;
  googleUser: GoogleUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isGoogleAuthenticated: boolean;
  isLoading: boolean;
  databaseInfo: DatabaseConnectionInfo | null;
  totalAdmins: number;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: (payload: { credential?: string; profile?: { email: string; name: string; picture?: string; sub?: string } }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  logoutGoogle: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  refreshStatus: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'gamescores_admin_token';
const GOOGLE_USER_STORAGE_KEY = 'gamescores_google_user';

export const AdminAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(() => {
    try {
      const stored = localStorage.getItem(GOOGLE_USER_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseConnectionInfo | null>(null);
  const [totalAdmins, setTotalAdmins] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);

  const refreshStatus = useCallback(async () => {
    try {
      const activeToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      const headers: Record<string, string> = {};
      if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
      }

      const res = await fetch('/api/admin/status', { headers });
      if (!res.ok) throw new Error('Status failed');
      const data = await res.json();

      if (data.success) {
        setDatabaseInfo(data.database || null);
        setTotalAdmins(data.totalAdmins || 0);

        if (data.isAuthenticated && data.user) {
          setAdminUser(data.user);
          setToken(activeToken);
        } else {
          // If unauthenticated and there's a default admin account, attempt auto-login
          if (!activeToken && data.totalAdmins === 1) {
            try {
              const autoRes = await fetch('/api/admin/auto-login', { method: 'POST' });
              const autoData = await autoRes.json();
              if (autoData.success && autoData.token) {
                localStorage.setItem(TOKEN_STORAGE_KEY, autoData.token);
                setToken(autoData.token);
                setAdminUser(autoData.user);
                return;
              }
            } catch (autoErr) {
              console.warn('[Auth] Auto-login error:', autoErr);
            }
          }

          setAdminUser(null);
          if (activeToken) {
            localStorage.removeItem(TOKEN_STORAGE_KEY);
            setToken(null);
          }
        }
      }
    } catch (e) {
      console.warn('[Auth] Failed to refresh admin status:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}): Promise<Response> => {
      const activeToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      const headers = new Headers(options.headers || {});
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
      const mergedOptions: RequestInit = {
        ...options,
        headers,
      };

      const response = await fetch(url, mergedOptions);

      // If unauthorized, prompt login modal
      if (response.status === 401) {
        const cloned = response.clone();
        try {
          const json = await cloned.json();
          if (json.requireLogin) {
            setShowLoginModal(true);
          }
        } catch {
          setShowLoginModal(true);
        }
      }

      return response;
    },
    []
  );

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Authentication failed' };
      }

      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      setToken(data.token);
      setAdminUser(data.user);
      setShowLoginModal(false);
      await refreshStatus();

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error during login' };
    }
  };

  const loginWithGoogle = async (payload: {
    credential?: string;
    profile?: { email: string; name: string; picture?: string; sub?: string };
  }): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Google authentication failed' };
      }

      const gUser: GoogleUser = {
        email: data.user.email,
        name: data.user.name,
        picture: data.user.picture,
        sub: data.user.sub,
        loginTime: new Date().toISOString(),
      };

      localStorage.setItem(GOOGLE_USER_STORAGE_KEY, JSON.stringify(gUser));
      setGoogleUser(gUser);

      if (data.token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
        setToken(data.token);
        setAdminUser({
          id: data.user.id || 'admin_google',
          username: data.user.email,
          role: data.user.role || 'superadmin',
          createdAt: new Date().toISOString(),
        });
      }

      setShowLoginModal(false);
      await refreshStatus();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error during Google login' };
    }
  };

  const logoutGoogle = async (): Promise<void> => {
    try {
      localStorage.removeItem(GOOGLE_USER_STORAGE_KEY);
      setGoogleUser(null);
      await logout();
    } catch {
      localStorage.removeItem(GOOGLE_USER_STORAGE_KEY);
      setGoogleUser(null);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setToken(null);
      setAdminUser(null);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      const activeToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (activeToken) {
        await fetch('/api/admin/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeToken}`,
          },
          body: JSON.stringify({ token: activeToken }),
        });
      }
    } catch (e) {
      console.warn('[Auth] Error logging out:', e);
    } finally {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(GOOGLE_USER_STORAGE_KEY);
      setToken(null);
      setAdminUser(null);
      setGoogleUser(null);
      await refreshStatus();
    }
  };

  const changePassword = async (
    oldPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await authFetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || 'Failed to update password' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  };

  return (
    <AdminAuthContext.Provider
      value={{
        adminUser,
        googleUser,
        token,
        isAuthenticated: Boolean(adminUser && token),
        isGoogleAuthenticated: Boolean(googleUser),
        isLoading,
        databaseInfo,
        totalAdmins,
        login,
        loginWithGoogle,
        logout,
        logoutGoogle,
        changePassword,
        authFetch,
        showLoginModal,
        setShowLoginModal,
        refreshStatus,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
};

export const useAdminAuth = (): AdminAuthContextType => {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return context;
};
