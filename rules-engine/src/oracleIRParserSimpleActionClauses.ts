import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';
import { recoverTruncatedActionClause } from './oracleIRParserSimpleActionHelpers';
import type { WithMeta } from './oracleIRParserSimpleActionHelpers';
import { tryParseSimpleActionEarlyClauses } from './oracleIRParserSimpleActionEarlyClauses';
import { tryParseSimpleActionAddManaChoiceClauses } from './oracleIRParserSimpleActionAddManaChoice';
import { tryParseSimpleActionDrawTurnClauses } from './oracleIRParserSimpleActionDrawTurn';
import { tryParseSimpleActionCounterSearchClauses } from './oracleIRParserSimpleActionCounterSearch';
import { tryParseSimpleActionDiscardVoteClauses } from './oracleIRParserSimpleActionDiscardVote';
import { tryParseSimpleActionBlightScryClauses } from './oracleIRParserSimpleActionBlightScry';
import { tryParseSimpleActionMillClauses } from './oracleIRParserSimpleActionMill';
import { tryParseSimpleActionTokenLifeClauses } from './oracleIRParserSimpleActionTokenLife';

export function tryParseSimpleActionClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const clause = recoverTruncatedActionClause(args.clause);
  const rawClause = args.rawClause;
  const { withMeta } = args;

  {
    const early = tryParseSimpleActionEarlyClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (early) return early;
  }

  {
    const addManaChoice = tryParseSimpleActionAddManaChoiceClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (addManaChoice) return addManaChoice;
  }

  {
    const drawTurn = tryParseSimpleActionDrawTurnClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (drawTurn) return drawTurn;
  }

  {
    const counterSearch = tryParseSimpleActionCounterSearchClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (counterSearch) return counterSearch;
  }

  {
    const discardVote = tryParseSimpleActionDiscardVoteClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (discardVote) return discardVote;
  }

  {
    const blightScry = tryParseSimpleActionBlightScryClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (blightScry) return blightScry;
  }

  {
    const mill = tryParseSimpleActionMillClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (mill) return mill;

    const tokenLife = tryParseSimpleActionTokenLifeClauses({ clause, rawClause, withMeta, parseRest: tryParseSimpleActionClause });
    if (tokenLife) return tokenLife;
  }

  {
    const staticRider = clause.match(
      /^(draft a card from this creature's spellbook|you may pay any amount of life|you have no maximum hand size until your next turn|level \d+ you may play an additional land on each of your turns|you get \{[a-z0-9]+\} for each .+ you control|transform up to one other target double-faced artifact you control|this effect can't reduce a number below \d+ or a number word below one|then incubate x, where x is .+|your favorite creatures get [+-]\d+\/[+-]?\d+|your maximum hand size is (?:two|three|four|five|six|seven|eight|nine|ten|\d+)|you may reveal that card|the player with the most life|then shuffle and put those cards on top in any order|you gain \d+ life for each time it was kicked|target creature card in your graveyard without unearth perpetually gains unearth|the unearth cost is equal to its mana cost|the heroes lose \d+ life|a card and convert this permanent|combat damage this turn, it deals that|they keep that card|you may pay (?:\{[^}]+\})+ up to three times)$/i
    );
    if (staticRider) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('effect rider'),
        effectText: [rawClause],
        duration: 'static',
        raw: rawClause,
      });
    }
  }

  return null;
}
