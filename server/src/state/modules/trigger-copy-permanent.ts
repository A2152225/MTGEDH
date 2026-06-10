import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { oracleObjectSelectorText } from './trigger-runtime-wiring.js';
import {
  applyPermanentBecomeCopyOfCardData,
  applyPermanentBecomeCopyOfTargetPermanent,
} from './permanent-copy.js';
import { debug, debugWarn } from '../../utils/debug.js';

export type CopyPermanentTriggerPattern =
  | 'self_from_another_target'
  | 'self_from_that_creature'
  | 'that_creature_from_self'
  | 'self_from_target_selection'
  | 'other_from_target_selection'
  | 'enchanted_from_that_creature'
  | 'self_from_exiled_card_choice'
  | 'other_from_exiled_card_choice'
  | 'mass_other_from_that_creature';

export function classifyCopyPermanentTriggerPattern(
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
): CopyPermanentTriggerPattern | null {
  const targetText = oracleObjectSelectorText(step.target).toLowerCase();
  const sourceText = oracleObjectSelectorText(step.source).toLowerCase();
  const raw = String(step.raw || '').toLowerCase();

  if (
    /^(this creature|this permanent|it|this vehicle|this equipment)$/.test(targetText) &&
    /\banother target (?:creature|permanent)\b/.test(sourceText)
  ) {
    return 'self_from_another_target';
  }

  if (
    /^(this creature|this permanent|it)$/.test(targetText) &&
    /^that creature$/.test(sourceText)
  ) {
    return 'self_from_that_creature';
  }

  if (
    /^that creature$/.test(targetText) &&
    /^(this creature|this permanent|it)$/.test(sourceText)
  ) {
    return 'that_creature_from_self';
  }

  if (
    /^(this creature|this permanent|it|enchanted creature)$/.test(targetText) &&
    /^that creature/.test(sourceText)
  ) {
    return 'enchanted_from_that_creature';
  }

  if (
    /each other nontoken creature you control/.test(targetText) &&
    /^that creature$/.test(sourceText)
  ) {
    return 'mass_other_from_that_creature';
  }

  if (
    /creature card exiled with/.test(sourceText) ||
    /card exiled with/.test(sourceText)
  ) {
    return /^(that creature|for as long as this equipment remains attached to it, that creature)$/.test(targetText) ||
      /that creature/.test(targetText)
      ? 'other_from_exiled_card_choice'
      : 'self_from_exiled_card_choice';
  }

  if (
    /target token you control/.test(targetText) &&
    /^it$/.test(sourceText)
  ) {
    return 'other_from_target_selection';
  }

  if (
    /other target (?:creature|permanent) you control/.test(sourceText) ||
    /up to one other target/.test(sourceText) ||
    /target nonlegendary creature/.test(sourceText) ||
    /target (?:artifact|creature|permanent|token)/.test(sourceText)
  ) {
    return 'self_from_target_selection';
  }

  if (/target/.test(sourceText)) {
    return 'self_from_target_selection';
  }

  if (/^that creature$/.test(targetText) && /chosen name|card with the chosen/.test(sourceText)) {
    return 'other_from_target_selection';
  }

  if (
    /^(this creature|this permanent|it)$/.test(targetText) &&
    /^(that creature or planeswalker|that card)$/.test(sourceText)
  ) {
    return 'self_from_target_selection';
  }

  if (raw.includes('becomes a copy of') && /target/.test(sourceText)) {
    return 'self_from_target_selection';
  }

  return null;
}

export function isSupportedCopyPermanentTriggerPattern(step: OracleEffectStep): boolean {
  if (step.kind !== 'copy_permanent') return false;
  return classifyCopyPermanentTriggerPattern(step as Extract<OracleEffectStep, { kind: 'copy_permanent' }>) != null;
}

function normalizeSelectorText(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^until end of turn,\s*/, '')
    .replace(/^as this creature transforms into this permanent,\s*it$/, 'this permanent')
    .replace(/^for as long as this equipment remains attached to it,\s*that creature$/, 'that creature');
}

