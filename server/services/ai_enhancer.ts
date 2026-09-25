import { GoogleGenAI } from '@google/genai';
import { FacebookPageConfig } from '../types.js';

let genAIClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  if (!genAIClient) {
    try {
      genAIClient = new GoogleGenAI({ apiKey });
    } catch {
      return null;
    }
  }
  return genAIClient;
}

export interface AiVariationRequest {
  type: 'LIVE' | 'FT' | 'HT' | 'GOAL' | 'CARD';
  headline?: string;
  summaryText: string;
  matchCount?: number;
  keyMatches?: Array<{ home: string; away: string; score: string; league?: string }>;
  pageName?: string;
  config?: FacebookPageConfig;
}

export interface AiVariationResponse {
  headline: string;
  callToAction: string;
  hashtags: string[];
  providerUsed: 'deepseek' | 'gemini';
}

/**
 * Checks if DeepSeek is configured (either in DB settings or env)
 */
export function isDeepSeekAvailable(config?: FacebookPageConfig): boolean {
  return !!(
    (config?.deepseekApiKey && config.deepseekApiKey.trim() !== '') ||
    process.env.DEEPSEEK_API_KEY
  );
}

/**
 * Checks if any AI generator (DeepSeek or Gemini) is active and available.
 */
export function isAiGeneratorAvailable(config?: FacebookPageConfig): boolean {
  return isDeepSeekAvailable(config) || !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

/**
 * Calls DeepSeek API (using OpenAI-compatible chat completions endpoint).
 */
async function callDeepSeekChat(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ headline: string; callToAction: string; hashtags: string[] } | null> {
  const endpoint = 'https://api.deepseek.com/chat/completions';

  const systemPrompt = `You are a high-engagement sports social media copywriter for an official football / soccer score channel.
Follow these rules strictly:
1. Output ONLY a valid JSON object matching: {"headline": string, "callToAction": string, "hashtags": string[]}
2. Do NOT wrap with markdown quotes or backticks if possible, just raw JSON.
3. Keep the headline punchy, vivid, with 1-2 relevant sports emojis, under 85 characters.
4. Keep the callToAction natural, conversational, under 110 characters.
5. Provide 3 to 4 varied hashtags relevant to football, the matches, or live results. Avoid repeating identical hashtag blocks across posts.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.85,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[AI Enhancer - DeepSeek] API Error (${res.status}): ${errText}`);
      return null;
    }

    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content);
    if (parsed.headline && Array.isArray(parsed.hashtags)) {
      return {
        headline: String(parsed.headline).trim(),
        callToAction: String(parsed.callToAction || '').trim(),
        hashtags: parsed.hashtags.map((h: string) => (h.startsWith('#') ? h : `#${h.replace(/[^a-zA-Z0-9]/g, '')}`)),
      };
    }
    return null;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn('[AI Enhancer - DeepSeek] Request error:', err?.message || err);
    return null;
  }
}

/**
 * Generate post headline, intro, and hashtags using either DeepSeek or Gemini.
 */
export async function generatePostVariationWithAi(
  req: AiVariationRequest
): Promise<AiVariationResponse | null> {
  const preferredProvider = req.config?.aiProvider || 'deepseek';
  const deepseekKey = req.config?.deepseekApiKey?.trim() || process.env.DEEPSEEK_API_KEY;
  const deepseekModel = req.config?.deepseekModel?.trim() || 'deepseek-chat';

  const prompt = `Page Name: ${req.pageName || 'GameScores'}
Event Type: ${req.type}
Total Matches: ${req.matchCount || 1}
Current Score/Match Summary:
${req.summaryText.slice(0, 400)}

Generate an authentic, engaging football post headline, a closing call-to-action / question, and 3-4 hashtags.`;

  // 1. Try DeepSeek first if configured or preferred
  if (preferredProvider === 'deepseek' && deepseekKey) {
    try {
      const result = await callDeepSeekChat(deepseekKey, deepseekModel, prompt);
      if (result) {
        return {
          ...result,
          providerUsed: 'deepseek',
        };
      }
    } catch (e: any) {
      console.warn('[AI Enhancer] DeepSeek generation failed:', e?.message || e);
    }
  }

  // 2. Try Gemini as alternative if available
  const gemini = getGeminiClient();
  if (gemini) {
    try {
      const geminiPrompt = `You are a professional football social media editor for "${req.pageName || 'GameScores'}".
Event Type: ${req.type}
Total Matches: ${req.matchCount || 1}
Context: ${req.summaryText.slice(0, 400)}

Generate a fresh, unique headline and a closing call-to-action for this Facebook post.
CRITICAL ANTI-SPAM RULES:
1. Do NOT use cliché or repetitive spam phrases like "Stay tuned".
2. Vary the tone (urgent, celebratory, analytical, exciting).
3. Provide 3-4 natural hashtags including the sport and event context.
4. Output strictly JSON:
{
  "headline": "A punchy, emoji-enhanced headline under 80 characters",
  "callToAction": "A natural 1-sentence closing question or page sign-off under 100 characters",
  "hashtags": ["#Tag1", "#Tag2", "#Tag3"]
}`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: geminiPrompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text?.trim();
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.headline && Array.isArray(parsed.hashtags)) {
          return {
            headline: String(parsed.headline).trim(),
            callToAction: String(parsed.callToAction || '').trim(),
            hashtags: parsed.hashtags.map((h: string) => (h.startsWith('#') ? h : `#${h}`)),
            providerUsed: 'gemini',
          };
        }
      }
    } catch (err: any) {
      console.warn('[AI Enhancer] Gemini variation skipped:', err?.message || err);
    }
  }

  // 3. If preferred was Gemini, but Gemini failed and DeepSeek is configured, try DeepSeek
  if (preferredProvider === 'gemini' && deepseekKey) {
    try {
      const result = await callDeepSeekChat(deepseekKey, deepseekModel, prompt);
      if (result) {
        return {
          ...result,
          providerUsed: 'deepseek',
        };
      }
    } catch (e: any) {
      console.warn('[AI Enhancer] Fallback to DeepSeek failed:', e?.message || e);
    }
  }

  return null;
}
