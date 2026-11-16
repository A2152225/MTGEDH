// server/src/state/modules/batch102Apply.ts
// B102 applies: Darkblade combat-damage draw, Arboria, Mudslide, Sanctuary Blade,
// Void Maw, Idris pump, Tidal Influence, and onward static applies.
// Public: the functions exported below.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import { drawCards } from './zones-handlers/zonesDrawCards.js';
import { playerSurveilledThisTurn } from './batch101LandRecoverSurveil.js';
import {
  parseSanctuaryBladeColorChoice,
  parseProtectionFromLastChosenColor,
  parseDarkbladeCombatDamageDraw,
  parseCreaturesWithoutFlyingDontUntap,
  parseArboriaAttackRestriction,
  parseAnotherCreatureWouldDieExile,
  parseIdrisExiledAbilitiesAndPump,
  parseNamedPermanentCastLock,
  parseHexproofUnlessAttacking,
  parseOtherCreaturesGetMinusOneMinusOne,
  parseEnchantedMinusXPowerFromControllerGy,
  parseDuringYourTurnBasePT,
  parseCluesYouControlAreEquipment,
  parseEightCountersIsCreatureAnnihilator,
  parseOpponentsCreaturesCantGetP1P1,
  parseEmptyHandDrawTwoLoseLife,
  parsePreventDamageControllerDraws,
  parsePreventDamageWhileMonarchPlusCounters,
  parseDamageRemovesP1P1AndPrevents,
  parseDeliriumDoubleNoncombatDamage,
  COLOR_CHOICE_OPTIONS,
} from './batch102Parsers.js';

