import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';

type CountCardsExiledWithSource = (
  state: GameState,
  sourceId: string,
  typeFilter?: string
) => number;
type FindObjectByName = (name: string) => unknown | null;
type GreatestPowerAmongCreatureCards = (cards: readonly unknown[]) => number;
type GreatestManaValueAmongCards = (cards: readonly unknown[]) => number;

export function tryEvaluateModifyPtWhereExileAndCardStats(args: {
  state: GameState;
  raw: string;
  battlefield: readonly BattlefieldPermanent[];
  controllerId: string;
  ctx?: OracleIRExecutionContext;
  runtime?: ModifyPtRuntime;
  countCardsExiledWithSource: CountCardsExiledWithSource;
  findObjectByName: FindObjectByName;
  greatestPowerAmongCreatureCards: GreatestPowerAmongCreatureCards;
  greatestManaValueAmongCards: GreatestManaValueAmongCards;
}): number | null {
  const {
    state,
    raw,
    battlefield,
    controllerId,
    ctx,
    runtime,
    countCardsExiledWithSource,
    findObjectByName,
    greatestPowerAmongCreatureCards,
    greatestManaValueAmongCards,
  } = args;

  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with this (?:permanent|creature|artifact|enchantment|planeswalker|card)?$/i);
    if (m) {
      const sourceId = String(ctx?.sourceId || '').trim();
      if (!sourceId) return null;
      return countCardsExiledWithSource(state, sourceId, m[1]);
    }
  }

  {
    const m = raw.match(/^x is the number of (?:(nonland permanent|permanent|artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery) )?cards? exiled with (?!this\b)([a-z][a-z0-9 ,.'\u2019-]*)$/i);
    if (m) {
      const namedPermanent = findObjectByName(String(m[2] || '')) as any;
      const namedId = String((namedPermanent as any)?.id || '').trim();
      if (!namedId) return null;

      return countCardsExiledWithSource(state, namedId, m[1]);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? in (?:your graveyard|all graveyards|(?:your opponents?|their) graveyard)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      const allGy = /all graveyards/.test(clause);
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (!allGy && pid !== controllerId) continue;
        const gy = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
        cards.push(...gy);
      }
      return greatestPowerAmongCreatureCards(cards);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) power among creature cards? exiled this way$/i);
    if (m) {
      const runtimeCards = Array.isArray(runtime?.lastExiledCards) ? runtime.lastExiledCards : null;
      if (runtimeCards) {
        return greatestPowerAmongCreatureCards(runtimeCards);
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
        for (const card of exile as any[]) {
          if (sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          cards.push(card);
        }
      }
      return greatestPowerAmongCreatureCards(cards);
    }
  }

  {
    const m = raw.match(/^x is the (?:greatest|highest) mana value among cards? (?:in your graveyard|discarded this way|exiled this way)$/i);
    if (m) {
      const clause = String(m[0] || '').toLowerCase();
      if (/exiled this way/.test(clause) && Array.isArray(runtime?.lastExiledCards)) {
        return greatestManaValueAmongCards(runtime.lastExiledCards);
      }

      const sourceId = String(ctx?.sourceId || '').trim();
      const cards: any[] = [];
      for (const player of (state.players || []) as any[]) {
        const pid = String((player as any)?.id || '').trim();
        if (pid !== controllerId) continue;
        const isExile = /exiled this way/.test(clause);
        const zone: readonly any[] = isExile
          ? (Array.isArray((player as any)?.exile) ? (player as any).exile : [])
          : (Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : []);
        for (const card of zone as any[]) {
          if (isExile && sourceId && String((card as any)?.exiledBy || '').trim() !== sourceId) continue;
          cards.push(card);
        }
      }
      return greatestManaValueAmongCards(cards);
    }
  }

  return null;
}
