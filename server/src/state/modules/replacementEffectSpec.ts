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
  ReplacementZone,
  ZoneChangeReplacementEvent,
} from './replacement-effects.js';

/** Declarative replacement spec (Phase 5.1). See docs/oracle-ir-phase5-continuous-effects-design.md */
export type ReplacementEffectSpecEvent = ReplacementEvent['type'];

export type ReplacementModifyMode = 'double' | 'triple' | 'add_flat' | 'halve';

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

export interface ReplacementLifeGainMatch {
  /** Gaining player must be an opponent of the spec source controller. */
  gainingPlayerIsOpponentOfSource?: boolean;
}

export interface ReplacementDamageMatch {
  /** Damage dealer must be the spec source controller (Angrath's Marauders). */
  dealingPlayerIsSourceController?: boolean;
  /** Receiving player must be an opponent of the spec source controller (Gisela double). */
  receivingPlayerIsOpponentOfSource?: boolean;
  /** Receiving player must be the spec source controller (Gisela prevent-half). */
  receivingPlayerIsSourceController?: boolean;
  /** Damage source permanent must be the creature this aura (spec source) is attached to. */
  damageSourceIsEnchantedBySource?: boolean;
  /** Only apply when the damage event is combat damage. */
  combatDamageOnly?: boolean;
}

export interface ReplacementEffectSpec {
  id: string;
  event: ReplacementEffectSpecEvent;
  match?: ReplacementZoneChangeMatch & ReplacementMillMatch & ReplacementCounterMatch & ReplacementDrawMatch & ReplacementLifeGainMatch & ReplacementDamageMatch;
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
    /** Prevent life gain (0) or replace with life loss (negative amount). */
    replaceLifeGainWith?: 'none' | 'loss';
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
  const direct = String(record.oracle_text || record.oracleText || '').trim();
  if (direct) return direct;
  const nested = record.card;
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as Record<string, unknown>;
    return String(nestedRecord.oracle_text || nestedRecord.oracleText || '').trim();
  }
  return '';
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

