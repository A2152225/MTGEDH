// server/src/state/modules/batch108Apply.ts
// B108 live apply: experience writer, PT, block/attack restrictions, keyword
// grants, chosen-permanent activation lock, typal must-attack, and type/color
// animation helpers. Public entry symbols listed below.

import { applyBatch107PlayerCounterPlusOne } from './batch107Apply.js';
import { registerPlayerCounterGainAdjustment } from '../../../../rules-engine/src/playerCounterGainHook.js';
import {
  parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated,
  parseAllBasicLandTypeAreNNColorCreaturesStillLands,
  parseAllCreaturesWithFlyingAbleToBlockThisDoSo,
  parseAsLongAsThisIsACreatureItHasProwess,
  parseCanOnlyAttackAlone,
  parseCantAttackOrBlockUnlessNPlusCounters,
  parseCantBeBlockedExceptByLegendaryCreatures,
  parseCreatureCombatDamageToThisPreventAndPlusCounter,
  parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked,
  parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink,
  parseEnchantedCantBeBlockedAsLongAsAttackingAlone,
  parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands,
  parseGetsPTAsLongAsNCreaturesAreBlockingIt,
  parseGetsPTAsLongAsTopLibraryCardIsCreature,
  parseHasDoubleStrikeAsLongAsNEquipmentAttached,
  parseTypalCreaturesAttackEachCombatIfAble,
  normalizeB108Oracle,
} from './batch108Parsers.js';

registerPlayerCounterGainAdjustment((state, playerId, counter, amount) => {
  if (String(counter || '').toLowerCase() !== 'experience') return amount;
  return applyBatch107PlayerCounterPlusOne(state, playerId, amount);
});

