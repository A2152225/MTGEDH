// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts (lines 716-1388 before extraction)
// Cluster moved: move_zone context/reference resolution helpers - controller & target player lookup,
// chosen-object id normalization, name aliasing, source permanent power/loyalty, graveyard target
// selection, and bound-card zone location lookup.
// Public entry symbols: getControllerId, getOpponents, getTargetPlayerId, getTopCardLibraryOwnerId,
// getBottomCardLibraryOwnerId, getChosenObjectIds, hasExplicitChosenObjectIds,
// chosenObjectIdsAreMatchingCardSelection, normalizeReferenceText,
// buildNameReferenceAliases, getTargetObjectId, getSourcePermanentPower, getSourcePermanentLoyalty,
// isAnotherTargetReference, getBoundTargetObjectId, isUpToOneTargetReference,
// buildNoOpOptionalSingleTargetResult, resolveUniqueChosenGraveyardTargetId,
// pickDeterministicGraveyardTargetId, resolveUniqueChosenAnyGraveyardTargetId,
// resolveBoundGraveyardTargetObjectId, isContextualBoundCardReference, resolveEnchantedCreaturePermanentId,
// isContextualBoundCardsReference, resolveMoveZoneGraveyardCount, collectBothCardsZoneEntries,
// readPlayerOrZoneCards, findBoundCardZoneLocation, ownerIdFromMovedCardSnapshots, inferPreferredSourceCardZones,
// isSourcePermanentOnBattlefield, collectSourceCardZoneMatches, resolveSourceCardZoneLocation.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveReferencedPlayerZone } from './oracleIRExecutorReferenceUtils';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { readPlayerZoneCards } from './oracleIRExecutorPlayerZoneAccess';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseMoveZoneBottomCardFromLibrary,
} from './oracleIRExecutorZoneOps';
import type {
  BoundCardZoneLocation,
  MoveZoneRuntime,
  StepApplyResult,
} from './oracleIRExecutorMoveZoneStepTypes';

export function getControllerId(ctx: OracleIRExecutionContext): PlayerID {
  return (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
}

export function getOpponents(state: GameState, controllerId: PlayerID): any[] {
  const players = (state.players || []) as any[];
  const hasValidController = players.some(p => p?.id === controllerId);
  return hasValidController ? players.filter(p => p?.id && p.id !== controllerId) : [];
}

export function getTargetPlayerId(ctx: OracleIRExecutionContext): PlayerID | '' {
  return (String(
    ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.targetOpponentId ||
      ctx.targetPlayerId ||
      ''
  ).trim() || '') as PlayerID | '';
}

export function getTopCardLibraryOwnerId(
  state: GameState,
  what: unknown,
  ctx: OracleIRExecutionContext,
): PlayerID | '' {
  if ((what as any)?.kind !== 'raw') return '' as PlayerID | '';
  const whatText = String((what as any)?.text || '').trim().toLowerCase();
  if (!whatText) return '' as PlayerID | '';

  if (whatText === 'the top card of your library') {
    return getControllerId(ctx);
  }

  if (
    whatText === "the top card of target player's library" ||
    whatText === "the top card of target opponent's library" ||
    whatText === "the top card of that player's library" ||
    whatText === "the top card of that opponent's library"
  ) {
    return getTargetPlayerId(ctx);
  }

  if (
    whatText === "the top card of its controller's library" ||
    whatText === "the top card of its owner's library"
  ) {
    const zonePhrase = whatText.replace(/^the top card of /, '');
    const referencedZone = resolveReferencedPlayerZone(state, ctx, zonePhrase);
    return (referencedZone?.playerId || '') as PlayerID | '';
  }

  return '' as PlayerID | '';
}

export function getBottomCardLibraryOwnerId(what: unknown, ctx: OracleIRExecutionContext): PlayerID | '' {
  const parsed = parseMoveZoneBottomCardFromLibrary(what as any);
  if (parsed === 'your') return getControllerId(ctx);
  if (parsed === 'target_player') return getTargetPlayerId(ctx);
  return '' as PlayerID | '';
}

export function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of chosen) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

export function hasExplicitChosenObjectIds(ctx: OracleIRExecutionContext): boolean {
  return Array.isArray(ctx.selectorContext?.chosenObjectIds);
}

