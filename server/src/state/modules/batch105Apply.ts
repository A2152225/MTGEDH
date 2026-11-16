// server/src/state/modules/batch105Apply.ts
// B105 live apply hooks: types, P/T, combat, ward/haste, enter-as, locks, umbra, monarch.

import { applyBatch104PowerToughnessAdjustment } from './batch104Apply.js';
import { grantedEquipmentOracleText } from './batch97GrantedEquipmentAbilities.js';
import { typeEnteredUnderControlThisTurn } from '../../socket/combat-handlers/combatDefenderAttackPermission.js';
import { batch105MonarchControllerForEnchanted } from '../../../../rules-engine/src/batch105MonarchControl.js';
export { batch105MonarchControllerForEnchanted } from '../../../../rules-engine/src/batch105MonarchControl.js';
import {
  parseAreEquipmentInAdditionAndHaveQuoted,
  parseOpponentCreaturesAllAttackIfAble,
  parseAsHistoricPermanentYouControlEntersBecomes,
  parseGetsPTAndKeywordWhenLifeGreaterThanStarting,
  parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting,
  parseHasHasteAndWardAsLongAsCast,
  parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou,
  parseCantBeBlockedIfTypeEnteredThisTurn,
  parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono,
  parseCreaturesAttackingYourOpponentsHaveDoubleStrike,
  parseCreaturesLoseAllAbilities,
  parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl,
  parseCreaturesCantBlock,
  parseGetsPTForEachColorPermanentOpponentsControlWithThreshold,
  parseDuringCombatCantCastInstantsOrActivateNonMana,
  parseOpponentWhoControlsMoreTypeCantCastOrPlay,
  parseAurasAttachedToPermanentsYouControlHaveUmbraArmor,
} from './batch105Parsers.js';

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function isCreature(perm: any): boolean {
  return /\bcreature\b/.test(typeLineOf(perm));
}

function lifeOf(state: any, playerId: string): number | undefined {
  const v = state?.life?.[playerId];
  if (Number.isFinite(Number(v))) return Number(v);
  const pl = (Array.isArray(state?.players) ? state.players : []).find((x: any) => String(x?.id) === playerId);
  return Number.isFinite(Number(pl?.life)) ? Number(pl.life) : undefined;
}

function startingLifeOf(state: any): number {
  const n = Number(state?.startingLife);
  return Number.isFinite(n) && n > 0 ? n : 40;
}

function graveyardOf(state: any, playerId: string): any[] {
  const zones = state?.zones?.[playerId]?.graveyard;
  if (Array.isArray(zones)) return zones;
  const pl = (Array.isArray(state?.players) ? state.players : []).find((x: any) => String(x?.id) === playerId);
  if (Array.isArray(pl?.graveyard)) return pl.graveyard;
  return [];
}

export function wasCastEntry(cardOrPerm: any, extra?: { wasCast?: boolean; enteredFromCast?: boolean }): boolean {
  if (extra?.wasCast === true || extra?.enteredFromCast === true) return true;
  if (cardOrPerm?.enteredFromCast === true || cardOrPerm?.wasCast === true) return true;
  if (cardOrPerm?.card?.enteredFromCast === true || cardOrPerm?.card?.wasCast === true) return true;
  const from = String(cardOrPerm?.enteredFromZone || cardOrPerm?.card?.enteredFromZone || extra && (extra as any).enteredFromZone || '').toLowerCase();
  return from === 'stack';
}

const CARD_TYPES = new Set([
  'artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land',
  'planeswalker', 'sorcery', 'tribal', 'legendary', 'basic', 'snow', 'world', 'token',
]);

function isHistoricCard(card: any): boolean {
  const tl = String(card?.type_line || card?.typeLine || '').toLowerCase();
  return /\blegendary\b/.test(tl) || /\bartifact\b/.test(tl) || /\bsaga\b/.test(tl);
}

