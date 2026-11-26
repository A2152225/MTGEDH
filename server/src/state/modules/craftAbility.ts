/**
 * state/modules/craftAbility.ts
 *
 * Craft (CR 702.167): "Craft with [materials] [cost]" means "[Cost], Exile this permanent, Exile
 * [materials] from among permanents you control and/or cards in your graveyard: Return this card
 * to the battlefield transformed under its owner's control. Activate only as a sorcery."
 *
 * State-side half of the generic craft module (the socket prompt lives in
 * socket/interaction-handlers/activationCraftCost.ts):
 * - parseCraftAbilityText: materials requirement + mana cost from the "Craft with ..." line only
 *   (the reminder text repeats the cost, so it is never parsed).
 * - Material requirements: "one or more [type]", "N [types]", "N that share a card type",
 *   "a Dinosaur, a Merfolk, a Pirate, and a Vampire" (one distinct material per slot), or a
 *   single type ("artifact", "creature", "Island", "Cave").
 * - listCraftMaterialCandidates / craftMaterialsFeasible / validateCraftMaterials.
 * - payCraftExileCosts: exiles the materials and the source, returns the craft stack item.
 * - resolveCraftReturnTransformed: returns the card from exile transformed and links the
 *   exiled materials (craftedFromCards / usedToCraftId) for "exiled cards used to craft".
 * - applyCraftActivationEvents: replay of 'activateCraft' (mana delta, exiles, stack item).
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import { normalizeCreatureTypeWord } from '../../../../shared/src/creatureTypes.js';
import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';
import type { GameContext } from '../context.js';
import type { GameEvent } from '../types';
import { uid } from '../utils.js';
import { getOrInitManaPool } from '../../socket/util.js';
import { debug } from '../../utils/debug.js';
import { linkCraftedMaterials } from './batch102CraftLinkage.js';
import { movePermanentToExile } from './counters_tokens-handlers/countersTokensMoveToExile.js';
import { enterPermanentTransformed } from './day-night.js';
import { markPermanentEnteredFromZone } from './triggerDelayedEffectUtils.js';
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';

export type CraftMaterialSpec =
  | { kind: 'count'; min: number; max: number; noun: string }
  | { kind: 'shareType'; count: number }
  | { kind: 'slots'; slots: string[] };

export type ParsedCraftAbility = { materialsText: string; manaCost: string; spec: CraftMaterialSpec };

export type CraftMaterialCandidate = {
  id: string;
  zone: 'battlefield' | 'graveyard';
  name: string;
  typeLine: string;
  card: any;
};

const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function countWord(word: string): number | undefined {
  const lower = String(word || '').toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return NUMBER_WORDS[lower];
}

/** Material requirement text ("two that share a card type", "one or more Dinosaurs", ...). */
export function parseCraftMaterialSpec(materialsText: string): CraftMaterialSpec {
  const text = String(materialsText || '').trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const oneOrMore = lower.match(/^one or more\s*(.*)$/);
  if (oneOrMore) return { kind: 'count', min: 1, max: Number.POSITIVE_INFINITY, noun: oneOrMore[1].trim() };
  const share = lower.match(/^(\w+) that share a card type$/);
  if (share && countWord(share[1])) return { kind: 'shareType', count: countWord(share[1])! };
  if (/,|\band\b/.test(lower)) {
    const slots = lower
      .split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s+(?=an?\s)/)
      .map((part) => part.replace(/^(?:an?|one)\s+/, '').trim())
      .filter(Boolean);
    if (slots.length > 1) return { kind: 'slots', slots };
  }
  const counted = lower.match(/^(\w+)\s+(.+)$/);
  if (counted && countWord(counted[1])) {
    const n = countWord(counted[1])!;
    return { kind: 'count', min: n, max: n, noun: counted[2].trim() };
  }
  return { kind: 'count', min: 1, max: 1, noun: lower };
}