function resolveThatCreaturePermanentId(state: any, triggerItem?: any): string | undefined {
  const effectData = triggerItem?.effectData || {};
  const candidates = [
    effectData.targetPermanentId,
    effectData.damagedPermanentId,
    effectData.triggeringPermanentId,
    triggerItem?.triggeringPermanent,
    triggerItem?.enteredPermanentId,
    triggerItem?.targets?.[0]?.id,
    triggerItem?.targets?.[0],
  ];
  for (const candidate of candidates) {
    const id = String(candidate || '').trim();
    if (!id) continue;
    if (state?.battlefield?.some((p: any) => String(p?.id || '') === id)) {
      return id;
    }
  }
  return undefined;
}

function resolveCrewedCreatureId(state: any, sourcePermanent: any): string | undefined {
  const crewedId = String(
    sourcePermanent?.crewedThisTurnCreatureId ||
      sourcePermanent?.lastCrewedCreatureId ||
      ''
  ).trim();
  if (crewedId && state?.battlefield?.some((p: any) => String(p?.id || '') === crewedId)) {
    return crewedId;
  }
  return undefined;
}

function collectExiledCardsForSource(state: any, sourcePermanentId: string, cardType: 'creature' | 'any' = 'creature'): any[] {
  const results: any[] = [];
  const sourcePermanent = (state?.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === sourcePermanentId,
  );
  const linkedOnPermanent = Array.isArray(sourcePermanent?.exiledCards) ? sourcePermanent.exiledCards : [];
  for (const card of linkedOnPermanent) {
    if (!card) continue;
    const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
    if (cardType === 'creature' && !typeLine.includes('creature')) continue;
    results.push(card);
  }

  const zones = state?.zones || {};
  for (const [playerId, zoneState] of Object.entries(zones)) {
    const exile = Array.isArray((zoneState as any)?.exile) ? (zoneState as any).exile : [];
    for (const card of exile) {
      if (!card) continue;
      if (String((card as any)?.exiledWithSourceId || '') !== sourcePermanentId) continue;
      const typeLine = String((card as any)?.type_line || '').toLowerCase();
      if (cardType === 'creature' && !typeLine.includes('creature')) continue;
      results.push({ ...card, ownerId: playerId });
    }
  }
  return results;
}

function buildBattlefieldTargetOptions(
  battlefield: any[],
  controller: PlayerID,
  sourcePermanentId: string,
  selectorText: string,
): Array<{ id: string; label: string; description?: string; image?: string }> {
  const lower = normalizeSelectorText(selectorText);
  const requireYouControl = /\byou control\b/.test(lower);
  const excludeLegendary = /\bnonlegendary\b/.test(lower);
  const isCreature = /\bcreature\b/.test(lower);
  const isArtifact = /\bartifact\b/.test(lower);
  const isEnchantment = /\benchantment\b/.test(lower);
  const isLand = /\bland\b/.test(lower);
  const isToken = /\btoken\b/.test(lower);
  const otherOnly = /\b(?:other|another)\b/.test(lower) || /up to one other/.test(lower);

  return battlefield
    .filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      if (otherOnly && permanentId === sourcePermanentId) return false;
      if (requireYouControl && String(perm?.controller || '') !== String(controller)) return false;
      const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
      if (isCreature && !typeLine.includes('creature')) return false;
      if (isArtifact && !typeLine.includes('artifact')) return false;
      if (isEnchantment && !typeLine.includes('enchantment')) return false;
      if (isLand && !typeLine.includes('land')) return false;
      if (isToken && !perm?.isToken) return false;
      if (excludeLegendary && /\blegendary\b/.test(typeLine)) return false;
      return true;
    })
    .map((perm: any) => ({
      id: perm.id,
      label: perm.card?.name || 'Permanent',
      description: perm.card?.type_line || perm.type_line,
      image: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
    }));
}