function addTypesInAddition(typeLine: string, additions: string[]): string {
  const raw = String(typeLine || '').trim();
  const parts = raw.split(/[—–]/);
  const leftParts = String(parts[0] || '').split(/\s+/).filter(Boolean);
  const rightParts = parts.length > 1 ? parts.slice(1).join(' ').split(/\s+/).filter(Boolean) : [];
  for (const typ of additions) {
    const word = String(typ || '').trim();
    if (!word) continue;
    const isCardType = CARD_TYPES.has(word.toLowerCase());
    const bucket = isCardType ? leftParts : rightParts;
    if (!bucket.some((p) => p.toLowerCase() === word.toLowerCase())) bucket.push(word);
  }
  return rightParts.length ? `${leftParts.join(' ')} — ${rightParts.join(' ')}` : leftParts.join(' ');
}

/** Layer 4: non-X artifacts (etc.) granted Equipment by Dan Lewis-family text. */
export function batch105AdditionalTypes(perm: any, state: any): string[] {
  if (!perm) return [];
  if (/\bequipment\b/.test(typeLineOf(perm))) return [];
  if (state && grantedEquipmentOracleText(perm, state)) return ['Equipment'];
  return [];
}

/**
 * As-enters replacement: a historic permanent you control becomes an N/N TYPE creature
 * in addition to its other types. Returns a cloned card when it applies.
 */
export function applyBatch105HistoricPermanentEntersBecomesToCard(
  card: any,
  controller: string,
  state: any,
): any {
  if (!card || !isHistoricCard(card)) return card;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  let parsed: { power: number; toughness: number; types: string[] } | null = null;
  for (const src of battlefield) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== String(controller || '')) continue;
    parsed = parseAsHistoricPermanentYouControlEntersBecomes(oracleOf(src));
    if (parsed) break;
  }
  if (!parsed) return card;
  const next = { ...card };
  next.type_line = addTypesInAddition(String(next.type_line || next.typeLine || ''), parsed.types);
  next.power = String(parsed.power);
  next.toughness = String(parsed.toughness);
  next.batch105HistoricBecame = true;
  return next;
}

/** Stamp an already-built entering permanent with the historic becomes-a-creature replacement. */
export function applyBatch105HistoricPermanentEntersBecomes(perm: any, state: any): any {
  if (!perm) return perm;
  const card = perm.card || perm;
  const nextCard = applyBatch105HistoricPermanentEntersBecomesToCard(card, String(perm.controller || ''), state);
  if (nextCard === card) return perm;
  perm.card = nextCard;
  if (nextCard.type_line) perm.type_line = nextCard.type_line;
  const p = Number(nextCard.power);
  const t = Number(nextCard.toughness);
  if (Number.isFinite(p)) perm.basePower = p;
  if (Number.isFinite(t)) perm.baseToughness = t;
  return perm;
}

/** War's Toll family: if another creature with the same controller is attacking, this one must too. */
export function batch105OpponentSourceForcesAllToAttack(perm: any, battlefield: any[]): boolean {
  if (!perm || !isCreature(perm)) return false;
  const controller = String(perm.controller || '');
  if (!controller) return false;
  const hasSource = (battlefield || []).some((src) =>
    src && src.phasedOut !== true && parseOpponentCreaturesAllAttackIfAble(oracleOf(src)),
  );
  if (!hasSource) return false;
  return (battlefield || []).some((other) =>
    other
    && other !== perm
    && String(other.id || '') !== String(perm.id || '')
    && String(other.controller || '') === controller
    && isCreature(other)
    && (other.attacking === true || other.isAttacking === true || other.attackingPlayerId || other.attackingId),
  );
}

export function batch105CreatureHasHasteFromWasCast(permanent: any): boolean {
  const parsed = parseHasHasteAndWardAsLongAsCast(oracleOf(permanent));
  return !!parsed && wasCastEntry(permanent);
}