function oracleOf(entry: any): string {
  return String(entry?.card?.oracle_text || entry?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(entry: any): string {
  return String(entry?.card?.type_line || entry?.type_line || entry?.typeLine || '');
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

export function applyGrantedCombatDamageDraw(
  ctx: GameContext,
  sourcePermanent: any,
  isCombatDamage: boolean,
  damageDealt: number,
): number {
  if (!isCombatDamage || !(Number(damageDealt) > 0) || !sourcePermanent) return 0;
  const text = oracleOf(sourcePermanent);
  if (!parseDarkbladeCombatDamageDraw(text)) return 0;
  const state = (ctx as any).state;
  if (!playerSurveilledThisTurn(state, String(sourcePermanent.controller || ''))) return 0;
  const pid = String(sourcePermanent.controller || '') as PlayerID;
  if (!pid) return 0;
  try {
    const drawn = drawCards(ctx, pid, 1);
    return Array.isArray(drawn) ? drawn.length : 1;
  } catch {
    const zones = state.zones = state.zones || {};
    zones[pid] = zones[pid] || {};
    const library: any[] = Array.isArray(zones[pid].library) ? zones[pid].library : [];
    const hand: any[] = Array.isArray(zones[pid].hand) ? zones[pid].hand : (zones[pid].hand = []);
    if (!library.length) return 0;
    const card = library.shift();
    hand.push({ ...card, zone: 'hand' });
    zones[pid].library = library;
    zones[pid].handCount = hand.length;
    return 1;
  }
}

export function noteNontokenPermanentEnteredThisTurn(state: any, controllerId: string, isToken?: boolean): void {
  if (!state || isToken === true) return;
  const pid = String(controllerId || '').trim();
  if (!pid) return;
  state.nontokenPermanentsEnteredThisTurnByPlayer = state.nontokenPermanentsEnteredThisTurnByPlayer || {};
  state.nontokenPermanentsEnteredThisTurnByPlayer[pid] = Number(state.nontokenPermanentsEnteredThisTurnByPlayer[pid] || 0) + 1;
}

export function snapshotArboriaLastTurnTracking(state: any): void {
  if (!state) return;
  const current = state.nontokenPermanentsEnteredThisTurnByPlayer || {};
  state.nontokenPermanentsEnteredLastTurnByPlayer = { ...current };
  state.nontokenPermanentsEnteredThisTurnByPlayer = {};
}

export function playerDidCastOrPutNontokenLastTurn(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  const casts = Number(state?.spellsCastLastTurnByPlayerCounts?.[pid] || 0);
  if (casts > 0) return true;
  const entered = Number(state?.nontokenPermanentsEnteredLastTurnByPlayer?.[pid] || 0);
  return entered > 0;
}

export function arboriaAttackRestrictionReason(creature: any, defendingPlayerId: string | undefined, state: any): string | null {
  if (!defendingPlayerId || !state) return null;
  const sources = battlefieldOf(state).filter((p) => p && p.phasedOut !== true && parseArboriaAttackRestriction(oracleOf(p)));
  if (!sources.length) return null;
  if (playerDidCastOrPutNontokenLastTurn(state, defendingPlayerId)) return null;
  return `${String(creature?.card?.name || 'This creature')} can't attack that player unless they cast a spell or put a nontoken permanent onto the battlefield during their last turn.`;
}

export function mudslideUntapProhibitionSource(battlefield: readonly any[] | undefined, permanent: any): string | null {
  if (!/\bcreature\b/i.test(typeLineOf(permanent))) return null;
  const flying = /\bflying\b/i.test(`${typeLineOf(permanent)} ${oracleOf(permanent)} ${(permanent?.keywords || []).join(' ')}`);
  if (flying || (Array.isArray(permanent?.keywords) && permanent.keywords.some((k: any) => /\bflying\b/i.test(String(k))))) return null;
  // Also accept a boolean / ability flag used by tests and the keyword helper.
  if (permanent?.hasFlying === true) return null;
  const list = Array.isArray(battlefield) ? battlefield : [];
  for (const src of list) {
    if (!src || src.phasedOut === true) continue;
    if (parseCreaturesWithoutFlyingDontUntap(oracleOf(src))) return String(src.card?.name || 'Mudslide');
  }
  return null;
}

export function maybeQueueSanctuaryBladeColorChoice(ctx: GameContext, equipment: any, attachedToId: string): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  if (!parseSanctuaryBladeColorChoice(oracleOf(equipment)) && !parseProtectionFromLastChosenColor(oracleOf(equipment))) return false;
  const controller = String(equipment.controller || '');
  if (!controller) return false;
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller as PlayerID,
    description: `${String(equipment.card?.name || 'Equipment')}: As this Equipment becomes attached to a creature, choose a color. The equipped creature has protection from the last chosen color.`,
    mandatory: true,
    sourceId: String(equipment.id || ''),
    sourceName: String(equipment.card?.name || 'Equipment'),
    sanctuaryBladeColorChoice: true,
    sanctuaryBladeEquipmentId: String(equipment.id || ''),
    sanctuaryBladeAttachedToId: attachedToId,
    options: COLOR_CHOICE_OPTIONS.map((c) => ({ id: c.id, label: c.label })),
  } as any);
  return true;
}

export function applySanctuaryBladeChosenColor(state: any, equipmentId: string, color: string): boolean {
  const equipment = battlefieldOf(state).find((p) => String(p?.id || '') === String(equipmentId));
  if (!equipment) return false;
  const chosen = String(color || '').trim().toLowerCase();
  if (!['white', 'blue', 'black', 'red', 'green'].includes(chosen)) return false;
  equipment.lastChosenColor = chosen;
  return true;
}

export function sanctuaryBladeProtectionTextForEquipped(state: any, permanent: any): string | null {
  const targetId = String(permanent?.id || '');
  if (!targetId) return null;
  for (const eq of battlefieldOf(state)) {
    if (!eq || eq.phasedOut === true) continue;
    const attached = String(eq.attachedToId || eq.attachedTo || '');
    if (attached !== targetId && !((Array.isArray(permanent.attachedCards) ? permanent.attachedCards : []).some((c: any) => String(c?.id || '') === String(eq.id || '')))) continue;
    if (!parseProtectionFromLastChosenColor(oracleOf(eq)) && !parseSanctuaryBladeColorChoice(oracleOf(eq))) continue;
    const color = String(eq.lastChosenColor || '').trim().toLowerCase();
    if (!color) continue;
    return `Equipped creature has protection from ${color}`;
  }
  return null;
}

