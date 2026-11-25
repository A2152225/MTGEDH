// server/src/state/modules/batch101LongTailApply.ts
// B101 long-tail applies: stun-counter lock, Shield of the Avatar prevent X,
// Jurassic Park / mayhem GY grants, Cairn Wanderer, venture-once, Case of the
// Gorgon's Kiss, Bludgeon Brawl, Entropic Specter P/T, Pick-Axe attach choice.
// Public: the functions exported below.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import {
  parseStunCountersCantBeRemovedFromOpponents,
  parseShieldPreventXCreatures,
  parseDinosaurGraveyardHasEscape,
  parseCairnWandererGyKeywords,
  parseOpponentVentureOncePerTurn,
  parseSolvedIsCreaturePTKeywords,
  parseBludgeonBrawl,
  parseChosenPlayerHandPT,
  parseNonlandGraveyardMayhem,
  parsePickAxeAsAttachesChoice,
  parseEquippedIsCopyOfLastChosen,
  parseDarkbladeSurveilGrants,
} from './batch101Parsers.js';
import { playerSurveilledThisTurn } from './batch101LandRecoverSurveil.js';

function oracleOf(entry: any): string {
  return String(entry?.card?.oracle_text || entry?.oracle_text || '').replace(/\u2019/g, "'");
}

function typeLineOf(entry: any): string {
  return String(entry?.card?.type_line || entry?.type_line || entry?.typeLine || '');
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

export function opponentStunCountersLocked(state: any, permanent: any): boolean {
  const controller = String(permanent?.controller || '');
  if (!controller) return false;
  return battlefieldOf(state).some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') === controller) return false;
    return parseStunCountersCantBeRemovedFromOpponents(oracleOf(perm));
  });
}

export function countControlledCreatures(state: any, playerId: string): number {
  const pid = String(playerId || '');
  return battlefieldOf(state).filter((p) => {
    if (!p || p.phasedOut === true) return false;
    if (String(p.controller || '') !== pid) return false;
    return /\bcreature\b/i.test(typeLineOf(p));
  }).length;
}

export function applyShieldOfTheAvatarPrevention(
  state: any,
  damageAmount: number,
  targetPermanentId?: string,
): { amount: number; modifiers: string[] } | null {
  const amount = Math.max(0, Math.floor(Number(damageAmount) || 0));
  const targetId = String(targetPermanentId || '').trim();
  if (!targetId || amount <= 0) return null;
  const target = battlefieldOf(state).find((p) => String(p?.id || '') === targetId);
  if (!target) return null;
  const attached: any[] = Array.isArray(target.attachedCards) ? target.attachedCards : [];
  const also = battlefieldOf(state).filter((p) => String(p?.attachedToId || p?.attachedTo || '') === targetId);
  const equipment = [...attached, ...also];
  for (const eq of equipment) {
    if (!parseShieldPreventXCreatures(oracleOf(eq))) continue;
    const controller = String(eq.controller || target.controller || '');
    const prevent = countControlledCreatures(state, controller);
    if (prevent <= 0) continue;
    const next = Math.max(0, amount - prevent);
    return {
      amount: next,
      modifiers: [`${String(eq.card?.name || "Shield of the Avatar")}: prevented ${amount - next} damage`],
    };
  }
  return null;
}

export function dinosaurHasGrantedEscape(state: any, card: any, ownerId: string): boolean {
  if (!/\bdinosaur\b/i.test(typeLineOf(card))) return false;
  const pid = String(ownerId || card?.owner || '');
  return battlefieldOf(state).some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== pid) return false;
    return parseDinosaurGraveyardHasEscape(oracleOf(perm));
  });
}

export function grantedEscapeCostForDinosaur(card: any): string {
  const mana = String(card?.mana_cost || card?.manaCost || '').trim();
  return `${mana} Exile three other cards from your graveyard`.trim();
}

export function nonlandHasGrantedMayhem(state: any, card: any, ownerId: string): boolean {
  if (/\bland\b/i.test(typeLineOf(card))) return false;
  const pid = String(ownerId || card?.owner || '');
  return battlefieldOf(state).some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') !== pid) return false;
    return parseNonlandGraveyardMayhem(oracleOf(perm));
  });
}

