// server/src/state/modules/batch100CombatAndKeywords.ts
// B100 combat, type, land, and keyword helpers used by static parse and live
// hooks. Public: parsers plus graveyardHasLessonCard, annihilatorValue,
// opponentsCantPlayLandCardsFromGraveyards, stampBatch100CreatureTypeLoss,
// permanentLosesCreatureTypeNow, landCardsInGraveyardsAreUntargetableByOpponent,
// battlefieldLandIsUntargetableByOpponent.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function oracleOf(perm: any): string {
  return normalize(perm?.card?.oracle_text || perm?.oracle_text || '');
}

function typeLineOf(entry: any): string {
  return String(entry?.card?.type_line || entry?.type_line || entry?.typeLine || '').toLowerCase();
}

const STASIS_RE = /players skip their untap steps/i;
const TOMIK_RE = /lands on the battlefield and land cards in graveyards can't be the targets of spells or abilities your opponents control/i;
const TOMIK_PLAY_RE = /your opponents can't play land cards from graveyards/i;
const ARVINOX_RE = /isn'?t a creature unless you control (\w+|\d+) or more permanents you don'?t own/i;
const LESSON_DEFENDER_RE = /as long as there(?: is|'s) a lesson card in your graveyard, (?:this creature|~|it) can attack as though it didn'?t have defender/i;
const SULU_RE = /stations spacecraft and crews vehicles as though (?:his|her|its|their) power were tripled/i;
const TAPESTRY_RE = /each creature you control with toughness greater than its power stations permanents using its toughness rather than its power/i;
const HASTE_ACTIVATE_RE = /you may activate abilities of creatures you control as though those creatures had haste/i;
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function wordOrNumber(raw: string): number {
  const key = String(raw || '').toLowerCase();
  if (WORDS[key] != null) return WORDS[key];
  const n = parseInt(key, 10);
  return Number.isFinite(n) ? n : 0;
}

export function parsePlayersSkipUntapSteps(oracle: string): boolean {
  return STASIS_RE.test(normalize(oracle));
}

export function parseTomikLandProtection(oracle: string): boolean {
  const text = normalize(oracle);
  return TOMIK_RE.test(text) || TOMIK_PLAY_RE.test(text);
}

export function parseMoreLandsThanAttackingPlayerToBlock(oracle: string): boolean {
  return /can't block unless you control more lands than attacking player/i.test(normalize(oracle));
}

export function parseAnnihilatorXFromCounters(oracle: string): boolean {
  const text = normalize(oracle).toLowerCase();
  return /\bannihilator\s+x\b/.test(text) && /number of \+1\/\+1 counters on (?:it|this creature|~)/.test(text);
}

export function parseActivateAsThoughHasteOther(oracle: string): boolean {
  return /you may activate abilities of other creatures you control as though those creatures had haste/i.test(normalize(oracle));
}

export function parseIsntCreatureUnlessDontOwn(oracle: string): { amount: number } | null {
  const text = normalize(oracle).replace(/\u2014/g, '-');
  const m = text.match(ARVINOX_RE);
  if (!m) return null;
  const amount = wordOrNumber(m[1]);
  return amount > 0 ? { amount } : null;
}

export function parseLessonGraveyardNoDefender(oracle: string): boolean {
  return LESSON_DEFENDER_RE.test(normalize(oracle));
}

export function parseStationCrewPowerTripled(oracle: string): boolean {
  return SULU_RE.test(normalize(oracle));
}

export function parseStationWithToughnessWhenGreater(oracle: string): boolean {
  return TAPESTRY_RE.test(normalize(oracle));
}

export function parseActivateAsThoughHaste(oracle: string): boolean {
  const text = normalize(oracle);
  return HASTE_ACTIVATE_RE.test(text) || parseActivateAsThoughHasteOther(text);
}

export function graveyardHasLessonCard(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  const piles: any[] = [];
  if (Array.isArray(zones[pid]?.graveyard)) piles.push(...zones[pid].graveyard);
  if (Array.isArray(state?.graveyards?.[pid])) piles.push(...state.graveyards[pid]);
  return piles.some((card) => /\blesson\b/.test(typeLineOf(card)));
}

export function plusOnePlusOneCounterCount(permanent: any): number {
  const counters = (permanent?.counters && typeof permanent.counters === 'object') ? permanent.counters : {};
  const aliases = ['+1/+1', 'p1p1', 'plus1plus1', 'plusOnePlusOne'];
  let total = 0;
  for (const key of aliases) total += Number(counters[key] || 0);
  return Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
}

export function annihilatorValue(permanent: any, keyword?: { value?: number }): number {
  const given = Number(keyword?.value);
  if (Number.isFinite(given) && given > 0) return Math.floor(given);
  const text = oracleOf(permanent).toLowerCase();
  if (/\bannihilator\s+x\b/.test(text) && /number of \+1\/\+1 counters on (?:it|this creature|~)/.test(text)) {
    return Math.max(0, plusOnePlusOneCounterCount(permanent));
  }
  return 1;
}

export function countPermanentsYouDontOwn(state: any, controllerId: string): number {
  const ctrl = String(controllerId || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.filter((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== ctrl) return false;
    const owner = String(perm.owner || perm.ownerId || '');
    return !!owner && owner !== ctrl;
  }).length;
}

export const BATCH100_NOT_A_CREATURE_FIELD = 'batch100NotACreature';

export function stampBatch100CreatureTypeLoss(state: any): void {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const parsed = parseIsntCreatureUnlessDontOwn(oracleOf(perm));
    if (!parsed) {
      if (perm[BATCH100_NOT_A_CREATURE_FIELD] != null) delete perm[BATCH100_NOT_A_CREATURE_FIELD];
      continue;
    }
    const enough = countPermanentsYouDontOwn(state, String(perm.controller || '')) >= parsed.amount;
    perm[BATCH100_NOT_A_CREATURE_FIELD] = !enough;
  }
}

export function permanentLosesCreatureTypeNow(permanent: any): boolean {
  return permanent?.[BATCH100_NOT_A_CREATURE_FIELD] === true;
}

export function opponentsCantPlayLandCardsFromGraveyards(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') === pid) return false;
    return TOMIK_PLAY_RE.test(oracleOf(perm));
  });
}

function tomikSourcesControlledBy(state: any, controllerId: string): boolean {
  const ctrl = String(controllerId || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm) => String(perm?.controller || '') === ctrl && !perm?.phasedOut && TOMIK_RE.test(oracleOf(perm)));
}

export function landCardsInGraveyardsAreUntargetableByOpponent(state: any, targetingPlayerId?: string): boolean {
  const pid = String(targetingPlayerId || '');
  if (!pid) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') === pid) return false;
    return TOMIK_RE.test(oracleOf(perm));
  });
}

export function battlefieldLandIsUntargetableByOpponent(state: any, targetingPlayerId: string, permanent: any): boolean {
  if (!/\bland\b/.test(typeLineOf(permanent))) return false;
  return landCardsInGraveyardsAreUntargetableByOpponent(state, targetingPlayerId);
}

export function isLandCard(entry: any): boolean {
  return /\bland\b/.test(typeLineOf(entry));
}

export { tomikSourcesControlledBy };
