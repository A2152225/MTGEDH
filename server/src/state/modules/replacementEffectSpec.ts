import type { ReplacementEffect } from './game-state-effects.js';
import {
  extractOracleCardLookupKeys,
  resolveCompiledOverlayForCard,
} from './oracleIrCompiledOverlayLookup.js';
import type {
  CardDrawReplacementEvent,
  ReplacementEffectResult,
  ReplacementEvent,
  ReplacementZone,
  ZoneChangeReplacementEvent,
} from './replacement-effects.js';

/** Declarative replacement spec (Phase 5.1). See docs/oracle-ir-phase5-continuous-effects-design.md */
export type ReplacementEffectSpecEvent = ReplacementEvent['type'];

export type ReplacementModifyMode = 'double' | 'add_flat' | 'halve';

export interface ReplacementZoneChangeMatch {
  sourceZone?: ReplacementZone;
  destinationZone?: ReplacementZone;
  /** Destination must be one of these zones (e.g. commander replacement). */
  destinationZoneIn?: ReplacementZone[];
  /** Object is a commander (`isCommander` flag or `metadata.commanderIds`). */
  objectIsCommander?: boolean;
  /** Stack item `castWithAbility` / alternative-cost marker must be one of these (lowercase). */
  castWithAbilityIn?: string[];
  /** Stack item has `exileAfterResolution` metadata. */
  exileAfterResolution?: boolean;
  /** Permanent metadata requests exile instead of leaving the battlefield. */
  leaveBattlefieldExileInstead?: boolean;
  /** Object is a token (`isToken` on permanent or card). */
  objectIsToken?: boolean;
  /** Object has a positive counter of this type (e.g. `finality`). */
  objectHasCounter?: string;
  /** Object type line must include this substring (lowercase). */
  objectTypeLineIncludes?: string;
  /** Destination must not be this zone. */
  destinationZoneNot?: ReplacementZone;
}

export interface ReplacementMillMatch {
  millingPlayerIsSourceController?: boolean;
  targetIsOpponent?: boolean;
}

export interface ReplacementCounterMatch {
  counterTypeIncludes?: string;
  targetControllerIsSourceController?: boolean;
}

export interface ReplacementDrawMatch {
  /** Drawing player must be an opponent of the spec source controller. */
  drawingPlayerIsOpponentOfSource?: boolean;
  /** Skip when `event.metadata[key] === true`. */
  skipWhenEventMetadataTrue?: string;
  /** Minimum draw count on the event (e.g. Alms Collector). */
  minimumDrawCount?: number;
}

export interface ReplacementEffectSpec {
  id: string;
  event: ReplacementEffectSpecEvent;
  match?: ReplacementZoneChangeMatch & ReplacementMillMatch & ReplacementCounterMatch & ReplacementDrawMatch;
  instead: {
    redirectZone?: ReplacementZone;
    choiceRequired?: boolean;
    replacementOptions?: ReplacementZone[];
    modify?: ReplacementModifyMode;
    value?: number;
    /** Redirect the draw to the source permanent's controller (Notion Thief). */
    redirectDrawTo?: 'source_controller';
    /** Each affected player draws this many instead (Alms Collector). */
    sharedDrawCount?: number;
  };
  effectId?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  sourcePermanentId?: string;
  sourceController?: string;
  sourceName?: string;
}

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
];

function normalizeOraclePatternText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

interface OracleDrawReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern draw replacements (no card-name routing). */
const ORACLE_DRAW_REPLACEMENT_TEMPLATES: readonly OracleDrawReplacementTemplate[] = [
  {
    templateId: 'player-draw-reveal-choice',
    oracleMustIncludeAll: ['if a player would draw a card', 'reveal', 'it instead'],
    spec: {
      event: 'card-draw',
      match: { skipWhenEventMetadataTrue: 'skipZursWeirdingReplacement' },
      instead: { choiceRequired: true },
      effectId: 'zurs-weirding-draw-replacement',
      reason: 'zurs_weirding_draw_replacement',
    },
  },
  {
    templateId: 'opponent-draw-redirect',
    oracleMustIncludeAll: ['if an opponent would draw a card', 'instead you draw a card'],
    spec: {
      event: 'card-draw',
      match: {
        drawingPlayerIsOpponentOfSource: true,
        skipWhenEventMetadataTrue: 'isFirstDrawStepDraw',
      },
      instead: { redirectDrawTo: 'source_controller' },
      effectId: 'draw-replaced-by-opponent',
      reason: 'draw_replaced_by_opponent',
    },
  },
  {
    templateId: 'opponent-multi-draw-shared',
    oracleMustIncludeAll: [
      'opponent would draw two or more cards',
      'instead you and that player each draw a card',
    ],
    spec: {
      event: 'card-draw',
      match: { drawingPlayerIsOpponentOfSource: true, minimumDrawCount: 2 },
      instead: { sharedDrawCount: 1 },
      effectId: 'draw-replaced-by-shared-draw',
      reason: 'draw_replaced_by_shared_draw',
    },
  },
];

function readCardOracleText(card: unknown): string {
  if (!card || typeof card !== 'object') return '';
  const record = card as Record<string, unknown>;
  return String(record.oracle_text || record.oracleText || '').trim();
}

export function collectOraclePatternDrawReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || !(perm as { card?: unknown }).card) continue;
    const permRecord = perm as {
      id?: string;
      controller?: string;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card));
    if (!oracle) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    for (const template of ORACLE_DRAW_REPLACEMENT_TEMPLATES) {
      if (!template.oracleMustIncludeAll.every((phrase) => oracle.includes(phrase))) continue;
      specs.push({
        ...template.spec,
        id: `${sourcePermanentId}:${template.templateId}`,
        sourcePermanentId,
        sourceController,
        sourceName,
      });
    }
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

  if (match.minimumDrawCount !== undefined) {
    const count = Math.max(0, Math.floor(Number(event.count || 0)));
    if (count < match.minimumDrawCount) return false;
  }

  return true;
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
  if (match.targetControllerIsSourceController === true
    && String(input.targetController) !== String(spec.sourceController || '')) {
    return false;
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

  for (const perm of battlefield) {
    if (!perm?.card || perm?.phasedOut === true) continue;

    const sourcePermanentId = String(perm.id || '').trim();
    const sourceController = String(perm.controller || '').trim();
    const sourceName = String(perm.card?.name || perm.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    const lookupKeys = extractOracleCardLookupKeys({ card: perm.card, effectiveCard: perm.card });
    const overlay = resolveCompiledOverlayForCard(lookupKeys);
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
  return specs;
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
      sourceName: isLeaveBattlefieldExile
        ? readReplacementSourceName(permanent)
        : String(stackItem?.card?.name || stackItem?.name || spec.sourceName || '').trim() || undefined,
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
  for (const spec of [...dynamicSpecs, ...BUILTIN_REPLACEMENT_EFFECT_SPECS]) {
    if ((event.type === 'mill' || event.type === 'counter-placement') && spec.instead.modify) {
      continue;
    }
    const result = evaluateReplacementEffectSpec(spec, event);
    if (result && (result.applied || result.choiceRequired)) {
      return result;
    }
  }
  return null;
}
