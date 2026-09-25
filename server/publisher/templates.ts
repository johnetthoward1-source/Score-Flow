import { Match, MatchEvent, FacebookPageConfig } from '../types.js';
import { generatePostVariationWithAi, isAiGeneratorAvailable } from '../services/ai_enhancer.js';

/**
 * Converts standard ASCII digits (0-9) to Unicode Mathematical Bold digits (𝟎-𝟗)
 */
export function toBoldDigits(val: string | number): string {
  return String(val).replace(/[0-9]/g, (digit) => {
    return String.fromCodePoint(0x1d7ce + Number(digit));
  });
}

export const COUNTRY_FLAG_MAP: Record<string, string> = {
  uzbekistan: '🇺🇿',
  paraguay: '🇵🇾',
  botswana: '🇧🇼',
  malawi: '🇲🇼',
  england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  spain: '🇪🇸',
  germany: '🇩🇪',
  italy: '🇮🇹',
  france: '🇫🇷',
  brazil: '🇧🇷',
  argentina: '🇦🇷',
  portugal: '🇵🇹',
  netherlands: '🇳🇱',
  belgium: '🇧🇪',
  turkey: '🇹🇷',
  scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  mexico: '🇲🇽',
  usa: '🇺🇸',
  'united states': '🇺🇸',
  colombia: '🇨🇴',
  chile: '🇨🇱',
  uruguay: '🇺🇾',
  ecuador: '🇪🇨',
  peru: '🇵🇪',
  venezuela: '🇻🇪',
  bolivia: '🇧🇴',
  japan: '🇯🇵',
  'south korea': '🇰🇷',
  'saudi arabia': '🇸🇦',
  saudi: '🇸🇦',
  morocco: '🇲🇦',
  egypt: '🇪🇬',
  nigeria: '🇳🇬',
  ghana: '🇬🇭',
  algeria: '🇩🇿',
  tunisia: '🇹🇳',
  cameroon: '🇨🇲',
  senegal: '🇸🇳',
  'ivory coast': '🇨🇮',
  croatia: '🇭🇷',
  serbia: '🇷🇸',
  poland: '🇵🇱',
  ukraine: '🇺🇦',
  russia: '🇷🇺',
  sweden: '🇸🇪',
  norway: '🇳🇴',
  denmark: '🇩🇰',
  switzerland: '🇨🇭',
  austria: '🇦🇹',
  greece: '🇬🇷',
  czech: '🇨🇿',
  'czech republic': '🇨🇿',
  romania: '🇷🇴',
  hungary: '🇭🇺',
  ireland: '🇮🇪',
  australia: '🇦🇺',
  india: '🇮🇳',
  china: '🇨🇳',
  bhutan: '🇧🇹',
  'south africa': '🇿🇦',
  angola: '🇦🇴',
  zambia: '🇿🇲',
  zimbabwe: '🇿🇼',
  kenya: '🇰🇪',
  tanzania: '🇹🇿',
  uganda: '🇺🇬',
  rwanda: '🇷🇼',
  mozambique: '🇲🇿',
  namibia: '🇳🇦',
  indonesia: '🇮🇩',
  thailand: '🇹🇭',
  vietnam: '🇻🇳',
  malaysia: '🇲🇾',
  singapore: '🇸🇬',
  qatar: '🇶🇦',
  uae: '🇦🇪',
  iran: '🇮🇷',
  iraq: '🇮🇶',
  israel: '🇮🇱',
  jordan: '🇯🇴',
  lebanon: '🇱🇧',
  kuwait: '🇰🇼',
  kazakhstan: '🇰🇿',
  georgia: '🇬🇪',
  armenia: '🇦🇲',
  azerbaijan: '🇦🇿',
  costa_rica: '🇨🇷',
  panama: '🇵🇦',
  canada: '🇨🇦',
  new_zealand: '🇳🇿',
  finland: '🇫🇮',
  iceland: '🇮🇸',
  slovakia: '🇸🇰',
  slovenia: '🇸🇮',
  bulgaria: '🇧🇬',
  bosnia: '🇧🇦',
  albania: '🇦🇱',
  estonia: '🇪🇪',
  latvia: '🇱🇻',
  lithuania: '🇱🇹',
  belarus: '🇧🇾',
  cyprus: '🇨🇾',
  malta: '🇲🇹',
  luxembourg: '🇱🇺',
  africa: '🌍',
  europe: '🇪🇺',
  asia: '🌏',
  'south america': '🌎',
  'north america': '🌎',
  world: '🌍',
  international: '🌍',
  cosafa: '🌍',
};

export function getCountryFlag(country?: string, leagueName?: string): string {
  const combined = `${country || ''} ${leagueName || ''}`.toLowerCase();
  for (const [key, flag] of Object.entries(COUNTRY_FLAG_MAP)) {
    if (combined.includes(key)) return flag;
  }
  return '🌍';
}

/**
 * Format league title header with country flag:
 * e.g. "🏆 🇺🇿 Uzbekistan • 1st Division\n━━━━━━━━━━━━━━━━━━━━━━━━━━━"
 */
