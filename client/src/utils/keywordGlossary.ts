// client/src/utils/keywordGlossary.ts
// Client-side keyword glossary with reminder text for UI tooltips
// Based on the rules-engine glossary.ts

export interface KeywordInfo {
  readonly term: string;
  readonly short: string;           // Short label for badge
  readonly color: string;           // Badge color
  readonly reminderText: string;    // Reminder text (like on cards)
  readonly fullText?: string;       // Full rules text
  readonly rulesReference?: string; // Rules citation
  readonly icon?: string;           // Icon identifier
}

/**
 * Comprehensive keyword ability definitions with reminder text
 * Sourced from the rules-engine glossary
 */
export const KEYWORD_GLOSSARY: Record<string, KeywordInfo> = {
  // Evasion abilities
  flying: {
    term: 'Flying',
    short: 'Fly',
    color: '#60a5fa',
    reminderText: 'This creature can only be blocked by creatures with flying or reach.',
    fullText: "A creature with flying can't be blocked except by other creatures with flying or reach. Flying is one of the most common evasion abilities.",
    rulesReference: 'Rule 702.9',
    icon: '🪽',
  },
  menace: {
    term: 'Menace',
    short: 'Men',
    color: '#f87171',
    reminderText: "This creature can't be blocked except by two or more creatures.",
    fullText: "A creature with menace must be blocked by at least two creatures if able. One blocker isn't enough.",
    rulesReference: 'Rule 702.111',
    icon: '👿',
  },
  skulk: {
    term: 'Skulk',
    short: 'Skl',
    color: '#9ca3af',
    reminderText: "This creature can't be blocked by creatures with greater power.",
    fullText: "A creature with skulk can't be blocked by creatures with greater power than it.",
    rulesReference: 'Rule 702.118',
    icon: '🐀',
  },
  shadow: {
    term: 'Shadow',
    short: 'Shd',
    color: '#6b7280',
    reminderText: "This creature can only block or be blocked by creatures with shadow.",
    fullText: "A creature with shadow can block or be blocked by only creatures with shadow.",
    rulesReference: 'Rule 702.28',
    icon: '👤',
  },
  fear: {
    term: 'Fear',
    short: 'Fer',
    color: '#374151',
    reminderText: "This creature can't be blocked except by artifact creatures and/or black creatures.",
    fullText: "A creature with fear can be blocked only by artifact creatures and/or black creatures.",
    rulesReference: 'Rule 702.36',
    icon: '😨',
  },
  intimidate: {
    term: 'Intimidate',
    short: 'Int',
    color: '#4b5563',
    reminderText: "This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.",
    fullText: "A creature with intimidate can be blocked only by artifact creatures and/or creatures that share a color with it.",
    rulesReference: 'Rule 702.13',
    icon: '😠',
  },
  
  // Blocking abilities
  reach: {
    term: 'Reach',
    short: 'Rch',
    color: '#22c55e',
    reminderText: 'This creature can block creatures with flying.',
    fullText: "Creatures with reach can block creatures with flying as well as creatures without flying.",
    rulesReference: 'Rule 702.17',
    icon: '🌲',
  },
  defender: {
    term: 'Defender',
    short: 'Def',
    color: '#78716c',
    reminderText: "This creature can't attack.",
    fullText: "Creatures with defender can't attack, but they can still block. Often found on high-toughness creatures.",
    rulesReference: 'Rule 702.3',
    icon: '🛡️',
  },
  
  // Combat damage abilities
  deathtouch: {
    term: 'Deathtouch',
    short: 'Dth',
    color: '#10b981',
    reminderText: 'Any amount of damage this deals to a creature is enough to destroy it.',
    fullText: "A creature with deathtouch needs to assign only 1 damage to another creature to destroy it, regardless of that creature's toughness.",
    rulesReference: 'Rule 702.2',
    icon: '☠️',
  },
  firststrike: {
    term: 'First Strike',
    short: '1st',
    color: '#ef4444',
    reminderText: 'This creature deals combat damage before creatures without first strike.',
    fullText: "Creatures with first strike deal combat damage during the first strike damage step, before creatures without first strike.",
    rulesReference: 'Rule 702.7',
    icon: '⚔️',
  },
  first_strike: {
    term: 'First Strike',
    short: '1st',
    color: '#ef4444',
    reminderText: 'This creature deals combat damage before creatures without first strike.',
    fullText: "Creatures with first strike deal combat damage during the first strike damage step, before creatures without first strike.",
    rulesReference: 'Rule 702.7',
    icon: '⚔️',
  },
  doublestrike: {
    term: 'Double Strike',
    short: '2x',
    color: '#dc2626',
    reminderText: 'This creature deals both first-strike and regular combat damage.',
    fullText: "Creatures with double strike deal combat damage twice: once during the first strike damage step and again during regular combat damage.",
    rulesReference: 'Rule 702.4',
    icon: '⚔️⚔️',
  },
  double_strike: {
    term: 'Double Strike',
    short: '2x',
    color: '#dc2626',
    reminderText: 'This creature deals both first-strike and regular combat damage.',
    fullText: "Creatures with double strike deal combat damage twice: once during the first strike damage step and again during regular combat damage.",
    rulesReference: 'Rule 702.4',
    icon: '⚔️⚔️',
  },
  lifelink: {
    term: 'Lifelink',
    short: 'Lnk',
    color: '#f0abfc',
    reminderText: 'Damage dealt by this creature also causes you to gain that much life.',
    fullText: "Whenever a source with lifelink deals damage, you gain that much life. Multiple instances of lifelink don't stack.",
    rulesReference: 'Rule 702.15',
    icon: '❤️',
  },
  trample: {
    term: 'Trample',
    short: 'Trm',
    color: '#34d399',
    reminderText: 'This creature can deal excess combat damage to the player or planeswalker it\'s attacking.',
    fullText: "If a creature with trample is blocked, you can assign excess damage beyond lethal to the defending player or planeswalker.",
    rulesReference: 'Rule 702.19',
    icon: '🦏',
  },
  vigilance: {
    term: 'Vigilance',
    short: 'Vig',
    color: '#fbbf24',
    reminderText: "Attacking doesn't cause this creature to tap.",
    fullText: "Attacking doesn't cause this creature to tap. It can attack and still be available to block.",
    rulesReference: 'Rule 702.20',
    icon: '👁️',
  },
  
  // Protection abilities
  hexproof: {
    term: 'Hexproof',
    short: 'Hex',
    color: '#3b82f6',
    reminderText: "This permanent can't be the target of spells or abilities your opponents control.",
    fullText: "Permanents with hexproof can't be targeted by spells or abilities your opponents control, but you can still target them.",
    rulesReference: 'Rule 702.11',
    icon: '🔮',
  },
  shroud: {
    term: 'Shroud',
    short: 'Shr',
    color: '#6366f1',
    reminderText: "This permanent can't be the target of spells or abilities.",
    fullText: "A permanent with shroud can't be the target of any spell or ability—including your own.",
    rulesReference: 'Rule 702.18',
    icon: '🌫️',
  },
  indestructible: {
    term: 'Indestructible',
    short: 'Ind',
    color: '#eab308',
    reminderText: "Damage and effects that say 'destroy' don't destroy this.",
    fullText: "Permanents with indestructible can't be destroyed by lethal damage or by effects that say 'destroy'. They can still be sacrificed or exiled.",
    rulesReference: 'Rule 702.12',
    icon: '💎',
  },
  ward: {
    term: 'Ward',
    short: 'Wrd',
    color: '#8b5cf6',
    reminderText: 'Whenever this permanent becomes the target of a spell or ability an opponent controls, counter it unless that player pays the ward cost.',
    rulesReference: 'Rule 702.21',
    icon: '🛡️',
  },
  protection: {
    term: 'Protection',
    short: 'Pro',
    color: '#fcd34d',
    reminderText: "This can't be damaged, enchanted, equipped, blocked, or targeted by anything it has protection from.",
    fullText: "Protection from [quality] means this can't be damaged, enchanted, equipped, fortified, or blocked by anything with that quality, and can't be targeted by spells or abilities with that quality.",
    rulesReference: 'Rule 702.16',
    icon: '✨',
  },
  
  // Speed abilities
  haste: {
    term: 'Haste',
    short: 'Hst',
    color: '#f97316',
    reminderText: 'This creature can attack and tap as soon as it comes under your control.',
    fullText: "Creatures with haste aren't affected by summoning sickness. They can attack and use tap abilities immediately.",
    rulesReference: 'Rule 702.10',
    icon: '⚡',
  },
  flash: {
    term: 'Flash',
    short: 'Flh',
    color: '#14b8a6',
    reminderText: 'You may cast this spell any time you could cast an instant.',
    fullText: "Flash allows you to cast spells at instant speed, including during opponents' turns and in response to other spells.",
    rulesReference: 'Rule 702.8',
    icon: '💫',
  },
  
  // Counter/recursion abilities
  persist: {
    term: 'Persist',
    short: 'Per',
    color: '#84cc16',
    reminderText: "When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield with a -1/-1 counter on it.",
    rulesReference: 'Rule 702.79',
    icon: '🔄',
  },
  undying: {
    term: 'Undying',
    short: 'Udy',
    color: '#22d3ee',
    reminderText: "When this creature dies, if it had no +1/+1 counters on it, return it to the battlefield with a +1/+1 counter on it.",
    rulesReference: 'Rule 702.93',
    icon: '💀',
  },
  
  // Damage modification
  wither: {
    term: 'Wither',
    short: 'Wth',
    color: '#65a30d',
    reminderText: 'This deals damage to creatures in the form of -1/-1 counters.',
    rulesReference: 'Rule 702.80',
    icon: '🥀',
  },
  infect: {
    term: 'Infect',
    short: 'Inf',
    color: '#4ade80',
    reminderText: 'This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.',
    fullText: "Damage from a source with infect is dealt to creatures as -1/-1 counters and to players as poison counters instead of dealing damage normally.",
    rulesReference: 'Rule 702.90',
    icon: '☣️',
  },
  
  // Triggered abilities
  prowess: {
    term: 'Prowess',
    short: 'Prw',
    color: '#f59e0b',
    reminderText: 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.',
    rulesReference: 'Rule 702.108',
    icon: '📖',
  },
  exalted: {
    term: 'Exalted',
    short: 'Exl',
    color: '#fcd34d',
    reminderText: 'Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.',
    rulesReference: 'Rule 702.83',
    icon: '👑',
  },
  
  // Landwalk abilities
  landwalk: {
    term: 'Landwalk',
    short: 'Lwk',
    color: '#a3e635',
    reminderText: "This creature can't be blocked as long as defending player controls a land of the specified type.",
    rulesReference: 'Rule 702.14',
    icon: '🗺️',
  },
  islandwalk: {
    term: 'Islandwalk',
    short: 'Isl',
    color: '#3b82f6',
    reminderText: "This creature can't be blocked as long as defending player controls an Island.",
    rulesReference: 'Rule 702.14',
    icon: '🏝️',
  },
  swampwalk: {
    term: 'Swampwalk',
    short: 'Swp',
    color: '#1f2937',
    reminderText: "This creature can't be blocked as long as defending player controls a Swamp.",
    rulesReference: 'Rule 702.14',
    icon: '🌑',
  },
  forestwalk: {
    term: 'Forestwalk',
    short: 'For',
    color: '#22c55e',
    reminderText: "This creature can't be blocked as long as defending player controls a Forest.",
    rulesReference: 'Rule 702.14',
    icon: '🌲',
  },
  mountainwalk: {
    term: 'Mountainwalk',
    short: 'Mtn',
    color: '#ef4444',
    reminderText: "This creature can't be blocked as long as defending player controls a Mountain.",
    rulesReference: 'Rule 702.14',
    icon: '⛰️',
  },
  plainswalk: {
    term: 'Plainswalk',
    short: 'Pln',
    color: '#fef3c7',
    reminderText: "This creature can't be blocked as long as defending player controls a Plains.",
    rulesReference: 'Rule 702.14',
    icon: '🌾',
  },
};

