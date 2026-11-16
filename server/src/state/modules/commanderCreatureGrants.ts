// Granted "commander creatures you own get +N/+N and have ..." buffs
// (Cultist of the Absolute). Quoted upkeep text is already copied onto the
// commander by grantedOracleTriggerScan; this module applies the power,
// toughness, and keyword half of that same sentence.
// Public: applyCommanderCreatureGrantPT, commanderCreatureGrantHasKeyword.

const GRANT_RE = /commander creatures you own get \+(\d+)\/\+(\d+) and have ([^\n.]+)/gi;

const KEYWORD_PHRASES = [
  'double strike',
  'first strike',
  'deathtouch',
  'flying',
  'trample',
  'lifelink',
  'vigilance',
  'haste',
  'hexproof',
  'indestructible',
  'menace',
  'reach',
];

function normalize(text: unknown): string {
  return String(text || '').replace(/[\u201C\u201D]/g, '"').replace(/[\u2014\u2013]/g, '-');
}

function isCommanderCreature(permanent: any, state: any): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return false;
  if (permanent?.isCommander === true || permanent?.commander === true || permanent?.card?.isCommander === true || permanent?.card?.commander === true) {
    return true;
  }
  const owner = String(permanent?.owner || permanent?.card?.owner || '');
  const info = state?.commandZone?.[owner];
  if (!info) return false;
  const cardName = String(permanent?.card?.name || '').trim().toLowerCase();
  const names: string[] = Array.isArray(info.commanderNames) ? info.commanderNames.map((v: unknown) => String(v || '').trim().toLowerCase()) : [];
  return Boolean(cardName && names.includes(cardName));
}

function keywordsIn(clause: string): string[] {
  const bare = clause.replace(/"[^"]*"/g, ' ').toLowerCase();
  return KEYWORD_PHRASES.filter((keyword) => new RegExp(`\\b${keyword}\\b`, 'i').test(bare));
}

function grantsFor(state: any): Array<{ controller: string; power: number; toughness: number; keywords: string[] }> {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const grants: Array<{ controller: string; power: number; toughness: number; keywords: string[] }> = [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.phasedOut === true) continue;
    const oracle = normalize(permanent.card?.oracle_text || permanent.oracle_text);
    GRANT_RE.lastIndex = 0;
    for (const match of oracle.matchAll(GRANT_RE)) {
      grants.push({
        controller: String(permanent.controller || ''),
        power: Math.max(0, Math.floor(Number(match[1] || 0))),
        toughness: Math.max(0, Math.floor(Number(match[2] || 0))),
        keywords: keywordsIn(String(match[3] || '')),
      });
    }
  }
  return grants;
}

function matchingGrants(permanent: any, state: any) {
  if (!isCommanderCreature(permanent, state)) return [];
  const owner = String(permanent?.owner || permanent?.card?.owner || '');
  return grantsFor(state).filter((grant) => grant.controller && grant.controller === owner);
}

export function applyCommanderCreatureGrantPT(
  permanent: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  let nextPower = power;
  let nextToughness = toughness;
  for (const grant of matchingGrants(permanent, state)) {
    nextPower += grant.power;
    nextToughness += grant.toughness;
  }
  return { power: nextPower, toughness: nextToughness };
}

export function commanderCreatureGrantHasKeyword(permanent: any, state: any, keyword: string): boolean {
  const needle = String(keyword || '').trim().toLowerCase();
  if (!needle) return false;
  return matchingGrants(permanent, state).some((grant) => grant.keywords.includes(needle));
}