export function applyVoidMawExileInstead(ctx: GameContext, dyingPermanent: any, exceptSourceId?: string): boolean {
  if (!dyingPermanent || !/\bcreature\b/i.test(typeLineOf(dyingPermanent))) return false;
  const state = (ctx as any).state;
  const dyingId = String(dyingPermanent.id || '');
  const source = battlefieldOf(state).find((p) => {
    if (!p || p.phasedOut === true) return false;
    if (String(p.id || '') === dyingId) return false;
    if (exceptSourceId && String(p.id || '') === String(exceptSourceId)) return false;
    return parseAnotherCreatureWouldDieExile(oracleOf(p));
  });
  if (!source) return false;
  const owner = String(dyingPermanent.owner || dyingPermanent.controller || '');
  const zones = state.zones = state.zones || {};
  zones[owner] = zones[owner] || { exile: [] };
  const exile: any[] = Array.isArray(zones[owner].exile) ? zones[owner].exile : (zones[owner].exile = []);
  const card = { ...(dyingPermanent.card || dyingPermanent), zone: 'exile', exiledWithSourceId: String(source.id), exiledWith: String(source.id), owner };
  exile.push(card);
  source.exiledWithVoidMaw = source.exiledWithVoidMaw || [];
  source.exiledWithVoidMaw.push(card);
  return true;
}

export function idrisExiledCardPump(perm: any, state: any): { power: number; toughness: number } | null {
  if (!parseIdrisExiledAbilitiesAndPump(oracleOf(perm))) return null;
  const id = String(perm?.id || '');
  const zones = state?.zones || {};
  for (const pid of Object.keys(zones)) {
    const exile: any[] = Array.isArray(zones[pid]?.exile) ? zones[pid].exile : [];
    const card = exile.find((c) => String(c?.exiledWithSourceId || c?.exiledWith || '') === id);
    if (card) {
      const mv = Math.max(0, Math.floor(Number(card.cmc ?? card.mana_value ?? card.manaValue ?? 0)));
      return { power: mv, toughness: mv };
    }
  }
  return null;
}

export function namedPermanentCastIsLocked(state: any, spell: any): boolean {
  const text = oracleOf(spell);
  if (!parseNamedPermanentCastLock(text)) return false;
  const name = String(spell?.name || spell?.card?.name || '').trim().toLowerCase();
  if (!name) return false;
  return battlefieldOf(state).some((p) => String(p?.card?.name || p?.name || '').trim().toLowerCase() === name);
}

export function tadeasHasHexproof(perm: any): boolean {
  if (!parseHexproofUnlessAttacking(oracleOf(perm))) return false;
  return perm?.attacking !== true && perm?.isAttacking !== true && !perm?.attackingPlayerId;
}

export function otherCreaturesMinusOneDelta(perm: any, state: any): { power: number; toughness: number } {
  const sources = battlefieldOf(state).filter((p) => p && p.phasedOut !== true && parseOtherCreaturesGetMinusOneMinusOne(oracleOf(p)));
  if (!sources.length) return { power: 0, toughness: 0 };
  const id = String(perm?.id || '');
  const n = sources.filter((p) => String(p.id || '') !== id).length;
  return { power: -n, toughness: -n };
}

export function enchantedMinusXPower(perm: any, state: any): number {
  const id = String(perm?.id || '');
  for (const aura of battlefieldOf(state)) {
    if (String(aura?.attachedTo || aura?.attachedToId || '') !== id) continue;
    if (!parseEnchantedMinusXPowerFromControllerGy(oracleOf(aura))) continue;
    const controller = String(perm?.controller || '');
    const gy = state?.zones?.[controller]?.graveyard;
    const count = state?.zones?.[controller]?.graveyardCount ?? (Array.isArray(gy) ? gy.length : 0);
    return -count;
  }
  return 0;
}

export function duringYourTurnBasePT(perm: any, state: any): { power: number; toughness: number } | null {
  const spec = parseDuringYourTurnBasePT(oracleOf(perm));
  if (!spec) return null;
  const turn = String(state?.turnPlayer || state?.activePlayer || '');
  const controller = String(perm?.controller || '');
  if (turn && turn !== controller) return null;
  return spec;
}