function queueCopyTargetSelection(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    sourceName: string;
    sourcePermanentId: string;
    sourcePermanent?: any;
    validTargets: Array<{ id: string; label: string; description?: string; image?: string }>;
    targetDescription: string;
    isOptional: boolean;
    retainedAbilityText?: string;
    action?: 'self_become_copy_of_creature' | 'other_become_copy_of_creature';
    copyTargetPermanentId?: string;
    targetTypes?: string[];
  },
): number {
  if (options.validTargets.length === 0) return 0;
  const gameId = String((ctx as any).gameId || 'unknown');
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return 0;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: options.controller,
    description: `${options.sourceName}: You may choose ${options.targetDescription} to copy (cancel to skip)`,
    mandatory: !options.isOptional,
    sourceId: options.sourcePermanentId,
    sourceName: options.sourceName,
    sourceImage:
      options.sourcePermanent?.card?.image_uris?.small ||
      options.sourcePermanent?.card?.image_uris?.normal ||
      options.sourcePermanent?.card?.imageUrl,
    validTargets: options.validTargets,
    targetTypes: options.targetTypes || ['creature'],
    minTargets: options.isOptional ? 0 : 1,
    maxTargets: 1,
    targetDescription: options.targetDescription,
    action: options.action || 'self_become_copy_of_creature',
    selfBecomeCopySourcePermanentId: options.sourcePermanentId,
    ...(options.copyTargetPermanentId ? { copyTargetPermanentId: options.copyTargetPermanentId } : {}),
    retainedAbilityText: options.retainedAbilityText || undefined,
  } as any);
  return 1;
}