interface OracleLifeGainReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern life-gain replacements (no card-name routing). */
const ORACLE_LIFE_GAIN_REPLACEMENT_TEMPLATES: readonly OracleLifeGainReplacementTemplate[] = [
  {
    templateId: 'opponent-life-gain-reversed-to-loss',
    oracleMustIncludeAll: ['if an opponent would gain life', 'loses that much life instead'],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsOpponentOfSource: true },
      instead: { replaceLifeGainWith: 'loss' },
      effectId: 'life-gain-reversed-to-loss',
      reason: 'life_gain_reversed_to_loss',
    },
  },
  {
    templateId: 'controller-life-gain-reversed-to-loss',
    oracleMustIncludeAll: ['would cause its controller to gain life', 'loses that much life instead'],
    spec: {
      event: 'life-gain',
      instead: { replaceLifeGainWith: 'loss' },
      effectId: 'life-gain-reversed-to-loss',
      reason: 'life_gain_reversed_to_loss',
    },
  },
  {
    templateId: 'opponents-cant-gain-life',
    oracleMustIncludeAll: ['your opponents', "can't gain life"],
    spec: {
      event: 'life-gain',
      match: { gainingPlayerIsOpponentOfSource: true },
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
  {
    templateId: 'players-cant-gain-life',
    oracleMustIncludeAll: ["players can't gain life"],
    spec: {
      event: 'life-gain',
      instead: { replaceLifeGainWith: 'none' },
      effectId: 'life-gain-prevented',
      reason: 'life_gain_prevented',
    },
  },
];

export function collectOraclePatternLifeGainReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_LIFE_GAIN_REPLACEMENT_TEMPLATES) {
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

interface OracleCounterReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern counter-placement replacements (no card-name routing). */
const ORACLE_COUNTER_REPLACEMENT_TEMPLATES: readonly OracleCounterReplacementTemplate[] = [
  {
    templateId: 'permanent-counters-double-you-control',
    oracleMustIncludeAll: [
      'counters on a permanent you control',
      'twice that many of those counters',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'permanent-counters-double',
      reason: 'permanent_counters_double',
    },
  },
  {
    templateId: 'p1p1-counters-plus-one-you-control',
    oracleMustIncludeAll: [
      '+1/+1 counters would be put',
      'that many plus one',
    ],
    spec: {
      event: 'counter-placement',
      match: {
        counterTypeIncludes: '+1/+1',
        targetControllerIsSourceController: true,
      },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'p1p1-counters-plus-one',
      reason: 'p1p1_counters_plus_one',
    },
  },
  {
    templateId: 'p1p1-counters-double-creature-you-control',
    oracleMustIncludeAll: [
      '+1/+1 counters would be put',
      'twice that many',
      'creature you control',
    ],
    spec: {
      event: 'counter-placement',
      match: {
        counterTypeIncludes: '+1/+1',
        targetControllerIsSourceController: true,
      },
      instead: { modify: 'double' },
      effectId: 'p1p1-counters-double',
      reason: 'p1p1_counters_double',
    },
  },
  {
    templateId: 'you-put-counters-double',
    oracleMustIncludeAll: [
      'if you would put one or more counters',
      'twice that many of each of those kinds',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'you-put-counters-double',
      reason: 'you_put_counters_double',
    },
  },
  {
    templateId: 'opponent-put-counters-halve',
    oracleMustIncludeAll: [
      'if an opponent would put one or more counters',
      'half that many of each of those kinds',
    ],
    spec: {
      event: 'counter-placement',
      match: { targetControllerIsSourceController: false },
      instead: { modify: 'halve' },
      effectId: 'opponent-put-counters-halve',
      reason: 'opponent_put_counters_halve',
    },
  },
];

export function collectOraclePatternCounterReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card)).toLowerCase();
    if (!oracle) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    for (const template of ORACLE_COUNTER_REPLACEMENT_TEMPLATES) {
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

interface OracleDamageReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern damage amount replacements (Furnace of Rath family; no card-name routing). */
const ORACLE_DAMAGE_REPLACEMENT_TEMPLATES: readonly OracleDamageReplacementTemplate[] = [
  {
    // Furnace of Rath / Dictate of the Twin Gods
    templateId: 'all-source-damage-double',
    oracleMustIncludeAll: [
      'if a source would deal damage to a permanent or player',
      'it deals double that damage',
    ],
    spec: {
      event: 'damage',
      instead: { modify: 'double' },
      effectId: 'all-source-damage-double',
      reason: 'all_source_damage_double',
    },
  },
  {
    // Angrath's Marauders family
    templateId: 'source-you-control-damage-double',
    oracleMustIncludeAll: [
      'if a source you control would deal damage',
      'deals double that damage',
    ],
    spec: {
      event: 'damage',
      match: { dealingPlayerIsSourceController: true },
      instead: { modify: 'double' },
      effectId: 'source-you-control-damage-double',
      reason: 'source_you_control_damage_double',
    },
  },
  {
    // Gisela, Blade of Goldnight (double half)
    templateId: 'damage-to-opponent-double',
    oracleMustIncludeAll: [
      'deal damage to an opponent or a permanent an opponent controls',
      'deals double that damage',
    ],
    spec: {
      event: 'damage',
      match: { receivingPlayerIsOpponentOfSource: true },
      instead: { modify: 'double' },
      effectId: 'damage-to-opponent-double',
      reason: 'damage_to_opponent_double',
    },
  },
  {
    // Gisela, Blade of Goldnight (prevent half)
    templateId: 'damage-to-you-prevent-half',
    oracleMustIncludeAll: [
      'deal damage to you or a permanent you control',
      'prevent half that damage',
    ],
    spec: {
      event: 'damage',
      match: { receivingPlayerIsSourceController: true },
      instead: { modify: 'halve' },
      effectId: 'damage-to-you-prevent-half',
      reason: 'damage_to_you_prevent_half',
    },
  },
  {
    // Fiery Emancipation / City on Fire
    templateId: 'source-you-control-damage-triple',
    oracleMustIncludeAll: [
      'if a source you control would deal damage',
      'deals triple that damage',
    ],
    spec: {
      event: 'damage',
      match: { dealingPlayerIsSourceController: true },
      instead: { modify: 'triple' },
      effectId: 'source-you-control-damage-triple',
      reason: 'source_you_control_damage_triple',
    },
  },
  {
    // Torbran, Thane of Red Fell
    templateId: 'red-source-you-control-damage-plus-2',
    oracleMustIncludeAll: [
      'red source you control would deal damage to an opponent',
      'that much damage plus 2',
    ],
    spec: {
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        receivingPlayerIsOpponentOfSource: true,
      },
      instead: { modify: 'add_flat', value: 2 },
      effectId: 'red-source-you-control-damage-plus-2',
      reason: 'red_source_you_control_damage_plus_2',
    },
  },
  {
    // Embermaw Hellion
    templateId: 'another-red-source-you-control-damage-plus-1',
    oracleMustIncludeAll: [
      'another red source you control would deal damage',
      'that much damage plus 1',
    ],
    spec: {
      event: 'damage',
      match: { dealingPlayerIsSourceController: true },
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'another-red-source-you-control-damage-plus-1',
      reason: 'another_red_source_you_control_damage_plus_1',
    },
  },
  {
    // The Sound of Drums / attachment-scoped combat double
    templateId: 'enchanted-creature-combat-damage-double',
    oracleMustIncludeAll: [
      'if enchanted creature would deal combat damage to a permanent or player',
      'deals double that damage',
    ],
    spec: {
      event: 'damage',
      match: {
        damageSourceIsEnchantedBySource: true,
        combatDamageOnly: true,
      },
      instead: { modify: 'double' },
      effectId: 'enchanted-creature-combat-damage-double',
      reason: 'enchanted_creature_combat_damage_double',
    },
  },
];

