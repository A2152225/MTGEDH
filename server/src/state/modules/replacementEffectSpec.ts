import type { ReplacementEffect } from './game-state-effects.js';
import {
  extractOracleCardLookupKeys,
  resolveCompiledOverlayForCard,
} from './oracleIrCompiledOverlayLookup.js';
import type {
  CardDrawReplacementEvent,
  LifeGainReplacementEvent,
  ReplacementEffectResult,
  ReplacementEvent,
  TokenCreationReplacementEvent,
  ZoneChangeReplacementEvent,
} from './replacement-effects.js';

import type {
  ReplacementEffectSpec,
  ReplacementEffectSpecEvent,
  ReplacementZoneChangeMatch,
} from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
export type {
  ReplacementEffectSpecEvent,
  ReplacementModifyMode,
  ReplacementZoneChangeMatch,
  ReplacementMillMatch,
  ReplacementLibrarySearchMatch,
  ReplacementCounterMatch,
  ReplacementDrawMatch,
  ReplacementLifeGainMatch,
  ReplacementLifeLossMatch,
  ReplacementTokenMatch,
  ReplacementDamageMatch,
  ReplacementLoseGameMatch,
  ReplacementLoseGameInstead,
  ReplacementEffectSpec,
} from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { collectOraclePatternLifeGainReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLifeGainOracleTemplates.js';
import { overlaySpecsMatchLifeGain, matchesLifeGainSpec } from './replacementEffectSpec-handlers/replacementEffectSpecLifeGainMatch.js';
import { collectOraclePatternLifeLossReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLifeLossOracleTemplates.js';
import { collectOraclePatternCounterReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecCounterOracleTemplates.js';
import { collectOraclePatternLibrarySearchReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLibrarySearchOracleTemplates.js';
import { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from './replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { collectOraclePatternDrawReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecDrawOracleTemplates.js';
import { collectOraclePatternTokenReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecTokenOracleTemplates.js';
import { collectOraclePatternMillReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecMillOracleTemplates.js';
import { collectOraclePatternZoneChangeReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecZoneChangeOracleTemplates.js';
import { collectOraclePatternLoseGameReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLoseGameOracleTemplates.js';
import { collectOraclePatternLifeFloorDamageReplacementSpecsFromState } from './replacementEffectSpec-handlers/replacementEffectSpecLifeFloorDamageOracleTemplates.js';

const STACK_GRAVEYARD_EXILE_ABILITIES = ['flashback', 'jump-start', 'escape', 'disturb', 'harmonize'];

export const BUILTIN_REPLACEMENT_EFFECT_SPECS: readonly ReplacementEffectSpec[] = [
  {
    id: 'builtin-stack-graveyard-exile',
    event: 'zone-change',
    match: {
      sourceZone: 'stack',
      destinationZone: 'graveyard',
      castWithAbilityIn: STACK_GRAVEYARD_EXILE_ABILITIES,
      exileAfterResolution: true,
    },
    instead: { redirectZone: 'exile' },
    effectId: 'stack-ability-exile-after-resolution',
    reason: 'cast_with_ability_exiles_after_resolution',
  },
  {
    id: 'builtin-token-ceases-to-exist',
    event: 'zone-change',
    match: {
      sourceZone: 'battlefield',
      objectIsToken: true,
      destinationZoneNot: 'battlefield',
    },
    instead: {},
    effectId: 'token-ceases-to-exist',
    reason: 'token_left_battlefield',
    metadata: { ceasesToExist: true },
  },
  // CR 616.1a: self-replacement effects apply before other replacements. A
  // "if this would leave the battlefield, exile it instead" stamp must redirect
  // to exile before the commander zone-change choice (CR 903.9) is offered.
  {
    id: 'builtin-leave-battlefield-exile-instead',
    event: 'zone-change',
    match: {
      sourceZone: 'battlefield',
      leaveBattlefieldExileInstead: true,
      destinationZoneNot: 'exile',
    },
    instead: { redirectZone: 'exile' },
    effectId: 'leave-battlefield-exile-instead',
    reason: 'explicit_leave_battlefield_replacement',
  },
  {
    id: 'builtin-finality-counter-exile-instead',
    event: 'zone-change',
    match: {
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      objectTypeLineIncludes: 'creature',
      objectHasCounter: 'finality',
    },
    instead: { redirectZone: 'exile' },
    effectId: 'finality-counter-exile-instead',
    reason: 'finality_counter',
  },
  {
    id: 'builtin-commander-zone-replacement-choice',
    event: 'zone-change',
    match: {
      destinationZoneIn: ['graveyard', 'exile', 'hand', 'library'],
      objectIsCommander: true,
    },
    instead: { choiceRequired: true },
    effectId: 'commander-zone-replacement-choice',
    reason: 'commander_zone_replacement_choice',
    metadata: { commandZoneChoice: true },
  },
];



export { overlaySpecsMatchLifeGain };
export {
  collectOraclePatternDrawReplacementSpecsFromState,
  collectOraclePatternLifeGainReplacementSpecsFromState,
  collectOraclePatternLifeLossReplacementSpecsFromState,
  collectOraclePatternTokenReplacementSpecsFromState,
  collectOraclePatternCounterReplacementSpecsFromState,
  collectOraclePatternMillReplacementSpecsFromState,
  collectOraclePatternLibrarySearchReplacementSpecsFromState,
  collectOraclePatternDamageReplacementSpecsFromState,
  overlaySpecsMatchDamage,
  collectOraclePatternZoneChangeReplacementSpecsFromState,
  collectOraclePatternLoseGameReplacementSpecsFromState,
  collectOraclePatternLifeFloorDamageReplacementSpecsFromState,
};

export function matchesSelfShuffleIntoLibraryReplacementOracle(oracleText: string): boolean {
  const normalized = normalizeOraclePatternText(oracleText);
  if (!normalized) return false;
  if (/shuffles? (?:their )?graveyard into (?:their )?library/.test(normalized)) {
    return false;
  }
  if (!normalized.includes('would be put into a graveyard from anywhere')) {
    return false;
  }
  return (
    /\bshuffle (?:it|this(?: card| permanent)?|that card)\b/.test(normalized)
    && /\binto (?:its|their|the) owner(?:'|')?s library\b/.test(normalized)
  );
}

interface IntrinsicZoneChangeReplacementTemplate {
  templateId: string;
  matchesOracle: (oracleText: string) => boolean;
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Replacements defined on the object being moved (Blightsteel, Nexus of Fate). */
const INTRINSIC_ZONE_CHANGE_REPLACEMENT_TEMPLATES: readonly IntrinsicZoneChangeReplacementTemplate[] = [
  {
    templateId: 'self-shuffle-into-library',
    matchesOracle: matchesSelfShuffleIntoLibraryReplacementOracle,
    spec: {
      event: 'zone-change',
      match: { destinationZone: 'graveyard' },
      instead: { redirectZone: 'library' },
      effectId: 'self-shuffle-into-library',
      reason: 'graveyard_self_shuffle_into_library',
      metadata: { shuffleIntoOwnerLibrary: true },
    },
  },
];

export function collectIntrinsicZoneChangeReplacementSpecsFromObject(
  object: unknown,
): ReplacementEffectSpec[] {
  const oracle = readCardOracleText(object);
  if (!oracle) return [];

  const specs: ReplacementEffectSpec[] = [];
  const sourceName = String(
    (object as { name?: string; card?: { name?: string } })?.name
    || (object as { card?: { name?: string } })?.card?.name
    || '',
  ).trim();
  const objectId = getObjectCardId(object as any) || sourceName || 'object';

  for (const template of INTRINSIC_ZONE_CHANGE_REPLACEMENT_TEMPLATES) {
    if (!template.matchesOracle(oracle)) continue;
    specs.push({
      ...template.spec,
      id: `intrinsic:${objectId}:${template.templateId}`,
      sourceName: sourceName || undefined,
    });
  }

  return specs;
}

function matchesDrawSpec(spec: ReplacementEffectSpec, event: CardDrawReplacementEvent): boolean {
  const match = spec.match;
  if (!match) return true;

  if (match.skipWhenEventMetadataTrue
    && event.metadata?.[match.skipWhenEventMetadataTrue] === true) {
    return false;
  }

  if (match.drawingPlayerIsOpponentOfSource === true
    && String(event.playerId || '') === String(spec.sourceController || '')) {
    return false;
  }

  if (match.drawingPlayerIsSourceController === true
    && String(event.playerId || '') !== String(spec.sourceController || '')) {
    return false;
  }

  if (match.minimumDrawCount !== undefined) {
    const count = Math.max(0, Math.floor(Number(event.count || 0)));
    if (count < match.minimumDrawCount) return false;
  }

  return true;
}

const NONCREATURE_TOKEN_NAMES = new Set([
  'treasure',
  'food',
  'clue',
  'blood',
  'gold',
  'map',
  'junk',
  'powerstone',
  'shard',
]);

function tokenCreationEventLooksLikeCreature(event: TokenCreationReplacementEvent): boolean {
  const typeLine = String(
    event.tokenTypeLine
    || event.metadata?.typeLine
    || event.metadata?.type_line
    || '',
  ).toLowerCase();
  if (typeLine.includes('creature')) return true;
  if (typeLine) return false;
  const name = String(event.tokenName || '').trim().toLowerCase();
  if (NONCREATURE_TOKEN_NAMES.has(name)) return false;
  return true;
}

function matchesTokenSpec(spec: ReplacementEffectSpec, event: TokenCreationReplacementEvent): boolean {
  const match = spec.match;
  if (!match) return true;

  const controllerId = String(event.controllerId || '');
  const sourceController = String(spec.sourceController || '');

  if (match.creatingPlayerIsSourceController === true
    && controllerId !== sourceController) {
    return false;
  }

  if (match.tokenIsCreature === true && !tokenCreationEventLooksLikeCreature(event)) {
    return false;
  }

  return true;
}

export function overlaySpecsMatchTokenCreation(
  spec: ReplacementEffectSpec,
  event: { controllerId: string; state?: unknown; tokenName?: string; tokenTypeLine?: string; count?: number },
): boolean {
  return matchesTokenSpec(spec, {
    type: 'token-creation',
    state: event.state,
    controllerId: event.controllerId,
    count: event.count ?? 1,
    tokenName: event.tokenName,
    tokenTypeLine: event.tokenTypeLine,
  });
}

function normalizeReplacementToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function readStackCastWithAbility(stackItem: any): string {
  return normalizeReplacementToken(
    stackItem?.card?.castWithAbility
      || stackItem?.castWithAbility
      || stackItem?.alternativeCost
      || '',
  );
}

function stackItemExilesAfterResolution(stackItem: any): boolean {
  return stackItem?.exileAfterResolution === true
    || stackItem?.card?.exileAfterResolution === true
    || stackItem?.card?.card?.exileAfterResolution === true;
}

function getObjectCardId(object: any): string {
  return String(object?.card?.id || object?.id || '').trim();
}

function objectIsTokenPermanent(object: any): boolean {
  return object?.isToken === true || object?.card?.isToken === true;
}

function normalizeCounterName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ counters?$/i, '')
    .replace(/^an?\s+/i, '')
    .trim();
}

function permanentHasCounter(permanent: any, counterName: string): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return false;
  const target = normalizeCounterName(counterName);
  for (const [name, amountRaw] of Object.entries(counters as Record<string, unknown>)) {
    if (normalizeCounterName(name) === target && Number(amountRaw || 0) > 0) {
      return true;
    }
  }
  return false;
}

function readLeaveBattlefieldReplacementDestination(permanent: any): string {
  return normalizeReplacementToken(
    permanent?.leaveBattlefieldReplacementDestination
      || permanent?.card?.leaveBattlefieldReplacementDestination
      || '',
  );
}

function readReplacementSourceName(permanent: any): string | undefined {
  const value = String(
    permanent?.leaveBattlefieldReplacementSourceName
      || permanent?.card?.leaveBattlefieldReplacementSourceName
      || '',
  ).trim();
  return value || undefined;
}

function readReplacementLifeGain(permanent: any): number | undefined {
  const value = Number(
    permanent?.leaveBattlefieldReplacementLifeGain
      || permanent?.card?.leaveBattlefieldReplacementLifeGain
      || 0,
  );
  return value > 0 ? value : undefined;
}

function objectIsCommander(event: ZoneChangeReplacementEvent): boolean {
  const object = event.object;
  if (object?.isCommander === true || object?.card?.isCommander === true) return true;

  const commanderIds = Array.isArray(event.metadata?.commanderIds) ? event.metadata?.commanderIds : [];
  const cardId = getObjectCardId(object);
  return Boolean(cardId && commanderIds.some((id) => String(id || '') === cardId));
}

function matchesZoneChangeSpec(event: ZoneChangeReplacementEvent, match: ReplacementZoneChangeMatch): boolean {
  if (match.sourceZone && event.sourceZone !== match.sourceZone) return false;
  if (match.destinationZone && event.destinationZone !== match.destinationZone) return false;
  if (match.destinationZoneIn && match.destinationZoneIn.length > 0
    && !match.destinationZoneIn.includes(event.destinationZone)) {
    return false;
  }
  if (match.objectIsCommander === true && !objectIsCommander(event)) return false;
  if (match.destinationZoneNot && event.destinationZone === match.destinationZoneNot) return false;

  const permanent = event.object;
  if (match.leaveBattlefieldExileInstead === true
    && readLeaveBattlefieldReplacementDestination(permanent) !== 'exile') {
    return false;
  }
  if (match.objectIsToken === true && !objectIsTokenPermanent(permanent)) return false;
  if (match.objectHasCounter
    && !permanentHasCounter(permanent, match.objectHasCounter)) {
    return false;
  }
  if (match.objectTypeLineIncludes) {
    const typeLine = normalizeReplacementToken(permanent?.card?.type_line || permanent?.type_line || '');
    if (!typeLine.includes(normalizeReplacementToken(match.objectTypeLineIncludes))) return false;
  }

  const stackItem = event.object;
  const castWithAbility = readStackCastWithAbility(stackItem);
  const explicitExileAfterResolution = match.exileAfterResolution === true && stackItemExilesAfterResolution(stackItem);
  const castWithListedAbility = Array.isArray(match.castWithAbilityIn)
    && match.castWithAbilityIn.length > 0
    && match.castWithAbilityIn.some((ability) => normalizeReplacementToken(ability) === castWithAbility);

  if (match.exileAfterResolution === true || (match.castWithAbilityIn && match.castWithAbilityIn.length > 0)) {
    return explicitExileAfterResolution || castWithListedAbility;
  }

  return true;
}

export function overlaySpecsMatchLibrarySearch(
  spec: ReplacementEffectSpec,
  event: { searchingPlayerId: string },
): boolean {
  const match = spec.match;
  if (!match) return true;
  const searching = String(event.searchingPlayerId || '');
  const sourceController = String(spec.sourceController || '');
  if (match.searchingPlayerIsOpponentOfSource === true && searching === sourceController) {
    return false;
  }
  if (match.searchingPlayerIsSourceController === true && searching !== sourceController) {
    return false;
  }
  return true;
}

export function overlaySpecsMatchMill(
  spec: ReplacementEffectSpec,
  event: { millingPlayerId: string; targetPlayerId: string },
): boolean {
  const match = spec.match;
  if (!match) return true;
  if (match.millingPlayerIsSourceController === true
    && String(event.millingPlayerId) !== String(spec.sourceController || '')) {
    return false;
  }
  if (match.targetIsOpponent === true
    && String(event.targetPlayerId) === String(event.millingPlayerId)) {
    return false;
  }
  return true;
}

export function overlaySpecsMatchCounterPlacement(
  spec: ReplacementEffectSpec,
  input: { counterType: string; targetController: string },
): boolean {
  const match = spec.match;
  if (!match) return true;
  if (match.counterTypeIncludes
    && !String(input.counterType || '').includes(String(match.counterTypeIncludes))) {
    return false;
  }
  if (typeof match.targetControllerIsSourceController === 'boolean') {
    const sameController = String(input.targetController) === String(spec.sourceController || '');
    if (match.targetControllerIsSourceController !== sameController) return false;
  }
  return true;
}

export function overlayReplacementSpecToEffect(spec: ReplacementEffectSpec): ReplacementEffect {
  const modify = spec.instead.modify;
  const source = String(spec.sourceName || spec.effectId || spec.id || 'Replacement effect');
  const controllerId = spec.sourceController;

  if (modify === 'add_flat') {
    return {
      type: 'add_flat',
      value: Number(spec.instead.value ?? 0),
      source,
      controllerId,
    };
  }
  if (modify === 'halve') {
    return { type: 'halve', source, controllerId };
  }
  if (modify === 'cap') {
    return {
      type: 'cap',
      value: Number(spec.instead.value ?? 1),
      source,
      controllerId,
    };
  }
  if (modify === 'triple') {
    return { type: 'triple', source, controllerId };
  }
  return { type: 'double', source, controllerId };
}

function normalizeOverlayReplacementSpec(
  raw: unknown,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const event = String(record.event || '').trim() as ReplacementEffectSpecEvent;
  if (!id || !event) return null;

  const instead = (record.instead && typeof record.instead === 'object')
    ? record.instead as ReplacementEffectSpec['instead']
    : undefined;
  if (!instead) return null;

  return {
    id: `${source.sourcePermanentId}:${id}`,
    event,
    match: (record.match && typeof record.match === 'object')
      ? record.match as ReplacementEffectSpec['match']
      : undefined,
    instead,
    effectId: String(record.effectId || id).trim() || id,
    reason: String(record.reason || '').trim() || undefined,
    metadata: (record.metadata && typeof record.metadata === 'object')
      ? record.metadata as Record<string, unknown>
      : undefined,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
}

function readOverlayReplacementSpecs(ability: {
  ability_type?: string;
  replacement_specs?: readonly unknown[];
  replacementSpecs?: readonly unknown[];
}): readonly unknown[] {
  const specs = ability.replacement_specs ?? ability.replacementSpecs;
  return Array.isArray(specs) ? specs : [];
}

export function collectReplacementEffectSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const overlayByLookupKey = new Map<string, ReturnType<typeof resolveCompiledOverlayForCard>>();

  for (const perm of battlefield) {
    if (!perm?.card || perm?.phasedOut === true) continue;

    const sourcePermanentId = String(perm.id || '').trim();
    const sourceController = String(perm.controller || '').trim();
    const sourceName = String(perm.card?.name || perm.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    const oracleId = String(perm.card?.oracle_id || perm.card?.oracleId || '').trim();
    const cacheKey = oracleId
      ? `id:${oracleId.toLowerCase()}`
      : `name:${sourceName.toLowerCase()}`;
    let overlay = overlayByLookupKey.get(cacheKey);
    if (overlay === undefined) {
      const lookupKeys = extractOracleCardLookupKeys({ card: perm.card, effectiveCard: perm.card });
      overlay = resolveCompiledOverlayForCard(lookupKeys);
      overlayByLookupKey.set(cacheKey, overlay);
    }
    if (!overlay?.abilities?.length) continue;

    for (const ability of overlay.abilities) {
      const abilityType = String(ability.ability_type || '').toUpperCase();
      if (abilityType !== 'REPLACEMENT' && abilityType !== 'STATIC') continue;

      for (const rawSpec of readOverlayReplacementSpecs(ability)) {
        const normalized = normalizeOverlayReplacementSpec(rawSpec, {
          sourcePermanentId,
          sourceController,
          sourceName,
        });
        if (normalized) specs.push(normalized);
      }
    }
  }

  specs.push(...collectOraclePatternDrawReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternLifeGainReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternLifeLossReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternTokenReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternZoneChangeReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternCounterReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternDamageReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternMillReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternLibrarySearchReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternLoseGameReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternLifeFloorDamageReplacementSpecsFromState(state));
  return specs;
}

/**
 * Aggregate amount-modify life-gain replacements (CR 616.1: +N then doublers).
 * First-match evaluateDeclarativeReplacementEvent skips these so they can stack.
 */
export function summarizeLifeGainAmountReplacements(
  state: unknown,
  playerId: string,
): { extraLife: number; multiplier: number; extraSources: string[]; doubleSources: string[] } {
  const pid = String(playerId || '').trim();
  const event: LifeGainReplacementEvent = {
    type: 'life-gain',
    state,
    playerId: pid,
    amount: 1,
  };
  let extraLife = 0;
  let multiplier = 1;
  const extraSources: string[] = [];
  const doubleSources: string[] = [];

  for (const spec of collectReplacementEffectSpecsFromState(state)) {
    if (spec.event !== 'life-gain' || !spec.instead.modify) continue;
    if (!matchesLifeGainSpec(spec, event)) continue;
    const sourceName = String(spec.sourceName || '').trim();
    if (spec.instead.modify === 'add_flat') {
      extraLife += Math.max(0, Math.floor(Number(spec.instead.value || 0)));
      if (sourceName) extraSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'double') {
      multiplier *= 2;
      if (sourceName) doubleSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'triple') {
      multiplier *= 3;
      if (sourceName) doubleSources.push(sourceName);
    }
  }

  return { extraLife, multiplier, extraSources, doubleSources };
}

/**
 * Aggregate amount-modify card-draw replacements (Thought Reflection / Archive).
 * First-match evaluateDeclarativeReplacementEvent skips these so they can stack.
 */
export function summarizeDrawAmountReplacements(
  state: unknown,
  playerId: string,
  metadata?: Record<string, unknown>,
): { extraCards: number; multiplier: number; extraSources: string[]; doubleSources: string[] } {
  const pid = String(playerId || '').trim();
  const event: CardDrawReplacementEvent = {
    type: 'card-draw',
    state,
    playerId: pid,
    count: 1,
    metadata,
  };
  let extraCards = 0;
  let multiplier = 1;
  const extraSources: string[] = [];
  const doubleSources: string[] = [];

  for (const spec of collectReplacementEffectSpecsFromState(state)) {
    if (spec.event !== 'card-draw' || !spec.instead.modify) continue;
    if (!matchesDrawSpec(spec, event)) continue;
    const sourceName = String(spec.sourceName || '').trim();
    if (spec.instead.modify === 'add_flat') {
      extraCards += Math.max(0, Math.floor(Number(spec.instead.value || 0)));
      if (sourceName) extraSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'double') {
      multiplier *= 2;
      if (sourceName) doubleSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'triple') {
      multiplier *= 3;
      if (sourceName) doubleSources.push(sourceName);
    }
  }

  return { extraCards, multiplier, extraSources, doubleSources };
}

/**
 * Aggregate amount-modify token-creation replacements (Anointed Procession / Primal Vigor / Ojer Taq).
 * First-match evaluateDeclarativeReplacementEvent skips these so they can stack.
 */
export function summarizeTokenAmountReplacements(
  state: unknown,
  controllerId: string,
  extras?: { tokenName?: string; tokenTypeLine?: string; metadata?: Record<string, unknown> },
): { extraTokens: number; multiplier: number; extraSources: string[]; doubleSources: string[] } {
  const pid = String(controllerId || '').trim();
  const event: TokenCreationReplacementEvent = {
    type: 'token-creation',
    state,
    controllerId: pid,
    count: 1,
    tokenName: extras?.tokenName,
    tokenTypeLine: extras?.tokenTypeLine,
    metadata: extras?.metadata,
  };
  let extraTokens = 0;
  let multiplier = 1;
  const extraSources: string[] = [];
  const doubleSources: string[] = [];

  for (const spec of collectReplacementEffectSpecsFromState(state)) {
    if (spec.event !== 'token-creation' || !spec.instead.modify) continue;
    if (!matchesTokenSpec(spec, event)) continue;
    const sourceName = String(spec.sourceName || '').trim();
    if (spec.instead.modify === 'add_flat') {
      extraTokens += Math.max(0, Math.floor(Number(spec.instead.value || 0)));
      if (sourceName) extraSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'double') {
      multiplier *= 2;
      if (sourceName) doubleSources.push(sourceName);
      continue;
    }
    if (spec.instead.modify === 'triple') {
      multiplier *= 3;
      if (sourceName) doubleSources.push(sourceName);
    }
  }

  return { extraTokens, multiplier, extraSources, doubleSources };
}

export function evaluateReplacementEffectSpec(
  spec: ReplacementEffectSpec,
  event: ReplacementEvent,
): ReplacementEffectResult | null {
  if (spec.event !== event.type) return null;

  if (event.type === 'zone-change' && spec.match) {
    if (!matchesZoneChangeSpec(event, spec.match)) return null;

    const stackItem = event.object;
    const castWithAbility = readStackCastWithAbility(stackItem);
    const explicitExileAfterResolution = stackItemExilesAfterResolution(stackItem);
    const redirectZone = spec.instead.redirectZone;

    if (spec.instead.choiceRequired) {
      const object = event.object;
      const cardId = getObjectCardId(object);
      const replacementOptions = spec.instead.replacementOptions
        ?? (spec.metadata?.commandZoneChoice === true
          ? ['command', event.destinationZone]
          : undefined);

      return {
        applied: false,
        choiceRequired: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        sourceName: String(object?.card?.name || object?.name || spec.sourceName || '').trim() || undefined,
        originalDestination: event.destinationZone,
        replacementDestination: redirectZone || event.destinationZone,
        replacementOptions,
        reason: spec.reason,
        metadata: {
          ...(spec.metadata || {}),
          ...(cardId && spec.metadata?.commandZoneChoice === true ? { commanderId: cardId } : {}),
        },
      };
    }

    if (spec.metadata?.ceasesToExist === true) {
      return {
        applied: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        originalDestination: event.destinationZone,
        reason: spec.reason,
        metadata: { ceasesToExist: true },
      };
    }

    if (!redirectZone) return null;

    const permanent = event.object;
    const isLeaveBattlefieldExile = spec.effectId === 'leave-battlefield-exile-instead';

    return {
      applied: true,
      eventType: event.type,
      effectId: explicitExileAfterResolution ? 'stack-exile-after-resolution' : (spec.effectId || spec.id),
      sourceName: String(
        spec.sourceName
        || (isLeaveBattlefieldExile ? readReplacementSourceName(permanent) : '')
        || stackItem?.card?.name
        || stackItem?.name
        || '',
      ).trim() || undefined,
      originalDestination: event.destinationZone,
      replacementDestination: redirectZone,
      reason: explicitExileAfterResolution ? 'exile_after_resolution' : spec.reason,
      ...(isLeaveBattlefieldExile ? { lifeGain: readReplacementLifeGain(permanent) } : {}),
      metadata: {
        ...(spec.metadata || {}),
        ...(castWithAbility ? { castWithAbility } : {}),
      },
    };
  }

  if (event.type === 'mill' && spec.instead.modify) {
    if (!overlaySpecsMatchMill(spec, event)) return null;
    return {
      applied: true,
      eventType: event.type,
      effectId: spec.effectId || spec.id,
      sourceName: spec.sourceName,
      originalAmount: Math.max(0, Math.floor(Number(event.count || 0))),
      reason: spec.reason || 'overlay_mill_replacement',
      metadata: {
        overlaySpecId: spec.id,
        replacementEffect: overlayReplacementSpecToEffect(spec),
      },
    };
  }

  if (event.type === 'counter-placement' && spec.instead.modify) {
    const counterKeys = Object.keys(event.deltas || {});
    const counterType = counterKeys[0] || '';
    const targetController = String(event.controllerId || '');
    if (!overlaySpecsMatchCounterPlacement(spec, { counterType, targetController })) return null;
    return {
      applied: true,
      eventType: event.type,
      effectId: spec.effectId || spec.id,
      sourceName: spec.sourceName,
      originalAmount: Object.values(event.deltas || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0),
      reason: spec.reason || 'overlay_counter_replacement',
      metadata: {
        overlaySpecId: spec.id,
        replacementEffect: overlayReplacementSpecToEffect(spec),
      },
    };
  }

  if (event.type === 'damage' && spec.instead.modify) {
    const meta = event.metadata as {
      damageDealer?: string;
      damageSourcePermanentId?: string;
      isCombatDamage?: boolean;
    } | undefined;
    const damageDealer = String(
      meta?.damageDealer
      || (event.source as { controller?: string } | undefined)?.controller
      || '',
    );
    const damageReceiver = String(event.targetPlayerId || event.targetId || '');
    const damageSourcePermanentId = String(
      meta?.damageSourcePermanentId
      || (event.source as { id?: string } | undefined)?.id
      || '',
    );
    const targetPermanentId = String(event.targetId || '').trim();
    // Amount-modify damage matching needs battlefield attachedTo / recipient
    // type; detectDamageReplacementEffects is the stacking path.
    if (!overlaySpecsMatchDamage(
      spec,
      {
        damageDealer,
        damageReceiver,
        damageSourcePermanentId: damageSourcePermanentId || undefined,
        isCombatDamage: meta?.isCombatDamage,
        targetPermanentId: targetPermanentId || undefined,
      },
      event.state,
    )) return null;
    const originalAmount = Math.max(0, Number(event.amount || 0));
    return {
      applied: true,
      eventType: event.type,
      effectId: spec.effectId || spec.id,
      sourceName: spec.sourceName,
      originalAmount,
      reason: spec.reason || 'overlay_damage_replacement',
      metadata: {
        overlaySpecId: spec.id,
        replacementEffect: overlayReplacementSpecToEffect(spec),
      },
    };
  }

  if (event.type === 'card-draw') {
    if (!matchesDrawSpec(spec, event)) return null;
    const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
    if (originalAmount <= 0) return null;

    if (spec.instead.choiceRequired) {
      return {
        applied: false,
        choiceRequired: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        sourceName: spec.sourceName,
        originalAmount,
        replacementAmount: 0,
        reason: spec.reason,
        metadata: {
          ...(spec.metadata || {}),
          playerId: String(event.playerId || ''),
          drawIndex: Number(event.drawIndex || 0) || undefined,
          remainingDrawCountAfterChoice: Math.max(
            0,
            Math.floor(Number(event.metadata?.remainingDrawCountAfterChoice || 0)),
          ),
        },
      };
    }

    if (spec.instead.redirectDrawTo === 'source_controller') {
      return {
        applied: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        sourceName: spec.sourceName,
        originalAmount,
        replacementAmount: 0,
        reason: spec.reason,
        metadata: {
          playerId: String(event.playerId || ''),
          replacementPlayerId: String(spec.sourceController || ''),
        },
      };
    }

    const sharedDrawCount = Number(spec.instead.sharedDrawCount || 0);
    if (sharedDrawCount > 0) {
      return {
        applied: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        sourceName: spec.sourceName,
        originalAmount,
        replacementAmount: sharedDrawCount,
        reason: spec.reason,
        metadata: {
          playerId: String(event.playerId || ''),
          additionalDraws: [{ playerId: String(spec.sourceController || ''), count: sharedDrawCount }],
        },
      };
    }
  }

  if (event.type === 'life-gain') {
    if (!matchesLifeGainSpec(spec, event)) return null;
    const originalAmount = Math.max(0, Math.floor(Number(event.amount || 0)));
    if (originalAmount <= 0) return null;

    if (spec.instead.replaceLifeGainWith === 'none') {
      return {
        applied: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        sourceName: spec.sourceName,
        originalAmount,
        replacementAmount: 0,
        preventedAmount: originalAmount,
        reason: spec.reason || 'life_gain_prevented',
        metadata: {
          playerId: String(event.playerId || ''),
        },
      };
    }

    if (spec.instead.replaceLifeGainWith === 'loss') {
      return {
        applied: true,
        eventType: event.type,
        effectId: spec.effectId || spec.id,
        sourceName: spec.sourceName,
        originalAmount,
        replacementAmount: -originalAmount,
        preventedAmount: 0,
        reason: spec.reason || 'life_gain_reversed_to_loss',
        metadata: {
          playerId: String(event.playerId || ''),
          reversedToLoss: true,
        },
      };
    }
  }

  return null;
}

function readReplacementCardOracleText(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const record = card as Record<string, unknown>;
  return String(record.oracle_text || record.oracleText || '').trim();
}

function readReplacementCardName(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  return String((card as Record<string, unknown>).name || '').trim();
}

/** Graveyard dredge options for declarative card-draw replacement (Phase 5.2). */
export function collectGraveyardDredgeDrawOptions(
  event: CardDrawReplacementEvent,
): Array<{ cardId: string; cardName: string; dredge: number }> {
  if (event.metadata?.skipDredgeReplacement === true) return [];

  const playerId = String(event.playerId || '');
  const zone = (event.state as { zones?: Record<string, { graveyard?: unknown[]; libraryCount?: number }> })?.zones?.[playerId] || {};
  const graveyard = Array.isArray(zone.graveyard) ? zone.graveyard : [];
  const libraryCount = Array.isArray((event.state as { libraries?: Record<string, unknown[]> })?.libraries?.[playerId])
    ? (event.state as { libraries: Record<string, unknown[]> }).libraries[playerId].length
    : Number(zone.libraryCount || 0);
  const options: Array<{ cardId: string; cardName: string; dredge: number }> = [];

  for (const card of graveyard) {
    const oracle = readReplacementCardOracleText(card);
    const match = oracle.match(/\bdredge\s+(\d+)\b/i);
    if (!match) continue;
    const dredge = parseInt(match[1], 10);
    if (!Number.isFinite(dredge) || dredge <= 0 || libraryCount < dredge) continue;
    options.push({
      cardId: String((card as { id?: string })?.id || '').trim(),
      cardName: readReplacementCardName(card) || 'Dredge card',
      dredge,
    });
  }

  return options;
}

function evaluateGraveyardDredgeDrawReplacement(
  event: CardDrawReplacementEvent,
): ReplacementEffectResult | null {
  const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
  if (originalAmount <= 0) return null;

  const dredgeOptions = collectGraveyardDredgeDrawOptions(event);
  if (dredgeOptions.length === 0) return null;

  return {
    applied: false,
    choiceRequired: true,
    eventType: event.type,
    effectId: 'dredge-draw-replacement-choice',
    originalAmount,
    replacementAmount: 0,
    reason: 'dredge_replacement_choice',
    metadata: {
      playerId: String(event.playerId || ''),
      dredgeOptions,
    },
  };
}

export function evaluateDeclarativeReplacementEvent(
  event: ReplacementEvent,
  state?: unknown,
): ReplacementEffectResult | null {
  if (event.type === 'card-draw') {
    const dredgeResult = evaluateGraveyardDredgeDrawReplacement(event);
    if (dredgeResult) return dredgeResult;
  }

  const dynamicSpecs = state ? collectReplacementEffectSpecsFromState(state) : [];
  const intrinsicSpecs = event.type === 'zone-change'
    ? collectIntrinsicZoneChangeReplacementSpecsFromObject((event as ZoneChangeReplacementEvent).object)
    : [];
  for (const spec of [...intrinsicSpecs, ...dynamicSpecs, ...BUILTIN_REPLACEMENT_EFFECT_SPECS]) {
    // Amount-modify families aggregate via detect*/apply*/summarize* helpers (616.1 ordering).
    // Library-search restrictions also aggregate (prevent + limit + control + payment + trigger).
    if (spec.event === 'library-search' || spec.event === 'lose-game') {
      continue;
    }
    if (
      spec.instead.modify
      && (
        event.type === 'mill'
        || event.type === 'counter-placement'
        || event.type === 'damage'
        || event.type === 'life-gain'
        || event.type === 'life-loss'
        || event.type === 'card-draw'
        || event.type === 'token-creation'
      )
    ) {
      continue;
    }
    const result = evaluateReplacementEffectSpec(spec, event);
    if (result && (result.applied || result.choiceRequired)) {
      return result;
    }
  }
  return null;
}