export function formatLeagueSectionHeader(country?: string, leagueName?: string): string {
  const c = (country || '').trim();
  const l = (leagueName || 'Football').trim();
  const flag = getCountryFlag(c, l);

  const cLower = c.toLowerCase();
  const isGenericRegion =
    !c ||
    cLower === 'world' ||
    cLower === 'international' ||
    cLower === 'africa' ||
    cLower === 'europe' ||
    cLower === 'asia' ||
    cLower === 'south america';

  const alreadyHasCountry = c && l.toLowerCase().includes(cLower);

  const title = (isGenericRegion || alreadyHasCountry) ? `${flag} ${l}` : `${flag} ${c} • ${l}`;
  return `🏆 ${title}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// Rotating dynamic headers and greetings to eliminate repetitive starting structures across automated posts
const LIVE_ROUNDUP_HEADERS = [
  (count: number, timeStr: string) => `⚽ LIVE SCORES & ACTION • ${count} MATCH${count === 1 ? '' : 'ES'} IN PROGRESS (${timeStr})`,
  (count: number, timeStr: string) => `⚡ ONGOING MATCHDAY ACTION • ${count} LIVE GAME${count === 1 ? '' : 'S'} (${timeStr})`,
  (count: number, timeStr: string) => `📊 LIVE SCOREBOARD UPDATE • ${count} ACTIVE FIXTURE${count === 1 ? '' : 'S'} (${timeStr})`,
  (count: number, timeStr: string) => `🔥 IN-PLAY SCORES & STATS • ${count} MATCH${count === 1 ? '' : 'ES'} LIVE NOW (${timeStr})`,
  (count: number, timeStr: string) => `⏱️ REAL-TIME SCOREBOARD • ${count} GAME${count === 1 ? '' : 'S'} CURRENTLY PLAYING (${timeStr})`,
  (count: number, timeStr: string) => `📢 LATEST LIVE SCORES • ${count} MATCH${count === 1 ? '' : 'ES'} UPDATE (${timeStr})`,
];

const FT_ROUNDUP_HEADERS = [
  (count: number) => `🏁 FULL-TIME RESULTS & WRAP-UP • ${count} FINISHED MATCH${count === 1 ? '' : 'ES'}`,
  (count: number) => `⚽ FINAL SCORES & RESULTS • ${count} MATCH${count === 1 ? '' : 'ES'} COMPLETED`,
  (count: number) => `📊 MATCHDAY FULL-TIME SCORES • ${count} GAME${count === 1 ? '' : 'S'} CONCLUDED`,
  (count: number) => `🏆 FULL-TIME ROUNDUP • ${count} FINAL SCORELINE${count === 1 ? '' : 'S'}`,
  (count: number) => `✅ OFFICIAL FULL-TIME RESULTS • ${count} COMPLETED FIXTURE${count === 1 ? '' : 'S'}`,
  (count: number) => `⚡ FINAL WHISTLE RESULTS • ${count} MATCH${count === 1 ? '' : 'ES'} COMPLETE`,
];

const HT_ROUNDUP_HEADERS = [
  (count: number) => `⏸️ HALF-TIME SCORES & INTERMISSION • ${count} MATCH${count === 1 ? '' : 'ES'}`,
  (count: number) => `⚽ HALF-TIME BREAK SCORES • ${count} GAME${count === 1 ? '' : 'S'} AT THE INTERVAL`,
  (count: number) => `📊 45' MINUTE SCORES UPDATE • ${count} FIXTURE${count === 1 ? '' : 'S'} AT HALF-TIME`,
  (count: number) => `⚡ HALF-TIME SCOREBOARD • ${count} MATCH${count === 1 ? '' : 'ES'} PAUSED`,
  (count: number) => `📢 FIRST HALF RECAP & SCORES • ${count} GAME${count === 1 ? '' : 'S'} AT HT`,
  (count: number) => `⏱️ INTERMISSION SCOREBOARD • ${count} MATCH${count === 1 ? '' : 'ES'} AT HALF-TIME`,
];

// Rotating hashtag pools to eliminate repetitive hashtag footprints across consecutive posts
const LIVE_HASHTAG_PACKS = [
  ['#LiveScores', '#Football', '#Matchday', '#SoccerScores'],
  ['#FootballLive', '#Scores', '#MatchdayLive', '#GameScores'],
  ['#LiveFootball', '#InPlay', '#Soccer', '#FootballScores'],
  ['#MatchdayAction', '#LiveUpdate', '#FootballNews', '#ScoresLive'],
  ['#SoccerLive', '#Scoreline', '#MatchAlerts', '#FootballUpdates'],
  ['#LiveScoreboard', '#Footy', '#SoccerGame', '#GoalUpdates'],
];

const FT_HASHTAG_PACKS = [
  ['#FullTime', '#Results', '#FinalScores', '#Matchday'],
  ['#FootballResults', '#FullTimeScores', '#GameScores', '#MatchSummary'],
  ['#SoccerResults', '#FinalWhistle', '#Scores', '#FT'],
  ['#MatchResults', '#FootballScores', '#ResultsRoundup', '#GameDay'],
  ['#FootballWrapUp', '#FinalResult', '#MatchdayResults', '#FullTimeWhistle'],
  ['#FootyResults', '#SoccerScores', '#FinalScore', '#ScoreUpdate'],
];

const HT_HASHTAG_PACKS = [
  ['#HalfTime', '#HTScores', '#LiveFootball', '#GameScores'],
  ['#HalfTimeUpdate', '#45Minutes', '#SoccerScores', '#Interval'],
  ['#FirstHalfRecap', '#LiveScores', '#HalfTimeWhistle', '#Football'],
  ['#HTScoreboard', '#InPlayScores', '#MatchdayLive', '#SoccerUpdate'],
  ['#HalfTimeScores', '#FootballUpdate', '#ScoresLive', '#Matchday'],
  ['#FirstHalf', '#SoccerLive', '#FootballScores', '#HTUpdate'],
];

export function getDynamicLiveRoundupHeader(count: number, timeStr: string, seed: number = Date.now()): string {
  const index = Math.abs(Math.floor(seed / (1000 * 60 * 3))) % LIVE_ROUNDUP_HEADERS.length;
  return LIVE_ROUNDUP_HEADERS[index](count, timeStr);
}

export function getDynamicFtRoundupHeader(count: number, seed: number = Date.now()): string {
  const index = Math.abs(Math.floor(seed / (1000 * 60 * 3))) % FT_ROUNDUP_HEADERS.length;
  return FT_ROUNDUP_HEADERS[index](count);
}

export function getDynamicHtRoundupHeader(count: number, seed: number = Date.now()): string {
  const index = Math.abs(Math.floor(seed / (1000 * 60 * 3))) % HT_ROUNDUP_HEADERS.length;
  return HT_ROUNDUP_HEADERS[index](count);
}

