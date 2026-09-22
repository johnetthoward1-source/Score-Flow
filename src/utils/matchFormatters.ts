import { Match, MatchEvent, MatchStats } from '../types';

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
  morocco: '🇲🇦',
  egypt: '🇪🇬',
  nigeria: '🇳🇬',
  ghana: '🇬🇭',
  algeria: '🇩🇿',
  tunisia: '🇹🇳',
  cameroon: '🇨🇲',
  senegal: '🇸🇳',
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
  kazakhstan: '🇰🇿',
  georgia: '🇬🇪',
  finland: '🇫🇮',
  iceland: '🇮🇸',
  slovakia: '🇸🇰',
  slovenia: '🇸🇮',
  bulgaria: '🇧🇬',
  bosnia: '🇧🇦',
  albania: '🇦🇱',
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

export const MATCH_STATS_LEGEND = `━━━━━━━━━━━━━━━━━━━━━━━━━━━
📢 Follow @GameScores for live scores & breaking updates!
#GameScores #LiveScores #Football #Matchday`;

export function formatSingleMatchPost(match: Match, stats?: MatchStats | null, events?: MatchEvent[]): string {
  const header = formatLeagueSectionHeader(match.league?.country, match.league?.name);

  // Match time & header
  const st = (match.statusText || '').trim();
  let timeBadge = '';
  if (match.status === 'FINISHED') {
    timeBadge = 'FT';
  } else if (match.status === 'PAUSED' || st.toLowerCase().includes('ht')) {
    timeBadge = "HT (45')";
  } else if (match.minute && match.minute > 0) {
    if (st.match(/\d+\+\d+/)) {
      timeBadge = st.replace(/'$/, '') + "'";
    } else if (match.addedTime) {
      timeBadge = `${match.minute}+${match.addedTime}'`;
    } else {
      timeBadge = `${match.minute}'`;
    }
  } else {
    timeBadge = st || 'LIVE';
  }

  const icon = match.status === 'FINISHED' ? '🏁' : '⚡';
  const matchLine = `${icon} ${timeBadge} | ${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`;

  const lines = [header, matchLine];

  // Half scores
  const p = match.periodScores;
  const evList = events || match.events || [];
  let h1Home = p?.half1Home;
  let h1Away = p?.half1Away;
  let h2Home = p?.half2Home;
  let h2Away = p?.half2Away;

  if (h1Home === undefined && evList.length > 0 && (match.minute && match.minute > 45)) {
    h1Home = evList.filter((e) => e.teamSide === 'home' && e.type === 'GOAL' && e.minute <= 45).length;
    h1Away = evList.filter((e) => e.teamSide === 'away' && e.type === 'GOAL' && e.minute <= 45).length;
  }

  if (h1Home !== undefined && h1Away !== undefined) {
    if (h2Home === undefined && h2Away === undefined && (match.status === 'FINISHED' || (match.minute && match.minute > 45))) {
      h2Home = Math.max(0, match.homeScore - h1Home);
      h2Away = Math.max(0, match.awayScore - h1Away);
    }
    if (h2Home !== undefined && h2Away !== undefined) {
      const secondHalfLabel = match.status === 'FINISHED' ? 'FT' : '2nd Half';
      const secondHalfScore = match.status === 'FINISHED' ? `${match.homeScore}-${match.awayScore}` : `${h2Home}-${h2Away}`;
      lines.push(`  📊 HT: ${h1Home}-${h1Away} | ${secondHalfLabel}: ${secondHalfScore}`);
    } else {
      lines.push(`  📊 HT: ${h1Home}-${h1Away}`);
    }
  }

  // Stat badges
  const stObj = stats || match.stats || {};
  const line1: string[] = [];

  if (match.addedTime) {
    line1.push(`⏱️ +${match.addedTime}m`);
  }

  const cHome = stObj.cornersHome ?? (evList.filter((e) => e.teamSide === 'home' && e.type === 'CORNER').length || undefined);
  const cAway = stObj.cornersAway ?? (evList.filter((e) => e.teamSide === 'away' && e.type === 'CORNER').length || undefined);
  if (cHome !== undefined && cAway !== undefined) {
    line1.push(`🚩 ${cHome}-${cAway} Corners`);
  }

  const evYHome = evList.filter((e) => e.teamSide === 'home' && e.type === 'YELLOW_CARD').length;
  const evYAway = evList.filter((e) => e.teamSide === 'away' && e.type === 'YELLOW_CARD').length;
  const yHome = stObj.yellowCardsHome !== undefined ? stObj.yellowCardsHome : evYHome > 0 ? evYHome : undefined;
  const yAway = stObj.yellowCardsAway !== undefined ? stObj.yellowCardsAway : evYAway > 0 ? evYAway : undefined;
  if (yHome !== undefined && yAway !== undefined) {
    line1.push(`🟨 ${yHome}-${yAway} Cards`);
  }

  const evRHome = evList.filter((e) => e.teamSide === 'home' && (e.type === 'RED_CARD' || e.type === 'YELLOW_RED_CARD')).length;
  const evRAway = evList.filter((e) => e.teamSide === 'away' && (e.type === 'RED_CARD' || e.type === 'YELLOW_RED_CARD')).length;
  const rHome = stObj.redCardsHome !== undefined ? stObj.redCardsHome : evRHome;
  const rAway = stObj.redCardsAway !== undefined ? stObj.redCardsAway : evRAway;
  if (rHome > 0 || rAway > 0 || (stObj.redCardsHome !== undefined && stObj.redCardsAway !== undefined && stObj.redCardsHome + stObj.redCardsAway > 0)) {
    line1.push(`🟥 ${rHome}-${rAway} Red`);
  }

  const evSubHome = evList.filter((e) => e.teamSide === 'home' && e.type === 'SUBSTITUTION').length;
  const evSubAway = evList.filter((e) => e.teamSide === 'away' && e.type === 'SUBSTITUTION').length;
  const subHome = stObj.substitutionsHome !== undefined ? stObj.substitutionsHome : evSubHome > 0 ? evSubHome : undefined;
  const subAway = stObj.substitutionsAway !== undefined ? stObj.substitutionsAway : evSubAway > 0 ? evSubAway : undefined;
  if (subHome !== undefined && subAway !== undefined) {
    line1.push(`🔁 ${subHome}-${subAway} Subs`);
  }

  if (line1.length > 0) {
    lines.push(`  ${line1.join(' • ')}`);
  }

  const line2: string[] = [];

  const hasShots = stObj.shotsHome !== undefined && stObj.shotsAway !== undefined;
  const hasOnTarget = stObj.shotsOnTargetHome !== undefined && stObj.shotsOnTargetAway !== undefined;

  if (hasShots && hasOnTarget) {
    line2.push(`🎯 Shots: ${stObj.shotsHome}-${stObj.shotsAway} (${stObj.shotsOnTargetHome}-${stObj.shotsOnTargetAway} on target)`);
  } else if (hasShots) {
    line2.push(`🏹 Shots: ${stObj.shotsHome}-${stObj.shotsAway}`);
  } else if (hasOnTarget) {
    line2.push(`🎯 On Target: ${stObj.shotsOnTargetHome}-${stObj.shotsOnTargetAway}`);
  }

  const evPenHome = evList.filter((e) => e.teamSide === 'home' && (e.detail?.toLowerCase().includes('penalty') || e.type === 'PENALTY_MISSED')).length;
  const evPenAway = evList.filter((e) => e.teamSide === 'away' && (e.detail?.toLowerCase().includes('penalty') || e.type === 'PENALTY_MISSED')).length;
  const penHome = stObj.penaltiesHome !== undefined ? stObj.penaltiesHome : evPenHome > 0 ? evPenHome : undefined;
  const penAway = stObj.penaltiesAway !== undefined ? stObj.penaltiesAway : evPenAway > 0 ? evPenAway : undefined;
  if (penHome !== undefined && penAway !== undefined && (penHome > 0 || penAway > 0)) {
    line2.push(`⚖️ ${penHome}-${penAway} Pen`);
  }

  if (stObj.possessionHome !== undefined && stObj.possessionAway !== undefined) {
    line2.push(`🅿️ Poss: ${stObj.possessionHome}%-${stObj.possessionAway}%`);
  }

  if (line2.length > 0) {
    lines.push(`  ${line2.join(' • ')}`);
  }

  lines.push(MATCH_STATS_LEGEND);

  return lines.join('\n');
}