export function batch105GrantedWardCost(perm: any): string | null {
  const parsed = parseHasHasteAndWardAsLongAsCast(oracleOf(perm));
  if (!parsed || !wasCastEntry(perm)) return null;
  return parsed.wardCost;
}

function countSubtypeYouControl(battlefield: any[], controller: string, subtype: string, excludeId?: string): number {
  let n = 0;
  for (const perm of battlefield || []) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') !== controller) continue;
    if (excludeId && String(perm.id || '') === excludeId) continue;
    if (new RegExp(`\\b${subtype}\\b`, 'i').test(typeLineOf(perm))) n += 1;
  }
  return n;
}

function countColorPermanentsOpponentsControl(battlefield: any[], controller: string, color: string): number {
  let n = 0;
  for (const perm of battlefield || []) {
    if (!perm || perm.phasedOut === true) continue;
    if (String(perm.controller || '') === controller) continue;
    const colors: string[] = Array.isArray(perm?.card?.colors) ? perm.card.colors.map((c: any) => String(c).toLowerCase()) : [];
    const identity: string[] = Array.isArray(perm?.card?.color_identity) ? perm.card.color_identity.map((c: any) => String(c).toLowerCase()) : [];
    const oracle = oracleOf(perm).toLowerCase();
    const colorWord = color.toLowerCase();
    const letter: Record<string, string> = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' };
    const code = letter[colorWord];
    if (colors.includes(colorWord) || colors.includes(code) || identity.includes(code) || identity.includes(colorWord) || oracle.includes(colorWord)) {
      n += 1;
      continue;
    }
    if (code && (colors.includes(code.toUpperCase()) || String(perm?.card?.color_identity || '').toLowerCase().includes(code))) n += 1;
  }
  return n;
}

export function batch105PowerToughnessAdjustment(perm: any, state: any): { power: number; toughness: number } {
  let power = 0;
  let toughness = 0;
  const controller = String(perm?.controller || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const life = lifeOf(state, controller);
  const starting = startingLifeOf(state);

  const greater = parseGetsPTAndKeywordWhenLifeGreaterThanStarting(oracleOf(perm));
  if (greater && life !== undefined && life > starting) {
    power += greater.power;
    toughness += greater.toughness;
  }
  const extra = parseAdditionalPTWhenLifeAtLeastNGreaterThanStarting(oracleOf(perm));
  if (extra && life !== undefined && life >= starting + extra.atLeast) {
    power += extra.power;
    toughness += extra.toughness;
  }

  const nantuko = parseGetsPTForEachColorPermanentOpponentsControlWithThreshold(oracleOf(perm));
  if (nantuko && graveyardOf(state, controller).length >= nantuko.threshold) {
    const count = countColorPermanentsOpponentsControl(battlefield, controller, nantuko.color);
    power += nantuko.power * count;
    toughness += nantuko.toughness * count;
  }

  for (const src of battlefield) {
    if (!src || src.phasedOut === true) continue;
    if (String(src.controller || '') !== controller) continue;
    const neo = parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono(oracleOf(src));
    if (!neo) continue;
    if (!new RegExp(`\\b${neo.subtype}\\b`, 'i').test(typeLineOf(perm))) continue;
    const others = countSubtypeYouControl(battlefield, controller, neo.subtype, String(perm.id || ''));
    power += neo.power * others;
    toughness += neo.toughness * others;
  }

  return { power, toughness };
}

export function applyBatch105PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  const after104 = applyBatch104PowerToughnessAdjustment(perm, state, power, toughness);
  const adj = batch105PowerToughnessAdjustment(perm, state);
  return { power: after104.power + adj.power, toughness: after104.toughness + adj.toughness };
}

export function batch105PermanentHasMenace(perm: any, state: any): boolean {
  const parsed = parseGetsPTAndKeywordWhenLifeGreaterThanStarting(oracleOf(perm));
  if (!parsed || parsed.keyword !== 'menace') return false;
  const life = lifeOf(state, String(perm?.controller || ''));
  const starting = startingLifeOf(state);
  return life !== undefined && life > starting;
}