function oracleOf(perm: any): string {
  return normalizeB108Oracle(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

function isPhased(perm: any): boolean {
  return Boolean(perm && perm.phasedOut === true);
}

function colorLetter(name: string): string {
  const key = String(name || '').toLowerCase();
  if (key === 'white' || key === 'w') return 'W';
  if (key === 'blue' || key === 'u') return 'U';
  if (key === 'black' || key === 'b') return 'B';
  if (key === 'red' || key === 'r') return 'R';
  if (key === 'green' || key === 'g') return 'G';
  return '';
}

function isCreatureish(perm: any): boolean {
  const tl = typeLineOf(perm);
  if (/\bcreature\b/.test(tl)) return true;
  return Array.isArray(perm?.layer4AddedTypes) && perm.layer4AddedTypes.includes('Creature');
}

function isPlaneswalker(perm: any): boolean {
  return /\bplaneswalker\b/.test(typeLineOf(perm));
}

function readPT(perm: any): { power: number; toughness: number } {
  const power = Number(perm?.power ?? perm?.currentPower ?? perm?.card?.power ?? 0);
  const toughness = Number(perm?.toughness ?? perm?.currentToughness ?? perm?.card?.toughness ?? 0);
  return {
    power: Number.isFinite(power) ? power : 0,
    toughness: Number.isFinite(toughness) ? toughness : 0,
  };
}

function plusCounterCount(perm: any, kind: string): number {
  const counters = perm?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  return Math.max(0, Math.floor(Number((counters as any)[kind]) || 0));
}

function blockersOf(perm: any, battlefield: any[]): any[] {
  const ids = Array.isArray(perm?.blockedBy) ? perm.blockedBy.map((id: any) => String(id)) : [];
  if (ids.length) {
    return battlefield.filter((p) => p && ids.includes(String(p.id || '')));
  }
  return battlefield.filter((p) => {
    const blocking = Array.isArray(p?.blocking) ? p.blocking.map((id: any) => String(id)) : [];
    return blocking.includes(String(perm?.id || ''));
  });
}

function attachedEquipmentCount(perm: any, battlefield: any[]): number {
  const id = String(perm?.id || '');
  if (!id) return 0;
  return battlefield.filter((p) => {
    if (!p || isPhased(p)) return false;
    if (String(p.attachedTo || '') !== id) return false;
    return /\bequipment\b/.test(typeLineOf(p));
  }).length;
}

function isAttackingAlone(perm: any, battlefield: any[]): boolean {
  const id = String(perm?.id || '');
  const attackers = battlefield.filter((p) => p && (p.attacking === true || p.isAttacking === true || String(p.attacking || '').trim()));
  return attackers.length === 1 && String(attackers[0]?.id || '') === id;
}

function typalMatches(perm: any, typal: string, state?: any): boolean {
  const re = new RegExp('\\b' + typal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
  if (re.test(typeLineOf(perm))) return true;
  const granted = [
    ...(Array.isArray(perm?.batch107GrantedCreatureTypes) ? perm.batch107GrantedCreatureTypes : []),
    ...(Array.isArray(perm?.batch108GrantedCreatureTypes) ? perm.batch108GrantedCreatureTypes : []),
  ];
  return granted.some((typ) => re.test(String(typ)));
}

function topLibraryCard(state: any, playerId: string): any | null {
  const lib = state?.zones?.[playerId]?.library;
  if (!Array.isArray(lib) || lib.length === 0) return null;
  return lib[0];
}

function isCreatureCard(card: any): boolean {
  return /\bcreature\b/.test(String(card?.card?.type_line || card?.type_line || '').toLowerCase());
}

/** Write experience counters, applying Winding Constrictor plus-one. */
export function addExperienceCounters(state: any, playerId: string, amount: number, ctx?: any): number {
  if (!state || !playerId || !(amount > 0)) {
    return Number(state?.experience?.[playerId] || ctx?.experience?.[playerId] || 0);
  }
  const plus = applyBatch107PlayerCounterPlusOne(state, playerId, amount);
  state.experience = state.experience || {};
  state.experience[playerId] = (Number(state.experience[playerId]) || 0) + plus;
  state.experienceCounters = state.experienceCounters || {};
  state.experienceCounters[playerId] = state.experience[playerId];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '') === String(playerId));
  if (player) {
    player.experience = state.experience[playerId];
    player.experienceCounters = state.experience[playerId];
    player.counters = player.counters || {};
    player.counters.experience = state.experience[playerId];
  }
  if (ctx) {
    ctx.experience = ctx.experience || {};
    ctx.experience[playerId] = state.experience[playerId];
  }
  return state.experience[playerId];
}

export function applyBatch108PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  let nextPower = power;
  let nextToughness = toughness;
  if (!perm || !state) return { power: nextPower, toughness: nextToughness };
  const battlefield = battlefieldOf(state);
  const blocked = parseGetsPTAsLongAsNCreaturesAreBlockingIt(oracleOf(perm));
  if (blocked && blockersOf(perm, battlefield).length >= blocked.min) {
    nextPower += blocked.power;
    nextToughness += blocked.toughness;
  }
  const top = parseGetsPTAsLongAsTopLibraryCardIsCreature(oracleOf(perm));
  if (top) {
    const card = topLibraryCard(state, String(perm.controller || ''));
    if (card && isCreatureCard(card)) {
      nextPower += top.power;
      nextToughness += top.toughness;
    }
  }
  return { power: nextPower, toughness: nextToughness };
}

export function getBatch108BlockRestrictionReason(
  attacker: any,
  blocker: any,
  battlefield: readonly any[] = [],
  _blockerControllerId?: string,
  gameState?: unknown,
): string | null {
  if (!attacker) return null;
  const state = gameState || { battlefield };
  const bf = Array.isArray(battlefield) ? battlefield : battlefieldOf(state);
  const capSources = bf.filter((src) => src && !isPhased(src));
  for (const src of capSources) {
    const cap = parseCreaturesYouControlWithPowerOrToughnessNOrLessCantBeBlocked(oracleOf(src));
    if (cap == null) continue;
    if (String(src.controller || '') !== String(attacker.controller || '')) continue;
    if (!isCreatureish(attacker)) continue;
    const pt = readPT(attacker);
    if (pt.power <= cap || pt.toughness <= cap) {
      return `Creatures you control with power or toughness ${cap} or less can't be blocked`;
    }
  }
  if (parseCantBeBlockedExceptByLegendaryCreatures(oracleOf(attacker))) {
    const tl = typeLineOf(blocker);
    if (!/\blegendary\b/.test(tl)) {
      return "Can't be blocked except by legendary creatures";
    }
  }
  if (parseEnchantedCantBeBlockedAsLongAsAttackingAlone(oracleOf(attacker))) {
    if (isAttackingAlone(attacker, bf as any[])) {
      return "Enchanted creature can't be blocked as long as it's attacking alone";
    }
  }
  const auraHostId = String(attacker?.id || '');
  for (const aura of bf) {
    if (!aura || isPhased(aura)) continue;
    if (String(aura.attachedTo || '') !== auraHostId) continue;
    if (parseEnchantedCantBeBlockedAsLongAsAttackingAlone(oracleOf(aura)) && isAttackingAlone(attacker, bf as any[])) {
      return "Enchanted creature can't be blocked as long as it's attacking alone";
    }
  }
  return null;
}