export function applyCluesAsEquipment(state: any): number {
  const sources = battlefieldOf(state).filter((p) => p && p.phasedOut !== true && parseCluesYouControlAreEquipment(oracleOf(p)));
  if (!sources.length) return 0;
  let n = 0;
  for (const src of sources) {
    const pid = String(src.controller || '');
    for (const perm of battlefieldOf(state)) {
      if (String(perm?.controller || '') !== pid) continue;
      const tl = typeLineOf(perm);
      if (!/\bclue\b/i.test(tl) && !/\bclue\b/i.test(String(perm?.card?.name || ''))) continue;
      if (!/\bequipment\b/i.test(tl)) {
        perm.card = perm.card || {};
        perm.card.type_line = `${tl} Equipment`.trim();
      }
      perm.grantedEquipCost = '{2}';
      perm.equippedCreaturePump = { power: 2, toughness: 0 };
      n += 1;
    }
  }
  return n;
}

export function applyIdolCreatureWhenEightCounters(perm: any): boolean {
  const spec = parseEightCountersIsCreatureAnnihilator(oracleOf(perm));
  if (!spec) return false;
  const c = Number(perm?.counters?.['+1/+1'] || 0);
  if (c < 8) return false;
  const tl = typeLineOf(perm);
  if (!/\bcreature\b/i.test(tl)) {
    perm.card = perm.card || {};
    perm.card.type_line = `${tl} Creature`.trim();
  }
  perm.annihilator = spec.annihilator;
  return true;
}

export function opponentsCantGetPlusOneCounters(state: any, targetPermanent: any): boolean {
  if (!/\bcreature\b/i.test(typeLineOf(targetPermanent))) return false;
  const controller = String(targetPermanent?.controller || '');
  return battlefieldOf(state).some((p) => {
    if (!p || p.phasedOut === true) return false;
    if (String(p.controller || '') === controller) return false;
    return parseOpponentsCreaturesCantGetP1P1(oracleOf(p));
  });
}

export function applyBloodScrivenerDrawReplacement(ctx: GameContext, playerId: string, drawCount: number): { count: number; lifeLost: number } | null {
  if (drawCount <= 0) return null;
  const state = (ctx as any).state;
  const hand = state?.zones?.[playerId]?.hand;
  const handCount = state?.zones?.[playerId]?.handCount ?? (Array.isArray(hand) ? hand.length : 0);
  if (handCount > 0) return null;
  const source = battlefieldOf(state).find((p) => String(p?.controller || '') === String(playerId) && parseEmptyHandDrawTwoLoseLife(oracleOf(p)));
  if (!source) return null;
  state.life = state.life || {};
  state.life[playerId] = Math.max(0, Number(state.life[playerId] || 0) - 1);
  return { count: drawCount + 1, lifeLost: 1 };
}


export function batch102PowerToughnessAdjustment(perm: any, state: any): { base: { power: number; toughness: number } | null; delta: { power: number; toughness: number } } {
  const base = duringYourTurnBasePT(perm, state);
  const other = otherCreaturesMinusOneDelta(perm, state);
  const minusX = enchantedMinusXPower(perm, state);
  const idris = idrisExiledCardPump(perm, state);
  return {
    base,
    delta: {
      power: other.power + minusX + (idris ? idris.power : 0),
      toughness: other.toughness + (idris ? idris.toughness : 0),
    },
  };
}

export function applyBatch102PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  const adj = batch102PowerToughnessAdjustment(perm, state);
  if (adj.base) {
    const printedP = Number(perm?.card?.power ?? perm?.basePower ?? 0) || 0;
    const printedT = Number(perm?.card?.toughness ?? perm?.baseToughness ?? 0) || 0;
    power = power - printedP + adj.base.power;
    toughness = toughness - printedT + adj.base.toughness;
  }
  return { power: power + adj.delta.power, toughness: toughness + adj.delta.toughness };
}

export {
  parsePreventDamageControllerDraws,
  parsePreventDamageWhileMonarchPlusCounters,
  parseDamageRemovesP1P1AndPrevents,
  parseDeliriumDoubleNoncombatDamage,
};
