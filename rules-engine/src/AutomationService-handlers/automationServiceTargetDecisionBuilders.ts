// Origin parent: rules-engine/src/AutomationService.ts
// Cluster moved: requiresDecisionToResolve plus exclusive target/mode/X decision builders.
// Public entry symbols: requiresDecisionToResolve, parseTargetTypes,
//   parseTargetDecisionConstraints, buildTargetDecisionFilters, buildTargetingSourceInfo,
//   buildTargetDecisionOptions, clampTargetMaxSelections, countMinTargets, countMaxTargets.
// Leaf must not import AutomationService.ts or AutomationService-handlers/index.ts.

import type { GameState, BattlefieldPermanent, StackItem } from '../../../shared/src';
import { getColorsFromObject } from '../oracleIRExecutorManaUtils';
import { canTargetPermanent } from '../permanentTargeting';
import { hasPermanentType } from '../permanentTypeUtils';
import { canTargetPlayer } from '../playerProtection';
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';
import {
  DecisionType,
  type PendingDecision,
  type DecisionOption,
  type SelectionFilter,
} from './automationServiceDecisionTypes.js';
import type {
  TargetingSourceInfo,
  TargetDecisionZone,
  TargetDecisionConstraints,
} from './automationServiceTargetDecisionTypes.js';

/**
 * Check if a stack item requires player decisions to resolve
 */
export function requiresDecisionToResolve(item: StackItem, state: GameState): {
  requires: boolean;
  decisions: PendingDecision[];
} {
  const decisions: PendingDecision[] = [];
  const card = item.card as any;
  const oracleText = (card?.oracle_text || '').toLowerCase();
  const typeLine = (card?.type_line || '').toLowerCase();
  
  // Check if spell has targets but none selected
  if (requiresTargets(oracleText) && (!item.targets || item.targets.length === 0)) {
    const targetTypes = parseTargetTypes(oracleText);
    const targetConstraints = parseTargetDecisionConstraints(oracleText);
    const targetFilters = buildTargetDecisionFilters(targetConstraints);
    const minSelections = countMinTargets(oracleText);
    const maxSelections = countMaxTargets(oracleText);
    const targetOptions = buildTargetDecisionOptions(
      state,
      targetTypes,
      targetConstraints,
      buildTargetingSourceInfo(item, {
        sourceId: item.id,
        controllerId: item.controller,
        objectType: String((item as any)?.type || '').trim().toLowerCase() === 'spell' ? 'spell' : 'ability',
      })
    );

    if (targetOptions.length > 0 || minSelections > 0) {
    decisions.push({
      id: `decision_${Date.now()}_target`,
      type: DecisionType.SELECT_TARGETS,
      playerId: item.controller,
      sourceId: item.id,
      sourceName: card?.name,
      description: `Choose targets for ${card?.name}`,
      options: targetOptions,
      ...(targetFilters.length > 0 ? { filters: targetFilters } : {}),
      targetTypes,
      minSelections,
      maxSelections: clampTargetMaxSelections(maxSelections, targetOptions.length, minSelections),
      mandatory: minSelections > 0,
      createdAt: Date.now(),
    });
    }
  }
  
  // Check for modal spells
  if (isModalSpell(oracleText)) {
    const modes = parseModes(oracleText);
    if (modes.length > 0) {
      const { min, max } = countModeSelection(oracleText);
      decisions.push({
        id: `decision_${Date.now()}_mode`,
        type: min > 1 ? DecisionType.SELECT_MODES : DecisionType.SELECT_MODE,
        playerId: item.controller,
        sourceId: item.id,
        sourceName: card?.name,
        description: `Choose ${min === max ? min : `${min}-${max}`} mode(s) for ${card?.name}`,
        options: modes.map((m, i) => ({ id: `mode_${i}`, label: m })),
        minSelections: min,
        maxSelections: max,
        mandatory: true,
        createdAt: Date.now(),
      });
    }
  }
  
  // Check for X spells
  if (hasXInCost(card?.mana_cost) || hasXInText(oracleText)) {
    decisions.push({
      id: `decision_${Date.now()}_x`,
      type: DecisionType.SELECT_X_VALUE,
      playerId: item.controller,
      sourceId: item.id,
      sourceName: card?.name,
      description: `Choose value of X for ${card?.name}`,
      minX: getMinimumXValueFromOracleText(oracleText),
      mandatory: true,
      createdAt: Date.now(),
    });
  }
  
  return {
    requires: decisions.length > 0,
    decisions,
  };
}