export function batch105HasDoubleStrike(perm: any, battlefield: any[] = [], state?: any): boolean {
  if (!perm) return false;
  const defending = String(perm?.attackingPlayerId || perm?.attackingId || perm?.defendingPlayerId || '');
  const controller = String(perm?.controller || '');
  for (const src of battlefield || []) {
    if (!src || src.phasedOut === true) continue;
    if (!parseCreaturesAttackingYourOpponentsHaveDoubleStrike(oracleOf(src))) continue;
    const srcController = String(src.controller || '');
    if (!srcController) continue;
    // Attacking a player who is an opponent of the source's controller.
    if (defending && defending !== srcController) return true;
    if (!defending && (perm.attacking === true || perm.isAttacking === true) && controller && controller !== srcController) return true;
  }
  return false;
}

export function batch105BlockRestrictionReason(
  blocker: any,
  attacker: any,
  battlefield: any[] = [],
  blockerControllerId?: string,
  gameState?: unknown,
): string | null {
  if (!attacker) return null;
  const state = (gameState as any) || { battlefield };
  const defenderId = String(blockerControllerId || blocker?.controller || '');

  const entered = parseCantBeBlockedIfTypeEnteredThisTurn(oracleOf(attacker));
  if (entered) {
    const controller = String(attacker.controller || '');
    if (typeEnteredUnderControlThisTurn(entered.type, battlefield, controller, state)) {
      return `${attacker?.card?.name || 'This creature'} can't be blocked because a ${entered.type} entered under its controller's control this turn`;
    }
  }

  for (const src of battlefield || []) {
    if (!src || src.phasedOut === true) continue;
    const neo = parseSubtypeYouControlGetPTForEachOtherAndCantBeBlockedByMono(oracleOf(src));
    if (!neo) continue;
    if (String(src.controller || '') !== String(attacker.controller || '')) continue;
    if (!new RegExp(`\\b${neo.subtype}\\b`, 'i').test(typeLineOf(attacker))) continue;
    const colors: string[] = Array.isArray(blocker?.card?.colors)
      ? blocker.card.colors.map((c: any) => String(c).toLowerCase())
      : [];
    if (neo.blockRestriction === 'monocolored' && colors.length === 1) {
      return `${attacker?.card?.name || 'This creature'} can't be blocked by monocolored creatures`;
    }
  }

  if (batch105CreaturesCantBlock(blocker, battlefield)) {
    return 'Creatures can\'t block';
  }

  if (batch105CantAttackOrBlockUnlessCreatureDied(blocker, state)) {
    return `${blocker?.card?.name || 'This creature'} can't block unless a creature died under its controller's control this turn`;
  }

  void defenderId;
  return null;
}

export function batch105CreaturesCantBlock(blocker: any, battlefield: any[]): boolean {
  if (!blocker || !isCreature(blocker)) return false;
  return (battlefield || []).some((src) => src && src.phasedOut !== true && parseCreaturesCantBlock(oracleOf(src)));
}

export function creatureDiedUnderControlThisTurn(state: any, controllerId: string): boolean {
  const map = state?.creaturesDiedThisTurnByController;
  if (map && typeof map === 'object' && Number(map[controllerId]) > 0) return true;
  const ids = Array.isArray(state?.creaturesDiedThisTurnIds) ? state.creaturesDiedThisTurnIds : [];
  if (ids.length > 0 && Array.isArray(state?.battlefield) === false) {
    // ids alone are not controller-scoped; prefer the map. Fall back only if a matching record exists.
  }
  const rec = state?.creaturesDiedThisTurn;
  if (Array.isArray(rec) && rec.some((e: any) => String(e?.controller || e?.controllerId || '') === controllerId)) return true;
  return false;
}