export function keywordsGrantedFromGraveyardCreatures(state: any, perm: any): string[] {
  if (!parseCairnWandererGyKeywords(oracleOf(perm))) return [];
  const wanted = parseCairnWandererGyKeywords(oracleOf(perm)) || [];
  const zones = state?.zones || {};
  const present = new Set<string>();
  for (const pid of Object.keys(zones)) {
    const gy: any[] = Array.isArray(zones[pid]?.graveyard) ? zones[pid].graveyard : [];
    for (const card of gy) {
      if (!/\bcreature\b/i.test(typeLineOf(card))) continue;
      const text = `${typeLineOf(card)} ${oracleOf(card)} ${(card?.keywords || []).join(' ')}`.toLowerCase();
      for (const kw of wanted) {
        if (kw === 'landwalk') {
          if (/\b(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk|landwalk)\b/i.test(text)) present.add('landwalk');
        } else if (kw === 'protection') {
          if (/\bprotection from\b/i.test(text)) present.add('protection');
        } else if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
          present.add(kw);
        }
      }
    }
  }
  return wanted.filter((k) => present.has(k));
}

export function darkbladeGrantsDeathtouch(state: any, perm: any): boolean {
  if (!parseDarkbladeSurveilGrants(oracleOf(perm))) return false;
  return playerSurveilledThisTurn(state, String(perm?.controller || ''));
}

export function opponentVentureBlockedThisTurn(state: any, venturingPlayerId: string): boolean {
  const pid = String(venturingPlayerId || '');
  if (Number(state?.venturedThisTurnByPlayer?.[pid] || 0) < 1) return false;
  return battlefieldOf(state).some((perm) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '') === pid) return false;
    return parseOpponentVentureOncePerTurn(oracleOf(perm));
  });
}

export function notePlayerVenturedThisTurn(state: any, playerId: string): void {
  const pid = String(playerId || '').trim();
  if (!state || !pid) return;
  state.venturedThisTurnByPlayer = state.venturedThisTurnByPlayer || {};
  state.venturedThisTurnByPlayer[pid] = Number(state.venturedThisTurnByPlayer[pid] || 0) + 1;
}

export function clearVenturedThisTurn(state: any): void {
  if (state) delete state.venturedThisTurnByPlayer;
}

export function maybeSolveCaseGorgonsKiss(state: any): number {
  const count = Number(state?.creatureCardsPutIntoGraveyardsThisTurn || 0);
  if (count < 3) return 0;
  let solved = 0;
  for (const perm of battlefieldOf(state)) {
    if (!perm || perm.phasedOut === true) continue;
    if (perm.solved === true) continue;
    const text = oracleOf(perm).toLowerCase();
    if (!/to solve.*three or more creature cards were put into graveyards from anywhere this turn/i.test(text)
      && !/three or more creature cards were put into graveyards from anywhere this turn/i.test(text)) continue;
    perm.solved = true;
    solved += 1;
  }
  return solved;
}

export function applySolvedCaseCreatureTypes(perm: any): { applied: boolean; power?: number; toughness?: number; types?: string[]; keywords?: string[] } {
  if (!perm || perm.solved !== true) return { applied: false };
  const spec = parseSolvedIsCreaturePTKeywords(oracleOf(perm));
  if (!spec) return { applied: false };
  const types = new Set(String(typeLineOf(perm)).split(/\s+/).filter(Boolean));
  for (const t of spec.types) types.add(t);
  perm.card = perm.card || {};
  perm.card.type_line = Array.from(types).join(' ');
  perm.power = spec.power;
  perm.toughness = spec.toughness;
  perm.keywords = Array.from(new Set([...(perm.keywords || []), ...spec.keywords]));
  return { applied: true, ...spec };
}

export function applyBludgeonBrawlToArtifacts(state: any): number {
  const sources = battlefieldOf(state).filter((p) => p && p.phasedOut !== true && parseBludgeonBrawl(oracleOf(p)));
  if (!sources.length) return 0;
  let stamped = 0;
  for (const perm of battlefieldOf(state)) {
    if (!perm || perm.phasedOut === true) continue;
    const tl = typeLineOf(perm).toLowerCase();
    if (!/\bartifact\b/.test(tl) || /\bcreature\b/.test(tl) || /\bequipment\b/.test(tl)) continue;
    const mv = Math.max(0, Math.floor(Number(perm.card?.cmc || perm.card?.mana_value || perm.mana_value || 0)));
    const types = String(typeLineOf(perm));
    if (!/\bequipment\b/i.test(types)) {
      perm.card = perm.card || {};
      perm.card.type_line = `${types} Equipment`.trim();
    }
    perm.bludgeonBrawlEquip = { manaValue: mv, pump: mv };
    perm.grantedEquipCost = `{${mv}}`;
    perm.equippedCreaturePump = { power: mv, toughness: 0 };
    stamped += 1;
  }
  return stamped;
}

