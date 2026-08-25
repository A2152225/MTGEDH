// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: UnlessSacrificesResult, evaluateUnlessSacrificesStep, applySacrificeStep.
// Public entries: evaluateUnlessSacrificesStep, applySacrificeStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { evaluateBattlefieldObjectCondition } from './oracleIRExecutorBattlefieldDelayedActionHelpers';
import { parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import {
  oracleIrBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldRemovalHelpers';
import { collectSacrificeChoiceBoundIds } from './oracleIRExecutorBattlefieldSacrificeChoiceBoundIds';
import { sacrificeStepResult } from './oracleIRExecutorBattlefieldSacrificeStepResult';
import { isNamedSelfSacrificeReference } from './oracleIRExecutorBattlefieldStackExileHelpers';
import {
  extractSacrificeWhatText,
  isPermanentAttackingForSacrifice,
  parseSacrificeWhat,
  resolveAttachmentReferencePermanents,
  sacrificeRequiresAttackingCreature,
} from './oracleIRExecutorBattlefieldSacrificeWhat';
import {
  finalizeBattlefieldRemoval,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';
import { createLastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { trySpecialSacrificeStep } from './oracleIRExecutorSpecialTargetHandlers';

export type UnlessSacrificesResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | {
      readonly applied: false;
      readonly message: string;
      readonly reason: string;
      readonly options?: {
        readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
        readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
        readonly pending?: boolean;
        readonly persist?: boolean;
      };
      readonly innerStep?: OracleEffectStep;
      readonly state?: GameState;
    };

/**
 * "counter it unless you sacrifice a land" — if the player can sacrifice a matching
 * permanent they must choose; declining (or being unable) applies nested steps
 * (typically counter_spell on this spell).
 */
export function evaluateUnlessSacrificesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_sacrifices' }>,
  ctx: OracleIRExecutionContext,
): UnlessSacrificesResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-sacrifices step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
        },
      },
    };
  }

  const sacrificerId = players[0];
  const whatText = String((step.what as any)?.text || step.what || 'a permanent').trim().toLowerCase();
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  const candidates = battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(sacrificerId || '').trim()) return false;
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    if (/\bland\b/.test(whatText)) return /\bland\b/.test(typeLine);
    if (/\bcreature\b/.test(whatText)) return /\bcreature\b/.test(typeLine);
    if (/\bartifact\b/.test(whatText)) return /\bartifact\b/.test(typeLine);
    if (/\benchantment\b/.test(whatText)) return /\benchantment\b/.test(typeLine);
    return true;
  });

  const explicitChoice =
    ctx.unlessSacrificesChoice === 'sacrifice' || ctx.unlessSacrificesChoice === 'decline'
      ? ctx.unlessSacrificesChoice
      : ((ctx as any).selectorContext?.unlessSacrificesChoice === 'sacrifice'
          || (ctx as any).selectorContext?.unlessSacrificesChoice === 'decline'
          ? (ctx as any).selectorContext.unlessSacrificesChoice
          : undefined);

  if (candidates.length === 0) {
    return {
      applied: true,
      shouldApplyNestedSteps: true,
      log: [`Resolved unless-sacrifices step (${sacrificerId} cannot sacrifice matching permanent): ${step.raw}`],
    };
  }

  if (explicitChoice === 'sacrifice') {
    const sacrificeStep = {
      kind: 'sacrifice',
      who: step.who,
      what: step.what,
      raw: step.raw,
    } as Extract<OracleEffectStep, { kind: 'sacrifice' }>;
    const sacrificeResult = applySacrificeStep(state, sacrificeStep, ctx);
    if ((sacrificeResult as any).applied === false) {
      return {
        applied: false,
        message: String((sacrificeResult as any).message || `Skipped unless-sacrifices sacrifice: ${step.raw}`),
        reason: String((sacrificeResult as any).reason || 'player_choice_required'),
        state: (sacrificeResult as any).state,
        options: (sacrificeResult as any).options,
        innerStep: sacrificeStep,
      };
    }
    return {
      applied: true,
      shouldApplyNestedSteps: false,
      state: (sacrificeResult as any).state ?? state,
      log: [
        ...(((sacrificeResult as any).log as string[]) || []),
        `Resolved unless-sacrifices step (${sacrificerId} sacrificed): ${step.raw}`,
      ],
    };
  }

  if (explicitChoice === 'decline') {
    return {
      applied: true,
      shouldApplyNestedSteps: true,
      log: [`Resolved unless-sacrifices step (${sacrificerId} declined to sacrifice): ${step.raw}`],
    };
  }

  return {
    applied: false,
    message: `Skipped unless-sacrifices step (player choice required): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      pending: true,
      metadata: {
        sacrificerId,
        candidateCount: candidates.length,
        what: whatText,
      },
    },
  };
}

export function applySacrificeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'sacrifice' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialSacrificeStep(state, step, ctx);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const enchantedSacrificeMatch = String(step.raw || '').match(
    /^enchanted permanent's controller sacrifices it$/i
  );
  if (enchantedSacrificeMatch) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    const attachedToId = String(
      (sourcePermanent as any)?.attachedTo || (sourcePermanent as any)?.enchanting || ''
    ).trim();
    const enchantedPermanent = attachedToId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === attachedToId)
      : undefined;
    if (!enchantedPermanent) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const removedIds = new Set<string>([String((enchantedPermanent as any)?.id || '').trim()].filter(Boolean));
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [enchantedPermanent], removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: [createLastKnownPermanentSnapshot(enchantedPermanent)],
    });
  }

  const controllerSacrificesMatch = String(step.raw || '').match(
    /^that creature's controller sacrifices (?:it|that creature)$/i
  );
  if (controllerSacrificesMatch) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, false, 'creature');
    const creature = battlefield.find((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      return contextualIds.includes(permanentId) && permanentMatchesType(perm, 'creature');
    });
    if (!creature) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const removedIds = new Set<string>([String((creature as any)?.id || '').trim()].filter(Boolean));
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [creature], removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: [createLastKnownPermanentSnapshot(creature)],
    });
  }

  const sacrificeWhatTextEarly = extractSacrificeWhatText(step);
  const explicitTargetSacrificeMatch = sacrificeWhatTextEarly.match(
    /^target (creature(?: or planeswalker)?|permanent|artifact|enchantment|land|planeswalker)$/i,
  );
  if (explicitTargetSacrificeMatch) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    if (boundIds.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const typeWord = String(explicitTargetSacrificeMatch[1] || 'permanent').toLowerCase();
    const selected = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!boundIds.includes(permanentId)) return false;
      if (typeWord.includes('creature') && typeWord.includes('planeswalker')) {
        return permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'planeswalker');
      }
      const typeFilter = parseSimplePermanentTypeFromText(typeWord) || 'permanent';
      return permanentMatchesType(perm, typeFilter);
    });
    if (selected.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const removedIds = new Set(
      selected.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean),
    );
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, selected, removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: selected.map(createLastKnownPermanentSnapshot),
    });
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const sacrificeWhatText = (() => {
    const direct = String((step.what as any)?.text || (step.what as any)?.raw || '').trim();
    if (direct) return direct;
    const rawMatch = String(step.raw || '').match(/(?:^then\s+)?sacrifice\s+(.+?)[.!?\s]*$/i);
    return rawMatch ? String(rawMatch[1] || '').trim() : '';
  })();
  const sacrificeWhat = { kind: 'raw', text: sacrificeWhatText } as const;
  if (/^any number of lands$/i.test(sacrificeWhatText)) {
    const chosenIds = collectBoundBattlefieldIds(ctx);
    const landPermanents = battlefield.filter((perm: any) => {
      if (!players.includes(String((perm as any)?.controller || '').trim())) return false;
      if (!permanentMatchesType(perm, 'land')) return false;
      const permanentId = String((perm as any)?.id || '').trim();
      return chosenIds.length === 0 || chosenIds.includes(permanentId);
    });
    const toSacrifice =
      chosenIds.length > 0
        ? landPermanents.filter((perm: any) => chosenIds.includes(String((perm as any)?.id || '').trim()))
        : landPermanents.slice(0, 1);
    if (toSacrifice.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    const removedIds = new Set(
      toSacrifice.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean)
    );
    const kept = battlefield.filter(perm => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toSacrifice, removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));
    return sacrificeStepResult(ctx, {
      applied: true,
      state: result.state,
      log: result.log,
      lastSacrificedPermanents: toSacrifice.map(createLastKnownPermanentSnapshot),
    });
  }

  const parsed = parseSacrificeWhat(sacrificeWhat);
  const namedSelfReference = isNamedSelfSacrificeReference(sacrificeWhat, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped sacrifice (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const toRemove: BattlefieldPermanent[] = [];
  let needsChoice = false;
  const sourceId = String(ctx.sourceId || '').trim();

  const resolveContextualPermanents = (
    contextual: Extract<NonNullable<typeof parsed>, { readonly mode: 'contextual' }>
  ): BattlefieldPermanent[] => {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, contextual.plural, contextual.type);
    if (ids.length === 0) return [];

    const matches = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!ids.includes(permanentId)) return false;
      if (!players.includes(perm.controller)) return false;
      if (!permanentMatchesType(perm, contextual.type)) return false;
      if (contextual.tokenOnly && !(perm as any)?.isToken) return false;
      return true;
    });

    if (matches.length > 0 || !contextual.tokenOnly) {
      return matches;
    }

    return battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!ids.includes(permanentId)) return false;
      if (!players.includes(perm.controller)) return false;
      return permanentMatchesType(perm, contextual.type);
    });
  };

  if (namedSelfReference || parsed?.mode === 'self') {
    const selfPermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;

    if (!selfPermanent || !players.includes(selfPermanent.controller)) {
      if (sourceId && parsed?.mode === 'self') {
        return {
          applied: true,
          state,
          log: ['Source permanent already absent for sacrifice'],
        };
      }
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    const chosenIds = collectSacrificeChoiceBoundIds(battlefield, ctx);
    const wantsCreature = /\bcreature\b/i.test(sacrificeWhatText);
    const wantsAttacking = sacrificeRequiresAttackingCreature(sacrificeWhatText);
    const pickOneForPlayer = (playerId: string): BattlefieldPermanent | undefined => {
      const sourceId = String(ctx.sourceId || '').trim();
      const matchesPlayer = (perm: any) =>
        String((perm as any)?.controller || '').trim() === playerId &&
        (!wantsCreature || permanentMatchesType(perm, 'creature')) &&
        (!wantsAttacking || isPermanentAttackingForSacrifice(perm));

      const boundMatches = battlefield.filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        return chosenIds.length > 0
          ? chosenIds.includes(permanentId) && matchesPlayer(perm)
          : matchesPlayer(perm);
      });
      const preferNonSource = (matches: BattlefieldPermanent[]) =>
        matches.find((perm: any) => String((perm as any)?.id || '').trim() !== sourceId) || matches[0];

      if (boundMatches.length > 0) return preferNonSource(boundMatches);

      const fallbackMatches = battlefield.filter((perm: any) => matchesPlayer(perm));
      return preferNonSource(fallbackMatches);
    };

    if (String((step.who as any)?.kind || '') === 'each_player') {
      const perPlayer = players
        .map((playerId) => pickOneForPlayer(String(playerId || '').trim()))
        .filter((perm): perm is BattlefieldPermanent => Boolean(perm));
      if (perPlayer.length !== players.length) {
        return {
          applied: false,
          message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }
      toRemove.push(...perPlayer);
    } else {
      if (chosenIds.length === 0) {
        return {
          applied: false,
          message: `Skipped sacrifice (requires player choice): ${step.raw}`,
          reason: 'player_choice_required',
          options: { classification: 'player_choice' },
        };
      }

      const selected = battlefield.filter((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        return (
          chosenIds.includes(permanentId) &&
          players.includes(String((perm as any)?.controller || '').trim()) &&
          (!wantsCreature || permanentMatchesType(perm, 'creature')) &&
          (!wantsAttacking || isPermanentAttackingForSacrifice(perm))
        );
      });
      if (selected.length === 0) {
        return {
          applied: false,
          message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      toRemove.push(...selected);
    }
  }

  if (parsed?.mode === 'contextual') {
    const contextualPermanents = resolveContextualPermanents(parsed);
    if (contextualPermanents.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(...contextualPermanents);
  }

  if (parsed?.mode === 'attached_to_source' || parsed?.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    if (attachmentResolution.requiresChoice) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (attachmentResolution.permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    toRemove.push(...attachmentResolution.permanents);
  }

  if (parsed?.mode === 'created_with_source') {
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const createdTokens = battlefield.filter((perm: any) => {
      if (!(perm as any)?.isToken) return false;
      if (!players.includes(perm.controller)) return false;
      return String((perm as any)?.createdBySourceId || '').trim() === sourceId;
    });

    toRemove.push(...createdTokens);
  }

  if (
    !namedSelfReference &&
    parsed &&
    (parsed.mode === 'count' || parsed.mode === 'all')
  ) {
    const effectiveCount = (() => {
      if (parsed.mode !== 'count') return 0;
      if (!parsed.usesVariableCount) return parsed.count;
      const xValue = Number((ctx as any).xValue);
      return Number.isFinite(xValue) ? Math.max(0, Math.floor(xValue)) : null;
    })();
    if (effectiveCount === null) {
      return {
        applied: false,
        message: `Skipped sacrifice (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }

    for (const playerId of players) {
      const excludeSource = Boolean((parsed as any).excludeSource);
      const allowedTypes = Array.isArray((parsed as any).types) && (parsed as any).types.length > 0
        ? (parsed as any).types
        : [parsed.type];
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const excludeSubtype = String((parsed as any).excludeSubtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const candidates = battlefield.filter(p => {
        if (p.controller !== playerId) return false;
        if (!allowedTypes.some(type => permanentMatchesType(p, type))) return false;
        if (tokenOnly && !(p as any)?.isToken) return false;
        if (subtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (!new RegExp(`(^|[^a-z])${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSubtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (new RegExp(`(^|[^a-z])${excludeSubtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSource && sourceId && String((p as any)?.id || '').trim() === sourceId) return false;
        return true;
      });

      if (parsed.mode === 'all') {
        toRemove.push(...candidates);
        continue;
      }

      const resolveCountCandidates = (): BattlefieldPermanent[] => {
        if (!Boolean((parsed as any).greatestPowerAmongControlled)) return candidates;
        if (candidates.length === 0) return [];
        const readPower = (perm: BattlefieldPermanent): number => {
          const rawPower = (perm as any)?.power ?? (perm as any)?.card?.power;
          const numeric = Number(rawPower);
          return Number.isFinite(numeric) ? numeric : 0;
        };
        const maxPower = Math.max(...candidates.map(readPower));
        return candidates.filter((perm) => readPower(perm) === maxPower);
      };

      const countCandidates = resolveCountCandidates();
      if (countCandidates.length < effectiveCount) {
        return {
          applied: false,
          message: `Skipped sacrifice (no deterministic target): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }

      if (countCandidates.length > effectiveCount) {
        const chosenIds = collectBoundBattlefieldIds(ctx);
        if (chosenIds.length > 0) {
          const selected = countCandidates.filter((perm: any) =>
            chosenIds.includes(String((perm as any)?.id || '').trim())
          );
          if (selected.length >= effectiveCount) {
            toRemove.push(...selected.slice(0, effectiveCount));
            continue;
          }
        }
        needsChoice = true;
        break;
      }
      toRemove.push(...countCandidates.slice(0, effectiveCount));
    }
  }

  if (needsChoice) {
    return {
      applied: false,
      message: `Skipped sacrifice (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (step.condition) {
    if (toRemove.length !== 1) {
      return {
        applied: false,
        message: `Skipped sacrifice (unsupported condition target shape): ${step.raw}`,
        reason: 'unsupported_condition',
      };
    }

    const conditionResult = evaluateBattlefieldObjectCondition(toRemove[0], step.condition);
    if (conditionResult === null) {
      return {
        applied: false,
        message: `Skipped sacrifice (unsupported condition evaluation): ${step.raw}`,
        reason: 'unsupported_condition',
      };
    }

    if (!conditionResult) {
      return {
        applied: false,
        message: `Skipped sacrifice (condition false): ${step.raw}`,
        reason: 'condition_false',
        options: { persist: false },
      };
    }
  }

  const lastSacrificedPermanents = toRemove.map(permanent => createLastKnownPermanentSnapshot(permanent));
  const sacrificedCreaturesPowerTotal = lastSacrificedPermanents.reduce((sum, permanent) => {
    if (!permanent.typeLine.includes('creature')) return sum;
    return sum + (permanent.power ?? 0);
  }, 0);

  const removedIds = new Set<string>(toRemove.map(p => p.id));
  const kept = battlefield.filter(p => !removedIds.has(p.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'graveyard', 'sacrificed', oracleIrBattlefieldRemovalOptions(ctx, 'sacrifice'));

  return sacrificeStepResult(ctx, {
    applied: true,
    state: result.state,
    log: result.log,
    lastSacrificedCreaturesPowerTotal: Math.max(0, sacrificedCreaturesPowerTotal),
    lastSacrificedPermanents,
  });
}