export function batch108CreatureMustAttackIfAble(perm: any, state: any): boolean {
  if (!perm || !isCreatureish(perm)) return false;
  for (const src of battlefieldOf(state)) {
    if (!src || isPhased(src)) continue;
    const typal = parseTypalCreaturesAttackEachCombatIfAble(oracleOf(src));
    if (typal && typalMatches(perm, typal, state)) return true;
  }
  return false;
}

export function batch108CanOnlyAttackAloneReason(
  creature: any,
  proposedAttackerIds: readonly string[] | undefined,
  _battlefield?: readonly any[],
): string | null {
  if (!creature || !parseCanOnlyAttackAlone(oracleOf(creature))) return null;
  const id = String(creature.id || '');
  const proposed = (proposedAttackerIds || []).map((entry) => String(entry));
  if (!proposed.includes(id)) return null;
  if (proposed.length > 1) {
    return `${String(creature?.card?.name || 'This creature')} can only attack alone`;
  }
  return null;
}

export function batch108AttackRestrictionReason(creature: any, _defendingPlayerId: string, state: any): string | null {
  const unless = parseCantAttackOrBlockUnlessNPlusCounters(oracleOf(creature));
  if (unless && plusCounterCount(creature, unless.counter) < unless.min) {
    return `${String(creature?.card?.name || 'This creature')} can't attack unless it has ${unless.min} or more ${unless.counter} counters on it`;
  }
  return null;
}

export function batch108CannotBlockReason(blocker: any): string | null {
  const unless = parseCantAttackOrBlockUnlessNPlusCounters(oracleOf(blocker));
  if (unless && plusCounterCount(blocker, unless.counter) < unless.min) {
    return `${String(blocker?.card?.name || 'This creature')} can't block unless it has ${unless.min} or more ${unless.counter} counters on it`;
  }
  return null;
}

export function isAbilityActivationProhibitedByBatch108ChosenPermanent(state: any, permanent: any): string | null {
  if (!permanent) return null;
  const targetId = String(permanent.id || '');
  if (!targetId) return null;
  for (const src of battlefieldOf(state)) {
    if (!src || isPhased(src)) continue;
    if (!parseActivatedAbilitiesOfTheChosenPermanentCantBeActivated(oracleOf(src))) continue;
    const chosen = String(src.chosenPermanentId || src.chosenPermanent || src.chosenPermanentID || '');
    if (chosen && chosen === targetId) {
      return `${String(src?.card?.name || 'A permanent')} prevents activating abilities of the chosen permanent.`;
    }
  }
  return null;
}

export function batch108PermanentHasKeyword(perm: any, state: any, keyword: string): boolean {
  if (!perm || !state) return false;
  const needle = String(keyword || '').toLowerCase().replace(/_/g, ' ').trim();
  const battlefield = battlefieldOf(state);
  const turnPlayer = String(state.turnPlayer ?? state.activePlayer ?? '');
  if (needle === 'lifelink') {
    for (const src of battlefield) {
      if (!src || isPhased(src)) continue;
      if (!parseDuringYourTurnCreaturesAndPlaneswalkersYouControlHaveLifelink(oracleOf(src))) continue;
      if (String(src.controller || '') !== String(perm.controller || '')) continue;
      if (turnPlayer && turnPlayer !== String(src.controller || '')) continue;
      if (isCreatureish(perm) || isPlaneswalker(perm)) return true;
    }
  }
  if (needle === 'double strike') {
    const need = parseHasDoubleStrikeAsLongAsNEquipmentAttached(oracleOf(perm));
    if (need != null && attachedEquipmentCount(perm, battlefield) >= need) return true;
  }
  if (needle === 'prowess') {
    if (parseAsLongAsThisIsACreatureItHasProwess(oracleOf(perm)) && isCreatureish(perm)) return true;
  }
  return false;
}