/**
 * Check if oracle text indicates the spell targets
 */
function requiresTargets(oracleText: string): boolean {
  return /\btarget\b/.test(oracleText);
}

/**
 * Parse target types from oracle text
 */
export function parseTargetTypes(oracleText: string): string[] {
  const normalizedText = String(oracleText || '')
    .replace(/\u2019/g, "'")
    .toLowerCase();
  const types: string[] = [];
  const addTypes = (...entries: string[]): void => {
    for (const entry of entries) {
      if (!types.includes(entry)) {
        types.push(entry);
      }
    }
  };
  
  // Common target patterns
  if (/target creature or player/.test(normalizedText)) addTypes('creature', 'player');
  if (/target artifact or enchantment/.test(normalizedText)) addTypes('artifact', 'enchantment');
  if (/target creature or planeswalker/.test(normalizedText)) addTypes('creature', 'planeswalker');
  if (/target player or planeswalker/.test(normalizedText)) addTypes('player', 'planeswalker');
  if (/target artifact or creature/.test(normalizedText)) addTypes('artifact', 'creature');
  if (/target instant or sorcery/.test(normalizedText)) addTypes('instant', 'sorcery');
  if (/target artifact, creature, or land/.test(normalizedText) || /target artifact, creature or land/.test(normalizedText)) {
    addTypes('artifact', 'creature', 'land');
  }
  if (/target card\b/.test(normalizedText)) addTypes('card');
  if (/target creature/.test(normalizedText)) addTypes('creature');
  if (/target instant/.test(normalizedText)) addTypes('instant');
  if (/target sorcery/.test(normalizedText)) addTypes('sorcery');
  if (/target player/.test(normalizedText)) addTypes('player');
  if (/target opponent\b(?!\scontrols?)/.test(normalizedText)) addTypes('opponent');
  if (/target permanent/.test(normalizedText)) addTypes('permanent');
  if (/target artifact/.test(normalizedText)) addTypes('artifact');
  if (/target enchantment/.test(normalizedText)) addTypes('enchantment');
  if (/target planeswalker/.test(normalizedText)) addTypes('planeswalker');
  if (/target land/.test(normalizedText) && !/target nonland/.test(normalizedText)) addTypes('land');
  if (/target spell/.test(normalizedText)) addTypes('spell');
  if (/any target/.test(normalizedText)) addTypes('creature', 'player', 'planeswalker', 'battle');
  
  return types.length > 0 ? types : ['permanent']; // Default to permanent if unclear
}

