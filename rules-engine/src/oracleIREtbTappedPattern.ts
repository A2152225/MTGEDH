/**
 * ETB-tapped pattern detection for Oracle IR (mirrors land-helpers.ts).
 * Shock / check / fast / slow / battle lands are resolved here so IR
 * createBattlefieldPermanentsFromCards does not stamp them untapped.
 */

function normalizeEtbOracle(oracleText: string): string {
  return String(oracleText || '').toLowerCase().replace(/\u2019/g, "'");
}

const BASIC_LAND_TYPES = ['plains', 'island', 'swamp', 'mountain', 'forest'] as const;

const ETB_COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function parseEtbCountWord(raw: string): number | null {
  const token = String(raw || '').toLowerCase().trim();
  if (!token) return null;
  if (ETB_COUNT_WORDS[token] !== undefined) return ETB_COUNT_WORDS[token];
  const n = Number.parseInt(token, 10);
  return Number.isFinite(n) ? n : null;
}

export function isPayLifeOrEnterTapped(oracleText: string): boolean {
  const text = normalizeEtbOracle(oracleText);
  return /you may pay \d+ life/.test(text)
    && /if you don't,.{0,60}enters(?: the battlefield)? tapped/.test(text);
}

export function detectETBTappedPattern(oracleText: string): 'always' | 'conditional' | 'never' {
  const text = normalizeEtbOracle(oracleText);
  const etbTappedMatch =
    text.includes('enters the battlefield tapped')
    || text.includes('enters tapped')
    || text.includes('comes into play tapped');

  if (!etbTappedMatch) return 'never';

  const sentences = text.split(/[.!]/);
  const etbSentence = sentences.find((s) =>
    s.includes('enters the battlefield tapped')
    || s.includes('enters tapped')
    || s.includes('comes into play tapped'),
  ) || '';

  const conditionalPatterns = [
    'unless you',
    'unless your',
    'you may pay',
    'if you control',
    "if you don't",
    'if an opponent',
  ];

  for (const pattern of conditionalPatterns) {
    if (etbSentence.includes(pattern)) return 'conditional';
  }

  return 'always';
}

/**
 * Turbulent cycle: "This land enters tapped unless your opponents control eight or more lands."
 * Counts lands among all opponents combined.
 */
export function matchOpponentsControlLandsETB(
  oracleText: string,
  opponentLandCount: number,
): { shouldEnterTapped: boolean; reason: string } | null {
  const text = String(oracleText || '').toLowerCase();
  const match = text.match(
    /(?:this land )?enters(?: the battlefield)? tapped unless your opponents control (\w+|\d+) or more lands/i,
  );
  if (!match) return null;

  const threshold = parseEtbCountWord(match[1] || '');
  if (threshold == null || threshold < 1) return null;

  const count = Math.max(0, Number(opponentLandCount) || 0);
  const shouldEnterTapped = count < threshold;
  return {
    shouldEnterTapped,
    reason: shouldEnterTapped
      ? `Enters tapped (opponents control ${count} land${count !== 1 ? 's' : ''}; need ${threshold}+)`
      : `Enters untapped (opponents control ${count} lands)`,
  };
}

type ControllerLandStats = {
  landCount: number;
  basicLandCount: number;
  landTypes: string[];
  hasLegendaryCreature: boolean;
  opponentCount: number;
  opponentLandCount: number;
};

function controllerIdOf(perm: any): string {
  return String(perm?.controller || perm?.controllerId || perm?.owner || '').trim();
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

export function collectControllerLandStats(
  battlefield: readonly unknown[],
  controllerId: string,
  opponentCountHint?: number,
): ControllerLandStats {
  let landCount = 0;
  let basicLandCount = 0;
  const landTypes: string[] = [];
  let hasLegendaryCreature = false;
  const opponentControllers = new Set<string>();
  let opponentLandCount = 0;

  for (const perm of battlefield) {
    if (!perm) continue;
    const controller = controllerIdOf(perm);
    const typeLine = typeLineOf(perm);
    if (controller && controller !== controllerId) {
      opponentControllers.add(controller);
      if (typeLine.includes('land')) opponentLandCount += 1;
    }
    if (controller !== controllerId) continue;
    if (typeLine.includes('land')) {
      landCount += 1;
      if (typeLine.includes('basic')) basicLandCount += 1;
      for (const basicType of BASIC_LAND_TYPES) {
        if (typeLine.includes(basicType)) landTypes.push(basicType);
      }
    }
    if (typeLine.includes('legendary') && typeLine.includes('creature')) {
      hasLegendaryCreature = true;
    }
  }

  return {
    landCount,
    basicLandCount,
    landTypes,
    hasLegendaryCreature,
    opponentCount: opponentCountHint ?? opponentControllers.size,
    opponentLandCount,
  };
}

/**
 * Deterministic "enters tapped unless …" checks from the battlefield.
 * Player-choice replacements (pay life, reveal from hand) return tapped;
 * the server queues the prompt that can untap them.
 */
export function evaluateConditionalEntersTappedFromBattlefield(
  oracleText: string,
  stats: ControllerLandStats,
): boolean | null {
  const text = normalizeEtbOracle(oracleText);
  if (isPayLifeOrEnterTapped(text)) return true;

  if (/(?:this land )?enters(?: the battlefield)? tapped unless you control two or more basic lands/i.test(text)) {
    return stats.basicLandCount < 2;
  }
  if (/(?:this land )?enters(?: the battlefield)? tapped unless you control two or more other lands/i.test(text)) {
    return stats.landCount < 2;
  }
  if (/if you control two or more other lands,.*(?:this land )?enters(?: the battlefield)? tapped/i.test(text)) {
    return stats.landCount >= 2;
  }
  if (/(?:this land )?enters(?: the battlefield)? tapped unless you control two or fewer other lands/i.test(text)) {
    return stats.landCount > 2;
  }
  if (/(?:this land )?enters(?: the battlefield)? tapped unless you have two or more opponents/i.test(text)) {
    return stats.opponentCount < 2;
  }

  const turbulent = matchOpponentsControlLandsETB(oracleText, stats.opponentLandCount);
  if (turbulent) return turbulent.shouldEnterTapped;

  const dualCheck = text.match(
    /(?:this land )?enters(?: the battlefield)? tapped unless you control (?:a|an) ([\w]+) or ([\w]+)/i,
  );
  if (dualCheck) {
    const type1 = dualCheck[1].toLowerCase();
    const type2 = dualCheck[2].toLowerCase();
    return !stats.landTypes.some((entry) => entry.includes(type1) || entry.includes(type2));
  }

  const singleCheck = text.match(
    /(?:this land )?enters(?: the battlefield)? tapped unless you control (?:a|an) ([\w]+(?:\s+[\w]+)?)/i,
  );
  if (singleCheck && !text.includes(' or ')) {
    const requiredType = singleCheck[1].toLowerCase().trim();
    if (requiredType === 'basic land') return stats.basicLandCount < 1;
    if (requiredType === 'legendary creature') return !stats.hasLegendaryCreature;
    return !stats.landTypes.some((entry) => entry.includes(requiredType));
  }

  if (
    /(?:this land )?enters(?: the battlefield)? tapped unless/i.test(text)
    || text.includes('comes into play tapped unless')
    || /you may reveal (?:a|an) .+ card from your hand/i.test(text)
  ) {
    return true;
  }

  return null;
}
