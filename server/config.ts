import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 3000,
  scraplingUrl: process.env.SCRAPLING_SERVICE_URL || 'http://127.0.0.1:5001',
  scraplingPort: 5001,
  
  // Facebook Meta Graph API
  fbApiVersion: process.env.FB_API_VERSION || 'v22.0',
  fbPageId: process.env.FB_PAGE_ID || '',
  fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || '',
  
  // Facebook Publishing Safety Configuration
  fbPublishEnabled: process.env.FACEBOOK_PUBLISH_ENABLED !== 'false',
  fbMinPublishIntervalSeconds: Math.max(15, Number(process.env.FACEBOOK_MIN_PUBLISH_INTERVAL_SECONDS) || 30), // Safe inter-post delay floor (30s)
  fbInitialCooldownSeconds: Number(process.env.FACEBOOK_INITIAL_COOLDOWN_SECONDS) || 600, // 10 min for first 1390008
  fbMaxCooldownSeconds: Number(process.env.FACEBOOK_MAX_COOLDOWN_SECONDS) || 3600, // 60 min ceiling for 1390008
  fbLockLeaseSeconds: Number(process.env.FACEBOOK_LOCK_LEASE_SECONDS) || 45, // Lock expiry lease
  
  // Database & Cache
  databaseUrl: process.env.DATABASE_URL || 'postgresql://gamescores_8n73_user:yytt6F2BRAftBE5oEbJebNPIcyC7GAPF@dpg-danrl90ae00c739qtqag-a/gamescores_8n73',
  redisUrl: process.env.REDIS_URL || '',
  
  // Security & Admin Auth
  googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '',
  apiAdminKey: process.env.API_ADMIN_KEY || '',
  jwtSecret: process.env.JWT_SECRET || 'gamescores_admin_jwt_secret_token_key_2026',
  
  // Polling & Queue intervals
  scrapeIntervalSeconds: Math.max(15, Number(process.env.SCRAPE_INTERVAL_SECONDS) || 30),
  fbPublishMaxRetries: 3,
  fbRateLimitPerMinute: 10,
};