function parseTargetDecisionZones(normalizedText: string): TargetDecisionZone[] {
  const targetMentions = normalizedText.match(/\btarget\b/g) || [];
  if (targetMentions.length > 1) {
    return [];
  }

  const zones: TargetDecisionZone[] = [];
  const addZone = (zone: TargetDecisionZone): void => {
    if (!zones.includes(zone)) {
      zones.push(zone);
    }
  };

  if (/target [^.!\n]*\b(?:from|in) (?:your |a |an opponent's )?graveyard\b/.test(normalizedText)) addZone('graveyard');
  if (/target [^.!\n]*\b(?:from|in) your hand\b/.test(normalizedText)) addZone('hand');
  if (/target [^.!\n]*\b(?:from|in) (?:your |an opponent's )?exile\b/.test(normalizedText)) addZone('exile');
  if (/target [^.!\n]*\b(?:from|in) (?:the |your )?command zone\b/.test(normalizedText)) addZone('commandZone');
  if (/target [^.!\n]*\b(?:from|in) your library\b/.test(normalizedText)) addZone('library');

  return zones;
}

export function parseTargetDecisionConstraints(oracleText: string): TargetDecisionConstraints {
  const normalizedText = String(oracleText || '')
    .replace(/\u2019/g, "'")
    .toLowerCase();
  const builtCustomFilters = buildCustomTargetFilters(normalizedText);
  const builtZones = parseTargetDecisionZones(normalizedText);
  const zoneControllerScope = /\b(?:from|in) your (?:graveyard|hand|exile|library|command zone)\b/.test(normalizedText)
    ? 'self'
    : /\b(?:from|in) an opponent's (?:graveyard|exile)\b/.test(normalizedText)
      ? 'opponent'
      : undefined;

  if (/target [^.!\n]*\byou control\b/.test(normalizedText)) {
    return {
      controllerScope: 'self',
      ...(builtZones.length > 0 ? { zones: builtZones } : {}),
      ...(builtCustomFilters.length > 0 ? { customFilters: builtCustomFilters } : {}),
    };
  }

  if (/target [^.!\n]*\b(?:an opponent controls|you don't control)\b/.test(normalizedText)) {
    return {
      controllerScope: 'opponent',
      ...(builtZones.length > 0 ? { zones: builtZones } : {}),
      ...(builtCustomFilters.length > 0 ? { customFilters: builtCustomFilters } : {}),
    };
  }

  return {
    ...(zoneControllerScope ? { controllerScope: zoneControllerScope } : {}),
    ...(builtZones.length > 0 ? { zones: builtZones } : {}),
    ...(builtCustomFilters.length > 0 ? { customFilters: builtCustomFilters } : {}),
  };
}

function buildCustomTargetFilters(normalizedTargetText: string): string[] {
  const customFilters: string[] = [];
  const addCustomFilter = (value: string): void => {
    if (!customFilters.includes(value)) {
      customFilters.push(value);
    }
  };

  if (/target [^.!\n]*\bnonland\b/.test(normalizedTargetText)) addCustomFilter('nonland');
  if (/target [^.!\n]*\bnoncreature\b/.test(normalizedTargetText)) addCustomFilter('noncreature');
  if (/target [^.!\n]*\bnonartifact\b/.test(normalizedTargetText)) addCustomFilter('nonartifact');
  if (/target [^.!\n]*\bnonenchantment\b/.test(normalizedTargetText)) addCustomFilter('nonenchantment');
  if (/target [^.!\n]*\bnonplaneswalker\b/.test(normalizedTargetText)) addCustomFilter('nonplaneswalker');
  if (/target [^.!\n]*\battacking\b/.test(normalizedTargetText)) addCustomFilter('attacking');
  if (/target [^.!\n]*\bblocking\b/.test(normalizedTargetText)) addCustomFilter('blocking');
  if (/target [^.!\n]*\bblocked\b/.test(normalizedTargetText) && !/target [^.!\n]*\bunblocked\b/.test(normalizedTargetText)) addCustomFilter('blocked');
  if (/target [^.!\n]*\bunblocked\b/.test(normalizedTargetText)) addCustomFilter('unblocked');
  if (/target untapped\b/.test(normalizedTargetText)) addCustomFilter('untapped');
  if (/target tapped\b/.test(normalizedTargetText) && !/target untapped\b/.test(normalizedTargetText)) addCustomFilter('tapped');

  return customFilters;
}

export function buildTargetDecisionFilters(constraints: TargetDecisionConstraints): SelectionFilter[] {
  const filters: SelectionFilter[] = [];

  if (constraints.controllerScope) {
    filters.push({
      type: 'controller',
      value: constraints.controllerScope,
    });
  }

  if ((constraints.zones || []).length > 0) {
    filters.push({
      type: 'zone',
      value: (constraints.zones || []).length === 1 ? (constraints.zones || [])[0] : [...(constraints.zones || [])],
    });
  }

  for (const customFilter of constraints.customFilters || []) {
    filters.push({
      type: 'custom',
      value: customFilter,
    });
  }

  return filters;
}

function normalizeTargetingSourceColors(value: unknown): readonly string[] | undefined {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    const parts = String(raw || '')
      .split(/(?:,|\/|\bor\b|\band\b)+/i)
      .map(part => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const lower = part.toLowerCase();
      const normalized =
        lower === 'w' || lower === 'white'
          ? 'W'
          : lower === 'u' || lower === 'blue'
            ? 'U'
            : lower === 'b' || lower === 'black'
              ? 'B'
              : lower === 'r' || lower === 'red'
                ? 'R'
                : lower === 'g' || lower === 'green'
                  ? 'G'
                  : ['W', 'U', 'B', 'R', 'G'].includes(part.toUpperCase())
                    ? part.toUpperCase()
                    : undefined;
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out.length > 0 ? out : undefined;
}

function getTargetingColorNames(colors: readonly string[] | undefined): readonly string[] {
  const out: string[] = [];

  for (const color of colors || []) {
    const colorName = color === 'W'
      ? 'white'
      : color === 'U'
        ? 'blue'
        : color === 'B'
          ? 'black'
          : color === 'R'
            ? 'red'
            : color === 'G'
              ? 'green'
              : undefined;
    if (colorName) {
      out.push(colorName);
    }
  }

  return out;
}

function getSourceTypeName(sourceObject: any): string | undefined {
  const typeLine = String(
    sourceObject?.card?.type_line ||
    sourceObject?.card?.cardType ||
    sourceObject?.type_line ||
    sourceObject?.cardType ||
    ''
  ).toLowerCase();
  if (typeLine.includes('instant')) return 'instant';
  if (typeLine.includes('sorcery')) return 'sorcery';
  if (typeLine.includes('creature')) return 'creature';
  if (typeLine.includes('artifact')) return 'artifact';
  if (typeLine.includes('enchantment')) return 'enchantment';
  if (typeLine.includes('planeswalker')) return 'planeswalker';
  if (typeLine.includes('battle')) return 'battle';
  if (typeLine.includes('land')) return 'land';
  return undefined;
}

export function buildTargetingSourceInfo(
  sourceObject: any,
  fallback: { sourceId?: string; controllerId: string; objectType: 'spell' | 'ability' }
): TargetingSourceInfo {
  const controllerId = String(
    sourceObject?.controllerId ||
    sourceObject?.controller ||
    fallback.controllerId ||
    ''
  ).trim() || fallback.controllerId;
  const colors = normalizeTargetingSourceColors(getColorsFromObject(sourceObject));
  const typeName = getSourceTypeName(sourceObject);

  return {
    ...(fallback.sourceId ? { sourceId: fallback.sourceId } : {}),
    controllerId,
    ...(colors ? { colors } : {}),
    objectType: fallback.objectType,
    ...(typeName ? { typeName } : {}),
  };
}

function getProcessedBattlefield(state: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[]
  ) as BattlefieldPermanent[];
}

function matchesPermanentTargetTypes(permanent: BattlefieldPermanent, targetTypes: readonly string[]): boolean {
  if (targetTypes.length === 0 || targetTypes.includes('permanent')) {
    return true;
  }

  for (const type of targetTypes) {
    if (type === 'player' || type === 'opponent' || type === 'spell') {
      continue;
    }
    if (hasPermanentType(permanent, type)) {
      return true;
    }
  }

  return false;
}

function canSourceTargetPlayer(
  state: GameState,
  targetPlayerId: string,
  sourceInfo: TargetingSourceInfo
): boolean {
  const unrestrictedResult = canTargetPlayer(
    state,
    targetPlayerId,
    sourceInfo.controllerId,
    undefined,
    sourceInfo.typeName,
  );
  if (!unrestrictedResult.canTarget) {
    return false;
  }

  for (const colorName of getTargetingColorNames(sourceInfo.colors)) {
    const result = canTargetPlayer(
      state,
      targetPlayerId,
      sourceInfo.controllerId,
      colorName,
      sourceInfo.typeName,
    );
    if (!result.canTarget) {
      return false;
    }
  }

  return true;
}

function matchesTargetDecisionConstraintsForController(
  targetControllerId: string | undefined,
  sourceInfo: TargetingSourceInfo,
  constraints: TargetDecisionConstraints
): boolean {
  const normalizedTargetControllerId = String(targetControllerId || '').trim();
  if (!constraints.controllerScope) {
    return true;
  }

  if (!normalizedTargetControllerId) {
    return false;
  }

  if (constraints.controllerScope === 'self') {
    return normalizedTargetControllerId === sourceInfo.controllerId;
  }

  return normalizedTargetControllerId !== sourceInfo.controllerId;
}

function matchesTargetDecisionCustomConstraints(
  cardLike: BattlefieldPermanent | any,
  constraints: TargetDecisionConstraints
): boolean {
  const typeLine = String(
    (cardLike as any)?.card?.type_line ||
    (cardLike as any)?.cardType ||
    (cardLike as any)?.type_line ||
    ''
  ).toLowerCase();
  const hasType = (type: string): boolean => {
    const normalizedType = String(type || '').trim().toLowerCase();
    if (!normalizedType) return false;

    if ((cardLike as any)?.card) {
      if (normalizedType === 'creature' || normalizedType === 'artifact' || normalizedType === 'enchantment' || normalizedType === 'land' || normalizedType === 'planeswalker' || normalizedType === 'battle') {
        return hasPermanentType(cardLike as BattlefieldPermanent, normalizedType);
      }
    }

    return typeLine.includes(normalizedType);
  };

  for (const customFilter of constraints.customFilters || []) {
    if (customFilter === 'nonland' && hasType('land')) {
      return false;
    }
    if (customFilter === 'noncreature' && hasType('creature')) {
      return false;
    }
    if (customFilter === 'nonartifact' && hasType('artifact')) {
      return false;
    }
    if (customFilter === 'nonenchantment' && hasType('enchantment')) {
      return false;
    }
    if (customFilter === 'nonplaneswalker' && hasType('planeswalker')) {
      return false;
    }
    if (customFilter === 'attacking' && !Boolean((cardLike as any).attacking)) {
      return false;
    }
    if (customFilter === 'blocking' && (!Array.isArray((cardLike as any).blocking) || (cardLike as any).blocking.length === 0)) {
      return false;
    }
    if (customFilter === 'blocked' && (!Array.isArray((cardLike as any).blockedBy) || (cardLike as any).blockedBy.length === 0)) {
      return false;
    }
    if (customFilter === 'unblocked' && (!Boolean((cardLike as any).attacking) || (Array.isArray((cardLike as any).blockedBy) && (cardLike as any).blockedBy.length > 0))) {
      return false;
    }
    if (customFilter === 'tapped' && !Boolean((cardLike as any).tapped)) {
      return false;
    }
    if (customFilter === 'untapped' && Boolean((cardLike as any).tapped)) {
      return false;
    }
  }

  return true;
}

function matchesCardLikeTargetTypes(cardLike: any, targetTypes: readonly string[]): boolean {
  if (targetTypes.length === 0 || targetTypes.includes('card')) {
    return true;
  }

  const typeLine = String(
    cardLike?.type_line ||
    cardLike?.card?.type_line ||
    cardLike?.cardType ||
    ''
  ).toLowerCase();
  const hasType = (type: string): boolean => {
    const normalizedType = String(type || '').trim().toLowerCase();
    if (!normalizedType) return false;
    if (normalizedType === 'permanent') {
      return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some(permanentType =>
        typeLine.includes(permanentType)
      );
    }

    return typeLine.includes(normalizedType);
  };

  return targetTypes.some(type => !['player', 'opponent', 'spell'].includes(type) && hasType(type));
}

function getZoneTargetCardCandidates(
  state: GameState,
  constraints: TargetDecisionConstraints
): Array<{ id: string; label: string; card: any; ownerId: string; zone: TargetDecisionZone }> {
  const zones = constraints.zones || [];
  const candidates: Array<{ id: string; label: string; card: any; ownerId: string; zone: TargetDecisionZone }> = [];
  const seen = new Set<string>();
  const addCandidate = (card: any, ownerId: string, zone: TargetDecisionZone): void => {
    const id = String(card?.id || card?.cardId || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push({
      id,
      label: String(card?.name || id).trim() || id,
      card,
      ownerId,
      zone,
    });
  };

  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim();
    if (!playerId) continue;

    for (const zone of zones) {
      if (zone === 'commandZone') continue;
      if (zone === 'library') continue;
      if (zone === 'hand' && constraints.controllerScope === 'opponent') continue;

      const zoneCards = Array.isArray((player as any)?.[zone]) ? (player as any)[zone] : [];
      for (const card of zoneCards) {
        addCandidate(card, playerId, zone);
      }
    }
  }

  if (zones.includes('commandZone')) {
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim();
      const zoneCards = Array.isArray((player as any)?.commandZone) ? (player as any).commandZone : [];
      for (const card of zoneCards) {
        addCandidate(card, playerId, 'commandZone');
      }
    }

    for (const [playerId, zoneCards] of Object.entries((state as any)?.commandZone || {})) {
      if (!Array.isArray(zoneCards)) continue;
      for (const card of zoneCards) {
        addCandidate(card, String(playerId || '').trim(), 'commandZone');
      }
    }
  }

  return candidates;
}

export function buildTargetDecisionOptions(
  state: GameState,
  targetTypes: readonly string[] | undefined,
  constraints: TargetDecisionConstraints,
  sourceInfo: TargetingSourceInfo
): DecisionOption[] {
  const normalizedTargetTypes = Array.from(new Set(
    (Array.isArray(targetTypes) ? targetTypes : [])
      .map(type => String(type || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  const options: DecisionOption[] = [];
  const seen = new Set<string>();
  const constrainedZones = constraints.zones || [];
  const addOption = (id: string, label: string): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    options.push({ id, label });
  };

  if (constrainedZones.length === 0 && (normalizedTargetTypes.includes('player') || normalizedTargetTypes.includes('opponent'))) {
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim();
      if (!playerId) continue;
      if (!matchesTargetDecisionConstraintsForController(playerId, sourceInfo, constraints)) {
        continue;
      }
      if (
        normalizedTargetTypes.includes('opponent') &&
        !normalizedTargetTypes.includes('player') &&
        playerId === sourceInfo.controllerId
      ) {
        continue;
      }
      if (!canSourceTargetPlayer(state, playerId, sourceInfo)) {
        continue;
      }
      addOption(playerId, String((player as any)?.name || playerId));
    }
  }

  const includesPermanentTargets = normalizedTargetTypes.length === 0 || normalizedTargetTypes.some(
    type => type !== 'player' && type !== 'opponent' && type !== 'spell'
  );
  if (includesPermanentTargets && constrainedZones.length === 0) {
    for (const permanent of getProcessedBattlefield(state)) {
      if (!matchesPermanentTargetTypes(permanent, normalizedTargetTypes)) {
        continue;
      }
      if (!matchesTargetDecisionConstraintsForController((permanent as any).controller, sourceInfo, constraints)) {
        continue;
      }
      if (!matchesTargetDecisionCustomConstraints(permanent, constraints)) {
        continue;
      }
      const targetingResult = canTargetPermanent(permanent, {
        controllerId: sourceInfo.controllerId,
        colors: sourceInfo.colors,
        objectType: sourceInfo.objectType,
      });
      if (!targetingResult.canTarget) {
        continue;
      }

      addOption(String(permanent.id || '').trim(), String((permanent.card as any)?.name || permanent.id));
    }
  }

  if (normalizedTargetTypes.includes('spell') && constrainedZones.length === 0) {
    for (const stackItem of state.stack || []) {
      const stackItemId = String((stackItem as any)?.id || '').trim();
      if (!stackItemId || stackItemId === sourceInfo.sourceId) {
        continue;
      }
      if (!matchesTargetDecisionConstraintsForController(
        String((stackItem as any)?.controller || (stackItem as any)?.controllerId || '').trim(),
        sourceInfo,
        constraints
      )) {
        continue;
      }

      const stackItemType = String((stackItem as any)?.type || '').trim().toLowerCase();
      if (stackItemType && stackItemType !== 'spell') {
        continue;
      }

      addOption(stackItemId, String(((stackItem as any)?.card as any)?.name || stackItemId));
    }
  }

  if (constrainedZones.length > 0) {
    for (const candidate of getZoneTargetCardCandidates(state, constraints)) {
      if (!matchesTargetDecisionConstraintsForController(candidate.ownerId, sourceInfo, constraints)) {
        continue;
      }
      if (!matchesCardLikeTargetTypes(candidate.card, normalizedTargetTypes)) {
        continue;
      }
      if (!matchesTargetDecisionCustomConstraints(candidate.card, constraints)) {
        continue;
      }

      addOption(candidate.id, candidate.label);
    }
  }

  return options;
}

export function clampTargetMaxSelections(maxSelections: number, availableOptions: number, minSelections: number): number {
  if (availableOptions <= 0) {
    return minSelections === 0 ? 0 : maxSelections;
  }

  return Math.max(minSelections, Math.min(maxSelections, availableOptions));
}

/**
 * Count minimum targets required
 */
export function countMinTargets(oracleText: string): number {
  if (/up to (\w+) target/i.test(oracleText)) return 0;
  
  const match = oracleText.match(/target (\w+) (creature|permanent|player|artifact|enchantment)s?/i);
  if (match) {
    const word = match[1].toLowerCase();
    const numbers: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
      a: 1, an: 1,
    };
    return numbers[word] || 1;
  }
  
  return 1;
}

/**
 * Count maximum targets
 */
export function countMaxTargets(oracleText: string): number {
  const upToMatch = oracleText.match(/up to (\w+) target/i);
  if (upToMatch) {
    const word = upToMatch[1].toLowerCase();
    const numbers: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5,
    };
    return numbers[word] || 1;
  }
  
  return countMinTargets(oracleText);
}

/**
 * Check if spell is modal (choose one, choose two, etc.)
 */
function isModalSpell(oracleText: string): boolean {
  return /choose (one|two|three|four|any number)/i.test(oracleText) ||
         /\n•/.test(oracleText); // Bullet points indicate modes
}

/**
 * Parse modes from oracle text
 */
function parseModes(oracleText: string): string[] {
  // Look for bullet point modes
  const bulletModes = oracleText.match(/• .+?(?=\n•|\n\n|$)/g);
  if (bulletModes) {
    return bulletModes.map(m => m.replace('• ', '').trim());
  }
  
  // Look for em-dash modes
  const dashModes = oracleText.match(/— .+?(?=\n—|\n\n|$)/g);
  if (dashModes) {
    return dashModes.map(m => m.replace('— ', '').trim());
  }
  
  return [];
}

/**
 * Count how many modes to select
 */
function countModeSelection(oracleText: string): { min: number; max: number } {
  if (/choose two/i.test(oracleText)) return { min: 2, max: 2 };
  if (/choose three/i.test(oracleText)) return { min: 3, max: 3 };
  if (/choose one or more/i.test(oracleText)) return { min: 1, max: 10 };
  if (/choose any number/i.test(oracleText)) return { min: 0, max: 10 };
  if (/choose up to two/i.test(oracleText)) return { min: 0, max: 2 };
  return { min: 1, max: 1 };
}

/**
 * Check if mana cost contains X
 */
function hasXInCost(manaCost?: string): boolean {
  return !!manaCost && /\{X\}/i.test(manaCost);
}

/**
 * Check if oracle text uses X
 */
function hasXInText(oracleText: string): boolean {
  return /\bX\b/.test(oracleText) && !/\bexile\b/i.test(oracleText.split(/\bX\b/)[0] || '');
}

function getMinimumXValueFromOracleText(oracleText: string): number {
  const normalizedText = String(oracleText || '').replace(/\u2019/g, "'");
  if (/\bX can't be 0\b/i.test(normalizedText)) return 1;
  return 0;
}