/** First "Craft with <materials> <cost>" line of an ability or card text; undefined when absent. */
export function parseCraftAbilityText(text: string): ParsedCraftAbility | undefined {
  const match = String(text || '').match(/\bcraft with\s+(.+?)\s*((?:\{[^}]+\})+)/i);
  if (!match) return undefined;
  const materialsText = match[1].trim();
  return { materialsText, manaCost: match[2].toUpperCase(), spec: parseCraftMaterialSpec(materialsText) };
}

function frontTypeLine(card: any, transformed?: boolean): string {
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const raw = String(card?.type_line || '');
  if (raw.includes('//')) return raw.split('//')[transformed ? 1 : 0].trim();
  if (!raw && faces.length) return String(faces[transformed ? 1 : 0]?.type_line || faces[0]?.type_line || '');
  return raw;
}

function cardTypesOf(typeLine: string): string[] {
  const head = typeLine.toLowerCase().split(/[—-]/)[0];
  return CARD_TYPES.filter((type) => new RegExp(`\\b${type}\\b`).test(head));
}

function singular(word: string): string {
  const w = word.toLowerCase();
  if (CARD_TYPES.includes(w)) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Does a material match a noun ("artifact", "creatures", "Island", "Dinosaurs", "" = anything)? */
export function craftMaterialMatchesNoun(candidate: CraftMaterialCandidate, noun: string): boolean {
  const words = String(noun || '').toLowerCase().replace(/\b(?:cards?|permanents?)\b/g, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const typeLine = candidate.typeLine.toLowerCase();
  const typeWords = typeLine.split(/[\s—-]+/).filter(Boolean);
  const types = cardTypesOf(typeLine);
  const oracle = String(candidate.card?.oracle_text || '').toLowerCase();
  const everyCreatureType = (types.includes('creature') || types.includes('kindred') || types.includes('tribal'))
    && (/\bchangeling\b/.test(oracle) || /\bis every creature type\b/.test(oracle));
  return words.every((raw) => {
    const word = singular(raw);
    if (CARD_TYPES.includes(word)) return types.includes(word);
    if (typeWords.includes(word)) return true;
    return everyCreatureType && Boolean(normalizeCreatureTypeWord(word) || normalizeCreatureTypeWord(`${word}s`));
  });
}

/** Other permanents you control plus cards in your graveyard (CR 702.167a). */
export function listCraftMaterialCandidates(state: any, playerId: string, sourcePermanentId: string): CraftMaterialCandidate[] {
  const out: CraftMaterialCandidate[] = [];
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || String(perm.id) === String(sourcePermanentId)) continue;
    if (String(perm.controller || '') !== String(playerId)) continue;
    out.push({
      id: String(perm.id),
      zone: 'battlefield',
      name: String(perm.card?.name || 'Permanent'),
      typeLine: frontTypeLine(perm.card, perm.transformed === true),
      card: perm.card || {},
    });
  }
  const graveyard: any[] = Array.isArray(state?.zones?.[playerId]?.graveyard) ? state.zones[playerId].graveyard : [];
  for (const card of graveyard) {
    if (!card?.id) continue;
    out.push({ id: String(card.id), zone: 'graveyard', name: String(card.name || 'Card'), typeLine: frontTypeLine(card), card });
  }
  return out;
}

function slotsAssignable(slots: string[], chosen: CraftMaterialCandidate[], exact: boolean): boolean {
  if (exact && chosen.length !== slots.length) return false;
  const used = new Set<number>();
  const assign = (slotIndex: number): boolean => {
    if (slotIndex >= slots.length) return true;
    for (let i = 0; i < chosen.length; i++) {
      if (used.has(i) || !craftMaterialMatchesNoun(chosen[i], slots[slotIndex])) continue;
      used.add(i);
      if (assign(slotIndex + 1)) return true;
      used.delete(i);
    }
    return false;
  };
  return assign(0);
}