/**
 * True when chosenObjectIds is a real selection among `matchingCardIds`:
 * an explicit empty list (chose zero) or at least one id that is currently matching.
 *
 * Trigger bindings stamp interveningIfSubjectPermanentId (the entering permanent)
 * into chosenObjectIds. That must not count as "the player already picked these
 * cards from hand" (Ghalta, Stampede Tyrant ETB via Savage Order).
 */
export function chosenObjectIdsAreMatchingCardSelection(
  ctx: OracleIRExecutionContext,
  matchingCardIds: Iterable<string>,
): boolean {
  if (!hasExplicitChosenObjectIds(ctx)) return false;
  const preferred = getChosenObjectIds(ctx);
  if (preferred.length === 0) return true;
  const matching = matchingCardIds instanceof Set
    ? matchingCardIds
    : new Set(Array.from(matchingCardIds).map((id) => String(id || '').trim()).filter(Boolean));
  return preferred.some((id) => matching.has(id));
}

export function normalizeReferenceText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildNameReferenceAliases(value: unknown): readonly string[] {
  const normalized = normalizeReferenceText(value);
  if (!normalized) return [];

  const aliases = new Set<string>();
  aliases.add(normalized);
  for (const face of normalized.split(/\s*\/\/\s*/).map(part => part.trim()).filter(Boolean)) {
    aliases.add(face);
    const commaHead = String(face.split(',')[0] || '').trim();
    if (commaHead.length >= 3) aliases.add(commaHead);
  }

  return [...aliases];
}

export function getTargetObjectId(ctx: OracleIRExecutionContext): string {
  return String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
}

export function getSourcePermanentPower(state: GameState, ctx: OracleIRExecutionContext): number | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return undefined;

  const sourcePermanent = ((state as any).battlefield || []).find(
    (candidate: any) => String(candidate?.id || '').trim() === sourceId
  ) as any;
  if (!sourcePermanent) return undefined;

  if (typeof sourcePermanent.effectivePower === 'number' && Number.isFinite(sourcePermanent.effectivePower)) {
    return sourcePermanent.effectivePower;
  }

  let power =
    typeof sourcePermanent.basePower === 'number' && Number.isFinite(sourcePermanent.basePower)
      ? sourcePermanent.basePower
      : Number.parseInt(
          String(sourcePermanent.power ?? sourcePermanent.card?.power ?? ''),
          10
        );
  if (!Number.isFinite(power)) return undefined;

  const counters = sourcePermanent.counters || {};
  power += Number(counters['+1/+1'] || 0);
  power -= Number(counters['-1/-1'] || 0);
  return power;
}

export function getSourcePermanentLoyalty(state: GameState, ctx: OracleIRExecutionContext): number | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return undefined;

  const sourcePermanent = ((state as any).battlefield || []).find(
    (candidate: any) => String(candidate?.id || '').trim() === sourceId
  ) as any;
  if (!sourcePermanent) return undefined;

  const loyalty = Number(
    sourcePermanent.loyalty ??
      sourcePermanent.counters?.loyalty ??
      sourcePermanent.card?.loyalty ??
      NaN
  );
  return Number.isFinite(loyalty) ? loyalty : undefined;
}

export function isAnotherTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:up to one\s+)?(?:(?:another|other)\s+target)\b/.test(text);
}

export function getBoundTargetObjectId(
  ctx: OracleIRExecutionContext,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  runtime?: MoveZoneRuntime
): string {
  const directId = getTargetObjectId(ctx);
  if (!isAnotherTargetReference(step.what)) {
    if (directId) return directId;
    const chosen = getChosenObjectIds(ctx);
    return chosen.length === 1 ? chosen[0] : '';
  }

  const excluded = new Set<string>();
  if (directId) excluded.add(directId);
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const remaining = getChosenObjectIds(ctx).filter(id => !excluded.has(id));
  return remaining.length === 1 ? remaining[0] : '';
}

export function isUpToOneTargetReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^up to one\s+(?:another\s+)?target\b/.test(text);
}

export function buildNoOpOptionalSingleTargetResult(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): StepApplyResult {
  return {
    applied: true,
    state,
    log: [`Skipped optional targetless move zone slot: ${step.raw}`],
    lastMovedCards: [],
  };
}

