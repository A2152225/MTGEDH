import type { GameState } from '../../shared/src';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleEffectStep } from './oracleIR';
import { findAntecedentStepIndex } from './oracleIRStepLedger';
import { resolveThisWayAntecedentStepIndex, REVEALED_THIS_WAY_ANTECEDENT_KINDS } from './oracleIRThisWayBinding';
import {
  resolveCardCountDiscardedThisWay,
  resolveNonlandCountDiscardedThisWay,
  resolveSnapshotCountAtAntecedent,
  resolveTotalPowerExiledThisWay,
} from './oracleIRThisWayResolver';
import { resolveLedgerAntecedentStepIndex } from './oracleIRLedgerCardAccess';

const EXILE_ANTECEDENT_KINDS = [
  'exile',
  'exile_top',
  'impulse_exile_top',
  'exile_named_cards_from_zones',
  'destroy',
  'move_zone',
] as const;

function resolveDiscardedAntecedentStepIndex(
  ctx: OracleIRExecutionContext | undefined,
  step?: OracleEffectStep,
): number | null {
  if (!ctx) return null;
  if (step) {
    const fromStep = resolveThisWayAntecedentStepIndex(ctx, step as OracleEffectStep, 'discard');
    if (fromStep !== null) return fromStep;
  }
  if (ctx.currentStepIndex == null) return null;
  return findAntecedentStepIndex(ctx.appliedStepKinds, 'discard', ctx.currentStepIndex);
}

function resolveExileAntecedentStepIndex(
  ctx: OracleIRExecutionContext | undefined,
  step?: OracleEffectStep,
): number | null {
  return resolveLedgerAntecedentStepIndex(ctx, step, EXILE_ANTECEDENT_KINDS);
}

function getCardTypesLower(card: any): string {
  return String(card?.type_line || card?.cardType || card?.card?.type_line || card?.card?.cardType || '')
    .trim()
    .toLowerCase();
}

function readControllerValue(value: any, controllerId: string, missingAsZero: boolean): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const key = String(controllerId);
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    return missingAsZero ? 0 : null;
  }
  const n = Number(value[key]);
  if (!Number.isFinite(n)) return missingAsZero ? 0 : null;
  return Math.max(0, n);
}

function sumOpponentsValue(value: any, state: GameState, controllerId: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const players = Array.isArray(state.players) ? state.players : [];
  if (players.length > 0) {
    return players.reduce((sum: number, player: any) => {
      const pid = String((player as any)?.id || '').trim();
      if (!pid || pid === controllerId) return sum;
      const n = Number((value as any)[pid]);
      return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
    }, 0);
  }

  return Object.entries(value as Record<string, unknown>).reduce((sum, [pid, amount]) => {
    if (String(pid).trim() === controllerId) return sum;
    const n = Number(amount);
    return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
  }, 0);
}

function sumAllValues(value: any): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.values(value as Record<string, unknown>).reduce<number>((sum, amount) => {
    const n = Number(amount);
    return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
  }, 0);
}

function firstNonNull(candidates: Array<number | null>): number | null {
  for (const candidate of candidates) {
    if (candidate !== null) return candidate;
  }
  return null;
}