/** Candidates that could be part of a legal material set (used for the prompt). */
export function filterCraftCandidatesForSpec(spec: CraftMaterialSpec, candidates: CraftMaterialCandidate[]): CraftMaterialCandidate[] {
  if (spec.kind === 'count') return candidates.filter((c) => craftMaterialMatchesNoun(c, spec.noun));
  if (spec.kind === 'slots') return candidates.filter((c) => spec.slots.some((slot) => craftMaterialMatchesNoun(c, slot)));
  return candidates.filter((c) => cardTypesOf(c.typeLine).length > 0);
}

export function craftMaterialsFeasible(spec: CraftMaterialSpec, candidates: CraftMaterialCandidate[]): boolean {
  const pool = filterCraftCandidatesForSpec(spec, candidates);
  if (spec.kind === 'count') return pool.length >= spec.min;
  if (spec.kind === 'slots') return slotsAssignable(spec.slots, pool, false);
  return CARD_TYPES.some((type) => pool.filter((c) => cardTypesOf(c.typeLine).includes(type)).length >= spec.count);
}

/** Same candidates with one legal material set first (AI / first-N pickers stay legal). */
export function orderCraftCandidatesValidFirst(spec: CraftMaterialSpec, pool: CraftMaterialCandidate[]): CraftMaterialCandidate[] {
  let suggested: CraftMaterialCandidate[] = [];
  if (spec.kind === 'count') {
    suggested = pool.slice(0, spec.min);
  } else if (spec.kind === 'shareType') {
    for (const type of CARD_TYPES) {
      const sharing = pool.filter((c) => cardTypesOf(c.typeLine).includes(type));
      if (sharing.length >= spec.count) { suggested = sharing.slice(0, spec.count); break; }
    }
  } else {
    const pick: CraftMaterialCandidate[] = [];
    const used = new Set<number>();
    const assign = (slotIndex: number): boolean => {
      if (slotIndex >= spec.slots.length) return true;
      for (let i = 0; i < pool.length; i++) {
        if (used.has(i) || !craftMaterialMatchesNoun(pool[i], spec.slots[slotIndex])) continue;
        used.add(i); pick.push(pool[i]);
        if (assign(slotIndex + 1)) return true;
        used.delete(i); pick.pop();
      }
      return false;
    };
    if (assign(0)) suggested = pick;
  }
  const ids = new Set(suggested.map((c) => c.id));
  return [...suggested, ...pool.filter((c) => !ids.has(c.id))];
}

export function craftSelectionBounds(spec: CraftMaterialSpec, candidateCount: number): { min: number; max: number } {
  if (spec.kind === 'count') return { min: spec.min, max: Math.min(candidateCount, spec.max) };
  if (spec.kind === 'slots') return { min: spec.slots.length, max: spec.slots.length };
  return { min: spec.count, max: spec.count };
}

/** null when the chosen materials satisfy the requirement, otherwise a player-facing reason. */
export function validateCraftMaterials(spec: CraftMaterialSpec, chosen: CraftMaterialCandidate[]): string | null {
  if (spec.kind === 'count') {
    if (chosen.length < spec.min || chosen.length > spec.max) return `choose ${spec.min === spec.max ? spec.min : `at least ${spec.min}`} material(s)`;
    const bad = chosen.find((c) => !craftMaterialMatchesNoun(c, spec.noun));
    return bad ? `${bad.name} is not ${spec.noun}` : null;
  }
  if (spec.kind === 'slots') {
    return slotsAssignable(spec.slots, chosen, true) ? null : `the materials must be ${spec.slots.map((s) => `a ${s}`).join(', ')} (one each)`;
  }
  if (chosen.length !== spec.count) return `choose exactly ${spec.count} materials`;
  const shared = CARD_TYPES.filter((type) => chosen.every((c) => cardTypesOf(c.typeLine).includes(type)));
  return shared.length > 0 ? null : 'the materials must share a card type';
}

