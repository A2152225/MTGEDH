import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { resolveSpell, type TargetRef, type categorizeSpell } from '../../rules-engine/targeting.js';
import { debug } from '../../utils/debug.js';
import { getEffectivePower } from '../../socket/util.js';
import { detectSpellLandBonus, applyTemporaryLandBonus } from './game-state-effects.js';
import { executeSpellEffect } from './executeSpellEffect.js';
import { wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import { applySupplementalOracleIRForResolvedSpell } from './oracleIrSpellLegacySupplemental.js';
import { applyInstantSorceryItsControllerCreatesToken } from './stackResolveSpellTargetMetadataUtils.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrFeatureFlags.js';
import {
  isCategorizeOpcodeDeletedFromResolveSpell,
  isCategorizeOpcodeRetiredUnderOracleIrPrimary,
  shouldSkipLegacySpellCategorizeExecution,
  skipRetiredSpellLegacyHandler,
} from './oracleIrSpellLegacyRouting.js';
import { parseNumberWord } from './oracleIrSpellLegacySpellShapeUtils.js';
import { persistBattlefieldPermanentPatchAfterMutation } from '../effects/battlefieldPermanentReplayPersistence.js';

function applyLegacyResolvedSpellRiders(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
    targetSpellControllerForSupplemental: PlayerID | null;
    targetSpellNameForSupplemental: string;
    targetControllerForTokenCreation: PlayerID | null;
  },
): void {
  applySupplementalOracleIRForResolvedSpell(
    ctx,
    options.oracleText,
    options.controller,
    options.effectiveCard?.name || 'spell',
    String((options.item as any).source || (options.item as any).permanentId || ''),
    String((options.item as any).id || (options.card as any)?.id || ''),
    {
      targetPlayerId: options.targetSpellControllerForSupplemental || undefined,
      referenceSpellName: options.targetSpellNameForSupplemental || undefined,
      sourceImage: options.effectiveCard.image_uris?.small || options.effectiveCard.image_uris?.normal,
      skipRawSteps: ['Counter target spell'],
    },
  );

  applyInstantSorceryItsControllerCreatesToken(ctx, {
    effectiveCard: options.effectiveCard,
    oracleText: options.oracleText,
    targetControllerForTokenCreation: options.targetControllerForTokenCreation,
  });
}