export function calculateChosenPlayerHandPT(card: any, gameState: any): { power: number; toughness: number } | undefined {
  if (!parseChosenPlayerHandPT(oracleOf(card) || String(card?.oracle_text || ''))) return undefined;
  const chosen = String(card.chosenPlayer || card.chosen_player || gameState?.battlefield?.find?.((p: any) => p?.card === card || p?.id === card.id)?.chosenPlayer || '');
  const zones = gameState?.zones || {};
  const handCountOf = (pid: string): number => {
    const hand = zones[pid]?.hand;
    return Number(zones[pid]?.handCount ?? (Array.isArray(hand) ? hand.length : 0)) || 0;
  };
  if (!chosen) {
    // As-enters choice still pending: count the largest legal choice so SBAs don't kill it first.
    const perm = gameState?.battlefield?.find?.((p: any) => p?.card === card || p?.id === card.id);
    const controller = String(perm?.controller || card?.controller || '');
    const players: any[] = Array.isArray(gameState?.players) ? gameState.players : [];
    const candidates = players.filter((p: any) => p && !p.hasLost && String(p.id) !== controller);
    const pool = candidates.length > 0 ? candidates : players;
    const count = pool.reduce((best: number, p: any) => Math.max(best, handCountOf(String(p.id))), 0);
    return { power: count, toughness: count };
  }
  const count = handCountOf(chosen);
  return { power: count, toughness: count };
}

function craftExileCards(state: any, equipment: any): any[] {
  const stored = equipment.craftedFromCards || equipment.craftExiledCards || equipment.exiledCardsUsedToCraft || [];
  if (Array.isArray(stored) && stored.length) {
    return stored.filter((c: any) => /\bcreature\b/i.test(typeLineOf(c)));
  }
  const eqId = String(equipment.id || equipment.card?.id || '');
  const out: any[] = [];
  const zones = state?.zones || {};
  for (const pid of Object.keys(zones)) {
    const exile: any[] = Array.isArray(zones[pid]?.exile) ? zones[pid].exile : [];
    for (const card of exile) {
      const linked = String(card.exiledWithSourceId || card.craftedIntoId || card.usedToCraftId || card.exiledFor || '');
      if (linked && linked === eqId && /\bcreature\b/i.test(typeLineOf(card))) out.push(card);
    }
  }
  return out;
}

export function maybeQueuePickAxeAttachChoice(ctx: GameContext, equipment: any, attachedToId: string): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  const state: any = (ctx as any).state;
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  if (!parsePickAxeAsAttachesChoice(oracleOf(equipment)) && !parseEquippedIsCopyOfLastChosen(oracleOf(equipment))) return false;
  const cards = craftExileCards(state, equipment);
  if (!cards.length) return false;
  const controller = String(equipment.controller || '');
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller as PlayerID,
    description: `${String(equipment.card?.name || 'Equipment')}: Choose an exiled creature card used to craft this Equipment. The equipped creature becomes a copy of the last chosen card.`,
    mandatory: true,
    sourceId: String(equipment.id || ''),
    sourceName: String(equipment.card?.name || 'Equipment'),
    pickAxeCraftChoice: true,
    pickAxeEquipmentId: String(equipment.id || ''),
    pickAxeAttachedToId: attachedToId,
    options: cards.map((c) => ({ id: String(c.id), label: String(c.name || 'exiled creature') })),
  } as any);
  return true;
}

export function applyPickAxeChosenCraftCard(state: any, equipmentId: string, chosenCardId: string, attachedToId?: string): boolean {
  const equipment = battlefieldOf(state).find((p) => String(p?.id || '') === String(equipmentId));
  if (!equipment) return false;
  const cards = craftExileCards(state, equipment);
  const chosen = cards.find((c) => String(c.id) === String(chosenCardId));
  if (!chosen) return false;
  equipment.lastChosenCraftCard = chosen;
  const targetId = String(attachedToId || equipment.attachedToId || '');
  const target = battlefieldOf(state).find((p) => String(p?.id || '') === targetId);
  if (target && parseEquippedIsCopyOfLastChosen(oracleOf(equipment))) {
    target.copiedFromCardId = String(chosen.id);
    target.copyOf = String(chosen.name || '');
    target.card = { ...(target.card || {}), ...chosen, id: target.card?.id || target.id };
  }
  return true;
}