export function resolveUniqueChosenGraveyardTargetId(
  state: GameState,
  playerId: PlayerID,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string,
  referencePower?: number
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const chosen = new Set(getChosenObjectIds(ctx));

  const graveyard = readPlayerOrZoneCards(state, player, playerId, 'graveyard');
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  const excluded = new Set<string>();
  const graveyardIds = new Set<string>();
  for (const card of graveyard) {
    const cardId = String((card as any)?.id || '').trim();
    if (cardId) graveyardIds.add(cardId);
  }
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId && !graveyardIds.has(movedId)) excluded.add(movedId);
  }

  const legalMatches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || excluded.has(cardId)) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower);
  });

  const matches =
    chosen.size > 0
      ? legalMatches.filter((card: any) => chosen.has(String(card?.id || '').trim()))
      : legalMatches;

  if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
  if (matches.length > 1) {
    for (const preferredId of getChosenObjectIds(ctx)) {
      const preferred = matches.find((card: any) => String(card?.id || '').trim() === preferredId);
      if (preferred) return String((preferred as any)?.id || '').trim();
    }
    return String((matches[0] as any)?.id || '').trim();
  }
  if (legalMatches.length === 1) return String((legalMatches[0] as any)?.id || '').trim();
  if (legalMatches.length > 1 && chosen.size === 0) {
    return String((legalMatches[0] as any)?.id || '').trim();
  }
  return '';
}

const AUDIT_PREFERRED_GY_TARGET_IDS = [
  'gy-creature-1',
  'gy-land-1',
  'gy-equipment-1',
  'gy-vehicle-1',
  'gy-instant-1',
  'gy-antecedent-1',
] as const;

export function pickDeterministicGraveyardTargetId(
  matches: readonly any[],
  criteria?: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria
): string {
  if (matches.length === 0) return '';
  if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();

  const cardType = String(criteria?.cardType || '').trim();
  const typePreferredIds: Record<string, readonly string[]> = {
    land: ['gy-land-1'],
    equipment: ['gy-equipment-1'],
    vehicle: ['gy-vehicle-1'],
    artifact: ['gy-artifact-spell-1', 'gy-noncreature-nonland'],
    enchantment: ['gy-aura-1'],
    instant: ['gy-blue-instant-1', 'gy-instant-1', 'gy-black-spell-1'],
    sorcery: ['gy-red-sorcery-1', 'gy-instant-1'],
    creature: ['gy-creature-1', 'gy-antecedent-1', 'gy-elf-1', 'gy-spirit-1', 'gy-outlaw-1'],
  };
  for (const preferredId of typePreferredIds[cardType] || []) {
    const hit = matches.find((card) => String((card as any)?.id || '').trim() === preferredId);
    if (hit) return preferredId;
  }

  for (const preferredId of AUDIT_PREFERRED_GY_TARGET_IDS) {
    const hit = matches.find((card) => String((card as any)?.id || '').trim() === preferredId);
    if (hit) return preferredId;
  }

  const sorted = [...matches].sort((left, right) =>
    String((left as any)?.id || '').trim().localeCompare(String((right as any)?.id || '').trim())
  );
  return String((sorted[0] as any)?.id || '').trim();
}

export function resolveUniqueChosenAnyGraveyardTargetId(
  state: GameState,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  ctx: OracleIRExecutionContext,
  runtime: MoveZoneRuntime | undefined,
  referenceCardName?: string,
  referencePower?: number
): string {
  const chosen = new Set(getChosenObjectIds(ctx));

  const excluded = new Set<string>();
  for (const moved of Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : []) {
    const movedId = String((moved as any)?.id || '').trim();
    if (movedId) excluded.add(movedId);
  }

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    const graveyard = playerId
      ? readPlayerOrZoneCards(state, player, playerId, 'graveyard')
      : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || excluded.has(cardId)) continue;
      if (chosen.size > 0 && !chosen.has(cardId)) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) continue;
      matches.push(card);
    }
  }

  if (matches.length > 0) return pickDeterministicGraveyardTargetId(matches, criteria);

  if (chosen.size === 0) {
    const allMatches: any[] = [];
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      const graveyard = playerId
        ? readPlayerOrZoneCards(state, player, playerId, 'graveyard')
        : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || excluded.has(cardId)) continue;
        if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) continue;
        allMatches.push(card);
      }
    }
    return pickDeterministicGraveyardTargetId(allMatches, criteria);
  }

  return '';
}

