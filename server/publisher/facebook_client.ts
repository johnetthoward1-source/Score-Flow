import { config } from '../config.js';

export interface MetaPageDetails {
  id: string;
  name: string;
  category?: string;
  link?: string;
  verificationStatus?: string;
}

export interface PublishResult {
  success: boolean;
  postId?: string;
  error?: string;
  errorCode?: number;
  errorSubcode?: number;
  rateLimited?: boolean;
  isSpamBlocked?: boolean;
  cooldownSeconds?: number;
}

export class FacebookGraphClient {
  private apiVersion: string;

  constructor(apiVersion = config.fbApiVersion) {
    this.apiVersion = apiVersion;
  }

  get baseUrl(): string {
    return `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Verify Facebook Page Access Token and retrieve page details from Meta Graph API
   */
  async verifyPageCredentials(pageId: string, accessToken: string): Promise<{
    valid: boolean;
    page?: MetaPageDetails;
    permissions?: string[];
    tokenType?: 'PAGE' | 'USER' | 'UNKNOWN';
    pageAccessToken?: string;
    error?: string;
    warning?: string;
  }> {
    if (!pageId || !accessToken) {
      return { valid: false, error: 'Page ID and Access Token are required.' };
    }

    const cleanPageId = pageId.trim();
    const cleanToken = accessToken.trim();

    try {
      let tokenType: 'PAGE' | 'USER' | 'UNKNOWN' = 'UNKNOWN';
      let resolvedPageToken: string = cleanToken;
      let targetPage: MetaPageDetails | undefined = undefined;

      // 1. Inspect token identity via /me
      try {
        const meRes = await fetch(`${this.baseUrl}/me?fields=id,name&access_token=${encodeURIComponent(cleanToken)}`);
        const meData = await meRes.json();
        if (meData?.id) {
          if (meData.id === cleanPageId) {
            tokenType = 'PAGE';
            targetPage = {
              id: meData.id,
              name: meData.name,
            };
          } else {
            tokenType = 'USER';
          }
        }
      } catch {
        // Fall back to direct page query
      }

      // 2. If it is a User Token (or /me wasn't the page), check /me/accounts for Page Access Token
      if (tokenType === 'USER') {
        try {
          const accountsRes = await fetch(`${this.baseUrl}/me/accounts?fields=id,name,category,link,access_token&access_token=${encodeURIComponent(cleanToken)}`);
          const accountsData = await accountsRes.json();
          if (accountsData?.data && Array.isArray(accountsData.data)) {
            const pageMatch = accountsData.data.find((p: any) => p.id === cleanPageId);
            if (pageMatch) {
              if (pageMatch.access_token) {
                resolvedPageToken = pageMatch.access_token;
              }
              targetPage = {
                id: pageMatch.id,
                name: pageMatch.name,
                category: pageMatch.category,
                link: pageMatch.link,
              };
            }
          }
        } catch {
          // Continue to direct query
        }
      }

      // 3. Query the Page node directly using the resolved token
      // CRITICAL FIX: DO NOT request 'access_token' in fields. 'access_token' is not a field on Page node in Graph API and throws (#100).
      const pageUrl = `${this.baseUrl}/${encodeURIComponent(cleanPageId)}?fields=id,name,category,link,verification_status&access_token=${encodeURIComponent(resolvedPageToken)}`;
      const pageRes = await fetch(pageUrl);
      const pageData = await pageRes.json();

      if (!pageRes.ok || pageData.error) {
        const errMsg = pageData.error?.message || `Meta API error (${pageRes.status})`;
        const errCode = pageData.error?.code || pageRes.status;
        const errSubcode = pageData.error?.error_subcode;

        let friendlyMsg = `${errMsg} [Code ${errCode}]`;
        if (errCode === 190) {
          friendlyMsg = 'The Page Access Token is invalid or expired. Please generate a fresh Page Access Token from Meta for Developers / Graph API Explorer.';
        } else if (errCode === 100) {
          friendlyMsg = `Meta Page ID "${cleanPageId}" not found or inaccessible. Ensure the Page ID is correct and the token has access to this Page.`;
        } else if (errCode === 200) {
          friendlyMsg = "Permissions error: The token lacks permission to manage or view this Facebook Page (requires 'pages_read_engagement' / 'pages_manage_posts').";
        } else if (errCode === 368 || errSubcode === 1390008) {
          friendlyMsg = 'Meta anti-spam limit active on this Page (error 1390008). Meta has temporarily placed this Page on a cooldown.';
        }

        return {
          valid: false,
          error: friendlyMsg,
          tokenType,
        };
      }

      targetPage = {
        id: pageData.id || cleanPageId,
        name: pageData.name || targetPage?.name || cleanPageId,
        category: pageData.category || targetPage?.category,
        link: pageData.link || targetPage?.link,
        verificationStatus: pageData.verification_status,
      };

      // 4. Check token permissions
      let grantedPermissions: string[] = [];
      try {
        const permUrl = `${this.baseUrl}/me/permissions?access_token=${encodeURIComponent(resolvedPageToken)}`;
        const permRes = await fetch(permUrl);
        const permData = await permRes.json();
        if (permData?.data && Array.isArray(permData.data)) {
          grantedPermissions = permData.data
            .filter((p: any) => p.status === 'granted')
            .map((p: any) => p.permission);
        }
      } catch {
        // Permissions check might fail on some page tokens; page query already succeeded
      }

      let warning: string | undefined = undefined;
      if (tokenType === 'USER' && resolvedPageToken === cleanToken) {
        warning = 'Notice: You are using a User Access Token instead of a dedicated Page Access Token. We recommend using a Page Access Token with pages_manage_posts for reliable background publishing.';
      } else if (grantedPermissions.length > 0 && !grantedPermissions.includes('pages_manage_posts')) {
        warning = "Warning: Token may be missing 'pages_manage_posts' permission required for publishing to Page feed.";
      }

      return {
        valid: true,
        page: targetPage,
        permissions: grantedPermissions,
        tokenType,
        pageAccessToken: resolvedPageToken,
        warning,
      };
    } catch (err) {
      return {
        valid: false,
        error: `Network failure connecting to Meta Graph API: ${(err as Error).message}`,
      };
    }
  }

  async verifyPageAccess(pageId: string, accessToken: string) {
    const res = await this.verifyPageCredentials(pageId, accessToken);
    return {
      isValid: res.valid,
      page: res.page,
      permissions: res.permissions,
      tokenType: res.tokenType,
      pageAccessToken: res.pageAccessToken,
      error: res.error,
      warning: res.warning,
    };
  }

  /**
   * Publish a post to the connected Facebook Page using official POST /{page-id}/feed endpoint
   */
  async publishPost(pageId: string, accessToken: string, message: string, link?: string): Promise<PublishResult> {
    if (!pageId || !accessToken) {
      return {
        success: false,
        error: 'Missing Page ID or Page Access Token.',
      };
    }

    try {
      const endpoint = `${this.baseUrl}/${encodeURIComponent(pageId)}/feed`;
      const body = new URLSearchParams();
      body.append('message', message);
      body.append('published', 'true');
      body.append('access_token', accessToken);
      if (link) {
        body.append('link', link);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${accessToken.trim()}`,
        },
        body: body.toString(),
      });

      // Parse usage headers
      const pageUsage = response.headers.get('x-page-usage');
      const appUsage = response.headers.get('x-app-usage');
      if (pageUsage || appUsage) {
        console.log(`[FB Graph API Usage] Page: ${pageUsage || 'N/A'}, App: ${appUsage || 'N/A'}`);
      }

      const data = await response.json();

      if (!response.ok || data.error) {
        const err = data.error || {};
        const code = err.code;
        const subcode = err.error_subcode || err.error_data?.error_subcode;
        const msg = String(err.message || '');

        // Detect Meta spam velocity limits and action blocking
        const isSpamBlocked =
          subcode === 1390008 ||
          code === 368 ||
          msg.includes('limit how often') ||
          msg.includes('protect the community from spam') ||
          msg.includes('temporarily blocked');

        // Detect API quota and request rate limits
        const isRateLimit =
          isSpamBlocked ||
          code === 4 ||
          code === 17 ||
          code === 32 ||
          code === 613 ||
          msg.toLowerCase().includes('rate limit') ||
          msg.toLowerCase().includes('calls to this api have exceeded');

        let cooldownSeconds = 0;
        if (isSpamBlocked) {
          // Meta anti-spam velocity limiter (1390008) requires 10+ minutes of complete rest to clear safely
          cooldownSeconds = 600;
        } else if (isRateLimit) {
          cooldownSeconds = 120;
        }

        let userFriendlyError = msg || `Meta Graph API error ${response.status}`;
        if (isSpamBlocked) {
          userFriendlyError = `Meta Anti-Spam Velocity Block (Error 1390008): Facebook temporarily blocked publishing to protect against spam velocity. The queue is safely paused for ${Math.round(cooldownSeconds / 60)} minutes to protect Page reputation.`;
        } else if (code === 190) {
          userFriendlyError = `Meta Token Expired (Code 190): Your Page Access Token has expired or was revoked. Please generate and save a fresh token in Facebook Publisher settings.`;
        } else if (code === 200) {
          userFriendlyError = `Meta Permission Error (Code 200): Token does not have permission to publish posts as this Page (missing 'pages_manage_posts').`;
        }

        console.log(`[FB Graph API Throttled] Code ${code || response.status}, Subcode ${subcode || 'none'} (${isSpamBlocked ? 'Spam Velocity Cooldown' : isRateLimit ? 'Rate Limited' : 'API Error'}): ${msg}`);

        return {
          success: false,
          error: userFriendlyError,
          errorCode: code,
          errorSubcode: subcode,
          rateLimited: isRateLimit,
          isSpamBlocked,
          cooldownSeconds,
        };
      }

      return {
        success: true,
        postId: data.id,
      };
    } catch (err) {
      console.warn('[FB Graph Client] Network error publishing post:', (err as Error).message);
      return {
        success: false,
        error: `Network error connecting to Meta Graph API: ${(err as Error).message}`,
      };
    }
  }
}

export const fbClient = new FacebookGraphClient();
