const ORACLE_KEYWORDS = [
  'absorb', 'affinity', 'afflict', 'afterlife', 'aftermath', 'amplify', 'annihilator',
  'backup', 'banding', 'bargain', 'battalion', 'battle cry', 'bestow', 'blitz', 'bloodthirst',
  'bushido', 'buyback', 'cascade', 'casualty', 'celebration', 'champion', 'changeling',
  'cipher', 'cleave', 'companion', 'compleated', 'conjure', 'connive', 'conspire', 'convoke',
  'corrupted', 'crew', 'cumulative upkeep', 'cycling', 'dash', 'daybound', 'deathtouch',
  'decayed', 'defender', 'delve', 'demonstrate', 'descend', 'detain', 'devotion', 'devour',
  'discover', 'disguise', 'disappear', 'disturb', 'domain', 'double strike', 'dredge', 'echo', 'embalm',
  'emerge', 'enchant', 'encore', 'enlist', 'enrage', 'entwine', 'equip', 'escalate', 'escape',
  'eternalize', 'evoke', 'evolve', 'exalted', 'exploit', 'explore', 'extort', 'fabricate',
  'fading', 'fear', 'ferocious', 'fight', 'first strike', 'flanking', 'flash', 'flashback',
  'flying', 'for mirrodin!', 'forecast', 'foretell', 'formidable', 'friends forever', 'fuse',
  'goad', 'graft', 'gravestorm', 'haste', 'haunt', 'hellbent', 'heroic', 'hexproof',
  'hideaway', 'horsemanship', 'imprint', 'improvise', 'incubate', 'indestructible', 'infect',
  'inspired', 'intimidate', 'investigate', 'islandwalk', 'jump-start', 'kicker', 'kinship',
  'landfall', 'landwalk', 'learn', 'level up', 'lifelink', 'living weapon', 'madness',
  'magecraft', 'manifest', 'megamorph', 'meld', 'menace', 'mentor', 'metalcraft', 'mill',
  'miracle', 'modular', 'monstrosity', 'morbid', 'morph', 'mountainwalk', 'mutate', 'ninjutsu',
  'nightbound', 'offering', 'offspring', 'outlast', 'overload', 'partner', 'partner with',
  'persist', 'phasing', 'plainswalk', 'plot', 'populate', 'proliferate', 'protection',
  'provoke', 'prowess', 'prowl', 'radiance', 'raid', 'rally', 'rampage', 'reach', 'rebound',
  'reconfigure', 'recover', 'reinforce', 'renown', 'replicate', 'retrace', 'revolt', 'riot',
  'ripple', 'saddle', 'scavenge', 'scry', 'shadow', 'shroud', 'skulk', 'soulbond', 'soulshift',
  'spectacle', 'sneak', 'splice', 'split second', 'spree', 'squad', 'storm', 'strive', 'sunburst',
  'support', 'surge', 'surveil', 'suspend', 'swampcycling', 'swampwalk', 'threshold', 'totem armor',
  'trample', 'training', 'transfigure', 'transform', 'transmute', 'treasure', 'tribute', 'undaunted',
  'undergrowth', 'undying', 'unearth', 'unleash', 'vanishing', 'vigilance', 'ward', 'wither',
] as const;

export function isManaProducingAbility(effectText: string): boolean {
  const text = effectText.toLowerCase();

  if (/add\s+\{/.test(text)) return true;
  if (/add\s+(one|two|three)?\s*mana/.test(text)) return true;
  if (/mana of any (type|color)/.test(text)) return true;

  return false;
}

export function hasTargeting(effectText: string): boolean {
  return /\btarget\b/i.test(effectText);
}

export function parseTargets(effectText: string): string[] {
  const targets: string[] = [];
  const text = effectText.toLowerCase();

  const patterns = [
    { pattern: /target\s+creature/, type: 'creature' },
    { pattern: /target\s+player/, type: 'player' },
    { pattern: /target\s+opponent/, type: 'opponent' },
    { pattern: /target\s+permanent/, type: 'permanent' },
    { pattern: /target\s+artifact/, type: 'artifact' },
    { pattern: /target\s+enchantment/, type: 'enchantment' },
    { pattern: /target\s+planeswalker/, type: 'planeswalker' },
    { pattern: /target\s+land/, type: 'land' },
    { pattern: /target\s+spell/, type: 'spell' },
    { pattern: /any\s+target/, type: 'any' },
  ] as const;

  for (const { pattern, type } of patterns) {
    if (pattern.test(text)) {
      targets.push(type);
    }
  }

  return targets;
}

export function parseKeywordsFromOracleText(oracleText: string): string[] {
  const keywords: string[] = [];
  const text = oracleText.toLowerCase();

  for (const keyword of ORACLE_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(text)) {
      keywords.push(keyword);
    }
  }

  return keywords;
}