export function collectOraclePatternDamageReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card)).toLowerCase();
    if (!oracle) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    for (const template of ORACLE_DAMAGE_REPLACEMENT_TEMPLATES) {
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

export function overlaySpecsMatchDamage(
  spec: ReplacementEffectSpec,
  input: {
    damageDealer: string;
    damageReceiver: string;
    damageSourcePermanentId?: string;
    isCombatDamage?: boolean;
  },
  state?: unknown,
): boolean {
  if (spec.event !== 'damage') return false;
  const match = spec.match || {};
  const sourceController = String(spec.sourceController || '');
  const dealer = String(input.damageDealer || '');
  const receiver = String(input.damageReceiver || '');

  if (typeof match.dealingPlayerIsSourceController === 'boolean') {
    if ((dealer === sourceController) !== match.dealingPlayerIsSourceController) return false;
  }
  if (typeof match.receivingPlayerIsOpponentOfSource === 'boolean') {
    const isOpponent = Boolean(sourceController) && Boolean(receiver) && receiver !== sourceController;
    if (isOpponent !== match.receivingPlayerIsOpponentOfSource) return false;
  }
  if (typeof match.receivingPlayerIsSourceController === 'boolean') {
    if ((receiver === sourceController) !== match.receivingPlayerIsSourceController) return false;
  }
  if (match.combatDamageOnly === true && !input.isCombatDamage) {
    return false;
  }
  if (match.damageSourceIsEnchantedBySource === true) {
    const damageSourceId = String(input.damageSourcePermanentId || '').trim();
    const auraId = String(spec.sourcePermanentId || '').trim();
    if (!damageSourceId || !auraId || !state) return false;
    const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
      ? (state as { battlefield: unknown[] }).battlefield
      : [];
    const aura = battlefield.find((perm) => {
      if (!perm || typeof perm !== 'object') return false;
      return String((perm as { id?: string }).id || '').trim() === auraId;
    }) as { attachedTo?: string } | undefined;
    if (!aura) return false;
    if (String(aura.attachedTo || '').trim() !== damageSourceId) return false;
  }
  return true;
}

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

interface OracleZoneChangeReplacementTemplate {
  templateId: string;
  oracleMustIncludeAll: readonly string[];
  oracleMustExcludeAny?: readonly string[];
  spec: Omit<ReplacementEffectSpec, 'id' | 'sourcePermanentId' | 'sourceController' | 'sourceName'>;
}

/** Oracle-pattern zone-change replacements (Phase 5.2 — no card-name routing). */
const ORACLE_ZONE_CHANGE_REPLACEMENT_TEMPLATES: readonly OracleZoneChangeReplacementTemplate[] = [
  {
    templateId: 'graveyard-to-exile-from-anywhere',
    oracleMustIncludeAll: ['would be put into a graveyard from anywhere', 'exile it instead'],
    oracleMustExcludeAny: [
      'shuffle it into',
      'shuffle this card into',
      'shuffle that card into',
      'shuffles their graveyard into',
    ],
    spec: {
      event: 'zone-change',
      match: { destinationZone: 'graveyard' },
      instead: { redirectZone: 'exile' },
      effectId: 'graveyard-to-exile-replacement',
      reason: 'graveyard_to_exile_replacement',
    },
  },
  {
    templateId: 'creature-die-exile-instead',
    oracleMustIncludeAll: ['if a creature would die', 'exile it instead'],
    spec: {
      event: 'zone-change',
      match: { destinationZone: 'graveyard', objectTypeLineIncludes: 'creature' },
      instead: { redirectZone: 'exile' },
      effectId: 'creature-die-exile-instead',
      reason: 'creature_die_exile_instead',
    },
  },
];

export function collectOraclePatternZoneChangeReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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

    for (const template of ORACLE_ZONE_CHANGE_REPLACEMENT_TEMPLATES) {
      if (!template.oracleMustIncludeAll.every((phrase) => oracle.includes(phrase))) continue;
      if (template.oracleMustExcludeAny?.some((phrase) => oracle.includes(phrase))) continue;
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

function matchesLifeGainSpec(spec: ReplacementEffectSpec, event: LifeGainReplacementEvent): boolean {
  const match = spec.match;
  if (!match) return true;

  if (match.gainingPlayerIsOpponentOfSource === true
    && String(event.playerId || '') === String(spec.sourceController || '')) {
    return false;
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
  specs.push(...collectOraclePatternLifeGainReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternZoneChangeReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternCounterReplacementSpecsFromState(state));
  specs.push(...collectOraclePatternDamageReplacementSpecsFromState(state));
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
    // Amount-modify damage matching needs battlefield attachedTo; that path uses
    // detectDamageReplacementEffects. This branch remains for non-modify callers.
    if (!overlaySpecsMatchDamage(
      spec,
      {
        damageDealer,
        damageReceiver,
        damageSourcePermanentId: damageSourcePermanentId || undefined,
        isCombatDamage: meta?.isCombatDamage,
      },
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
    // Amount-modify families aggregate via detect*/apply* helpers (616.1 ordering).
    if (
      (event.type === 'mill' || event.type === 'counter-placement' || event.type === 'damage')
      && spec.instead.modify
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
