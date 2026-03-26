import type { GameState } from '../../shared/src';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';

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
}): number | null {
  const { state, controllerId, raw, runtime } = args;
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
        readControllerValue(stateAny.lifeGainedThisTurn, controllerId, false),
        readControllerValue(stateAny.lifeGained, controllerId, false),
        readControllerValue(stateAny.turnStats?.lifeGained, controllerId, false),
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
        readControllerValue(stateAny.lifeLostThisTurn, controllerId, false),
        readControllerValue(stateAny.lifeLost, controllerId, false),
        readControllerValue(stateAny.turnStats?.lifeLost, controllerId, false),
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
    const m = raw.match(/^x is the number of cards? revealed this way$/i);
    if (m) {
      const revealed = Number(runtime?.lastRevealedCardCount ?? 0);
      return Number.isFinite(revealed) ? Math.max(0, revealed) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? discarded this way$/i);
    if (m) {
      const discarded = Number(runtime?.lastDiscardedCardCount ?? 0);
      return Number.isFinite(discarded) ? Math.max(0, discarded) : 0;
    }
  }

  {
    const m = raw.match(/^x is the number of cards? exiled this way$/i);
    if (m) {
      const exiled = Number(runtime?.lastExiledCardCount ?? 0);
      return Number.isFinite(exiled) ? Math.max(0, exiled) : 0;
    }
  }

  {
    const m = raw.match(/^x is the total power of (?:the )?cards? exiled this way$/i);
    if (m) {
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

  return null;
}
