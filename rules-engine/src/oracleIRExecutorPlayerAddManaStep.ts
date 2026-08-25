// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: applyAddManaStep (+ exclusive commander color identity,
// manaStringToColorCounts, recordProducedMana, TEMPORARY_RETAINED_MANA_COLORS).
// Public entries: applyAddManaStep, TEMPORARY_RETAINED_MANA_COLORS.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  repeatManaString,
  resolveAddManaAmount,
  resolveDynamicAddManaSequence,
} from './oracleIRExecutorPlayerAddManaAmount';
import type { PlayerStepHandlerResult } from './oracleIRExecutorPlayerStepTypes';
import { addManaToPoolForPlayer, resolvePlayers } from './oracleIRExecutorPlayerUtils';

function normalizeColorSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => String(value || '').trim().toUpperCase())
    .map((value) => value.length === 1 ? value : value.slice(0, 1))
    .filter((value) => /^[WUBRG]$/.test(value));
}

function getCommanderColorIdentityForPlayer(state: GameState, playerId: PlayerID): string[] {
  const player: any = (state.players || []).find((entry: any) => entry?.id === playerId);
  const direct = normalizeColorSymbols(player?.commanderColorIdentity || player?.colorIdentity || player?.deckColorIdentity);
  if (direct.length > 0) return [...new Set(direct)];

  const commanderCards: any[] = [];
  for (const source of [player?.commander, player?.commanders]) {
    if (Array.isArray(source)) commanderCards.push(...source);
    else if (source) commanderCards.push(source);
  }

  const commanderZone = Array.isArray((state as any)?.commanderZone) ? (state as any).commanderZone : [];
  commanderCards.push(...commanderZone.filter((entry: any) => String(entry?.ownerId || entry?.owner || entry?.controller || '').trim() === String(playerId)));

  const colors = commanderCards.flatMap((card: any) =>
    normalizeColorSymbols(card?.colorIdentity || card?.color_identity || card?.card?.colorIdentity || card?.card?.color_identity)
  );
  return [...new Set(colors)];
}

export const TEMPORARY_RETAINED_MANA_COLORS = ['white', 'blue', 'black', 'red', 'green', 'colorless'] as const;

function manaStringToColorCounts(mana: string): Record<(typeof TEMPORARY_RETAINED_MANA_COLORS)[number], number> {
  const counts = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  const symbols = String(mana || '').match(/\{[^}]+\}/g) || [];
  for (const symbol of symbols) {
    const upper = symbol.toUpperCase();
    if (upper === '{W}') counts.white += 1;
    else if (upper === '{U}') counts.blue += 1;
    else if (upper === '{B}') counts.black += 1;
    else if (upper === '{R}') counts.red += 1;
    else if (upper === '{G}') counts.green += 1;
    else if (upper === '{C}') counts.colorless += 1;
    else if (/^\{\d+\}$/.test(upper)) counts.colorless += Math.max(0, parseInt(upper.slice(1, -1), 10) || 0);
  }
  return counts;
}

function recordProducedMana(state: GameState, playerId: PlayerID, manaToAdd: string): GameState {
  return {
    ...(state as any),
    lastOracleIrProducedMana: {
      ...((state as any).lastOracleIrProducedMana || {}),
      [playerId]: manaStringToColorCounts(manaToAdd),
    },
  } as any;
}

