// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: counter-spell immunity helpers plus applyCounterSpellStep
// (and isPlayerStillInGame, which the lose_game family also uses).
// Public entry symbols: applyCounterSpellStep, isPlayerStillInGame.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getStateGrantedCounterImmunityForSpell } from './futureSpellEffects';
import { stampCardsPutIntoGraveyardThisTurn } from './oracleIRExecutorPlayerUtils';
import { getColorsFromObject } from './oracleIRExecutorManaUtils';
import { getStackItems } from './stackOperations';

const COUNTER_IMMUNITY_COLOR_SYMBOLS: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeCounterImmunityText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/g, '')
    .trim();
}

function normalizeCounterImmunityColors(value: unknown): readonly string[] {
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
      const normalized = ['W', 'U', 'B', 'R', 'G'].includes(part.toUpperCase())
        ? part.toUpperCase()
        : COUNTER_IMMUNITY_COLOR_SYMBOLS[lower];
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  return out;
}

function getCardLikeOracleText(value: any): string {
  return String(
    value?.card?.oracle_text ||
    value?.card?.oracleText ||
    value?.card?.rulesText ||
    value?.oracle_text ||
    value?.oracleText ||
    value?.rulesText ||
    value?.abilityText ||
    ''
  ).replace(/\u2019/g, "'");
}

function getCardLikeTypeLineLower(value: any): string {
  return String(
    value?.card?.type_line ||
    value?.card?.cardType ||
    value?.type_line ||
    value?.cardType ||
    ''
  )
    .toLowerCase()
    .trim();
}