export function batch105CantAttackOrBlockUnlessCreatureDied(perm: any, state: any): boolean {
  if (!parseCantAttackOrBlockUnlessCreatureDiedUnderYourControl(oracleOf(perm))) return false;
  return !creatureDiedUnderControlThisTurn(state, String(perm?.controller || ''));
}

/** Players can't cast instant spells during combat (Hand to Hand family). */
export function batch105CannotCastInstantDuringCombat(state: any, spell: any): string | null {
  const phase = String(state?.phase || '').toLowerCase();
  const step = String(state?.step || '').toLowerCase();
  const isCombat = phase === 'combat' || /combat|declare_?attackers|declare_?blockers/.test(step);
  if (!isCombat) return null;
  const tl = String(spell?.type_line || spell?.card?.type_line || '').toLowerCase();
  if (!/\binstant\b/.test(tl)) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const src = battlefield.find((p) => p && p.phasedOut !== true && parseDuringCombatCantCastInstantsOrActivateNonMana(oracleOf(p)));
  if (!src) return null;
  return `Players can't cast instant spells during combat (${src?.card?.name || 'a permanent'})`;
}

/** Players can't activate non-mana abilities during combat (Hand to Hand family). */
export function batch105CannotActivateNonManaDuringCombat(state: any, isManaAbility: boolean): string | null {
  if (isManaAbility) return null;
  const phase = String(state?.phase || '').toLowerCase();
  const step = String(state?.step || '').toLowerCase();
  const isCombat = phase === 'combat' || /combat|declare_?attackers|declare_?blockers/.test(step);
  if (!isCombat) return null;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const src = battlefield.find((p) => p && p.phasedOut !== true && parseDuringCombatCantCastInstantsOrActivateNonMana(oracleOf(p)));
  if (!src) return null;
  return `Players can't activate abilities that aren't mana abilities during combat (${src?.card?.name || 'a permanent'})`;
}

