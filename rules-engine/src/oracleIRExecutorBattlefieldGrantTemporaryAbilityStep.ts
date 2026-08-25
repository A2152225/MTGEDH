// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: remaining applyGrantTemporaryAbilityStep body after early-case peel.
// Public entry: applyGrantTemporaryAbilityStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { tryApplyGrantTemporaryAbilityEarlyCases } from './oracleIRExecutorBattlefieldGrantTemporaryAbilityEarlyCases';
import {
  inferGrantTemporaryAbilityTargetFromRaw,
  normalizeGrantTemporaryAbilityTargetText,
} from './oracleIRExecutorBattlefieldGrantTemporaryTargetText';
import { buildNameReferenceAliases } from './oracleIRExecutorBattlefieldNameAliases';
import { parseSimpleBattlefieldSelector, parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import {
  resolveDirectBattlefieldPermanents,
  resolveGrantTemporaryMassTargets,
} from './oracleIRExecutorBattlefieldPermanentSelectors';
import { resolveRecentlyCreatedTokenPermanents } from './oracleIRExecutorBattlefieldRecentlyCreatedTokens';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { registerTemporaryStaticAbilityGrant } from './oracleIRExecutorBattlefieldTemporaryStaticAbilityGrant';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { permanentMatchesSelector, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';

export function applyGrantTemporaryAbilityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const stepRaw = String(step.raw || '');
  const inferredTarget = inferGrantTemporaryAbilityTargetFromRaw(stepRaw);
  const normalizedTargetText =
    normalizeGrantTemporaryAbilityTargetText(
      String((step.target as any)?.text || inferredTarget || ''),
      stepRaw
    ) || inferredTarget;
  const targetText = normalizedTargetText.toLowerCase();
  const sourceNameAliases = new Set(buildNameReferenceAliases(String(ctx.sourceName || '')));

  const earlyGrant = tryApplyGrantTemporaryAbilityEarlyCases(
    state,
    step,
    ctx,
    runtime,
    battlefield,
    stepRaw,
    targetText,
    normalizedTargetText,
    sourceNameAliases,
  );
  if (earlyGrant) return earlyGrant;


  if (/^(?:up to )?x target creatures$/i.test(normalizedTargetText)) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const xCount = Number.isFinite(Number(ctx.xValue))
      ? Math.max(1, Number(ctx.xValue))
      : boundIds.length > 0
        ? boundIds.length
        : 1;
    const matches = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!id || !permanentMatchesType(perm, 'creature')) return false;
      if (boundIds.length > 0) return boundIds.includes(id);
      return String(perm?.controller || '').trim() === String(ctx.controllerId || '').trim();
    });
    const targets = matches.slice(0, xCount);
    if (targets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText, stepRaw].filter(Boolean);
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((targets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${targets.length} creature(s) until end of turn`],
      };
    }
  }

  const customMassTargets = resolveGrantTemporaryMassTargets(
    battlefield,
    normalizedTargetText,
    String(step.raw || ''),
    ctx
  );
  if (customMassTargets && customMassTargets.length > 0) {
    const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
    if (descriptions.length === 0) {
      const sourceId = String(ctx.sourceId || '').trim();
      const sourceName = String(ctx.sourceName || '').trim();
      const existingStaticGrantEffects = Array.isArray((state as any).staticAbilityGrantEffects)
        ? [...(state as any).staticAbilityGrantEffects]
        : [];
      const staticGrantEffect = {
        id: `${sourceId || sourceName || 'oracle'}:temp-context-grant:${existingStaticGrantEffects.length + 1}`,
        sourceId: sourceId || undefined,
        sourceName: sourceName || undefined,
        controllerId: String(ctx.controllerId || '').trim() || undefined,
        target: step.target,
        abilities: [],
        effectText: [String(step.raw || '').trim()].filter(Boolean),
        duration: 'end_of_turn',
        raw: step.raw,
      };
      return {
        applied: true,
        state: {
          ...(state as any),
          staticAbilityGrantEffects: [...existingStaticGrantEffects, staticGrantEffect],
        } as GameState,
        log: [`Registered contextual temporary ability grant: ${step.raw}`],
      };
    }
    const controllerId = (String(ctx.controllerId || '').trim() ||
      String((customMassTargets[0] as any)?.controller || '').trim()) as PlayerID;
    const nextState = applyTemporaryEffectToPermanents(state, customMassTargets, ctx, {
      descriptions,
      grantedAbilities,
      expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
      ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
    });
    // Color-qualified targeting shields ("creatures you control can't be the targets of blue or
    // black spells") apply to creatures that enter after the grant as well, so the same text is
    // kept as a continuous static grant after the snapshot stamp.
    if (descriptions.some((text) => /can(?:not|'t)\s+be\s+the\s+targets?\b/i.test(text))) {
      return registerTemporaryStaticAbilityGrant(nextState, step, ctx, {
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
    return {
      applied: true,
      state: nextState,
      log: [`Granted temporary ability text to ${customMassTargets.length} permanent(s) until end of turn`],
    };
  }

  const compoundZombieMatch = /^it and zombies you control$/i.test(normalizedTargetText);
  if (compoundZombieMatch) {
    const itTargets = resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: 'it' }, ctx);
    const zombieTargets = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) && typeLineHasSubtype(perm, 'zombie')
    );
    const massTargets = [
      ...itTargets,
      ...zombieTargets.filter(
        zombie => !itTargets.some(target => String((target as any)?.id || '').trim() === String((zombie as any)?.id || '').trim())
      ),
    ];
    if (massTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      if (descriptions.length === 0) {
        return {
          applied: false,
          message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${massTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  const withCounterMatch = /^each creature you control with a counter on it$/i.test(normalizedTargetText);
  if (withCounterMatch) {
    const massTargets = battlefield.filter(
      perm =>
        permanentMatchesSelector(
          perm,
          { kind: 'battlefield_selector', types: ['creature'], controllerFilter: 'you' },
          ctx
        ) &&
        Object.entries(((perm as any)?.counters || {}) as Record<string, number>).some(
          ([, count]) => Number(count) > 0
        )
    );
    if (massTargets.length > 0) {
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      if (descriptions.length === 0) {
        return {
          applied: false,
          message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Granted temporary ability text to ${massTargets.length} permanent(s) until end of turn`],
      };
    }
  }

  const massBuffSelector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalizedTargetText } as any);
  if (massBuffSelector) {
    const massTargets = battlefield.filter(perm => permanentMatchesSelector(perm, massBuffSelector, ctx));
    if (massTargets.length > 0) {
      const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim().toUpperCase();
      const chosenColorWord = (() => {
        switch (chosenMana) {
          case '{W}':
            return 'white';
          case '{U}':
            return 'blue';
          case '{B}':
            return 'black';
          case '{R}':
            return 'red';
          case '{G}':
            return 'green';
          default:
            return '';
        }
      })();
      const resolveChosenColorText = (value: string): string | null => {
        if (!/protection from (?:the chosen color|the color of your choice)/i.test(value)) return value;
        return chosenColorWord ? `protection from ${chosenColorWord}` : null;
      };
      const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
        .map(value => resolveChosenColorText(String(value || '').trim()))
        .filter((value): value is string => Boolean(value));
      const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
        .map(value => resolveChosenColorText(String(value || '').trim()))
        .filter((value): value is string => Boolean(value));
      const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
      if (descriptions.length === 0) {
        return {
          applied: false,
          message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
          reason: 'impossible_action',
        };
      }
      const controllerId = (String(ctx.controllerId || '').trim() ||
        String((massTargets[0] as any)?.controller || '').trim()) as PlayerID;
      const nextState = applyTemporaryEffectToPermanents(state, massTargets, ctx, {
        descriptions,
        grantedAbilities,
        expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [
          `Granted temporary ability text to ${massTargets.length} permanent(s) ${step.duration === 'until_next_turn' ? 'until next turn' : 'until end of turn'}`,
        ],
      };
    }
  }
  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, { kind: 'raw', text: normalizedTargetText }, ctx);
  const explicitTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  const contextualTargetIds = /^target\b/.test(targetText)
    ? buildContextualBattlefieldTargetIds(
        battlefield,
        ctx,
        false,
        parseSimplePermanentTypeFromText(normalizedTargetText) || undefined,
      )
    : [];
  const boundTargetIds = contextualTargetIds.length > 0
    ? contextualTargetIds
    : (explicitTargetId ? [explicitTargetId] : []);
  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(battlefield, step.target as any, runtime);
  const recentMovedTargets = recentTokenTargets.length > 0
    ? []
    : resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets =
    attachedTargets.length > 0
      ? []
      : boundTargetIds.length > 0 && /^target\b/.test(targetText)
        ? battlefield.filter((perm: any) => boundTargetIds.includes(String((perm?.id || '')).trim()))
        : recentTokenTargets.length > 0 || recentMovedTargets.length > 0
          ? []
          : resolveDirectBattlefieldPermanents(battlefield, { kind: 'raw', text: normalizedTargetText }, ctx);
  const targets = attachedTargets.length > 0
    ? attachedTargets
    : recentTokenTargets.length > 0
    ? recentTokenTargets
    : recentMovedTargets.length > 0
      ? recentMovedTargets
      : directTargets;

  if (targets.length === 0 && /^those creatures$/i.test(normalizedTargetText)) {
    const antecedentIds = Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
      ? ctx.lastAntecedentBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    if (antecedentIds.length > 0) {
      const antecedentSet = new Set(antecedentIds);
      const antecedentTargets = battlefield.filter((perm: any) =>
        antecedentSet.has(String((perm as any)?.id || '').trim())
      );
      if (antecedentTargets.length > 0) {
        const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
          .map(value => String(value || '').trim())
          .filter(Boolean);
        const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
          .map(value => String(value || '').trim())
          .filter(Boolean);
        const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);
        const controllerId = (String(ctx.controllerId || '').trim() ||
          String((antecedentTargets[0] as any)?.controller || '').trim()) as PlayerID;
        const nextState = applyTemporaryEffectToPermanents(state, antecedentTargets, ctx, {
          descriptions: descriptions.length > 0 ? descriptions : [stepRaw],
          grantedAbilities,
          expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
          ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
        });
        return {
          applied: true,
          state: nextState,
          log: [`Granted temporary ability text to ${antecedentTargets.length} antecedent creature(s) until end of turn`],
        };
      }
    }
  }

  if (targets.length === 0) {
    if (
      /^you$/i.test(normalizedTargetText) ||
      /^each opponent$/i.test(normalizedTargetText) ||
      /^the next (?:.+?\s+)?spell you cast/i.test(normalizedTargetText) ||
      /^creature cards in your graveyard$/i.test(normalizedTargetText) ||
      (
        !/^those\b/i.test(normalizedTargetText) &&
        /\b(?:you gain|until (?:end of turn|your next turn)|all damage that would be dealt|face-down spells you cast)\b/i.test(stepRaw)
      )
    ) {
      return registerTemporaryStaticAbilityGrant(state, step, ctx, {
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
    const sourceId = String(ctx.sourceId || '').trim();
    if (
      sourceId &&
      (/\b(?:this creature|this permanent|it also|it gets|it gains|for each \{r\}\{r\} spent to cast it)\b/i.test(stepRaw) ||
        /^it\b/i.test(normalizedTargetText))
    ) {
      return registerTemporaryStaticAbilityGrant(state, step, ctx, {
        targetPermanentId: sourceId,
        duration: step.duration === 'until_next_turn' ? 'until_next_turn' : 'end_of_turn',
      });
    }
    return {
      applied: false,
      message: `Skipped temporary ability grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped temporary ability grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim().toUpperCase();
  const chosenColorWord = (() => {
    switch (chosenMana) {
      case '{W}':
        return 'white';
      case '{U}':
        return 'blue';
      case '{B}':
        return 'black';
      case '{R}':
        return 'red';
      case '{G}':
        return 'green';
      default:
        return '';
    }
  })();
  const resolveChosenColorText = (value: string): string | null => {
    if (!/protection from (?:the chosen color|the color of your choice)/i.test(value)) return value;
    return chosenColorWord ? `protection from ${chosenColorWord}` : null;
  };

  const grantedAbilities = (Array.isArray(step.abilities) ? step.abilities : [])
    .map(value => resolveChosenColorText(String(value || '').trim()))
    .filter((value): value is string => Boolean(value));
  const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
    .map(value => resolveChosenColorText(String(value || '').trim()))
    .filter((value): value is string => Boolean(value));

  const needsChosenColor = [
    ...(Array.isArray(step.abilities) ? step.abilities : []),
    ...(Array.isArray(step.effectText) ? step.effectText : []),
  ].some(value => /protection from (?:the chosen color|the color of your choice)/i.test(String(value || '')));
  if (needsChosenColor && !chosenColorWord) {
    return {
      applied: false,
      message: `Skipped temporary ability grant (requires player color choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const descriptions = [...grantedAbilities, ...effectText].filter(Boolean);

  if (descriptions.length === 0) {
    return {
      applied: false,
      message: `Skipped temporary ability grant (no effect text): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || String((targets[0] as any)?.controller || '').trim()) as PlayerID;
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions,
    grantedAbilities,
    expiresAt: step.duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
    ...(step.duration === 'until_next_turn' && controllerId ? { expiresOnControllerTurn: controllerId } : {}),
  });

  return {
    applied: true,
    state: nextState,
    log: [
      `Granted temporary ability text to ${targets.length} permanent(s) ${step.duration === 'until_next_turn' ? 'until next turn' : 'until end of turn'}`,
    ],
  };
}