function matchesCounterImmunityWord(value: string, word: string): boolean {
  const escapedWord = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedWord}\\b`, 'i').test(value);
}

function spellMatchesCounterImmunityQualifier(stackItem: any, qualifierRaw: string): boolean {
  const qualifier = normalizeCounterImmunityText(qualifierRaw);
  if (!qualifier) return false;

  const spellCard = stackItem?.card || stackItem;
  const colorSymbol = COUNTER_IMMUNITY_COLOR_SYMBOLS[qualifier];
  if (colorSymbol) {
    return getColorsFromObject(spellCard)
      .map(color => String(color || '').trim().toUpperCase())
      .includes(colorSymbol);
  }

  const typeLineLower = getCardLikeTypeLineLower(spellCard);
  if (!typeLineLower) return false;
  return matchesCounterImmunityWord(typeLineLower, qualifier);
}

function getStackItemCounterImmunityMetadata(stackItem: any): {
  readonly unconditional: boolean;
  readonly counterSourceColors: readonly string[];
} {
  const rawCounterImmunity = stackItem?.counterImmunity ?? stackItem?.card?.counterImmunity;
  const counterSourceColors = (() => {
    const direct = normalizeCounterImmunityColors(
      stackItem?.cantBeCounteredBySourceColors ?? stackItem?.card?.cantBeCounteredBySourceColors
    );
    if (direct.length > 0) return direct;

    if (Array.isArray(rawCounterImmunity)) {
      return normalizeCounterImmunityColors(rawCounterImmunity);
    }

    if (rawCounterImmunity && typeof rawCounterImmunity === 'object') {
      return normalizeCounterImmunityColors(
        (rawCounterImmunity as any)?.counterSourceColors ??
          (rawCounterImmunity as any)?.sourceColors ??
          (rawCounterImmunity as any)?.onlyAgainstSourceColors ??
          (rawCounterImmunity as any)?.cantBeCounteredBySourceColors
      );
    }

    return [];
  })();

  return {
    unconditional:
      Boolean(stackItem?.cantBeCountered || stackItem?.card?.cantBeCountered) ||
      rawCounterImmunity === true ||
      Boolean((rawCounterImmunity as any)?.unconditional) ||
      Boolean((rawCounterImmunity as any)?.cantBeCountered),
    counterSourceColors,
  };
}

function getCounterSourceColors(ctx?: OracleIRExecutionContext): readonly string[] {
  return normalizeCounterImmunityColors(ctx?.sourceColors);
}

function battlefieldGrantsCounterImmunity(state: GameState, stackItem: any): boolean {
  const spellController = String(
    stackItem?.controller || stackItem?.controllerId || stackItem?.owner || stackItem?.ownerId || ''
  ).trim();
  if (!spellController) return false;

  const battlefield = Array.isArray((state as any).battlefield) ? ((state as any).battlefield as any[]) : [];
  return battlefield.some((source: any) => {
    const sourceController = String(source?.controller || source?.controllerId || source?.ownerId || source?.owner || '').trim();
    const oracleText = getCardLikeOracleText(source);
    if (!oracleText) return false;

    const lines = oracleText
      .split(/\r?\n+/)
      .map(line => normalizeCounterImmunityText(line))
      .filter(Boolean);

    return lines.some((line) => {
      if (/^spells can(?:not|'t) be countered$/i.test(line)) return true;

      if (/^spells you control can(?:not|'t) be countered$/i.test(line)) {
        return spellController === sourceController;
      }

      const controllerQualifiedMatch = line.match(/^(.+?) spells you control can(?:not|'t) be countered$/i);
      if (controllerQualifiedMatch) {
        return spellController === sourceController && spellMatchesCounterImmunityQualifier(stackItem, String(controllerQualifiedMatch[1] || ''));
      }

      const globalQualifiedMatch = line.match(/^(.+?) spells can(?:not|'t) be countered$/i);
      if (globalQualifiedMatch) {
        return spellMatchesCounterImmunityQualifier(stackItem, String(globalQualifiedMatch[1] || ''));
      }

      return false;
    });
  });
}

function spellCanBeCountered(state: GameState, stackItem: any, ctx?: OracleIRExecutionContext): boolean {
  const stackCounterImmunity = getStackItemCounterImmunityMetadata(stackItem);
  const stateCounterImmunity = getStateGrantedCounterImmunityForSpell(state, stackItem);
  const counterImmunity = {
    unconditional: Boolean(stackCounterImmunity.unconditional) || Boolean(stateCounterImmunity?.unconditional),
    counterSourceColors: Array.from(
      new Set([
        ...(stackCounterImmunity.counterSourceColors || []),
        ...(stateCounterImmunity?.counterSourceColors || []),
      ])
    ),
  };
  if (counterImmunity.unconditional) {
    return false;
  }

  if (counterImmunity.counterSourceColors.length > 0) {
    const counterSourceColors = getCounterSourceColors(ctx);
    if (counterSourceColors.some(color => counterImmunity.counterSourceColors.includes(color))) {
      return false;
    }
  }

  const oracleText = normalizeCounterImmunityText(getCardLikeOracleText(stackItem));
  if (oracleText.includes("this spell can't be countered") || oracleText.includes('this spell cannot be countered')) {
    return false;
  }

  return !battlefieldGrantsCounterImmunity(state, stackItem);
}

export function isPlayerStillInGame(player: any): boolean {
  return Boolean(player?.id) && !player?.hasLost && !player?.eliminated && !player?.conceded && !player?.spectator && !player?.isSpectator;
}

type CounterStackTargetKind = 'spell' | 'ability' | 'spell_or_ability';

function isStackAbilityStackType(type: string): boolean {
  const normalized = String(type || '').trim();
  return normalized === 'ability' || normalized === 'activated_ability' || normalized === 'triggered_ability';
}

function isStackManaAbilityItem(stackItem: any): boolean {
  return Boolean((stackItem as any)?.isManaAbility);
}

function counterSpellStepTargetText(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): string {
  const target = (step as any).target;
  if (target && typeof target === 'object' && typeof (target as any).text === 'string') {
    return String((target as any).text || '');
  }
  return String(step.raw || '');
}

function counterSpellStepCombinedText(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): string {
  return `${counterSpellStepTargetText(step)} ${String(step.raw || '')}`.toLowerCase();
}

function isSelfReferentialCounterSpellStep(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): boolean {
  const combined = counterSpellStepCombinedText(step);
  if (!/\b(?:this permanent|this spell|~)\b/.test(combined)) return false;
  return !/\btarget spell\b/.test(combined);
}

function resolveSelfReferentialCounterStackItem(
  stackItems: readonly any[],
  state: GameState,
  ctx: OracleIRExecutionContext,
  targetKind: CounterStackTargetKind,
): any | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const direct = stackItems.find((item) => String((item as any)?.id || '').trim() === sourceId);
    if (direct && stackItemMatchesCounterTargetKind(state, direct, ctx, targetKind)) return direct;
  }
  const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
  if (!sourceName) return undefined;
  return stackItems.find((item) => {
    const itemName = String((item as any)?.card?.name || (item as any)?.name || '').trim().toLowerCase();
    return itemName === sourceName && stackItemMatchesCounterTargetKind(state, item, ctx, targetKind);
  });
}

function inferCounterStackTargetKind(step: Extract<OracleEffectStep, { kind: 'counter_spell' }>): CounterStackTargetKind {
  const combined = counterSpellStepCombinedText(step);
  const mentionsSpell = /\b(?:target spell|that spell|spells?\b)/.test(combined);
  const mentionsAbility = /\b(?:target ability|that ability|(?:activated|triggered)\s+abilit(?:y|ies)|abilities?\b)/.test(combined);

  if (mentionsSpell && mentionsAbility) {
    return 'spell_or_ability';
  }
  if (mentionsAbility && !mentionsSpell) {
    return 'ability';
  }
  return 'spell';
}

function stackItemMatchesCounterTargetKind(
  state: GameState,
  stackItem: any,
  ctx: OracleIRExecutionContext,
  targetKind: CounterStackTargetKind,
): boolean {
  const type = String((stackItem as any)?.type || '').trim();
  if (isStackAbilityStackType(type)) {
    if (targetKind === 'spell') return false;
    return !isStackManaAbilityItem(stackItem);
  }
  if (type !== 'spell') return false;
  if (targetKind === 'ability') return false;
  return spellCanBeCountered(state, stackItem, ctx);
}

function readCounterSpellStackItems(state: GameState): any[] {
  return [...getStackItems((state as any)?.stack)];
}

function withUpdatedCounterSpellStack(state: GameState, stackItems: readonly any[]): GameState {
  const stack = (state as any)?.stack;
  if (stack && !Array.isArray(stack) && Array.isArray(stack.objects)) {
    return { ...state, stack: { ...stack, objects: [...stackItems] } } as GameState;
  }
  return { ...state, stack: [...stackItems] } as GameState;
}

function filterCounterStackCandidates(
  state: GameState,
  stackItems: readonly any[],
  ctx: OracleIRExecutionContext,
  targetKind: CounterStackTargetKind,
): any[] {
  const sourceId = String(ctx.sourceId || '').trim();
  return stackItems.filter((item) => {
    const itemId = String((item as any)?.id || '').trim();
    if (!itemId) return false;
    if (sourceId && (itemId === sourceId || String((item as any)?.card?.id || '').trim() === sourceId)) {
      return false;
    }
    return stackItemMatchesCounterTargetKind(state, item, ctx, targetKind);
  });
}

export function applyCounterSpellStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'counter_spell' }>,
  ctx: OracleIRExecutionContext & { readonly skipBulkStackWipe?: boolean },
):
  | { readonly applied: true; readonly state: GameState; readonly log: readonly string[]; readonly lastMovedCards: readonly any[] }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: 'player_choice_required' | 'failed_to_apply';
      readonly options?: {
        readonly classification?: 'player_choice' | 'invalid_input';
        readonly metadata?: Record<string, string | number | boolean | readonly string[]>;
        readonly persist?: boolean;
      };
    } {
  const stackItems = readCounterSpellStackItems(state);
  const directTargetId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  const targetKind = inferCounterStackTargetKind(step);
  const combined = counterSpellStepCombinedText(step);
  const eachOpponentStack = /\beach\s+spell and ability your opponents control\b/i.test(combined)
    || /\bfor each spell and ability your opponents control\b/i.test(combined);
  const bulkAllOtherSpells = /\ball other spells\b/i.test(combined);
  const bulkAllAbilities = /\bcounter all abilities\b/i.test(combined)
    || (/\ball abilities\b/i.test(combined) && bulkAllOtherSpells);

  // Untargeted wipes must not collapse to a leftover targetSpellId (cast-time
  // stamp, Hive Mind retarget metadata, or a bound triggering spell). Nested
  // per-item applies set skipBulkStackWipe so they take the single-object path.
  if ((eachOpponentStack || bulkAllOtherSpells || bulkAllAbilities) && !ctx.skipBulkStackWipe) {
    const controllerId = String(ctx.controllerId || '').trim();
    let bulkKind: CounterStackTargetKind = targetKind;
    if (bulkAllOtherSpells && bulkAllAbilities) bulkKind = 'spell_or_ability';
    else if (bulkAllAbilities && !bulkAllOtherSpells) bulkKind = 'ability';
    else if (bulkAllOtherSpells) bulkKind = 'spell';
    const bulkItems = filterCounterStackCandidates(state, stackItems, ctx, bulkKind)
      .filter((item) => {
        if (!eachOpponentStack) return true;
        const itemController = String(item?.controller || item?.controllerId || '').trim();
        return Boolean(itemController) && itemController !== controllerId;
      });
    let current = state;
    const logs: string[] = [];
    const moved: any[] = [];
    for (const item of bulkItems) {
      const itemId = String(item?.id || '').trim();
      if (!itemId) continue;
      const nested = applyCounterSpellStep(current, step, {
        ...ctx,
        skipBulkStackWipe: true,
        targetSpellId: itemId,
        selectorContext: {
          ...(ctx.selectorContext || {}),
          targetSpellId: itemId,
        },
      });
      if (!nested.applied) continue;
      current = nested.state;
      logs.push(...nested.log);
      moved.push(...nested.lastMovedCards);
    }
    const emptyLog = eachOpponentStack
      ? `Countered no opponent spells or abilities: ${step.raw}`
      : `Countered no matching stack objects: ${step.raw}`;
    return {
      applied: true,
      state: current,
      log: logs.length > 0 ? logs : [emptyLog],
      lastMovedCards: moved,
    };
  }
  const targetLabel = targetKind === 'ability' ? 'ability' : targetKind === 'spell_or_ability' ? 'spell or ability' : 'spell';
  const candidates = filterCounterStackCandidates(state, stackItems, ctx, targetKind);

  let targetStackItem = isSelfReferentialCounterSpellStep(step)
    ? resolveSelfReferentialCounterStackItem(stackItems, state, ctx, targetKind)
    : undefined;

  if (!targetStackItem && directTargetId) {
    targetStackItem = candidates.find(item => String((item as any)?.id || '').trim() === directTargetId);
  }

  if (!targetStackItem && directTargetId) {
    if (candidates.length === 1) {
      targetStackItem = candidates[0];
    } else if (candidates.length > 0) {
      targetStackItem = candidates.find(item => String((item as any)?.id || '').trim() === directTargetId) || candidates[0];
    }
  }

  if (!targetStackItem && directTargetId && candidates.length === 0) {
    const directStackItem = stackItems.find(item => String((item as any)?.id || '').trim() === directTargetId);
    if (directStackItem && stackItemMatchesCounterTargetKind(state, directStackItem, ctx, targetKind)) {
      targetStackItem = directStackItem;
    }
  }

  if (!targetStackItem) {
    if (candidates.length === 1) {
      targetStackItem = candidates[0];
    } else if (candidates.length === 0) {
      return {
        applied: false,
        message: `Skipped counter ${targetLabel} (no legal ${targetLabel} target on stack): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          classification: 'invalid_input',
          metadata: { stackSpellCount: 0, stackTargetCount: 0 },
          persist: false,
        },
      };
    } else {
      const candidateIds = candidates.map(item => String((item as any)?.id || '').trim()).filter(Boolean);
      return {
        applied: false,
        message: `Skipped counter ${targetLabel} (requires stack target choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: {
          classification: 'player_choice',
          metadata: {
            stackSpellCount: candidates.filter(item => String((item as any)?.type || '').trim() === 'spell').length,
            stackTargetCount: candidates.length,
            candidateSpellIds: candidateIds,
            candidateStackTargetIds: candidateIds,
          },
        },
      };
    }
  }

  const targetStackItemId = String((targetStackItem as any)?.id || '').trim();
  const targetType = String((targetStackItem as any)?.type || '').trim();
  const isAbilityTarget = isStackAbilityStackType(targetType);
  const updatedStack = stackItems.filter(item => String((item as any)?.id || '').trim() !== targetStackItemId);

  if (isAbilityTarget) {
    const abilityDesc = String(
      (targetStackItem as any)?.description ||
        (targetStackItem as any)?.ability?.text ||
        (targetStackItem as any)?.name ||
        targetStackItemId,
    ).trim() || targetStackItemId;

    return {
      applied: true,
      state: withUpdatedCounterSpellStack(state, updatedStack),
      log: [`Countered ability ${abilityDesc}`],
      lastMovedCards: [],
    };
  }

  const ownerId = String(
    (targetStackItem as any)?.owner ||
      (targetStackItem as any)?.ownerId ||
      (targetStackItem as any)?.controller ||
      (targetStackItem as any)?.controllerId ||
      ''
  ).trim();
  if (!targetStackItemId || !ownerId) {
    return {
      applied: false,
      message: `Skipped counter spell (missing stack spell owner metadata): ${step.raw}`,
      reason: 'failed_to_apply',
      options: {
        classification: 'invalid_input',
        metadata: { targetSpellId: targetStackItemId },
      },
    };
  }

  const movedCard = (targetStackItem as any)?.card || targetStackItem;
  const targetName = String((targetStackItem as any)?.card?.name || (targetStackItem as any)?.name || targetStackItemId).trim() || targetStackItemId;

  // Copied spells can cease instead of changing zones (ceaseOnCounter).
  if ((movedCard as any)?.ceaseOnCounter === true || (targetStackItem as any)?.ceaseOnCounter === true) {
    return {
      applied: true,
      state: withUpdatedCounterSpellStack(state, updatedStack),
      log: [`Countered copied spell ${targetName} (ceased to exist)`],
      lastMovedCards: [],
    };
  }

  // Mirror stack→GY replacements (flashback / jump-start / escape / disturb / harmonize,
  // castFromGraveyard, exileAfterResolution). Full overlay replacement stays server-side;
  // this covers the builtin exile-after-resolution family so IR primary matches counterStackItem.
  const castWithAbility = String(
    (targetStackItem as any)?.card?.castWithAbility
      || (targetStackItem as any)?.castWithAbility
      || (movedCard as any)?.castWithAbility
      || '',
  ).trim().toLowerCase();
  const STACK_GY_EXILE_ABILITIES = new Set(['flashback', 'jump-start', 'escape', 'disturb', 'harmonize']);
  const exileAfterResolution = Boolean(
    (targetStackItem as any)?.exileAfterResolution
      || (targetStackItem as any)?.card?.exileAfterResolution
      || (movedCard as any)?.exileAfterResolution,
  );
  const castFromGraveyard = Boolean(
    (targetStackItem as any)?.castFromGraveyard
      || (targetStackItem as any)?.card?.castFromGraveyard
      || (movedCard as any)?.castFromGraveyard,
  );
  const forceExileSpells = /\bexile\b/i.test(String(step.raw || '')) && /\bspells?\b/i.test(combined);
  const shouldExile = forceExileSpells
    || exileAfterResolution
    || castFromGraveyard
    || STACK_GY_EXILE_ABILITIES.has(castWithAbility);

  const updatedPlayers = (state.players || []).map((player: any) => {
    if (String(player?.id || '').trim() !== ownerId) return player;
    if (shouldExile) {
      const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
      const stamped = { ...(movedCard as any), zone: 'exile' };
      return {
        ...player,
        exile: [...exile, stamped],
      };
    }
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    return {
      ...player,
      graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, [movedCard])],
    };
  });

  return {
    applied: true,
    state: {
      ...withUpdatedCounterSpellStack(state, updatedStack),
      players: updatedPlayers as any,
    },
    log: [
      shouldExile
        ? `Countered spell ${targetName} (exiled)`
        : `Countered spell ${targetName}`,
    ],
    lastMovedCards: [movedCard],
  };
}