export function getRotatingHashtags(
  type: 'LIVE' | 'FT' | 'HT' | 'GOAL' | 'CARD',
  leagueTags: string[] = [],
  seed: number = Date.now()
): string {
  const cleanTags = Array.from(
    new Set(
      leagueTags
        .filter(Boolean)
        .map(t => (t.startsWith('#') ? t : `#${t.replace(/[^a-zA-Z0-9]/g, '')}`))
        .filter(t => t.length > 2)
    )
  ).slice(0, 2);

  let pool = LIVE_HASHTAG_PACKS;
  if (type === 'FT') pool = FT_HASHTAG_PACKS;
  else if (type === 'HT') pool = HT_HASHTAG_PACKS;

  const slotIndex = Math.abs(Math.floor(seed / (1000 * 60 * 4))) % pool.length;
  const basePack = pool[slotIndex];

  // Merge unique league-specific tags with selected rotating base tags
  const combined = Array.from(new Set([...cleanTags, ...basePack]));
  return combined.slice(0, 4).join(' ');
}

const FOOTER_SIGNATURES = [
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📢 Follow @${name} for live scores & verified updates!\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚽ Real-time scores & instant match coverage on @${name}\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔥 Stay updated with @${name} for live match scores & goal alerts!\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n⚡ Follow @${name} for ongoing pitch action & immediate results\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 Accurate match statistics & live updates powered by @${name}\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔔 Turn on notifications for @${name} to never miss a live score!\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📱 Track today's games and up-to-the-minute scores right here on @${name}\n${hashtags}`,
  (name: string, tag: string, hashtags: string) => `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🌟 Your home for instant scores and complete football statistics: @${name}\n${hashtags}`,
];

export function getBrandedFooter(
  config?: FacebookPageConfig,
  type: 'LIVE' | 'FT' | 'HT' | 'GOAL' | 'CARD' = 'LIVE',
  leagueTags: string[] = [],
  seed: number = Date.now()
): string {
  const name = config?.pageName?.trim() || 'GameScores';
  const tag = name.replace(/[^a-zA-Z0-9]/g, '') || 'GameScores';
  const pageTag = `#${tag}`;
  const rotatingHashtags = getRotatingHashtags(type, [pageTag, ...leagueTags], seed);

  // Rotate signature based on 3-minute time windows & pseudo-random variation
  const index = Math.abs(Math.floor(seed / (1000 * 60 * 3))) % FOOTER_SIGNATURES.length;
  return FOOTER_SIGNATURES[index](name, tag, rotatingHashtags);
}

export const MATCH_STATS_LEGEND = `━━━━━━━━━━━━━━━━━━━━━━━━━━━
📢 Follow @GameScores for live scores & breaking updates!
#GameScores #LiveScores #Football #Matchday`;