export function resolveBoundGraveyardTargetObjectId(
  state: GameState,
  boundTargetObjectId: string,
  criteria: import('./oracleIRExecutorZoneOps').MoveZoneSingleTargetCriteria,
  referenceCardName?: string,
  referencePower?: number
): string {
  const bound = String(boundTargetObjectId || '').trim();
  if (!bound) return '';

  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    const graveyard = playerId
      ? readPlayerOrZoneCards(state, player, playerId, 'graveyard')
      : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === bound);
    if (!card) continue;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) {
      return '';
    }
    return bound;
  }
  return '';
}

export function isContextualBoundCardReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return (
    text === 'it' ||
    text === 'him' ||
    text === 'her' ||
    text === 'that spell' ||
    text === 'the card' ||
    text === 'the chosen card' ||
    /^one of those cards(?: back)?$/.test(text) ||
    /^that card from a graveyard$/.test(text) ||
    /^that (?:(?:[a-z0-9+'/-]+\s+)*(?:card|creature|permanent|spell))(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile)))?$/.test(
      text
    )
  );
}

export function resolveEnchantedCreaturePermanentId(state: GameState, ctx: OracleIRExecutionContext): string {
  const sourceId = String(ctx.sourceId || '').trim();
  const controllerId = getControllerId(ctx);
  const battlefield = (state.battlefield || []) as any[];

  if (sourceId) {
    const sourcePermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === sourceId) as any;
    const attachedToId = String(sourcePermanent?.attachedTo || '').trim();
    if (attachedToId) {
      const attachedPermanent = battlefield.find(perm => String((perm as any)?.id || '').trim() === attachedToId);
      if (attachedPermanent && hasExecutorClass(attachedPermanent as any, 'creature')) return attachedToId;
    }
  }

  for (const perm of battlefield) {
    if ((perm as any)?.controller !== controllerId) continue;
    if (!hasExecutorClass(perm as any, 'enchantment')) continue;
    const attachedToId = String((perm as any)?.attachedTo || '').trim();
    if (!attachedToId) continue;
    const attachedPermanent = battlefield.find(candidate => String((candidate as any)?.id || '').trim() === attachedToId);
    if (attachedPermanent && hasExecutorClass(attachedPermanent as any, 'creature')) return attachedToId;
  }

  return '';
}

