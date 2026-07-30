import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { destroyPermanent } from './counters_tokens.js';
import {
  createSpellLegacyTokenFromSpec,
  parseSpellLegacyTokenCreation,
} from './oracleIrSpellLegacyTokenUtils.js';
import { parseNumberWord } from './oracleIrSpellLegacySpellShapeUtils.js';
import { buildResolvedSpellCopySnapshot, wasSpellCastFromGraveyard } from './stackResolveSpellCopyChoiceUtils.js';
import { buildOracleOverlayCollectOptions } from './oracleIrCompiledOverlayLookup.js';
import { collectOracleEffectSteps } from './trigger-runtime-wiring.js';
import {
  isSpellEffectOwnedByOracleIrPrimary,
  skipRetiredSpellLegacyHandler,
} from './oracleIrSpellLegacyRouting.js';

type InstantSorceryPostCategorizeRiderOptions = {
  controller: PlayerID;
  card: any;
  effectiveCard: any;
  item: any;
  oracleText: string;
  oracleTextLower: string;
  targets: any[];
  spellXValue: unknown;
  uncategorizedSpellFallbackApplied: number;
  oracleIrSpellHandled?: boolean;
};

export function applyInstantSorceryGraveyardConditionalTokenRider(
  ctx: GameContext,
  options: InstantSorceryPostCategorizeRiderOptions,
): void {
  const spellName = String(options.effectiveCard?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleText, spellName)) {
    return;
  }
  if (isSpellEffectOwnedByOracleIrPrimary(options.oracleText, spellName)) {
    return;
  }

  if (!wasSpellCastFromGraveyard(options.item)) {
    return;
  }

  const oracleTextLower = options.oracleTextLower;
  const graveyardTokenInsteadMatch = oracleTextLower.match(
    /if this spell was cast from a graveyard,\s*create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) of those tokens instead/i,
  );
  if (!graveyardTokenInsteadMatch) {
    return;
  }

  let tokenCreationResult = parseSpellLegacyTokenCreation(
    options.effectiveCard.name,
    oracleTextLower,
    options.controller,
    (ctx as any).state,
    typeof options.spellXValue === 'number' ? options.spellXValue : undefined,
  );
  if (!tokenCreationResult) {
    return;
  }

  const replacementCount = parseNumberWord(graveyardTokenInsteadMatch[1], tokenCreationResult.count);
  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const existingMatchingTokens = battlefield.filter((perm: any) => {
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    const tokenName = String(tokenCreationResult?.name || '').toLowerCase();
    const power = Number(perm?.basePower ?? perm?.card?.power ?? 0);
    const toughness = Number(perm?.baseToughness ?? perm?.card?.toughness ?? 0);
    if (power !== tokenCreationResult.power || toughness !== tokenCreationResult.toughness) {
      return false;
    }
    if (tokenName && typeLine.includes(tokenName)) return true;
    return tokenName === 'human' && typeLine.includes('human');
  }).length;

  const tokensToCreate = Math.max(0, replacementCount - existingMatchingTokens);
  if (tokensToCreate <= 0) {
    return;
  }

  createSpellLegacyTokenFromSpec(ctx, options.controller, {
    ...tokenCreationResult,
    count: tokensToCreate,
  });
  debug(
    2,
    `[applyInstantSorceryGraveyardConditionalTokenRider] ${spellName}: created ${tokensToCreate} supplemental token(s) for graveyard cast (${existingMatchingTokens} already present, target ${replacementCount})`,
  );
}