export function tryEvaluateModifyPtWhereTurnStats(args: {
  state: GameState;
  controllerId: string;
  raw: string;
  runtime?: ModifyPtRuntime;
  ctx?: OracleIRExecutionContext;
  step?: OracleEffectStep;
}): number | null {
  const { state, controllerId, raw, runtime, ctx, step } = args;
  const stateAny: any = state as any;

  {
    const m = raw.match(/^x is the amount of life your opponents(?:['Ã¢â‚¬â„¢])?(?: have)? gained(?: this turn)?$/i);
    if (m) {
      return firstNonNull([
        sumOpponentsValue(stateAny.lifeGainedThisTurn, state, controllerId),
        sumOpponentsValue(stateAny.lifeGained, state, controllerId),
        sumOpponentsValue(stateAny.turnStats?.lifeGained, state, controllerId),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the amount of life you gained(?: this turn)?$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.lifeGainedThisTurn, controllerId, true),
        readControllerValue(stateAny.lifeGained, controllerId, true),
        readControllerValue(stateAny.turnStats?.lifeGained, controllerId, true),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the amount of life your opponents(?:['Ã¢â‚¬â„¢])?(?: have)? lost(?: this turn)?$/i);
    if (m) {
      return firstNonNull([
        sumOpponentsValue(stateAny.lifeLostThisTurn, state, controllerId),
        sumOpponentsValue(stateAny.lifeLost, state, controllerId),
        sumOpponentsValue(stateAny.turnStats?.lifeLost, state, controllerId),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the amount of life (?:you(?:['Ã¢â‚¬â„¢]ve| have)|you) lost(?: this turn)?$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.lifeLostThisTurn, controllerId, true),
        readControllerValue(stateAny.lifeLost, controllerId, true),
        readControllerValue(stateAny.turnStats?.lifeLost, controllerId, true),
      ]);
    }
  }

  {
    const referencedPlayerId = String(
      ctx?.selectorContext?.targetPlayerId
        || ctx?.referencedPlayerId
        || ctx?.selectorContext?.thatPlayerId
        || ctx?.thatPlayerId
        || ctx?.selectorContext?.targetOpponentId
        || ctx?.targetOpponentId
        || '',
    ).trim();
    const playerId = referencedPlayerId || controllerId;
    const theyLost = raw.match(
      /^x is (?:the (?:amount of )?life|life) (?:they|that player) lost(?: this turn)?$/i,
    );
    if (theyLost) {
      return firstNonNull([
        readControllerValue(stateAny.lifeLostThisTurn, playerId, true),
        readControllerValue(stateAny.lifeLost, playerId, true),
        readControllerValue(stateAny.turnStats?.lifeLost, playerId, true),
      ]);
    }
    const theyGained = raw.match(
      /^x is (?:the (?:amount of )?life|life) (?:they|that player) gained(?: this turn)?$/i,
    );
    if (theyGained) {
      return firstNonNull([
        readControllerValue(stateAny.lifeGainedThisTurn, playerId, true),
        readControllerValue(stateAny.lifeGained, playerId, true),
        readControllerValue(stateAny.turnStats?.lifeGained, playerId, true),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? (?:you(?:['Ã¢â‚¬â„¢]ve| have)|you) discarded this turn$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.cardsDiscardedThisTurn, controllerId, true),
        readControllerValue(stateAny.cardsDiscarded, controllerId, true),
        readControllerValue(stateAny.turnStats?.cardsDiscarded, controllerId, true),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? your opponents have discarded this turn$|^x is the number of cards? your opponents discarded this turn$/i);
    if (m) {
      return firstNonNull([
        sumOpponentsValue(stateAny.cardsDiscardedThisTurn, state, controllerId),
        sumOpponentsValue(stateAny.cardsDiscarded, state, controllerId),
        sumOpponentsValue(stateAny.turnStats?.cardsDiscarded, state, controllerId),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? (?:you(?:['Ã¢â‚¬â„¢]ve| have)|you) drawn this turn$|^x is the number of cards? you drew this turn$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.cardsDrawnThisTurn, controllerId, true),
        readControllerValue(stateAny.cardsDrawn, controllerId, true),
        readControllerValue(stateAny.turnStats?.cardsDrawn, controllerId, true),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? your opponents have drawn this turn$|^x is the number of cards? your opponents drew this turn$/i);
    if (m) {
      return firstNonNull([
        sumOpponentsValue(stateAny.cardsDrawnThisTurn, state, controllerId),
        sumOpponentsValue(stateAny.cardsDrawn, state, controllerId),
        sumOpponentsValue(stateAny.turnStats?.cardsDrawn, state, controllerId),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of spells? (?:you(?:['Ã¢â‚¬â„¢]ve| have)|you) cast this turn$|^x is the number of spells? you cast this turn$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.spellsCastThisTurn, controllerId, true),
        readControllerValue(stateAny.spellsCast, controllerId, true),
        readControllerValue(stateAny.turnStats?.spellsCast, controllerId, true),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of spells? your opponents have cast this turn$|^x is the number of spells? your opponents cast this turn$/i);
    if (m) {
      return firstNonNull([
        sumOpponentsValue(stateAny.spellsCastThisTurn, state, controllerId),
        sumOpponentsValue(stateAny.spellsCast, state, controllerId),
        sumOpponentsValue(stateAny.turnStats?.spellsCast, state, controllerId),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of spells? cast this turn$/i);
    if (m) {
      return firstNonNull([
        sumAllValues(stateAny.spellsCastThisTurn),
        sumAllValues(stateAny.spellsCast),
        sumAllValues(stateAny.turnStats?.spellsCast),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of lands? (?:you(?:['Ã¢â‚¬â„¢]ve| have)|you) played this turn$|^x is the number of lands? you played this turn$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.landsPlayedThisTurn, controllerId, true),
        readControllerValue(stateAny.landsPlayed, controllerId, true),
        readControllerValue(stateAny.turnStats?.landsPlayed, controllerId, true),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of lands? your opponents have played this turn$|^x is the number of lands? your opponents played this turn$/i);
    if (m) {
      return firstNonNull([
        sumOpponentsValue(stateAny.landsPlayedThisTurn, state, controllerId),
        sumOpponentsValue(stateAny.landsPlayed, state, controllerId),
        sumOpponentsValue(stateAny.turnStats?.landsPlayed, state, controllerId),
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of times you descended this turn$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.permanentCardsPutIntoYourGraveyardThisTurn, controllerId, true),
        readControllerValue(stateAny.turnStats?.permanentCardsPutIntoYourGraveyard, controllerId, true),
        stateAny.descendedThisTurn?.[controllerId] ? 1 : 0,
      ]);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? revealed this way$/i);
    if (m) {
      const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, REVEALED_THIS_WAY_ANTECEDENT_KINDS);
      if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
        return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
      }
      const revealed = Number(runtime?.lastRevealedCardCount ?? 0);
      return Number.isFinite(revealed) ? Math.max(0, revealed) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? discarded this way$/i);
    if (m) {
      if (ctx?.stepLedger?.size) {
        const antecedentStepIndex = resolveDiscardedAntecedentStepIndex(ctx, step);
        if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
          return resolveCardCountDiscardedThisWay(ctx, antecedentStepIndex);
        }
      }
      const discarded = Number(runtime?.lastDiscardedCardCount ?? 0);
      return Number.isFinite(discarded) ? Math.max(0, discarded) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of nonland cards? discarded this way$/i);
    if (m) {
      if (ctx?.stepLedger?.size) {
        const antecedentStepIndex = resolveDiscardedAntecedentStepIndex(ctx, step);
        if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
          return resolveNonlandCountDiscardedThisWay(ctx, antecedentStepIndex);
        }
      }
      const discardedCards = Array.isArray(runtime?.lastDiscardedCards) ? runtime.lastDiscardedCards : [];
      return discardedCards.reduce((count: number, card: any) => {
        return count + (getCardTypesLower(card).includes('land') ? 0 : 1);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of cards? exiled this way$/i);
    if (m) {
      if (ctx?.stepLedger?.size) {
        const antecedentStepIndex = resolveExileAntecedentStepIndex(ctx, step);
        if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
          return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
        }
      }
      const exiled = Number(runtime?.lastExiledCardCount ?? 0);
      return Number.isFinite(exiled) ? Math.max(0, exiled) : 0;
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?cards? exiled this way$/i);
    if (m) {
      if (ctx?.stepLedger?.size) {
        const antecedentStepIndex = resolveExileAntecedentStepIndex(ctx, step);
        if (antecedentStepIndex != null && ctx.stepLedger.has(antecedentStepIndex)) {
          const total = resolveTotalPowerExiledThisWay(ctx, antecedentStepIndex);
          if (total !== null) return total;
        }
      }
      const exiledCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : [];
      return exiledCards.reduce((sum: number, card: any) => {
        const n = Number((card as any)?.power ?? (card as any)?.card?.power);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?creatures? goaded this way$/i);
    if (m) {
      const goadedCreatures = Array.isArray(runtime?.lastGoadedCreatures) ? runtime.lastGoadedCreatures : [];
      return goadedCreatures.reduce((sum: number, creature: any) => {
        const n = Number((creature as any)?.power ?? (creature as any)?.card?.power);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?creatures? sacrificed this way$/i);
    if (m) {
      const totalPower = Number(runtime?.lastSacrificedCreaturesPowerTotal ?? 0);
      return Number.isFinite(totalPower) ? Math.max(0, totalPower) : 0;
    }
  }

  {
    const m = raw.match(/^x is (?:the )?amount of excess damage dealt this way$|^x is the excess damage dealt this way$/i);
    if (m) {
      const excess = Number(runtime?.lastExcessDamageDealtThisWay ?? 0);
      return Number.isFinite(excess) ? Math.max(0, excess) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? looked at while scrying this way$/i);
    if (m) {
      const antecedentStepIndex = resolveLedgerAntecedentStepIndex(ctx, step, ['scry']);
      if (antecedentStepIndex != null && ctx?.stepLedger?.has(antecedentStepIndex)) {
        return resolveSnapshotCountAtAntecedent(ctx, antecedentStepIndex);
      }
      const looked = Number(runtime?.lastScryLookedAtCount ?? 0);
      return Number.isFinite(looked) ? Math.max(0, looked) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of (?:permanents|creatures|myr) tapped this way$/i);
    if (m) {
      const tapped = Number(runtime?.lastTappedMatchingPermanentCount ?? 0);
      return Number.isFinite(tapped) ? Math.max(0, tapped) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of nontoken creatures that died this turn$/i);
    if (m) {
      const byController = stateAny.nontokenCreaturesDiedThisTurnByController;
      if (byController && typeof byController === 'object' && !Array.isArray(byController)) {
        return sumAllValues(byController);
      }
      const fallback = stateAny.creaturesDiedThisTurnByController;
      if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
        return sumAllValues(fallback);
      }
      return Boolean(stateAny.creatureDiedThisTurn) ? 1 : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of treasure tokens you created this turn$/i);
    if (m) {
      return readControllerValue(stateAny.treasureTokensCreatedThisTurnByController, controllerId, true);
    }
  }

  {
    const m = raw.match(/^x is the total number of rad counters among players$/i);
    if (m) {
      return (state.players || []).reduce((sum: number, player: any) => {
        const rad = Number((player as any)?.counters?.rad ?? (player as any)?.radCounters ?? 0);
        return sum + (Number.isFinite(rad) ? Math.max(0, rad) : 0);
      }, 0);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died this turn$/i);
    if (m) {
      const byController = stateAny.creaturesDiedThisTurnByController;
      if (byController && typeof byController === 'object' && !Array.isArray(byController)) {
        return sumAllValues(byController);
      }
      return Boolean(stateAny.creatureDiedThisTurn) ? 1 : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died under your control(?: this turn)?$/i);
    if (m) {
      return readControllerValue(stateAny.creaturesDiedThisTurnByController, controllerId, true);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that died under (?:(?:your )?opponents(?:['Ã¢â‚¬â„¢])?|an opponent(?:['Ã¢â‚¬â„¢]s)?) control(?: this turn)?$/i);
    if (m) {
      return sumOpponentsValue(stateAny.creaturesDiedThisTurnByController, state, controllerId);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures you control that died(?: this turn)?$/i);
    if (m) {
      return readControllerValue(stateAny.creaturesDiedThisTurnByController, controllerId, true);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures your opponents control that died(?: this turn)?$/i);
    if (m) {
      return sumOpponentsValue(stateAny.creaturesDiedThisTurnByController, state, controllerId);
    }
  }

  {
    const m = raw.match(/^x is the number of permanents (?:you(?:['Ã¢â‚¬â„¢]ve| have)|you) sacrificed(?: this turn)?$/i);
    if (m) {
      return readControllerValue(stateAny.permanentsSacrificedThisTurn, controllerId, true);
    }
  }

  {
    const m = raw.match(/^x is the number of permanents your opponents have sacrificed(?: this turn)?$|^x is the number of permanents your opponents sacrificed(?: this turn)?$/i);
    if (m) {
      return sumOpponentsValue(stateAny.permanentsSacrificedThisTurn, state, controllerId);
    }
  }

  {
    const m = raw.match(/^x is the number of tokens you created this turn$/i);
    if (m) {
      return readControllerValue(stateAny.tokensCreatedThisTurn, controllerId, true);
    }
  }

  {
    const m = raw.match(/^x is the number of creatures that were exiled under your opponents' control this turn$/i);
    if (m) {
      return sumOpponentsValue(stateAny.creaturesExiledUnderOpponentsControlThisTurn, state, controllerId);
    }
  }

  {
    const m = raw.match(/^x is the number of mounts and\/or vehicles that entered the battlefield under your control this turn$/i);
    if (m) {
      return readControllerValue(stateAny.mountsAndVehiclesEnteredBattlefieldThisTurn, controllerId, true);
    }
  }

  {
    const m = raw.match(/^x is the number of instant and sorcery spells you've cast this turn$/i);
    if (m) {
      return firstNonNull([
        readControllerValue(stateAny.instantAndSorcerySpellsCastThisTurn, controllerId, true),
        readControllerValue(stateAny.noncreatureSpellsCastThisTurn, controllerId, true),
      ]);
    }
  }

  return null;
}