function snapshotMaterial(candidate: CraftMaterialCandidate, isToken: boolean): any {
  const card = candidate.card || {};
  return {
    id: String(card.id || candidate.id),
    materialId: candidate.id,
    zone: candidate.zone,
    name: candidate.name,
    type_line: candidate.typeLine,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: Array.isArray(card.colors) ? [...card.colors] : undefined,
    power: card.power,
    toughness: card.toughness,
    isToken: isToken || undefined,
  };
}

function bumpCount(zone: any, key: string, delta: number): void {
  if (zone && typeof zone[key] === 'number') zone[key] = Math.max(0, zone[key] + delta);
}

/**
 * Pays the non-mana craft costs: exiles each material (permanent or graveyard card) and the source.
 * Returns the craft stack item (not yet pushed) or an error string. Shared by live play and replay.
 */
export function payCraftExileCosts(
  ctx: GameContext,
  args: { playerId: string; permanentId: string; materialIds: string[]; stackItemId?: string; materialsText?: string },
): { stackItem?: any; error?: string } {
  const state: any = ctx.state;
  const playerId = String(args.playerId);
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const source = battlefield.find((perm: any) => perm && String(perm.id) === String(args.permanentId));
  if (!source) return { error: 'the crafting permanent is no longer on the battlefield' };
  const sourceCard = source.card || {};
  const ownerId = String(source.owner || source.controller || playerId);
  const candidates = listCraftMaterialCandidates(state, playerId, String(args.permanentId));
  const chosen = args.materialIds.map((id) => candidates.find((c) => c.id === String(id)));
  if (chosen.some((c) => !c)) return { error: 'a chosen material is no longer available' };

  const materials: any[] = [];
  const exiledMaterialCardIds: string[] = [];
  const zones = state.zones = state.zones || {};
  for (const candidate of chosen as CraftMaterialCandidate[]) {
    if (candidate.zone === 'battlefield') {
      const perm = battlefield.find((p: any) => p && String(p.id) === candidate.id);
      const isToken = perm?.isToken === true;
      materials.push(snapshotMaterial(candidate, isToken));
      movePermanentToExile(ctx, candidate.id, { exiledWithSourceId: String(args.permanentId), exiledWithSourceName: String(sourceCard.name || '') });
      if (!isToken) exiledMaterialCardIds.push(String(candidate.card?.id || candidate.id));
    } else {
      const zone = zones[playerId] = zones[playerId] || {};
      const graveyard: any[] = Array.isArray(zone.graveyard) ? zone.graveyard : [];
      const index = graveyard.findIndex((card: any) => card && String(card.id) === candidate.id);
      if (index < 0) continue;
      const [card] = graveyard.splice(index, 1);
      zone.exile = Array.isArray(zone.exile) ? zone.exile : [];
      zone.exile.push({ ...card, zone: 'exile', exiledWithSourceId: String(args.permanentId) });
      bumpCount(zone, 'graveyardCount', -1);
      bumpCount(zone, 'exileCount', 1);
      materials.push(snapshotMaterial(candidate, false));
      exiledMaterialCardIds.push(String(card.id));
    }
  }
  movePermanentToExile(ctx, String(args.permanentId));

  const stackItem = {
    id: args.stackItemId || uid('ability'),
    type: 'ability',
    abilityType: 'craft',
    controller: playerId,
    source: String(args.permanentId),
    sourceName: String(sourceCard.name || 'Craft'),
    description: `Craft${args.materialsText ? ` with ${args.materialsText}` : ''}: return ${sourceCard.name || 'this card'} transformed under its owner's control.`,
    craftParams: {
      cardId: String(sourceCard.id || ''),
      ownerId,
      cardName: String(sourceCard.name || ''),
      materials,
      exiledMaterialCardIds,
    },
  };
  return { stackItem };
}

