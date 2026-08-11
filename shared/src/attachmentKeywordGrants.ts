/**
 * Parse keyword grants from Equipment / Aura oracle text:
 * "Equipped creature has prowess", "Enchanted creature has hexproof and haste", etc.
 */

/** Keywords that attachments commonly grant (static + triggered). */
export const ATTACHMENT_GRANT_KEYWORDS: readonly string[] = [
  'flying', 'trample', 'lifelink', 'deathtouch', 'vigilance', 'haste',
  'first strike', 'double strike', 'hexproof', 'shroud', 'indestructible',
  'menace', 'reach', 'flash', 'defender', 'skulk', 'prowess',
  'islandwalk', 'forestwalk', 'mountainwalk', 'swampwalk', 'plainswalk',
  'fear', 'intimidate', 'shadow', 'horsemanship', 'flanking',
  'persist', 'undying', 'wither', 'infect', 'battle cry', 'exalted',
  'myriad', 'melee', 'ward', 'toxic', 'annihilator', 'afflict', 'training',
  'mentor', 'dethrone', 'evolve',
];

/** Multi-word keywords first so split/scan prefers them. */
const KEYWORDS_LONGEST_FIRST = [...ATTACHMENT_GRANT_KEYWORDS].sort((a, b) => b.length - a.length);

export function extractKeywordsFromGrantText(grantText: string): string[] {
  let remaining = String(grantText || '')
    .toLowerCase()
    // Drop quoted granted abilities / reminder text for keyword extraction.
    .replace(/"[^"]*"/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\buntil end of turn\b.*/g, ' ')
    .replace(/\bas long as\b.*/g, ' ')
    .replace(/\bif you control\b.*/g, ' ')
    .replace(/\bwhere x\b.*/g, ' ')
    .replace(/\bgets?\s*[+\-]?\d*\s*\/\s*[+\-]?\d*/g, ' ')
    .replace(/\bbase power and toughness\b.*/g, ' ')
    .replace(/\bward\s*\{[^}]+\}/g, 'ward')
    .replace(/\bannihilator\s+\d+/g, 'annihilator')
    .replace(/\bafflict\s+\d+/g, 'afflict')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const found: string[] = [];
  for (const keyword of KEYWORDS_LONGEST_FIRST) {
    const re = new RegExp(`(?:^|\\s)${keyword.replace(/\s+/g, '\\s+')}(?:\\s|$)`);
    if (re.test(remaining)) {
      found.push(keyword);
      remaining = remaining.replace(re, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  return found;
}

/**
 * Collect keyword grants from a single attachment oracle string.
 */
export function parseAttachmentGrantedKeywordsFromOracle(oracleText: string): string[] {
  const oracle = String(oracleText || '');
  const granted = new Set<string>();

  const patterns = [
    /(?:equipped|enchanted)\s+creature\s+has\s+([^.]+)/gi,
    /(?:equipped|enchanted)\s+creature\s+gains?\s+([^.]+)/gi,
    /(?:equipped|enchanted)\s+creature\s+gets?\s+[+\-]?\d*\s*\/\s*[+\-]?\d*\s+and\s+(?:has|gains?)\s+([^.]+)/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(oracle)) !== null) {
      for (const keyword of extractKeywordsFromGrantText(match[1] || '')) {
        granted.add(keyword);
      }
    }
  }

  return [...granted];
}

export function attachmentOracleGrantsKeyword(oracleText: string, keyword: string): boolean {
  const wanted = String(keyword || '').toLowerCase().trim();
  if (!wanted) return false;
  return parseAttachmentGrantedKeywordsFromOracle(oracleText).includes(wanted);
}

/** Attached Equipment and Auras on a host permanent (by attachedEquipment ids or attachedTo). */
export function iterAttachments(permanent: any, battlefield: any[]): any[] {
  const out: any[] = [];
  const seen = new Set<string>();
  const bf = Array.isArray(battlefield) ? battlefield : [];

  const attachedEquipment = Array.isArray(permanent?.attachedEquipment) ? permanent.attachedEquipment : [];
  for (const equipId of attachedEquipment) {
    const id = String(equipId || '');
    if (!id || seen.has(id)) continue;
    const equipment = bf.find((p: any) => String(p?.id || '') === id);
    if (equipment) {
      seen.add(id);
      out.push(equipment);
    }
  }

  const permanentId = String(permanent?.id || '');
  if (permanentId) {
    for (const attachment of bf) {
      if (!attachment?.card) continue;
      const id = String(attachment.id || '');
      if (!id || seen.has(id)) continue;
      if (String(attachment.attachedTo || '') !== permanentId) continue;
      const typeLine = String(attachment.card.type_line || '').toLowerCase();
      if (!typeLine.includes('equipment') && !typeLine.includes('aura')) continue;
      seen.add(id);
      out.push(attachment);
    }
  }

  return out;
}

/** Keywords granted to a permanent by attached Equipment/Auras. */
export function getAttachmentGrantedKeywords(permanent: any, battlefield: any[]): string[] {
  const granted = new Set<string>();
  for (const attachment of iterAttachments(permanent, battlefield)) {
    for (const keyword of parseAttachmentGrantedKeywordsFromOracle(attachment?.card?.oracle_text || '')) {
      granted.add(keyword);
    }
  }
  return [...granted];
}

export function permanentHasAttachmentGrantedKeyword(
  permanent: any,
  battlefield: any[],
  keyword: string,
): boolean {
  const wanted = String(keyword || '').toLowerCase().trim();
  if (!wanted) return false;
  return getAttachmentGrantedKeywords(permanent, battlefield).includes(wanted);
}

/**
 * True when any permanent controlled by `controllerId` grants the keyword
 * to creatures you control (lord / anthem style).
 */
export function controllerGrantsKeywordToCreatures(
  battlefield: any[],
  controllerId: string,
  keyword: string,
): boolean {
  const wanted = String(keyword || '').toLowerCase().trim();
  if (!wanted) return false;
  const ctrl = String(controllerId || '');
  for (const perm of Array.isArray(battlefield) ? battlefield : []) {
    if (!perm?.card || String(perm.controller || '') !== ctrl) continue;
    const oracle = String(perm.card.oracle_text || '').toLowerCase();
    // "Creatures you control have prowess" / "Other creatures you control have haste"
    const re = new RegExp(
      String.raw`(?:other\s+)?(?:[\w]+\s+)?creatures you control (?:get [+\-]?\d+\s*\/\s*[+\-]?\d+\s+and\s+)?have (?:[\w\s,]+?\s+and\s+)?${wanted.replace(/\s+/g, '\\s+')}`,
      'i',
    );
    if (re.test(oracle)) return true;
  }
  return false;
}