/**
 * Get keyword info by name (case-insensitive, handles variations)
 */
export function getKeywordInfo(keyword: string): KeywordInfo | undefined {
  // Normalize: lowercase, remove spaces/hyphens
  const normalized = keyword.toLowerCase().replace(/[\s-]/g, '');
  
  // Direct lookup
  if (KEYWORD_GLOSSARY[normalized]) {
    return KEYWORD_GLOSSARY[normalized];
  }
  
  // Try with underscores
  const underscored = keyword.toLowerCase().replace(/\s+/g, '_');
  if (KEYWORD_GLOSSARY[underscored]) {
    return KEYWORD_GLOSSARY[underscored];
  }
  
  // Search by term name
  for (const key in KEYWORD_GLOSSARY) {
    if (KEYWORD_GLOSSARY[key].term.toLowerCase() === keyword.toLowerCase()) {
      return KEYWORD_GLOSSARY[key];
    }
  }
  
  return undefined;
}

/**
 * Get reminder text for a keyword
 */
export function getKeywordReminderText(keyword: string): string | undefined {
  const info = getKeywordInfo(keyword);
  return info?.reminderText;
}

/**
 * Format keyword with reminder text (like on a card)
 */
export function formatKeywordWithReminder(keyword: string): string {
  const info = getKeywordInfo(keyword);
  if (info) {
    return `${info.term} (${info.reminderText})`;
  }
  return keyword;
}

/**
 * Build tooltip content for a keyword badge
 */
export function buildKeywordTooltip(keyword: string): { title: string; body: string; rules?: string } | undefined {
  const info = getKeywordInfo(keyword);
  if (!info) return undefined;
  
  return {
    title: info.term,
    body: info.reminderText,
    rules: info.rulesReference,
  };
}
