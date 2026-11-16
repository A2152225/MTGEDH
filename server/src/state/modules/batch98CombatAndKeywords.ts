// server/src/state/modules/batch98CombatAndKeywords.ts
// B98 helpers for combat requirements, face-up locks, imprint keywords,
// soulshift X, saddle/type grants, and madness cost parts.
// Public: parse/test helpers used by live hooks and batch98 tests.
import { batch105OpponentSourceForcesAllToAttack } from './batch105Apply.js';
import { batch106CreatureMustAttackIfAble } from './batch106Apply.js';
import { batch107CreatureMustAttackIfAble } from './batch107Apply.js';

export function normalizeB98Oracle(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export function oracleOf(perm: any): string {
  return normalizeB98Oracle(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

/** "If a creature you control attacks, this creature also attacks if able." (Ekundu Cyclops) */
export function parseAlsoAttacksIfAble(oracle: string): boolean {
  return /if a creature you control attacks, (?:this creature|~|it) also attacks if able/i.test(normalizeB98Oracle(oracle));
}

export function permanentMustAttackIfAnotherYouControlAttacks(perm: any, battlefield?: any[]): boolean {
  if (parseAlsoAttacksIfAble(oracleOf(perm))) return true;
  if (Array.isArray(battlefield) && batch105OpponentSourceForcesAllToAttack(perm, battlefield)) return true;
  if (Array.isArray(battlefield) && batch106CreatureMustAttackIfAble(perm, { battlefield })) return true;
  return false;
}

/** "Permanents your opponents control can't be turned face up during your turn." */
export function parseOpponentsCantTurnFaceUpOnYourTurn(oracle: string): boolean {
  return /permanents your opponents control can't be turned face up during your turn/i.test(normalizeB98Oracle(oracle));
}

export function faceUpBlockedByOpponentsLock(state: any, actingPlayerId: string): { blocked: boolean; byName?: string } {
  const turnPlayer = String(state?.activePlayer || state?.turnPlayer || state?.currentPlayer || '');
  if (!turnPlayer || String(actingPlayerId) === turnPlayer) return { blocked: false };
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of bf) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== turnPlayer) continue;
    if (parseOpponentsCantTurnFaceUpOnYourTurn(oracleOf(perm))) {
      return { blocked: true, byName: String(perm.card?.name || 'a permanent') };
    }
  }
  return { blocked: false };
}

const IMPRINT_KEYWORD_RE = /as long as a card exiled with (?:this creature|~|it) has flying, (?:this creature|~|it) has flying\. the same is true for ([^.]+)\./i;

export const IMPRINT_BASE_KEYWORDS = ['flying'] as const;

export function parseImprintExiledKeywordList(oracle: string): string[] {
  const text = normalizeB98Oracle(oracle).toLowerCase();
  const m = text.match(IMPRINT_KEYWORD_RE);
  if (!m) {
    if (/as long as a card exiled with (?:this creature|~|it) has flying/i.test(text)) return ['flying'];
    return [];
  }
  const rest = String(m[1] || '');
  const names = rest.split(/,| and /i).map((p) => p.trim()).filter(Boolean);
  return ['flying', ...names];
}

export function cardsExiledWithPermanent(perm: any, state?: any): any[] {
  const direct = perm?.imprintedCards || perm?.exiledWith || perm?.linkedExiledCards;
  if (Array.isArray(direct) && direct.length) return direct;
  const id = String(perm?.id || '');
  if (!id || !state) return [];
  const out: any[] = [];
  const players = Array.isArray(state.players) ? state.players : [];
  for (const p of players) {
    const exile = Array.isArray(p?.exile) ? p.exile : [];
    for (const card of exile) {
      const linked = String(card?.exiledBy || card?.imprintedBy || card?.linkedPermanentId || '');
      if (linked && linked === id) out.push(card);
    }
  }
  const zones = state?.zones;
  if (zones && typeof zones === 'object') {
    for (const z of Object.values(zones) as any[]) {
      const exile = Array.isArray(z?.exile) ? z.exile : [];
      for (const card of exile) {
        const linked = String(card?.exiledBy || card?.imprintedBy || card?.linkedPermanentId || '');
        if (linked && linked === id) out.push(card);
      }
    }
  }
  return out;
}