export function applyCopyPermanentTriggerStep(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  step: Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
  triggerItem?: any,
): number {
  const pattern = classifyCopyPermanentTriggerPattern(step);
  if (!pattern) return 0;

  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || triggerItem?.sourceId || ''
  ).trim();
  if (!sourcePermanentId || (ctx as any).isReplaying) return 0;

  const state = (ctx as any).state;
  const battlefield = state?.battlefield || [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourcePermanentId);
  const sourceSelectorText = oracleObjectSelectorText(step.source);
  const targetSelectorText = oracleObjectSelectorText(step.target);
  const retainedAbilityText = String(step.retainAbilityText || '').trim();
  const stepRaw = String(step.raw || '').trim();
  const isOptional = Boolean((step as { optional?: boolean }).optional) || /^you may\b/i.test(stepRaw);

  if (pattern === 'self_from_that_creature') {
    const thatCreatureId = resolveThatCreaturePermanentId(state, triggerItem);
    if (!thatCreatureId) {
      debug(2, `[executeTriggerEffect] ${sourceName}: no that_creature resolved for copy`);
      return 0;
    }
    const result = applyPermanentBecomeCopyOfTargetPermanent(
      state,
      sourcePermanentId,
      thatCreatureId,
      retainedAbilityText || undefined,
    );
    return result.applied ? 1 : 0;
  }

  if (pattern === 'that_creature_from_self') {
    const thatCreatureId = resolveThatCreaturePermanentId(state, triggerItem);
    if (!thatCreatureId || thatCreatureId === sourcePermanentId) {
      debug(2, `[executeTriggerEffect] ${sourceName}: no valid that_creature for reverse copy`);
      return 0;
    }
    const result = applyPermanentBecomeCopyOfTargetPermanent(
      state,
      thatCreatureId,
      sourcePermanentId,
      retainedAbilityText || undefined,
    );
    return result.applied ? 1 : 0;
  }

  if (pattern === 'enchanted_from_that_creature') {
    const auraPermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourcePermanentId);
    const enchantedCreatureId = String(auraPermanent?.attachedTo || auraPermanent?.enchanting || '').trim() || sourcePermanentId;
    const thatCreatureId = resolveThatCreaturePermanentId(state, triggerItem);
    if (!thatCreatureId) return 0;
    const result = applyPermanentBecomeCopyOfTargetPermanent(
      state,
      enchantedCreatureId,
      thatCreatureId,
      retainedAbilityText || undefined,
    );
    return result.applied ? 1 : 0;
  }

  if (pattern === 'mass_other_from_that_creature') {
    const thatCreatureId = resolveThatCreaturePermanentId(state, triggerItem);
    if (!thatCreatureId) {
      return queueCopyTargetSelection(ctx, {
        controller,
        sourceName,
        sourcePermanentId,
        sourcePermanent,
        validTargets: buildBattlefieldTargetOptions(battlefield, controller, sourcePermanentId, 'target creature'),
        targetDescription: 'a creature to copy',
        isOptional: false,
        action: 'self_become_copy_of_creature',
      });
    }
    let applied = 0;
    for (const perm of battlefield) {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId || permanentId === sourcePermanentId) continue;
      if (String(perm?.controller || '') !== String(controller)) continue;
      if (perm?.isToken) continue;
      const copyResult = applyPermanentBecomeCopyOfTargetPermanent(state, permanentId, thatCreatureId);
      if (copyResult.applied) applied += 1;
    }
    return applied;
  }

  if (pattern === 'self_from_exiled_card_choice' || pattern === 'other_from_exiled_card_choice') {
    const exiledCards = collectExiledCardsForSource(state, sourcePermanentId, 'creature');
    const validTargets = exiledCards.map((card: any) => ({
      id: String(card?.id || card?.cardId || '').trim(),
      label: String(card?.name || 'Exiled card'),
      description: String(card?.type_line || ''),
    })).filter(target => target.id);
    if (validTargets.length === 0) {
      debug(2, `[executeTriggerEffect] ${sourceName}: no exiled cards to copy`);
      return 0;
    }
    return queueCopyTargetSelection(ctx, {
      controller,
      sourceName,
      sourcePermanentId,
      sourcePermanent,
      validTargets,
      targetDescription: 'a creature card exiled with this permanent',
      isOptional,
      retainedAbilityText: retainedAbilityText || undefined,
      action: pattern === 'other_from_exiled_card_choice' ? 'other_become_copy_of_creature' : 'self_become_copy_of_creature',
      copyTargetPermanentId: pattern === 'other_from_exiled_card_choice'
        ? resolveThatCreaturePermanentId(state, triggerItem) || String(sourcePermanent?.attachedTo || '').trim() || undefined
        : undefined,
      targetTypes: ['card'],
    });
  }

  if (pattern === 'self_from_target_selection' || pattern === 'other_from_target_selection' || pattern === 'self_from_another_target') {
    let selectorForTargets = sourceSelectorText;
    if (/crewed it this turn/.test(sourceSelectorText)) {
      const crewedId = resolveCrewedCreatureId(state, sourcePermanent);
      if (crewedId) {
        const result = applyPermanentBecomeCopyOfTargetPermanent(
          state,
          sourcePermanentId,
          crewedId,
          retainedAbilityText || undefined,
        );
        return result.applied ? 1 : 0;
      }
      selectorForTargets = 'target nonlegendary creature';
    }

    const validTargets = buildBattlefieldTargetOptions(
      battlefield,
      controller,
      sourcePermanentId,
      selectorForTargets,
    );
    const copyTargetPermanentId =
      pattern === 'other_from_target_selection'
        ? (normalizeSelectorText(targetSelectorText).includes('token')
            ? undefined
            : resolveThatCreaturePermanentId(state, triggerItem))
        : undefined;

    return queueCopyTargetSelection(ctx, {
      controller,
      sourceName,
      sourcePermanentId,
      sourcePermanent,
      validTargets,
      targetDescription: selectorForTargets || 'a target',
      isOptional,
      retainedAbilityText: retainedAbilityText || undefined,
      action: pattern === 'other_from_target_selection' ? 'other_become_copy_of_creature' : 'self_become_copy_of_creature',
      copyTargetPermanentId,
      targetTypes: ['creature', 'artifact', 'enchantment', 'land', 'planeswalker'],
    });
  }

  debugWarn(1, `[executeTriggerEffect] ${sourceName}: unsupported copy_permanent pattern ${pattern}`);
  return 0;
}