export function applyInstantSorceryCopyStackSpellRiders(
  ctx: GameContext,
  options: InstantSorceryPostCategorizeRiderOptions,
): void {
  if (options.oracleIrSpellHandled) {
    return;
  }

  const spellName = String(options.effectiveCard?.name || 'spell');
  if (
    /copy target instant or sorcery spell you control/i.test(options.oracleText)
    && collectOracleEffectSteps(
      options.oracleText,
      spellName,
      buildOracleOverlayCollectOptions({ cardName: spellName, sourceName: spellName }),
    ).some((step) => step.kind === 'copy_spell')
  ) {
    return;
  }

  if (skipRetiredSpellLegacyHandler(options.oracleText, spellName)) {
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleText = options.oracleText;
  const oracleTextLower = options.oracleTextLower;
  const targets = options.targets;
  const bumpSeq = typeof (ctx as any).bumpSeq === 'function' ? (ctx as any).bumpSeq.bind(ctx) : undefined;

  if (targets.length > 0 && /copy target instant or sorcery spell you control/i.test(oracleText)) {
    const targetStackItemId = String(typeof targets[0] === 'string' ? targets[0] : targets[0]?.id || '').trim();
    const stack = Array.isArray(state.stack) ? state.stack : [];
    const targetStackItem = targetStackItemId
      ? stack.find((stackItem: any) => stackItem && String(stackItem.id || '') === targetStackItemId)
      : null;

    if (targetStackItem && String(targetStackItem.controller || '') === String(controller || '')) {
      const targetStackItemRuntime = targetStackItem as any;
      const targetTypeLine = String(targetStackItemRuntime?.card?.type_line || targetStackItemRuntime?.spell?.type_line || '').toLowerCase();
      const targetIsInstantOrSorcery = targetTypeLine.includes('instant') || targetTypeLine.includes('sorcery');
      if (targetIsInstantOrSorcery) {
        const copyCount = wasSpellCastFromGraveyard(item) && /copy that spell twice instead/i.test(oracleText) ? 2 : 1;
        const sourceName = effectiveCard.name || 'spell';

        for (let copyIndex = 0; copyIndex < copyCount; copyIndex++) {
          const copiedSpell = buildResolvedSpellCopySnapshot(targetStackItem, sourceName, controller);
          stack.push(copiedSpell);
        }

        bumpSeq?.();

        const gameId = (ctx as any).gameId || 'unknown';
        (ctx as any).io?.to?.(gameId)?.emit?.('chat', {
          id: `m_${Date.now()}`,
          gameId,
          from: 'system',
          message: `${sourceName} copies ${String(targetStackItem?.card?.name || 'that spell')}${copyCount > 1 ? ` ${copyCount} times` : ''}.`,
          ts: Date.now(),
        });

        debug(2, `[resolveTopOfStack] ${sourceName} copied ${targetStackItem?.card?.name || targetStackItemId} ${copyCount} time(s)`);
      }
    }
  }

  if (oracleTextLower.includes('when you next cast an instant or sorcery spell this turn, copy that spell. you may choose new targets for the copy.')) {
    const stateAny = state as any;
    stateAny.delayedSpellCopiesThisTurn = Array.isArray(stateAny.delayedSpellCopiesThisTurn)
      ? stateAny.delayedSpellCopiesThisTurn
      : [];
    stateAny.delayedSpellCopiesThisTurn.push({
      controllerId: controller,
      spellType: 'instant_or_sorcery',
      sourceName: effectiveCard.name || 'Spell copy',
      allowRetargeting: true,
    });
    (ctx as any).delayedSpellCopiesThisTurn = stateAny.delayedSpellCopiesThisTurn;
    debug(2, `[resolveTopOfStack] ${effectiveCard.name || 'Spell'}: queued next instant/sorcery spell copy for ${controller}`);
  }
}

export function applyInstantSorceryFracturedIdentityAndFallbackRiders(
  ctx: GameContext,
  options: InstantSorceryPostCategorizeRiderOptions,
): void {
  const spellName = String(options.effectiveCard?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleText, spellName)) {
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleTextLower = options.oracleTextLower;
  const targets = options.targets;
  const spellXValue = typeof options.spellXValue === 'number' ? options.spellXValue : undefined;

  const isFracturedIdentity = effectiveCard.name?.toLowerCase().includes('fractured identity')
    || (
      oracleTextLower.includes('exile target')
      && oracleTextLower.includes('each player other than its controller')
      && oracleTextLower.includes('creates a token')
      && oracleTextLower.includes('copy')
    );

  if (isFracturedIdentity && targets.length > 0) {
    const targetId = typeof targets[0] === 'string' ? targets[0] : targets[0]?.id;
    const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);

    if (targetPerm && targetPerm.card) {
      const targetController = targetPerm.controller as PlayerID;
      const targetCard = targetPerm.card as any;
      const players = (state as any).players || [];
      const copyRecipients = players.filter((p: any) => p && p.id && p.id !== targetController);

      debug(2, `[resolveTopOfStack] Fractured Identity: Creating token copies for ${copyRecipients.length} players (excluding target controller ${targetController})`);

      for (const recipient of copyRecipients) {
        try {
          const tokenId = uid('fi_token');
          const typeLine = targetCard.type_line || '';
          const isCreature = typeLine.toLowerCase().includes('creature');

          const tokenPerm = {
            id: tokenId,
            controller: recipient.id as PlayerID,
            owner: recipient.id as PlayerID,
            tapped: false,
            counters: {},
            basePower: isCreature ? parseInt(String(targetCard.power || '0'), 10) : undefined,
            baseToughness: isCreature ? parseInt(String(targetCard.toughness || '0'), 10) : undefined,
            summoningSickness: isCreature,
            isToken: true,
            card: {
              id: tokenId,
              name: targetCard.name || 'Copy',
              type_line: typeLine,
              oracle_text: targetCard.oracle_text || '',
              mana_cost: targetCard.mana_cost || '',
              power: targetCard.power,
              toughness: targetCard.toughness,
              image_uris: targetCard.image_uris,
              zone: 'battlefield',
            },
          };

          state.battlefield = state.battlefield || [];
          state.battlefield.push(tokenPerm as any);

          debug(2, `[resolveTopOfStack] Fractured Identity: Created token copy of ${targetCard.name} for ${recipient.name || recipient.id}`);
        } catch (err) {
          debugWarn(1, `[resolveTopOfStack] Failed to create Fractured Identity token for ${recipient.id}:`, err);
        }
      }
    }
  }

  if (options.uncategorizedSpellFallbackApplied <= 0 && !options.oracleIrSpellHandled) {
    let tokenCreationResult = parseSpellLegacyTokenCreation(effectiveCard.name, oracleTextLower, controller, state, spellXValue);
    const graveyardTokenInsteadMatch = oracleTextLower.match(/if this spell was cast from a graveyard,\s*create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) of those tokens instead/i);
    if (tokenCreationResult && wasSpellCastFromGraveyard(item) && graveyardTokenInsteadMatch) {
      const replacementCount = parseNumberWord(graveyardTokenInsteadMatch[1], tokenCreationResult.count);
      tokenCreationResult = { ...tokenCreationResult, count: replacementCount };
    }
    if (tokenCreationResult) {
      createSpellLegacyTokenFromSpec(ctx, controller, tokenCreationResult);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} created ${tokenCreationResult.count} ${tokenCreationResult.name} token(s) for ${controller} (xValue: ${spellXValue ?? 'N/A'})`);
    }
  } else if (wasSpellCastFromGraveyard(item)) {
    applyInstantSorceryGraveyardConditionalTokenRider(ctx, options);
  }

  const conditionalWipeMatch = oracleTextLower.match(/if x is (\d+) or more,\s*(destroy all (?:other )?creatures)/i);
  if (conditionalWipeMatch && typeof spellXValue === 'number') {
    const threshold = parseInt(conditionalWipeMatch[1], 10);
    const destroyPattern = conditionalWipeMatch[2];

    if (spellXValue >= threshold) {
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: X=${spellXValue} >= ${threshold}, triggering: ${destroyPattern}`);

      const battlefield = state.battlefield || [];
      const creaturesBeforeSpell = battlefield.filter((perm: any) => {
        if (!perm) return false;
        const typeLine = (perm.card?.type_line || '').toLowerCase();
        return typeLine.includes('creature');
      });

      const destroyOther = destroyPattern.includes('other');
      for (const creature of creaturesBeforeSpell) {
        if (destroyOther && (creature as any).isToken) {
          const hasCounters = creature.counters && Object.keys(creature.counters).length > 0;
          const hasDamage = (creature as any).damage > 0;
          if (!hasCounters && !hasDamage) {
            continue;
          }
        }

        destroyPermanent(ctx, creature.id);
        debug(2, `[resolveTopOfStack] ${effectiveCard.name}: Destroyed ${creature.card?.name || creature.id}`);
      }
    } else {
      debug(2, `[resolveTopOfStack] ${effectiveCard.name}: X=${spellXValue} < ${threshold}, no board wipe`);
    }
  }
}

export function applyInstantSorceryPostCategorizeSpellRiders(
  ctx: GameContext,
  options: InstantSorceryPostCategorizeRiderOptions,
): void {
  applyInstantSorceryCopyStackSpellRiders(ctx, options);
  applyInstantSorceryFracturedIdentityAndFallbackRiders(ctx, options);
}