function escapeRegExpWord(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cardHasKeywordOrProtection(card: any, keyword: string): boolean {
  const kw = String(keyword || '').toLowerCase();
  const oracle = String(card?.oracle_text || card?.card?.oracle_text || '');
  const kws = Array.isArray(card?.keywords) ? card.keywords : (Array.isArray(card?.card?.keywords) ? card.card.keywords : []);
  if (kws.some((k: any) => String(k).toLowerCase() === kw || String(k).toLowerCase().startsWith(kw + ' '))) return true;
  if (kw === 'landwalk') return /\b(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk|landwalk)\b/i.test(oracle) || kws.some((k: any) => /walk/i.test(String(k)));
  if (kw === 'protection') return /\bprotection from\b/i.test(oracle) || kws.some((k: any) => String(k).toLowerCase().startsWith('protection'));
  const re = new RegExp('\\b' + escapeRegExpWord(kw) + '\\b', 'i');
  return re.test(oracle.split('\n')[0] || oracle);
}

export function imprintExiledGrantsKeyword(perm: any, keyword: string, state?: any): boolean {
  const list = parseImprintExiledKeywordList(oracleOf(perm));
  const kw = String(keyword || '').toLowerCase();
  if (!list.some((k) => k.toLowerCase() === kw || (kw.startsWith('protection') && k.toLowerCase() === 'protection'))) return false;
  return cardsExiledWithPermanent(perm, state).some((card) => cardHasKeywordOrProtection(card, kw === 'protection' || kw.startsWith('protection') ? 'protection' : kw));
}

/** Soulshift X, where X is the number of <type> you control. */
export function parseSoulshiftXCount(oracle: string): { type: string } | null {
  const m = normalizeB98Oracle(oracle).match(/has soulshift x, where x is the number of ([a-z][a-z']*)s? you control/i);
  if (!m) return null;
  return { type: String(m[1] || '').replace(/s$/i, '') };
}

export function countControlledType(state: any, playerId: string, typeWord: string): number {
  const wanted = String(typeWord || '').toLowerCase();
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let n = 0;
  for (const perm of bf) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== String(playerId)) continue;
    const tl = String(perm.card?.type_line || perm.type_line || '').toLowerCase();
    if (new RegExp('\\b' + escapeRegExpWord(wanted) + '\\b').test(tl)) n += 1;
  }
  return n;
}

export function getSoulshiftValueForPermanent(perm: any, state?: any): number | null {
  const oracle = oracleOf(perm);
  const dyn = parseSoulshiftXCount(oracle);
  if (dyn) return countControlledType(state, String(perm?.controller || ''), dyn.type);
  const m = oracle.match(/\bsoulshift\s+(\d+)\b/i);
  if (m) return Number(m[1]);
  return null;
}

export function parseAdditionalTypesAndSaddle(oracle: string): { types: string[]; saddle: number } | null {
  const text = normalizeB98Oracle(oracle);
  const m = text.match(/each ((?:[a-z][a-z']*(?:, |, and | and )?){2,}) creature you control is an? ([a-z]+) in addition to its other types and has saddle (\d+)/i);
  if (!m) return null;
  const types = String(m[1] || '').split(/,| and /i).map((p) => p.trim()).filter(Boolean);
  const added = String(m[2] || '').trim();
  const saddle = Number(m[3]);
  if (!types.length || !added || !Number.isFinite(saddle)) return null;
  return { types, saddle };
}

export function permanentGainsSaddleFromTypeGrant(perm: any, state: any): number | null {
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const controller = String(perm?.controller || '');
  const tl = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  if (!/\bcreature\b/.test(tl)) return null;
  for (const source of bf) {
    if (!source || source.phasedOut === true) continue;
    if (String(source.controller || '') !== controller) continue;
    const parsed = parseAdditionalTypesAndSaddle(oracleOf(source));
    if (!parsed) continue;
    if (parsed.types.some((t) => new RegExp('\\b' + escapeRegExpWord(t.toLowerCase()) + '\\b').test(tl))) {
      return parsed.saddle;
    }
  }
  return null;
}

export interface MadnessCostParts {
  mana: string;
  life: number;
}

/** Madness—{mana}, Pay N life. Mana-only forms still return life: 0. */
export function parseMadnessCostParts(oracleText: string): MadnessCostParts | null {
  const text = normalizeB98Oracle(oracleText);
  const m = text.match(/madness\s*(?:[\u2014\u2013-]\s*|\s+)((?:\{[^}]+\})+)(?:\s*,\s*pay (\d+) life)?/i);
  if (!m) return null;
  return {
    mana: String(m[1] || '').replace(/\s+/g, '').trim(),
    life: m[2] ? Number(m[2]) : 0,
  };
}

export function parseLandsWithChosenNameHaveAbility(oracle: string): string | null {
  const m = normalizeB98Oracle(oracle).match(/lands with the chosen name have "([^"]+)"/i);
  return m ? String(m[1] || '').trim() : null;
}

export function quotedAbilityForChosenNameLand(perm: any, state: any): string | null {
  const name = String(perm?.card?.name || perm?.name || '').trim();
  const tl = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
  if (!name || (tl && !/\bland\b/.test(tl))) return null;
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const norm = name.toLowerCase();
  for (const source of bf) {
    if (!source || source.phasedOut === true) continue;
    const quoted = parseLandsWithChosenNameHaveAbility(oracleOf(source));
    if (!quoted) continue;
    const chosen = String(source.chosenCardName || source.chosenName || '').trim().toLowerCase();
    if (chosen && chosen === norm) return quoted;
  }
  return null;
}

export function parseTransformEmblemGrant(oracle: string): { face: string; text: string } | null {
  const text = normalizeB98Oracle(oracle);
  const m = text.match(/as (?:this creature|~) transforms into (.+?), you get an emblem with "([^"]+)"/i);
  if (!m) return null;
  return { face: String(m[1] || '').trim(), text: String(m[2] || '').trim() };
}

export function opponentsLifeLostThisTurn(state: any, playerId: string): number {
  const lost = state?.lifeLostThisTurn || {};
  const players: any[] = Array.isArray(state?.players) ? state.players : [];
  let total = 0;
  for (const p of players) {
    const id = String(p?.id || '');
    if (!id || id === String(playerId)) continue;
    if (p?.eliminated || p?.lost || p?.leftGame) continue;
    total += Number(lost[id] || 0) || 0;
  }
  return total;
}

export function parseFromHandMvLeqLifeLostCascade(oracle: string): boolean {
  return /during your turn, spells you cast from your hand with mana value x or less have cascade, where x is the total amount of life your opponents have lost this turn/i.test(normalizeB98Oracle(oracle));
}

export function cardManaValue(card: any): number {
  const raw = card?.mana_value ?? card?.cmc ?? card?.manaValue ?? card?.card?.mana_value ?? card?.card?.cmc;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, raw);
  return 0;
}

export function grantsCascadeFromHandByOpponentsLifeLost(state: any, playerId: string, card: any): boolean {
  const turnPlayer = String(state?.activePlayer || state?.turnPlayer || state?.currentPlayer || '');
  if (turnPlayer && turnPlayer !== String(playerId)) return false;
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (!bf.some((p) => p && String(p.controller || '') === String(playerId) && parseFromHandMvLeqLifeLostCascade(oracleOf(p)))) return false;
  return cardManaValue(card) <= opponentsLifeLostThisTurn(state, playerId);
}


export function parseOgreSingleSourceLethal(oracle: string): boolean {
  return /can't be destroyed by lethal damage unless lethal damage dealt by a single source is marked on it/i.test(normalizeB98Oracle(oracle));
}

/** True when Ogre Enforcer-style text applies and no single source has marked lethal. */
export function shouldSkipLethalDestroyUnlessSingleSource(perm: any, toughness: number): boolean {
  if (!parseOgreSingleSourceLethal(oracleOf(perm))) return false;
  const lethal = Number(toughness) || 0;
  if (lethal <= 0) return false;
  const bySource = perm?.markedDamageBySource || perm?.damageBySource;
  if (bySource && typeof bySource === 'object') {
    return !Object.values(bySource).some((n) => Number(n) >= lethal);
  }
  const ids = Array.isArray(perm?.damageSourceIds) ? perm.damageSourceIds.filter((id: unknown) => String(id || '').trim()) : [];
  // A single recorded source accounts for all marked damage. Otherwise we cannot prove lethal from one source.
  return ids.length !== 1;
}

export function recordMarkedDamageFromSource(perm: any, sourceId: string, amount: number): void {
  if (!perm || !amount) return;
  const id = String(sourceId || 'unknown');
  const cur = (perm.markedDamageBySource && typeof perm.markedDamageBySource === 'object') ? perm.markedDamageBySource : {};
  cur[id] = (Number(cur[id]) || 0) + Number(amount);
  perm.markedDamageBySource = cur;
}