export function isContextualBoundCardsReference(what: unknown): boolean {
  const text = String((what as any)?.text || (what as any)?.raw || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  return /^(?:each of )?(?:those cards|those creatures|those creature cards|those permanents|those permanent cards)(?: from (?:(?:the |your |their |target player's |target opponent's |an opponent's |its owner's |its controller's |that player's |one of your opponents' )?(?:graveyard|hand|exile|library)))?$/.test(
    text
  );
}

export function resolveMoveZoneGraveyardCount(
  parsed: { readonly count: number },
  ctx: OracleIRExecutionContext
): number {
  if (parsed.count < 0) {
    return Math.max(0, Number(ctx.referenceAmount ?? ctx.xValue ?? 3));
  }
  return parsed.count;
}

export function collectBothCardsZoneEntries(
  state: GameState,
  controllerId: PlayerID,
  ctx: OracleIRExecutionContext,
  runtime?: MoveZoneRuntime
): Array<{ readonly playerId: PlayerID; readonly cardId: string; readonly zone: BoundCardZoneLocation['zone'] }> {
  const wanted = new Set<string>();
  const results: Array<{ readonly playerId: PlayerID; readonly cardId: string; readonly zone: BoundCardZoneLocation['zone'] }> = [];

  const tryAdd = (cardId: string) => {
    const normalizedId = String(cardId || '').trim();
    if (!normalizedId || wanted.has(normalizedId)) return;
    const location = findBoundCardZoneLocation(state, normalizedId);
    if (!location || (location.zone !== 'hand' && location.zone !== 'exile' && location.zone !== 'graveyard')) {
      return;
    }
    wanted.add(normalizedId);
    results.push({ playerId: location.playerId, cardId: normalizedId, zone: location.zone });
  };

  for (const id of getChosenObjectIds(ctx)) tryAdd(id);
  if (Array.isArray(runtime?.lastMovedCards)) {
    for (const card of runtime.lastMovedCards) tryAdd(String((card as any)?.id || '').trim());
  }

  if (results.length < 2) {
    const player = state.players.find(entry => entry.id === controllerId) as any;
    for (const zone of ['exile', 'hand'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      for (const card of cards) {
        tryAdd(String((card as any)?.id || '').trim());
        if (results.length >= 2) break;
      }
      if (results.length >= 2) break;
    }
  }

  return results.slice(0, 2);
}

export function readPlayerOrZoneCards(
  state: GameState,
  player: any,
  playerId: PlayerID,
  zone: 'graveyard' | 'hand' | 'exile' | 'library',
): any[] {
  if (zone === 'library') {
    return readPlayerZoneCards(state, playerId, player, 'library');
  }
  const fromPlayer = Array.isArray(player?.[zone]) ? player[zone] : [];
  const fromZones = Array.isArray((state as any).zones?.[playerId]?.[zone])
    ? (state as any).zones[playerId][zone]
    : [];
  if (fromPlayer.length === 0) return fromZones;
  if (fromZones.length === 0) return fromPlayer;
  const seen = new Set(fromPlayer.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
  const merged = [...fromPlayer];
  for (const card of fromZones) {
    const cardId = String(card?.id || '').trim();
    if (cardId && seen.has(cardId)) continue;
    if (cardId) seen.add(cardId);
    merged.push(card);
  }
  return merged;
}

export function ownerIdFromMovedCardSnapshots(
  cards: readonly any[] | undefined,
  cardId: string,
): string | undefined {
  const wanted = String(cardId || '').trim();
  if (!wanted || !Array.isArray(cards)) return undefined;
  for (const card of cards) {
    if (String(card?.id || '').trim() !== wanted) continue;
    const ownerId = String((card as any)?.owner || (card as any)?.ownerId || '').trim();
    if (ownerId) return ownerId;
  }
  return undefined;
}

function pickBoundCardZoneLocation(matches: readonly BoundCardZoneLocation[]): BoundCardZoneLocation | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const libraryMatches = matches.filter((entry) => entry.zone === 'library');
  if (libraryMatches.length === 1) return libraryMatches[0];
  return null;
}

export function findBoundCardZoneLocation(
  state: GameState,
  targetCardId: string,
  preferredPlayerId?: string,
): BoundCardZoneLocation | null {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return null;

  const preferredOwner = String(preferredPlayerId || '').trim();
  const matches: BoundCardZoneLocation[] = [];
  const seen = new Set<string>();
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    if (preferredOwner && playerId !== preferredOwner) continue;

    for (const zone of ['graveyard', 'hand', 'exile', 'library'] as const) {
      const cards = readPlayerOrZoneCards(state, player, playerId, zone);
      if (cards.some((card: any) => String(card?.id || '').trim() === wantedId)) {
        const key = `${playerId}:${zone}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ playerId, zone });
      }
    }
  }

  return pickBoundCardZoneLocation(matches);
}

export function inferPreferredSourceCardZones(stepRaw: string | undefined): readonly ('graveyard' | 'hand' | 'exile')[] | null {
  const normalized = normalizeReferenceText(stepRaw || '');
  if (!normalized) return null;
  if (/\bfrom your graveyard\b/.test(normalized) || /\bexile this card from your graveyard\b/.test(normalized)) {
    return ['graveyard'];
  }
  if (/\bfrom your hand\b/.test(normalized)) return ['hand'];
  if (/\bfrom (?:(?:the )?exile|your exile)\b/.test(normalized)) return ['exile'];
  if (/\breturn this card\b/.test(normalized) && !/\bfrom\b/.test(normalized) && /\bto the battlefield\b/.test(normalized)) {
    return ['graveyard'];
  }
  if (
    /\breturn this permanent\b/.test(normalized) &&
    !/\bfrom\b/.test(normalized) &&
    /\bto the battlefield\b/.test(normalized)
  ) {
    return ['graveyard'];
  }
  if (
    /\breturn this (?:card|creature|enchantment|artifact|permanent|land)\b/.test(normalized) &&
    !/\bfrom\b/.test(normalized) &&
    /\bto (?:its owner's|your|their) hand\b/.test(normalized)
  ) {
    return [];
  }
  return null;
}

export function isSourcePermanentOnBattlefield(state: GameState, ctx: OracleIRExecutionContext): boolean {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return false;
  return ((state.battlefield || []) as any[]).some(
    (permanent: any) =>
      String(permanent?.id || '').trim() === sourceId || String(permanent?.card?.id || '').trim() === sourceId
  );
}

export function collectSourceCardZoneMatches(
  state: GameState,
  sourceNameAliases: ReadonlySet<string>,
  zones: readonly ('graveyard' | 'hand' | 'exile')[],
  preferredPlayerId?: PlayerID
): Array<BoundCardZoneLocation & { readonly cardId: string }> {
  const matches: Array<BoundCardZoneLocation & { readonly cardId: string }> = [];
  const players = [...(state.players || [])];
  if (preferredPlayerId) {
    players.sort((left, right) => {
      const leftId = String((left as any)?.id || '').trim();
      const rightId = String((right as any)?.id || '').trim();
      if (leftId === preferredPlayerId) return -1;
      if (rightId === preferredPlayerId) return 1;
      return 0;
    });
  }

  for (const player of players) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    for (const zone of zones) {
      const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      for (const card of cards) {
        const cardId = String((card as any)?.id || '').trim();
        const cardNameAliases = new Set(buildNameReferenceAliases((card as any)?.name));
        if (!cardId || cardNameAliases.size === 0) continue;
        if ([...sourceNameAliases].some(alias => cardNameAliases.has(alias))) {
          matches.push({ playerId, zone, cardId });
        }
      }
    }
  }

  return matches;
}

export function resolveSourceCardZoneLocation(
  state: GameState,
  what: unknown,
  ctx: OracleIRExecutionContext,
  stepRaw?: string
): BoundCardZoneLocation & { readonly cardId: string } | null {
  const rawText = normalizeReferenceText((what as any)?.text || (what as any)?.raw || '');
  if (!rawText) return null;

  const withoutSourceZoneSuffix = rawText.replace(/\s+from your (?:graveyard|hand|exile)$/i, '').trim();

  const selfReference = /^(?:this card|this permanent|this aura|this equipment|this enchantment|this artifact|this creature|this land)$/i.test(
    withoutSourceZoneSuffix
  );
  const sourceNameAliases = new Set(buildNameReferenceAliases(ctx.sourceName));
  const matchesSourceName = sourceNameAliases.has(rawText) || sourceNameAliases.has(withoutSourceZoneSuffix);
  if (!selfReference && !matchesSourceName) return null;

  const preferredZones = inferPreferredSourceCardZones(stepRaw);
  // "Return this creature to its owner's hand" with no source zone normally bounces the permanent,
  // which the battlefield path owns. On a dies trigger the card is already in a graveyard, so fall
  // back to that zone rather than declaring the selector unsupported.
  const zonesToSearch =
    preferredZones && preferredZones.length === 0
      ? isSourcePermanentOnBattlefield(state, ctx)
        ? null
        : (['graveyard'] as const)
      : preferredZones || (['graveyard', 'hand', 'exile'] as const);
  if (!zonesToSearch) return null;
  const controllerId = getControllerId(ctx);
  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const exactLocation = findBoundCardZoneLocation(state, sourceId);
    if (exactLocation && zonesToSearch.some(zone => zone === exactLocation.zone)) {
      return { ...exactLocation, cardId: sourceId };
    }

    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      for (const zone of zonesToSearch) {
        const cards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
        for (const card of cards) {
          const cardId = String((card as any)?.id || '').trim();
          if (!cardId) continue;
          if (cardId === sourceId || cardId.startsWith(`${sourceId}-`)) {
            return { playerId, zone, cardId };
          }
        }
      }
    }
  }

  const preferredMatches = collectSourceCardZoneMatches(state, sourceNameAliases, zonesToSearch, controllerId);
  if (preferredMatches.length === 1) return preferredMatches[0];
  if (preferredMatches.length > 1) {
    if (sourceId) {
      const sourceDerived = preferredMatches.filter(
        match => match.cardId === sourceId || match.cardId.startsWith(`${sourceId}-`)
      );
      if (sourceDerived.length === 1) return sourceDerived[0];
    }
    const nonFixture = preferredMatches.filter(match => match.cardId !== 'gy-source-self');
    if (nonFixture.length === 1) return nonFixture[0];
  }
  return null;
}