export function applyAddManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped add mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const normalizeManaChoice = (raw: string): string | null => {
    const trimmed = String(raw || '').trim().toUpperCase();
    if (!trimmed) return null;
    const symbol = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : `{${trimmed}}`;
    return /^{[WUBRG]}$/i.test(symbol) ? symbol.toUpperCase() : null;
  };
  const countManaSymbols = (raw: string): number => {
    const matches = String(raw || '').match(/\{[^}]+\}/g);
    return Array.isArray(matches) ? matches.length : 0;
  };
  const normalizeManaChoiceSequence = (raw: string): string[] | null => {
    const compact = String(raw || '').replace(/\s+/g, '').trim();
    if (!compact) return null;

    const braceMatches = compact.match(/\{[^}]+\}/g);
    if (Array.isArray(braceMatches) && braceMatches.join('') === compact) {
      const symbols = braceMatches.map(normalizeManaChoice);
      return symbols.every(Boolean) ? (symbols as string[]) : null;
    }

    if (/^[WUBRG]+$/i.test(compact)) {
      return compact.toUpperCase().split('').map((symbol) => `{${symbol}}`);
    }

    const single = normalizeManaChoice(compact);
    return single ? [single] : null;
  };
  const rawStepText = String(step.raw || '').trim();
  const orForEachMatch = rawStepText.match(/add (\{[wubrg]\}) or (\{[wubrg]\}) for each/i);
  if (orForEachMatch) {
    const count =
      resolveAddManaAmount(state, step, ctx) ??
      Number(ctx.referenceAmount ?? (ctx.selectorContext as any)?.referenceAmount ?? 1);
    const chosen =
      normalizeManaChoice(String(ctx.selectorContext?.chosenMana || orForEachMatch[1] || '').trim()) ||
      normalizeManaChoice(String(orForEachMatch[1] || '').trim());
    if (chosen && Number.isFinite(Number(count)) && Number(count) > 0) {
      const manaToAdd = repeatManaString(chosen, Math.max(0, Math.floor(Number(count))));
      for (const playerId of players) {
        const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd, step.spendRestriction, ctx.sourceId, ctx.sourceName);
        log.push(...result.log);
        if (!result.applied) {
          return {
            applied: false,
            message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
            reason: 'failed_to_apply',
          };
        }
        nextState = recordProducedMana(result.state, playerId, manaToAdd);
      }
      return { applied: true, state: nextState, log };
    }
  }
  const repeatedAmount = resolveAddManaAmount(state, step, ctx);
  const manaResolution = (() => {
    let options = Array.isArray(step.manaOptions)
      ? step.manaOptions.map(option => String(option || '').trim()).filter(Boolean)
      : [];
    if (step.manaOptionsScope === 'commander_color_identity') {
      if (players.length !== 1) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (commander color identity needs one player): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      const colorIdentity = getCommanderColorIdentityForPlayer(state, players[0]);
      const allowed = new Set(colorIdentity.map((color) => `{${color}}`.toUpperCase()));
      options = options.filter((option) => allowed.has(option.toUpperCase()));
      if (options.length === 0) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (commander color identity unavailable): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: { classification: 'invalid_input' as const },
        };
      }
    }
    if (options.length <= 1) {
      return {
        kind: 'resolved' as const,
        mana: String(step.mana || '').trim(),
      };
    }

    const symbolCount = Math.max(1, countManaSymbols(String(step.mana || '').trim()));
    const rawText = String(step.raw || '').trim();
    const requiresChosenColorSequence = /each of the chosen colors/i.test(rawText);
    const requestedSymbolCount = step.amount ? repeatedAmount : symbolCount;
    const requiresCombinationChoice = /any combination of/i.test(rawText) && (requestedSymbolCount ?? 0) > 1;
    const requiresRepeatedSingleChoice = /any one color/i.test(rawText) && (requestedSymbolCount ?? 0) > 1;

    if (requiresChosenColorSequence) {
      const chosenSymbols = normalizeManaChoiceSequence(String(ctx.selectorContext?.chosenMana || '').trim());
      if (!chosenSymbols || chosenSymbols.length === 0) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs chosen colors): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      if (options.length > 0 && !chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen colors): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              options,
            },
          },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: chosenSymbols.join(''),
      };
    }

    const requiresSplitColorPairs = /two mana of any one color and two mana of any other color/i.test(rawText);
    if (requiresSplitColorPairs) {
      const chosenSymbols = normalizeManaChoiceSequence(String(ctx.selectorContext?.chosenMana || '').trim());
      if (!chosenSymbols || chosenSymbols.length !== 4) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs two chosen colors): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      if (!chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen colors): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              options,
            },
          },
        };
      }

      const [first, second, third, fourth] = chosenSymbols;
      if (
        !first ||
        !second ||
        !third ||
        !fourth ||
        first.toUpperCase() !== second.toUpperCase() ||
        third.toUpperCase() !== fourth.toUpperCase() ||
        first.toUpperCase() === third.toUpperCase()
      ) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid split color pairs): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
            },
          },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: chosenSymbols.join(''),
      };
    }

    if ((requestedSymbolCount ?? symbolCount) > 1 && (requiresCombinationChoice || requiresRepeatedSingleChoice)) {
      const chosenSymbols = normalizeManaChoiceSequence(String(ctx.selectorContext?.chosenMana || '').trim());
      if (!chosenSymbols || chosenSymbols.length === 0) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs chosen color): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      if (!chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))) {
        const expectedCount = requestedSymbolCount ?? symbolCount;
        if (requiresCombinationChoice && options.length > 0 && expectedCount > 0) {
          const fallbackSymbol = options[0];
          return {
            kind: 'resolved' as const,
            mana: Array.from({ length: expectedCount }, () => fallbackSymbol).join(''),
          };
        }
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen color): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              options,
            },
          },
        };
      }

      if (requiresCombinationChoice) {
        if (chosenSymbols.length === 1 && (requestedSymbolCount ?? 0) > 1) {
          return {
            kind: 'resolved' as const,
            mana: Array.from({ length: requestedSymbolCount ?? symbolCount }, () => chosenSymbols[0]).join(''),
          };
        }
        if (
          chosenSymbols.length > 0 &&
          chosenSymbols.length < (requestedSymbolCount ?? symbolCount) &&
          chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))
        ) {
          const padded = [...chosenSymbols];
          while (padded.length < (requestedSymbolCount ?? symbolCount)) {
            padded.push(padded[padded.length - 1] || padded[0] || options[0] || '');
          }
          return {
            kind: 'resolved' as const,
            mana: padded.slice(0, requestedSymbolCount ?? symbolCount).join(''),
          };
        }
        if (chosenSymbols.length !== requestedSymbolCount) {
          if (
            requiresCombinationChoice &&
            options.length > 0 &&
            chosenSymbols.length > (requestedSymbolCount ?? symbolCount) &&
            chosenSymbols.every((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase()))
          ) {
            return {
              kind: 'resolved' as const,
              mana: chosenSymbols.slice(0, requestedSymbolCount ?? symbolCount).join(''),
            };
          }
          if (requiresCombinationChoice && options.length > 0 && (requestedSymbolCount ?? symbolCount) > 0) {
            const fallbackSymbol =
              chosenSymbols.find((symbol) => options.some((option) => option.toUpperCase() === symbol.toUpperCase())) ||
              options[0];
            return {
              kind: 'resolved' as const,
              mana: Array.from({ length: requestedSymbolCount ?? symbolCount }, () => fallbackSymbol).join(''),
            };
          }
          return {
            kind: 'skip' as const,
            message: `Skipped add mana (invalid chosen color count): ${step.raw}`,
            reason: 'invalid_input' as const,
            options: {
              classification: 'invalid_input' as const,
              metadata: {
                chosenMana: chosenSymbols.join(''),
                expectedCount: requestedSymbolCount ?? symbolCount,
              },
            },
          };
        }

        return {
          kind: 'resolved' as const,
          mana: chosenSymbols.join(''),
        };
      }

      const chosenColor = chosenSymbols[0];
      const repeatedChoice = chosenSymbols.length === 1
        ? Array.from({ length: requestedSymbolCount ?? symbolCount }, () => chosenColor)
        : chosenSymbols;
      if (
        repeatedChoice.length !== (requestedSymbolCount ?? symbolCount) ||
        repeatedChoice.some((symbol) => symbol.toUpperCase() !== chosenColor.toUpperCase())
      ) {
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (invalid chosen color repetition): ${step.raw}`,
          reason: 'invalid_input' as const,
          options: {
            classification: 'invalid_input' as const,
            metadata: {
              chosenMana: chosenSymbols.join(''),
              expectedCount: requestedSymbolCount ?? symbolCount,
            },
          },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: repeatedChoice.join(''),
      };
    }

    const chosenMana = normalizeManaChoice(String(ctx.selectorContext?.chosenMana || '').trim());
    if (!chosenMana) {
      if (step.requiresChosenMana) {
        const expectedCount = repeatedAmount ?? requestedSymbolCount ?? symbolCount;
        if (requiresCombinationChoice && options.length > 0 && (expectedCount ?? 0) > 0) {
          return {
            kind: 'resolved' as const,
            mana: Array.from({ length: expectedCount ?? symbolCount }, () => options[0]).join(''),
          };
        }
        return {
          kind: 'skip' as const,
          message: `Skipped add mana (needs chosen color): ${step.raw}`,
          reason: 'player_choice_required' as const,
          options: { classification: 'player_choice' as const },
        };
      }

      return {
        kind: 'resolved' as const,
        mana: options[0] || '',
      };
    }

    const match = options.find(option => option.toUpperCase() === chosenMana.toUpperCase());
    if (match) {
      return {
        kind: 'resolved' as const,
        mana: match,
      };
    }

    if (step.requiresChosenMana) {
      return {
        kind: 'skip' as const,
        message: `Skipped add mana (invalid chosen color): ${step.raw}`,
        reason: 'invalid_input' as const,
        options: {
          classification: 'invalid_input' as const,
          metadata: {
            chosenMana,
            options,
          },
        },
      };
    }

    return {
      kind: 'resolved' as const,
      mana: options[0] || '',
    };
  })();

  const dynamicManaSequence = resolveDynamicAddManaSequence(state, step, ctx);
  if (dynamicManaSequence === null) {
    return {
      applied: false,
      message: `Skipped add mana (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
    };
  }

  if (manaResolution.kind === 'skip') {
    return {
      applied: false,
      message: manaResolution.message,
      reason: manaResolution.reason,
      options: manaResolution.options,
    };
  }

  if (dynamicManaSequence !== undefined) {
    const manaToAdd = dynamicManaSequence;

    if (!manaToAdd) {
      return {
        applied: true,
        state,
        log: [`Resolved add mana to zero mana: ${step.raw}`],
      };
    }

    for (const playerId of players) {
      const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd, step.spendRestriction, ctx.sourceId, ctx.sourceName);
      log.push(...result.log);
      if (!result.applied) {
        return {
          applied: false,
          message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
          reason: 'failed_to_apply',
          options: {
            metadata: log.length > 0 ? { log } : undefined,
          },
        };
      }
      nextState = recordProducedMana(result.state, playerId, manaToAdd);
    }

    return { applied: true, state: nextState, log };
  }

  if (repeatedAmount === null) {
    return {
      applied: false,
      message: `Skipped add mana (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
    };
  }

  const sequenceDrivenAmount = step.amount && /each of the chosen colors|any combination of/i.test(String(step.raw || ''));
  const manaToAdd = sequenceDrivenAmount
    ? manaResolution.mana
    : step.amount
    ? repeatManaString(manaResolution.mana, repeatedAmount)
    : manaResolution.mana;

  if (!manaToAdd) {
    return {
      applied: true,
      state,
      log: [`Resolved add mana to zero mana: ${step.raw}`],
    };
  }

  for (const playerId of players) {
    const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd, step.spendRestriction, ctx.sourceId, ctx.sourceName);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          metadata: log.length > 0 ? { log } : undefined,
        },
      };
    }
    nextState = recordProducedMana(result.state, playerId, manaToAdd);
  }

  return { applied: true, state: nextState, log };
}