export function executeInstantSorceryLegacyCategorizedSpell(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    card: any;
    effectiveCard: any;
    item: any;
    oracleText: string;
    targets: any[];
    spellSpec: NonNullable<ReturnType<typeof categorizeSpell>>;
    spellXValue: unknown;
    targetSpellControllerForSupplemental: PlayerID | null;
    targetSpellNameForSupplemental: string;
    targetControllerForTokenCreation: PlayerID | null;
  },
): void {
  const spellName = String(options.effectiveCard?.name || options.card?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleText, spellName)) {
    return;
  }
  if (shouldSkipLegacySpellCategorizeExecution(options.oracleText, spellName)) {
    return;
  }
  const spellOp = String(options.spellSpec?.op || '');
  // P1a: resolveSpell cases deleted — always skip (including SPELL_LEGACY).
  if (isCategorizeOpcodeDeletedFromResolveSpell(spellOp)) {
    debug(1, `[spell] skip deleted resolve categorize op: ${spellOp} (${spellName})`);
    applyLegacyResolvedSpellRiders(ctx, options);
    return;
  }
  // Defense-in-depth: retired categorize ops never execute opcodes under IR primary,
  // even if ownership helpers miss a variant of the oracle text (P1a / end-state roadmap).
  if (
    isOracleIrSpellPrimaryEnabled()
    && isCategorizeOpcodeRetiredUnderOracleIrPrimary(spellOp)
  ) {
    debug(
      1,
      `[spell] skip retired categorize op under IR primary: ${spellOp} (${spellName})`,
    );
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const card = options.card;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const targets = options.targets;
  const spellXValue = options.spellXValue;

  // Generate effects based on spell type and targets.
  // For X spells, hydrate the amount at resolution time when X is known.
  let hydratedSpec: any = options.spellSpec;
  if ((hydratedSpec as any)?.amountIsX && typeof spellXValue === 'number') {
    hydratedSpec = { ...(hydratedSpec as any), amount: spellXValue };
  }
  if ((hydratedSpec as any)?.tokenCountIsX && typeof spellXValue === 'number') {
    hydratedSpec = { ...(hydratedSpec as any), tokenCount: spellXValue };
  }
  if ((hydratedSpec as any)?.millCountIsX && typeof spellXValue === 'number') {
    hydratedSpec = { ...(hydratedSpec as any), millCount: spellXValue };
  }
  if ((hydratedSpec as any)?.scryCountIsX && typeof spellXValue === 'number') {
    hydratedSpec = { ...(hydratedSpec as any), scryCount: spellXValue };
  }
  if ((hydratedSpec as any)?.surveilCountIsX && typeof spellXValue === 'number') {
    hydratedSpec = { ...(hydratedSpec as any), surveilCount: spellXValue };
  }
  if (
    (hydratedSpec as any)?.millCountDoubleIfCastFromGraveyard &&
    wasSpellCastFromGraveyard(item)
  ) {
    const baseMill = Math.max(0, Number((hydratedSpec as any)?.millCount ?? spellXValue ?? 0) || 0);
    if (baseMill > 0) {
      hydratedSpec = { ...(hydratedSpec as any), millCount: baseMill * 2 };
    }
  }
  if (
    String((hydratedSpec as any)?.op || '') === 'CREATE_TOKEN'
    && wasSpellCastFromGraveyard(item)
  ) {
    const graveyardTokenInsteadMatch = oracleText.toLowerCase().match(
      /if this spell was cast from a graveyard,\s*create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) of those tokens instead/i,
    );
    if (graveyardTokenInsteadMatch) {
      const baseCount = Math.max(1, Number((hydratedSpec as any)?.tokenCount ?? 1) || 1);
      const replacementCount = parseNumberWord(graveyardTokenInsteadMatch[1], baseCount);
      hydratedSpec = { ...(hydratedSpec as any), tokenCount: replacementCount };
    }
  }

  // Convert persisted string targets back into the correct TargetRef kind.
  // Counterspells commonly store stack item ids as plain strings during cast flow.
  const targetRefs: TargetRef[] = targets.map((t: any) => {
    if (typeof t !== 'string') {
      return t;
    }

    if (
      hydratedSpec?.op === 'COUNTER_TARGET_SPELL' ||
      hydratedSpec?.op === 'COUNTER_TARGET_ABILITY' ||
      state.stack?.some((stackItem: any) => String(stackItem?.id || '') === t)
    ) {
      return { kind: 'stack' as const, id: t };
    }

    if (state.players?.some((player: any) => String(player?.id || '') === t)) {
      return { kind: 'player' as const, id: t };
    }

    return { kind: 'permanent' as const, id: t };
  });

  const effects = resolveSpell(hydratedSpec as any, targetRefs, state as any, controller as any);

  for (const effect of effects) {
    executeSpellEffect(
      ctx,
      effect,
      controller,
      effectiveCard.name || 'spell',
      String((item as any).source || (item as any).permanentId || ''),
      String((item as any).id || (card as any)?.id || ''),
    );
  }

  if (targets.length > 0 && /double (?:another\s+)?(?:up to (?:one|two|three|four|five|\d+) )?target creature(?: you control)?'s power until end of turn\b/i.test(oracleText)) {
    const battlefield = state.battlefield || [];
    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((permanent: any) => String(permanent?.id || '') === String(targetId || ''));
      if (!targetCreature) continue;

      const currentPower = Math.max(0, Number(getEffectivePower(targetCreature as any) || 0));
      const targetCreatureRuntime = targetCreature as any;
      targetCreatureRuntime.temporaryPTMods = Array.isArray(targetCreatureRuntime.temporaryPTMods) ? targetCreatureRuntime.temporaryPTMods : [];
      targetCreatureRuntime.temporaryPTMods.push({
        power: currentPower,
        toughness: 0,
        source: effectiveCard.name || 'spell',
        expiresAt: 'end_of_turn',
        turnApplied: state.turnNumber || 0,
      });
      persistBattlefieldPermanentPatchAfterMutation(ctx as any, targetCreatureRuntime, {
        sourceName: String(effectiveCard.name || 'spell'),
        fields: ['temporaryPTMods'],
      });

      debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'spell'} gave ${targetCreature.card?.name || targetId} +${currentPower}/+0 until end of turn`);
    }
  }

  if (targets.length > 0 && /(?:up to (?:one|two|three|four|five|\d+) )?target creatures? can't be blocked this turn\.?/i.test(oracleText)) {
    const battlefield = state.battlefield || [];
    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((permanent: any) => String(permanent?.id || '') === String(targetId || ''));
      if (!targetCreature) continue;

      const typeLine = String(targetCreature?.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      const targetCreatureRuntime = targetCreature as any;
      targetCreatureRuntime.temporaryAbilities = Array.isArray(targetCreatureRuntime.temporaryAbilities) ? targetCreatureRuntime.temporaryAbilities : [];
      targetCreatureRuntime.temporaryAbilities.push({
        ability: "can't be blocked",
        source: effectiveCard.name || 'spell',
        expiresAt: 'end_of_turn',
        turnApplied: state.turnNumber || 0,
      });
      persistBattlefieldPermanentPatchAfterMutation(ctx as any, targetCreatureRuntime, {
        sourceName: String(effectiveCard.name || 'spell'),
        fields: ['temporaryAbilities'],
      });

      debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'spell'} made ${targetCreature.card?.name || targetId} unblockable until end of turn`);
    }
  }

  const landBonus = detectSpellLandBonus(effectiveCard.name || '', oracleText);
  if (landBonus > 0) {
    applyTemporaryLandBonus(ctx, controller, landBonus);
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} granted ${controller} ${landBonus} additional land play(s) this turn`);
  }

  applyLegacyResolvedSpellRiders(ctx, options);
}