export function batch105CannotCastOrPlayForWardOfBones(
  state: any,
  playerId: string,
  spellOrType: any,
  action: 'cast' | 'play',
): string | null {
  const pid = String(playerId || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const countType = (controller: string, typ: string) => battlefield.filter((p) =>
    p && p.phasedOut !== true && String(p.controller || '') === controller && new RegExp(`\\b${typ}\\b`, 'i').test(typeLineOf(p)),
  ).length;
  const spellType = String(spellOrType?.type_line || spellOrType?.card?.type_line || spellOrType || '').toLowerCase();
  for (const src of battlefield) {
    if (!src || src.phasedOut === true) continue;
    const you = String(src.controller || '');
    if (!you || you === pid) continue;
    const rules = parseOpponentWhoControlsMoreTypeCantCastOrPlay(oracleOf(src));
    for (const rule of rules) {
      if (rule.action !== action) continue;
      if (action === 'cast' && !new RegExp(`\\b${rule.type}\\b`, 'i').test(spellType)) continue;
      if (action === 'play' && rule.type !== 'land') continue;
      if (countType(pid, rule.type === 'land' ? 'land' : `${rule.type}`) > countType(you, rule.type === 'land' ? 'land' : `${rule.type}`)) {
        return `${src?.card?.name || 'A permanent'} prevents this ${rule.action}`;
      }
    }
  }
  return null;
}

/** "Can't attack you" on Fealty: "you" is the Aura's controller. */
export function batch105CantAttackYouPlayerIds(attacker: any, battlefield: any[] = []): string[] {
  const id = String(attacker?.id || '');
  if (!id) return [];
  const out: string[] = [];
  for (const aura of battlefield || []) {
    if (!aura || aura.phasedOut === true) continue;
    if (String(aura.attachedTo || '') !== id) continue;
    if (!parseEnchantedAttacksEachCombatIfAbleAndCantAttackYou(oracleOf(aura)) && !/can't attack you/i.test(oracleOf(aura))) continue;
    const you = String(aura.controller || '').trim();
    if (you && !out.includes(you)) out.push(you);
  }
  return out;
}

export function batch105IllegalDefendingPlayerReason(
  attacker: any,
  defendingPlayerId: string,
  battlefield: any[] = [],
): string | null {
  const banned = batch105CantAttackYouPlayerIds(attacker, battlefield);
  if (banned.includes(String(defendingPlayerId || ''))) {
    return `${attacker?.card?.name || 'This creature'} can't attack you`;
  }
  if (batch105CantAttackOrBlockUnlessCreatureDied(attacker, { battlefield, creaturesDiedThisTurnByController: (attacker as any)?.__diedState })) {
    // Real state must be passed by callers that have it; see batch105AttackRestrictionReason.
  }
  return null;
}

export function batch105AttackRestrictionReason(attacker: any, defendingPlayerId: string, state: any): string | null {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const you = batch105IllegalDefendingPlayerReason(attacker, defendingPlayerId, battlefield);
  if (you) return you;
  if (batch105CantAttackOrBlockUnlessCreatureDied(attacker, state)) {
    return `${attacker?.card?.name || 'This creature'} can't attack unless a creature died under its controller's control this turn`;
  }
  return null;
}

function auraHasPrintedOrGrantedUmbraArmor(aura: any, battlefield: any[]): boolean {
  const text = oracleOf(aura).toLowerCase();
  if (/\bumbra armor\b/.test(text) || /\btotem armor\b/.test(text)) return true;
  const keywords: unknown[] = [
    ...(Array.isArray(aura?.card?.keywords) ? aura.card.keywords : []),
    ...(Array.isArray(aura?.keywords) ? aura.keywords : []),
    ...(Array.isArray(aura?.grantedAbilities) ? aura.grantedAbilities : []),
  ];
  if (keywords.some((k) => /umbra armor|totem armor/i.test(String(k || '')))) return true;
  const host = (battlefield || []).find((p) => p && String(p.id || '') === String(aura?.attachedTo || ''));
  if (!host) return false;
  const hostController = String(host.controller || '');
  return (battlefield || []).some((src) =>
    src
    && src.phasedOut !== true
    && String(src.controller || '') === hostController
    && parseAurasAttachedToPermanentsYouControlHaveUmbraArmor(oracleOf(src)),
  );
}

export function findBatch105UmbraArmorAura(battlefield: readonly any[] | undefined, perm: any): any | null {
  const id = String(perm?.id || '');
  if (!id) return null;
  const bf = Array.isArray(battlefield) ? battlefield : [];
  for (const aura of bf) {
    if (!aura || aura.phasedOut || String(aura.attachedTo || '') !== id) continue;
    if (!/\baura\b/.test(typeLineOf(aura))) continue;
    if (auraHasPrintedOrGrantedUmbraArmor(aura, bf as any[])) return aura;
  }
  return null;
}

/** If enchanted permanent would be destroyed, instead remove damage and destroy the umbra/totem Aura. */
export function tryBatch105UmbraArmorDestroyReplacement(
  state: any,
  permanentId: string,
  sacrificeAura: (auraId: string) => unknown,
): boolean {
  const bf: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const perm = bf.find((p) => p && String(p.id || '') === String(permanentId || ''));
  if (!perm) return false;
  const aura = findBatch105UmbraArmorAura(bf, perm);
  if (!aura) return false;
  perm.damage = 0;
  perm.markedDamage = 0;
  perm.damageMarked = 0;
  const auraId = String(aura.id || '');
  if (auraId) sacrificeAura(auraId);
  return true;
}

export function batch105CreaturesLoseAllAbilities(perm: any, battlefield: any[] = []): boolean {
  if (!perm || !isCreature(perm)) return false;
  return (battlefield || []).some((src) => src && src.phasedOut !== true && parseCreaturesLoseAllAbilities(oracleOf(src)));
}

export { parseAreEquipmentInAdditionAndHaveQuoted };