function getFormattedMatchLine(m: Match): string {
  const st = (m.statusText || '').trim();
  let timeBadge = '';
  if (m.status === 'FINISHED') {
    timeBadge = 'FT';
  } else if (m.status === 'PAUSED' || st.toLowerCase().includes('ht') || st.toLowerCase().includes('half time')) {
    timeBadge = "HT (45')";
  } else if (m.minute && m.minute > 0) {
    if (st.match(/\d+\+\d+/)) {
      timeBadge = st.replace(/'$/, '') + "'";
    } else if (m.addedTime) {
      timeBadge = `${m.minute}+${m.addedTime}'`;
    } else {
      timeBadge = `${m.minute}'`;
    }
  } else {
    timeBadge = st || 'LIVE';
  }

  const icon = m.status === 'FINISHED' ? '🏁' : '⚡';
  return `${icon} ${timeBadge} | ${m.homeTeam.name} ${m.homeScore} - ${m.awayScore} ${m.awayTeam.name}`;
}

function formatPeriodScoresLine(m: Match): string | null {
  const p = m.periodScores;
  const events = m.events || [];
  let h1Home = p?.half1Home;
  let h1Away = p?.half1Away;
  let h2Home = p?.half2Home;
  let h2Away = p?.half2Away;

  // Fallback: extract from goals in events if available
  if (h1Home === undefined && events.length > 0 && (m.minute && m.minute > 45)) {
    h1Home = events.filter(e => e.teamSide === 'home' && e.type === 'GOAL' && e.minute <= 45).length;
    h1Away = events.filter(e => e.teamSide === 'away' && e.type === 'GOAL' && e.minute <= 45).length;
  }

  if (h1Home !== undefined && h1Away !== undefined) {
    if (h2Home === undefined && h2Away === undefined && (m.status === 'FINISHED' || (m.minute && m.minute > 45))) {
      h2Home = Math.max(0, m.homeScore - h1Home);
      h2Away = Math.max(0, m.awayScore - h1Away);
    }
    if (h2Home !== undefined && h2Away !== undefined) {
      const secondHalfLabel = m.status === 'FINISHED' ? 'FT' : '2nd Half';
      const secondHalfScore = m.status === 'FINISHED' ? `${m.homeScore}-${m.awayScore}` : `${h2Home}-${h2Away}`;
      return `  📊 HT: ${h1Home}-${h1Away} | ${secondHalfLabel}: ${secondHalfScore}`;
    }
    return `  📊 HT: ${h1Home}-${h1Away}`;
  }

  return null;
}

function formatMatchStatsLines(m: Match): string[] {
  const stats = m.stats || {};
  const events = m.events || [];
  const lines: string[] = [];

  // Line 1: In-game incidents (Added time, Corners, Cards, Subs)
  const line1: string[] = [];

  if (m.addedTime) {
    line1.push(`⏱️ +${m.addedTime}m`);
  }

  const cHome = stats.cornersHome ?? (events.filter(e => e.teamSide === 'home' && e.type === 'CORNER').length || undefined);
  const cAway = stats.cornersAway ?? (events.filter(e => e.teamSide === 'away' && e.type === 'CORNER').length || undefined);
  if (cHome !== undefined && cAway !== undefined) {
    line1.push(`🚩 ${cHome}-${cAway} Corners`);
  }

  const evYHome = events.filter(e => e.teamSide === 'home' && e.type === 'YELLOW_CARD').length;
  const evYAway = events.filter(e => e.teamSide === 'away' && e.type === 'YELLOW_CARD').length;
  const yHome = stats.yellowCardsHome !== undefined ? stats.yellowCardsHome : (evYHome > 0 ? evYHome : undefined);
  const yAway = stats.yellowCardsAway !== undefined ? stats.yellowCardsAway : (evYAway > 0 ? evYAway : undefined);
  if (yHome !== undefined && yAway !== undefined) {
    line1.push(`🟨 ${yHome}-${yAway} Cards`);
  }

  const evRHome = events.filter(e => e.teamSide === 'home' && (e.type === 'RED_CARD' || e.type === 'YELLOW_RED_CARD')).length;
  const evRAway = events.filter(e => e.teamSide === 'away' && (e.type === 'RED_CARD' || e.type === 'YELLOW_RED_CARD')).length;
  const rHome = stats.redCardsHome !== undefined ? stats.redCardsHome : evRHome;
  const rAway = stats.redCardsAway !== undefined ? stats.redCardsAway : evRAway;
  if ((rHome > 0 || rAway > 0) || (stats.redCardsHome !== undefined && stats.redCardsAway !== undefined && stats.redCardsHome + stats.redCardsAway > 0)) {
    line1.push(`🟥 ${rHome}-${rAway} Red`);
  }

  const evSubHome = events.filter(e => e.teamSide === 'home' && e.type === 'SUBSTITUTION').length;
  const evSubAway = events.filter(e => e.teamSide === 'away' && e.type === 'SUBSTITUTION').length;
  const subHome = stats.substitutionsHome !== undefined ? stats.substitutionsHome : (evSubHome > 0 ? evSubHome : undefined);
  const subAway = stats.substitutionsAway !== undefined ? stats.substitutionsAway : (evSubAway > 0 ? evSubAway : undefined);
  if (subHome !== undefined && subAway !== undefined) {
    line1.push(`🔁 ${subHome}-${subAway} Subs`);
  }

  if (line1.length > 0) {
    lines.push(`  ${line1.join(' • ')}`);
  }

  // Line 2: Performance metrics (Shots, Penalties, Possession)
  const line2: string[] = [];

  const hasShots = stats.shotsHome !== undefined && stats.shotsAway !== undefined;
  const hasOnTarget = stats.shotsOnTargetHome !== undefined && stats.shotsOnTargetAway !== undefined;

  if (hasShots && hasOnTarget) {
    line2.push(`🎯 Shots: ${stats.shotsHome}-${stats.shotsAway} (${stats.shotsOnTargetHome}-${stats.shotsOnTargetAway} on target)`);
  } else if (hasShots) {
    line2.push(`🏹 Shots: ${stats.shotsHome}-${stats.shotsAway}`);
  } else if (hasOnTarget) {
    line2.push(`🎯 On Target: ${stats.shotsOnTargetHome}-${stats.shotsOnTargetAway}`);
  }

  const evPenHome = events.filter(e => e.teamSide === 'home' && (e.detail?.toLowerCase().includes('penalty') || e.type === 'PENALTY_MISSED')).length;
  const evPenAway = events.filter(e => e.teamSide === 'away' && (e.detail?.toLowerCase().includes('penalty') || e.type === 'PENALTY_MISSED')).length;
  const penHome = stats.penaltiesHome !== undefined ? stats.penaltiesHome : (evPenHome > 0 ? evPenHome : undefined);
  const penAway = stats.penaltiesAway !== undefined ? stats.penaltiesAway : (evPenAway > 0 ? evPenAway : undefined);
  if (penHome !== undefined && penAway !== undefined && (penHome > 0 || penAway > 0)) {
    line2.push(`⚖️ ${penHome}-${penAway} Pen`);
  }

  if (stats.possessionHome !== undefined && stats.possessionAway !== undefined) {
    line2.push(`🅿️ Poss: ${stats.possessionHome}%-${stats.possessionAway}%`);
  }

  if (line2.length > 0) {
    lines.push(`  ${line2.join(' • ')}`);
  }

  return lines;
}

function getMinuteValue(eventMinute?: number, matchMinute?: number, statusText?: string): number {
  if (eventMinute && eventMinute > 0) return eventMinute;
  if (matchMinute && matchMinute > 0) return matchMinute;
  if (statusText) {
    const m = statusText.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return 1;
}

/**
 * Returns formatted league names and country details for social posting.
 * Formats "COUNTRY: League Name" (e.g. "ENGLAND: Premier League", "SPAIN: LaLiga")
 * without duplication if the league name already includes the country name.
 */
function getLeagueDisplayDetails(league?: { name: string; country?: string }) {
  const rawName = (league?.name || 'Football').trim();
  const country = (league?.country || '').trim();
  
  const alreadyHasCountry = country && rawName.toLowerCase().includes(country.toLowerCase());
  const combinedName = country && !alreadyHasCountry ? `${country}: ${rawName}` : rawName;
  
  const leagueTag = rawName.replace(/[^a-zA-Z0-9]/g, '');
  const countryTag = country.replace(/[^a-zA-Z0-9]/g, '');
  
  return {
    rawName,
    country,
    combinedName,
    leagueTag,
    countryTag,
  };
}

export function formatGoalPost(match: Match, event: MatchEvent, config: FacebookPageConfig): string {
  const minVal = getMinuteValue(event.minute, match.minute, match.statusText);
  const minStr = String(minVal);
  const period = minVal <= 45 ? '1st Half' : minVal <= 90 ? '2nd Half' : 'Extra Time';
  const seed = Date.now();

  const GOAL_EMOJIS = ['⚽ GOAL!', '⚡ GOOOAL!', '🔥 BALL IN THE NET!', '🎯 GOAL!'];
  const goalHeader = GOAL_EMOJIS[Math.abs(Math.floor(seed / 1000)) % GOAL_EMOJIS.length];

  let template = config.postTemplateGoal || `${goalHeader} {home_team} {home_score} - {away_score} {away_team}!\n⏱️ Match Time: {minute}' min ({period})\n👤 {player}\n🏆 {league_name}\n\n#{league_tag} {hashtags}`;
  
  // If existing saved template doesn't have an explicit minute label, ensure the minute line is clear
  if (!template.includes('⏱️') && !template.includes('Match Time') && !template.includes('Minute')) {
    template = template.replace(/(⚽ GOAL![^\n]*)/, `$1\n⏱️ Match Time: {minute}' min ({period})`);
  }

  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;
  const scoreLine = `${event.homeScore ?? match.homeScore} - ${event.awayScore ?? match.awayScore}`;
  const rotatingHashtags = getRotatingHashtags('GOAL', [leagueTag, countryTag], seed);
  
  let playerStr = event.playerName ? `Scorer: ${event.playerName}` : 'Goal scored!';
  if (event.detail) {
    playerStr += ` (${event.detail})`;
  }
  if (event.secondaryPlayerName) {
    playerStr += ` (Assist: ${event.secondaryPlayerName})`;
  }

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{home_score}/g, String(event.homeScore ?? match.homeScore))
    .replace(/{away_score}/g, String(event.awayScore ?? match.awayScore))
    .replace(/{score}/g, scoreLine)
    .replace(/{player}/g, playerStr)
    .replace(/{minute}/g, minStr)
    .replace(/{period}/g, period)
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatYellowCardPost(match: Match, event: MatchEvent, config: FacebookPageConfig): string {
  const minVal = getMinuteValue(event.minute, match.minute, match.statusText);
  const minStr = String(minVal);
  const period = minVal <= 45 ? '1st Half' : minVal <= 90 ? '2nd Half' : 'Extra Time';
  const seed = Date.now();
  const rotatingHashtags = getRotatingHashtags('CARD', [], seed);

  let template = config.postTemplateYellowCard || "🟨 YELLOW CARD! {player} ({team}) booked in the {minute}' min!\n⏱️ Match Time: {minute}' ({period})\n{home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n\n#{league_tag} {hashtags}";

  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;
  const teamName = event.teamSide === 'home' ? match.homeTeam.name : match.awayTeam.name;
  const playerName = event.playerName || 'Player';

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{team}/g, teamName)
    .replace(/{player}/g, playerName)
    .replace(/{minute}/g, minStr)
    .replace(/{period}/g, period)
    .replace(/{home_score}/g, String(event.homeScore ?? match.homeScore))
    .replace(/{away_score}/g, String(event.awayScore ?? match.awayScore))
    .replace(/{score}/g, `${match.homeScore} - ${match.awayScore}`)
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatRedCardPost(match: Match, event: MatchEvent, config: FacebookPageConfig): string {
  const minVal = getMinuteValue(event.minute, match.minute, match.statusText);
  const minStr = String(minVal);
  const period = minVal <= 45 ? '1st Half' : minVal <= 90 ? '2nd Half' : 'Extra Time';
  const seed = Date.now();
  const rotatingHashtags = getRotatingHashtags('CARD', [], seed);

  let template = config.postTemplateRedCard || "🟥 RED CARD! {team} player {player} sent off in the {minute}' min!\n⏱️ Match Time: {minute}' ({period})\n{home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n\n#{league_tag} {hashtags}";

  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;
  const teamName = event.teamSide === 'home' ? match.homeTeam.name : match.awayTeam.name;
  const playerName = event.playerName || 'Player';

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{team}/g, teamName)
    .replace(/{player}/g, playerName)
    .replace(/{minute}/g, minStr)
    .replace(/{period}/g, period)
    .replace(/{home_score}/g, String(event.homeScore ?? match.homeScore))
    .replace(/{away_score}/g, String(event.awayScore ?? match.awayScore))
    .replace(/{score}/g, `${match.homeScore} - ${match.awayScore}`)
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatCornerPost(match: Match, event: MatchEvent, config: FacebookPageConfig): string {
  const minVal = getMinuteValue(event.minute, match.minute, match.statusText);
  const minStr = String(minVal);
  const period = minVal <= 45 ? '1st Half' : minVal <= 90 ? '2nd Half' : 'Extra Time';
  const seed = Date.now();
  const rotatingHashtags = getRotatingHashtags('LIVE', [], seed);

  let template = config.postTemplateCorner || "🚩 CORNER KICK! Corner awarded to {team} in the {minute}' min!\n⏱️ Match Time: {minute}' ({period})\n{home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n\n#{league_tag} {hashtags}";

  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;
  const teamName = event.teamSide === 'home' ? match.homeTeam.name : match.awayTeam.name;

  let cornerCount = '';
  if (match.stats) {
    const cHome = match.stats.cornersHome ?? 0;
    const cAway = match.stats.cornersAway ?? 0;
    cornerCount = `Corners: ${cHome} - ${cAway}`;
  }

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{team}/g, teamName)
    .replace(/{minute}/g, minStr)
    .replace(/{period}/g, period)
    .replace(/{corner_count}/g, cornerCount)
    .replace(/{home_score}/g, String(event.homeScore ?? match.homeScore))
    .replace(/{away_score}/g, String(event.awayScore ?? match.awayScore))
    .replace(/{score}/g, `${match.homeScore} - ${match.awayScore}`)
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatKickoffPost(match: Match, config: FacebookPageConfig): string {
  const seed = Date.now();
  const rotatingHashtags = getRotatingHashtags('LIVE', [], seed);
  const template = config.postTemplateKickoff || "⚡ MATCH KICK-OFF! (1st Half)\n{home_team} vs {away_team}\n⏱️ Match Time: Kick-Off (1')\n🏆 {league_name}\n\nStay tuned for live score updates!\n#{league_tag} {hashtags}";
  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatHalfTimePost(match: Match, config: FacebookPageConfig): string {
  const seed = Date.now();
  const rotatingHashtags = getRotatingHashtags('HT', [], seed);
  const template = config.postTemplateHalfTime || "⏸️ HALF-TIME: {home_team} {home_score} - {away_score} {away_team}\n⏱️ Match Time: Half-Time (45')\n🏆 {league_name}\n\n#{league_tag} {hashtags}";
  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{home_score}/g, String(match.homeScore))
    .replace(/{away_score}/g, String(match.awayScore))
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatFullTimePost(match: Match, config: FacebookPageConfig): string {
  const seed = Date.now();
  const rotatingHashtags = getRotatingHashtags('FT', [], seed);
  const template = config.postTemplateFullTime || "🏁 FULL-TIME: {home_team} {home_score} - {away_score} {away_team}\n⏱️ Match Time: Full-Time (90')\n🏆 {league_name}\n{stats_summary}\n\nThanks for following!\n#{league_tag} {hashtags}";
  const { rawName, country, combinedName, leagueTag, countryTag } = getLeagueDisplayDetails(match.league);
  const leagueNameReplacement = template.includes('{league_country}') ? rawName : combinedName;
  
  let statsSummary = '';
  if (config.includeStatsInFullTime && match.stats) {
    const s = match.stats;
    const lines = [];
    if (s.possessionHome !== undefined && s.possessionAway !== undefined) {
      lines.push(`Possession: ${s.possessionHome}% - ${s.possessionAway}%`);
    }
    if (s.shotsOnTargetHome !== undefined && s.shotsOnTargetAway !== undefined) {
      lines.push(`Shots on Target: ${s.shotsOnTargetHome} - ${s.shotsOnTargetAway}`);
    }
    if (s.cornersHome !== undefined && s.cornersAway !== undefined) {
      lines.push(`Corners: ${s.cornersHome} - ${s.cornersAway}`);
    }
    if (lines.length > 0) {
      statsSummary = `\n📊 Match Stats:\n${lines.join('\n')}`;
    }
  }

  return template
    .replace(/{home_team}/g, match.homeTeam.name)
    .replace(/{away_team}/g, match.awayTeam.name)
    .replace(/{home_score}/g, String(match.homeScore))
    .replace(/{away_score}/g, String(match.awayScore))
    .replace(/{league_country}/g, country)
    .replace(/{country}/g, country)
    .replace(/{country_tag}/g, countryTag)
    .replace(/{league_name}/g, leagueNameReplacement)
    .replace(/{league_tag}/g, leagueTag)
    .replace(/{stats_summary}/g, statsSummary)
    .replace(/{hashtags}/g, rotatingHashtags);
}

export function formatLiveRoundupPost(matches: Match[], config: FacebookPageConfig): string {
  if (!matches || matches.length === 0) {
    return '⚽ LIVE SCORES UPDATE\nNo active live matches currently in progress.\n#LiveScores #Football';
  }

  // Filter strictly by target leagues if configured
  let filteredMatches = matches;
  if (config.targetLeagueIds && config.targetLeagueIds.length > 0) {
    filteredMatches = matches.filter(m => config.targetLeagueIds.includes(m.league.id));
  } else {
    filteredMatches = []; // If no leagues are selected for today, do not include unselected leagues
  }

  // Group matches by country and league
  const leagueGroups = new Map<string, { leagueName: string; country: string; matches: Match[] }>();
  for (const m of filteredMatches) {
    const lName = m.league?.name || 'International / Other';
    const lCountry = (m.league?.country || '').trim();
    const groupKey = `${lCountry}:::${lName}`;
    if (!leagueGroups.has(groupKey)) {
      leagueGroups.set(groupKey, { leagueName: lName, country: lCountry, matches: [] });
    }
    leagueGroups.get(groupKey)!.matches.push(m);
  }

  const leagueSections: string[] = [];

  for (const { leagueName, country, matches: lMatches } of leagueGroups.values()) {
    const header = formatLeagueSectionHeader(country, leagueName);
    const matchLines: string[] = [];

    for (const m of lMatches) {
      const mHeader = getFormattedMatchLine(m);
      const linesForMatch: string[] = [mHeader];

      // 1st / 2nd half score line
      const periodLine = formatPeriodScoresLine(m);
      if (periodLine) {
        linesForMatch.push(periodLine);
      }

      // Stats lines
      const statsLines = formatMatchStatsLines(m);
      if (statsLines.length > 0) {
        linesForMatch.push(...statsLines);
      }

      matchLines.push(linesForMatch.join('\n'));
    }

    leagueSections.push(`${header}\n${matchLines.join('\n\n')}`);
  }

  const matchesList = leagueSections.join('\n\n');
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const seed = now.getTime();
  const dynamicHeader = getDynamicLiveRoundupHeader(filteredMatches.length, timeStr, seed);
  const leagueTags = Array.from(new Set(filteredMatches.map(m => m.league?.name ? m.league.name.replace(/[^a-zA-Z0-9]/g, '') : '').filter(Boolean)));
  const rotatingHashtags = getRotatingHashtags('LIVE', leagueTags, seed);
  const footer = getBrandedFooter(config, 'LIVE', leagueTags, seed);

  // If user has a custom template that includes {matches_list}, fill it
  if (config.postTemplateRoundup && config.postTemplateRoundup.trim() !== '') {
    let output = config.postTemplateRoundup
      .replace(/{title}/g, dynamicHeader)
      .replace(/{count}/g, String(filteredMatches.length))
      .replace(/{time}/g, timeStr)
      .replace(/{matches_list}/g, matchesList)
      .replace(/{legend}/g, footer)
      .replace(/{hashtags}/g, rotatingHashtags);

    // If template did not include {matches_list}, default to matchesList + footer
    if (!config.postTemplateRoundup.includes('{matches_list}')) {
      return `${dynamicHeader}\n\n${matchesList}\n\n${footer}`;
    }
    // If template has {matches_list} but lacks footer or page signature, append it
    if (!output.includes('Follow') && !output.includes('━━━━━━━━━━━━━━━━')) {
      output = `${output}\n\n${footer}`;
    }
    return output;
  }

  // Default output matching dynamic non-repetitive layout
  return `${dynamicHeader}\n\n${matchesList}\n\n${footer}`;
}

export function formatResultsRoundupPost(matches: Match[], config: FacebookPageConfig): string {
  if (!matches || matches.length === 0) {
    const seed = Date.now();
    const dynamicHeader = getDynamicFtRoundupHeader(0, seed);
    const tags = getRotatingHashtags('FT', [], seed);
    return `${dynamicHeader}\nNo new completed matches to report at this time.\n\n${tags}`;
  }

  // Filter strictly by target leagues if configured
  let filtered = matches;
  if (config.targetLeagueIds && config.targetLeagueIds.length > 0) {
    filtered = matches.filter(m => config.targetLeagueIds.includes(m.league.id));
  } else {
    filtered = []; // If no leagues are selected for today, do not include unselected leagues
  }

  // Group by country and league
  const leagueGroups = new Map<string, { leagueName: string; country: string; matches: Match[] }>();
  for (const m of filtered) {
    const lName = m.league?.name || 'International / Other';
    const lCountry = (m.league?.country || '').trim();
    const groupKey = `${lCountry}:::${lName}`;
    if (!leagueGroups.has(groupKey)) {
      leagueGroups.set(groupKey, { leagueName: lName, country: lCountry, matches: [] });
    }
    leagueGroups.get(groupKey)!.matches.push(m);
  }

  const leagueSections: string[] = [];

  for (const { leagueName, country, matches: lMatches } of leagueGroups.values()) {
    const header = formatLeagueSectionHeader(country, leagueName);
    const matchLines: string[] = [];

    for (const m of lMatches) {
      const mHeader = getFormattedMatchLine(m);
      const linesForMatch: string[] = [mHeader];

      const periodLine = formatPeriodScoresLine(m);
      if (periodLine) {
        linesForMatch.push(periodLine);
      }

      if (config.includeStatsInFullTime) {
        const statsLines = formatMatchStatsLines(m);
        if (statsLines.length > 0) {
          linesForMatch.push(...statsLines);
        }
      }

      matchLines.push(linesForMatch.join('\n'));
    }

    leagueSections.push(`${header}\n${matchLines.join('\n\n')}`);
  }

  const matchesList = leagueSections.join('\n\n');
  const seed = Date.now();
  const dynamicHeader = getDynamicFtRoundupHeader(filtered.length, seed);
  const leagueTags = Array.from(new Set(filtered.map(m => m.league?.name ? m.league.name.replace(/[^a-zA-Z0-9]/g, '') : '').filter(Boolean)));
  const rotatingHashtags = getRotatingHashtags('FT', leagueTags, seed);
  const footer = getBrandedFooter(config, 'FT', leagueTags, seed);

  if (config.postTemplateFullTimeRoundup && config.postTemplateFullTimeRoundup.trim() !== '') {
    let output = config.postTemplateFullTimeRoundup
      .replace(/{title}/g, dynamicHeader)
      .replace(/{count}/g, String(filtered.length))
      .replace(/{matches_list}/g, matchesList)
      .replace(/{legend}/g, footer)
      .replace(/{hashtags}/g, rotatingHashtags);

    if (!config.postTemplateFullTimeRoundup.includes('{matches_list}')) {
      return `${dynamicHeader}\n\n${matchesList}\n\n${footer}`;
    }
    if (!output.includes('Follow') && !output.includes('━━━━━━━━━━━━━━━━')) {
      output = `${output}\n\n${footer}`;
    }
    return output;
  }

  return `${dynamicHeader}\n\n${matchesList}\n\n${footer}`;
}

export function formatHalfTimeRoundupPost(matches: Match[], config: FacebookPageConfig): string {
  if (!matches || matches.length === 0) {
    const seed = Date.now();
    const dynamicHeader = getDynamicHtRoundupHeader(0, seed);
    const tags = getRotatingHashtags('HT', [], seed);
    return `${dynamicHeader}\nNo active matches currently at half-time intermission.\n\n${tags}`;
  }

  // Filter strictly by target leagues if configured
  let filtered = matches;
  if (config.targetLeagueIds && config.targetLeagueIds.length > 0) {
    filtered = matches.filter(m => config.targetLeagueIds.includes(m.league.id));
  } else {
    filtered = []; // If no leagues are selected for today, do not include unselected leagues
  }

  if (filtered.length === 0) {
    const seed = Date.now();
    const dynamicHeader = getDynamicHtRoundupHeader(0, seed);
    const tags = getRotatingHashtags('HT', [], seed);
    return `${dynamicHeader}\nNo matches from selected leagues currently at half-time.\n\n${tags}`;
  }

  // Group by country and league
  const leagueGroups = new Map<string, { leagueName: string; country: string; matches: Match[] }>();
  for (const m of filtered) {
    const lName = m.league?.name || 'International / Other';
    const lCountry = (m.league?.country || '').trim();
    const groupKey = `${lCountry}:::${lName}`;
    if (!leagueGroups.has(groupKey)) {
      leagueGroups.set(groupKey, { leagueName: lName, country: lCountry, matches: [] });
    }
    leagueGroups.get(groupKey)!.matches.push(m);
  }

  const leagueSections: string[] = [];

  for (const { leagueName, country, matches: lMatches } of leagueGroups.values()) {
    const header = formatLeagueSectionHeader(country, leagueName);
    const matchLines: string[] = [];

    for (const m of lMatches) {
      const mHeader = `⏸️ HT (45') | ${m.homeTeam.name} ${m.homeScore} - ${m.awayScore} ${m.awayTeam.name}`;
      const linesForMatch: string[] = [mHeader];

      // Goal scorers during 1st half if events are available
      const events = m.events || [];
      const firstHalfGoals = events.filter(e => e.type === 'GOAL' && (e.minute || 0) <= 45);
      if (firstHalfGoals.length > 0) {
        const goalDescriptions = firstHalfGoals.map(g => {
          const team = g.teamSide === 'home' ? m.homeTeam.shortName || m.homeTeam.name : m.awayTeam.shortName || m.awayTeam.name;
          const min = g.minute ? `${g.minute}'` : '';
          return `⚽ ${g.playerName || 'Goal'} (${team} ${min})`;
        });
        linesForMatch.push(`  ${goalDescriptions.join(' • ')}`);
      }

      // Stats (Cards, Corners, Possession)
      const statsLines = formatMatchStatsLines(m);
      if (statsLines.length > 0) {
        linesForMatch.push(...statsLines);
      }

      matchLines.push(linesForMatch.join('\n'));
    }

    leagueSections.push(`${header}\n${matchLines.join('\n\n')}`);
  }

  const matchesList = leagueSections.join('\n\n');
  const seed = Date.now();
  const dynamicHeader = getDynamicHtRoundupHeader(filtered.length, seed);
  const leagueTags = Array.from(new Set(filtered.map(m => m.league?.name ? m.league.name.replace(/[^a-zA-Z0-9]/g, '') : '').filter(Boolean)));
  const rotatingHashtags = getRotatingHashtags('HT', leagueTags, seed);
  const footer = getBrandedFooter(config, 'HT', leagueTags, seed);

  if (config.postTemplateHalfTimeRoundup && config.postTemplateHalfTimeRoundup.trim() !== '') {
    let output = config.postTemplateHalfTimeRoundup
      .replace(/{title}/g, dynamicHeader)
      .replace(/{count}/g, String(filtered.length))
      .replace(/{matches_list}/g, matchesList)
      .replace(/{legend}/g, footer)
      .replace(/{hashtags}/g, rotatingHashtags);

    if (!config.postTemplateHalfTimeRoundup.includes('{matches_list}')) {
      return `${dynamicHeader}\n\n${matchesList}\n\n${footer}`;
    }
    if (!output.includes('Follow') && !output.includes('━━━━━━━━━━━━━━━━')) {
      output = `${output}\n\n${footer}`;
    }
    return output;
  }

  return `${dynamicHeader}\n\n${matchesList}\n\n${footer}`;
}

/**
 * Async variants of formatters that query DeepSeek (or Gemini) when AI enhancement is active,
 * seamlessly augmenting the headline, intro note, and hashtags while falling back to standard formatters.
 */
export async function formatLiveRoundupPostAsync(matches: Match[], config: FacebookPageConfig): Promise<string> {
  const basePost = formatLiveRoundupPost(matches, config);
  if (!config.enableAiPostEnhancement || !isAiGeneratorAvailable(config)) {
    return basePost;
  }

  try {
    const aiVar = await generatePostVariationWithAi({
      type: 'LIVE',
      summaryText: basePost.slice(0, 450),
      matchCount: matches.length,
      pageName: config.pageName,
      config,
    });

    if (aiVar && aiVar.headline) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const enrichedHeader = `${aiVar.headline} (${timeStr})`;
      const enrichedHashtags = aiVar.hashtags && aiVar.hashtags.length > 0 ? aiVar.hashtags.join(' ') : '';
      
      let replaced = basePost;
      const lines = replaced.split('\n');
      if (lines.length > 0) {
        lines[0] = enrichedHeader;
        replaced = lines.join('\n');
      }

      if (aiVar.callToAction) {
        replaced += `\n💬 ${aiVar.callToAction}`;
      }

      if (enrichedHashtags && !replaced.includes(enrichedHashtags.split(' ')[0])) {
        replaced += `\n${enrichedHashtags}`;
      }
      return replaced;
    }
  } catch (err) {
    console.warn('[Formatters] AI enhancement error, using base format:', err);
  }

  return basePost;
}

export async function formatResultsRoundupPostAsync(matches: Match[], config: FacebookPageConfig): Promise<string> {
  const basePost = formatResultsRoundupPost(matches, config);
  if (!config.enableAiPostEnhancement || !isAiGeneratorAvailable(config) || matches.length === 0) {
    return basePost;
  }

  try {
    const aiVar = await generatePostVariationWithAi({
      type: 'FT',
      summaryText: basePost.slice(0, 450),
      matchCount: matches.length,
      pageName: config.pageName,
      config,
    });

    if (aiVar && aiVar.headline) {
      const lines = basePost.split('\n');
      if (lines.length > 0) {
        lines[0] = aiVar.headline;
      }
      let replaced = lines.join('\n');
      if (aiVar.callToAction) {
        replaced += `\n💬 ${aiVar.callToAction}`;
      }
      if (aiVar.hashtags && aiVar.hashtags.length > 0) {
        const tagLine = aiVar.hashtags.join(' ');
        if (!replaced.includes(aiVar.hashtags[0])) {
          replaced += `\n${tagLine}`;
        }
      }
      return replaced;
    }
  } catch (err) {
    console.warn('[Formatters] AI FT enhancement error, using base format:', err);
  }

  return basePost;
}

export async function formatHalfTimeRoundupPostAsync(matches: Match[], config: FacebookPageConfig): Promise<string> {
  const basePost = formatHalfTimeRoundupPost(matches, config);
  if (!config.enableAiPostEnhancement || !isAiGeneratorAvailable(config) || matches.length === 0) {
    return basePost;
  }

  try {
    const aiVar = await generatePostVariationWithAi({
      type: 'HT',
      summaryText: basePost.slice(0, 450),
      matchCount: matches.length,
      pageName: config.pageName,
      config,
    });

    if (aiVar && aiVar.headline) {
      const lines = basePost.split('\n');
      if (lines.length > 0) {
        lines[0] = aiVar.headline;
      }
      let replaced = lines.join('\n');
      if (aiVar.callToAction) {
        replaced += `\n💬 ${aiVar.callToAction}`;
      }
      if (aiVar.hashtags && aiVar.hashtags.length > 0) {
        const tagLine = aiVar.hashtags.join(' ');
        if (!replaced.includes(aiVar.hashtags[0])) {
          replaced += `\n${tagLine}`;
        }
      }
      return replaced;
    }
  } catch (err) {
    console.warn('[Formatters] AI HT enhancement error, using base format:', err);
  }

  return basePost;
}