export function batch108AdditionalTypes(perm: any, state: any): string[] {
  const added = new Set<string>();
  if (!perm || !state) return [];
  for (const src of battlefieldOf(state)) {
    if (!src || isPhased(src)) continue;
    const limb = parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands(oracleOf(src));
    if (limb) {
      const tl = typeLineOf(perm);
      const isForest = /\bforest\b/.test(tl) || added.has('Forest');
      const isSaproling = typalMatches(perm, 'Saproling', state);
      if (isForest || isSaproling) {
        added.add('Creature');
        added.add('Land');
        added.add('Forest');
        added.add('Saproling');
      }
    }
    const kormus = parseAllBasicLandTypeAreNNColorCreaturesStillLands(oracleOf(src));
    if (kormus) {
      const sub = kormus.land === 'plains' ? 'plains' : kormus.land.slice(0, -1);
      if (new RegExp('\\b' + sub + '\\b', 'i').test(typeLineOf(perm))) {
        added.add('Creature');
      }
    }
  }
  return [...added];
}

export function batch108GrantedCreatureTypes(perm: any, state: any): string[] {
  const types = new Set<string>();
  for (const typ of batch108AdditionalTypes(perm, state)) {
    if (typ !== 'Creature' && typ !== 'Land') types.add(typ);
  }
  return [...types];
}

export function readBatch108ColorSetting(state: any, object: any): { set: string[]; colorless: boolean } {
  const out = { set: [] as string[], colorless: false };
  if (!state || !object) return out;
  for (const src of battlefieldOf(state)) {
    if (!src || isPhased(src)) continue;
    const limb = parseForestsAndSaprolingsAreNNColorSaprolingCreaturesAndForestLands(oracleOf(src));
    if (limb) {
      const tl = typeLineOf(object);
      const isForest = /\bforest\b/.test(tl);
      const isSaproling = typalMatches(object, 'Saproling', state);
      const letter = colorLetter(limb.color);
      if ((isForest || isSaproling) && letter) out.set = [letter];
    }
    const kormus = parseAllBasicLandTypeAreNNColorCreaturesStillLands(oracleOf(src));
    if (kormus) {
      const sub = kormus.land === 'plains' ? 'plains' : kormus.land.slice(0, -1);
      const letter = colorLetter(kormus.color);
      if (new RegExp('\\b' + sub + '\\b', 'i').test(typeLineOf(object)) && letter) out.set = [letter];
    }
  }
  return out;
}

export function applyBatch108DamagePrevention(
  ctx: any,
  damageAmount: number,
  _damageDealer: string,
  _damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0) || isCombatDamage !== true) return null;
  const state = ctx?.state || ctx;
  if (!state) return null;
  const targetId = String(targetPermanentId || '').trim();
  if (!targetId) return null;
  const battlefield = battlefieldOf(state);
  const target = battlefield.find((p) => String(p?.id || '') === targetId);
  if (!target) return null;
  if (!parseCreatureCombatDamageToThisPreventAndPlusCounter(oracleOf(target))) return null;
  const sourceId = String(damageSourcePermanentId || '').trim();
  const source = battlefield.find((p) => String(p?.id || '') === sourceId);
  if (!source || !isCreatureish(source)) return null;
  target.counters = target.counters || {};
  target.counters['+1/+1'] = (Number(target.counters['+1/+1']) || 0) + 1;
  const name = String(target?.card?.name || 'This creature');
  return {
    amount: 0,
    modifiers: [`${name}: prevented ${damageAmount} combat damage, added a +1/+1 counter`],
  };
}

export function applyCardToLibraryTop(state: any, card: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid || !card || !state) return false;
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  library.unshift({ ...card, zone: 'library' });
  state.zones[pid].library = library;
  state.zones[pid].libraryNeedsShuffle = false;
  return true;
}

export function attackerMustBeBlockedByFlyingIfAble(permanent: any): boolean {
  return parseAllCreaturesWithFlyingAbleToBlockThisDoSo(oracleOf(permanent));
}