function parsePT(value: any): number | undefined {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Resolution: return the exiled card transformed under its owner's control (CR 702.167a). */
export function resolveCraftReturnTransformed(ctx: GameContext, item: any, controller: PlayerID): void {
  const state: any = ctx.state;
  const params = item?.craftParams || {};
  const ownerId = String(params.ownerId || controller);
  const exile: any[] = Array.isArray(state?.zones?.[ownerId]?.exile) ? state.zones[ownerId].exile : [];
  const index = exile.findIndex((card: any) => card && String(card.id) === String(params.cardId));
  if (index < 0) {
    debug(2, `[craft] ${params.cardName || 'card'} is no longer in exile; craft does nothing`);
    return;
  }
  const card = exile[index];
  const faces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  if (faces.length < 2) {
    debug(2, `[craft] ${card?.name || 'card'} has no back face; it stays in exile`);
    return;
  }
  exile.splice(index, 1);
  bumpCount(state.zones[ownerId], 'exileCount', -1);
  const permanent: any = {
    id: uid('perm'),
    controller: ownerId,
    owner: ownerId,
    tapped: false,
    counters: {},
    summoningSickness: true,
    card: { ...card, zone: 'battlefield' },
  };
  const enterFace = enterPermanentTransformed(permanent, 'other');
  if (enterFace.outcome === 'stay_in_zone' || enterFace.outcome === 'graveyard') {
    exile.splice(index, 0, card);
    bumpCount(state.zones[ownerId], 'exileCount', 1);
    return;
  }
  const typeLine = String(permanent.card?.type_line || '').toLowerCase();
  if (typeLine.includes('creature')) {
    permanent.basePower = parsePT(permanent.card?.power);
    permanent.baseToughness = parsePT(permanent.card?.toughness);
  }
  markPermanentEnteredFromZone(permanent, 'exile');
  state.battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  state.battlefield.push(permanent);
  stampPermanentEntryTimestamp(state, permanent);

  const materialIds = new Set<string>((params.exiledMaterialCardIds || []).map((id: any) => String(id)));
  const liveMaterials: any[] = [];
  for (const zoneOwner of Object.keys(state.zones || {})) {
    for (const exiled of (Array.isArray(state.zones[zoneOwner]?.exile) ? state.zones[zoneOwner].exile : [])) {
      if (exiled && materialIds.has(String(exiled.id))) liveMaterials.push(exiled);
    }
  }
  linkCraftedMaterials(state, permanent, liveMaterials);
  permanent.craftMaterialSnapshots = Array.isArray(params.materials) ? params.materials.map((m: any) => ({ ...m })) : [];
  debug(2, `[craft] ${card.name} returned transformed with ${liveMaterials.length} linked material card(s)`);

  if (!(ctx as any).isReplaying) {
    try {
      triggerETBEffectsForPermanent(ctx, permanent, ownerId as PlayerID);
    } catch {
      // The permanent already entered.
    }
  }
}

/** Replay of 'activateCraft' { playerId, permanentId, materialIds, stackItemId, materialsText }. */
export function applyCraftActivationEvents(ctx: GameContext, e: GameEvent): boolean {
  if ((e as any)?.type !== 'activateCraft') return false;
  const ev = e as any;
  const delta = ev.paymentManaDelta;
  if (ev.playerId && delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const pool = getOrInitManaPool(ctx.state as any, String(ev.playerId) as any) as any;
    for (const [key, raw] of Object.entries(delta as Record<string, unknown>)) {
      const amount = Number(raw || 0);
      if (Number.isFinite(amount) && amount !== 0) pool[key] = Number(pool[key] || 0) + amount;
    }
  }
  const result = payCraftExileCosts(ctx, {
    playerId: String(ev.playerId || ''),
    permanentId: String(ev.permanentId || ''),
    materialIds: Array.isArray(ev.materialIds) ? ev.materialIds.map(String) : [],
    stackItemId: ev.stackItemId ? String(ev.stackItemId) : undefined,
    materialsText: ev.materialsText ? String(ev.materialsText) : undefined,
  });
  if (result.stackItem) {
    const state: any = ctx.state;
    state.stack = Array.isArray(state.stack) ? state.stack : [];
    state.stack.push(result.stackItem);
  }
  if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
  return true;
}
