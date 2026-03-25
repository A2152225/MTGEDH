import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'’-]*?(?:'s|’s)? (?:controller|owner))\\s+)?";

export function tryParseLifeAndCombatClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const gain = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}gains?\\s+(\\d+|x|[a-z]+)\\s+life\\b`, 'i'));
    if (gain) {
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(gain[1]),
        amount: parseQuantity(gain[2]),
        raw: rawClause,
      });
    }

    const gainDefault = clause.match(/^gain\s+(\d+|x|[a-z]+)\s+life\b/i);
    if (gainDefault) {
      return withMeta({
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: parseQuantity(gainDefault[1]),
        raw: rawClause,
      });
    }

    const gainEqual = clause.match(/^(.*?)(?:gains?\s+life\s+equal\s+to)\s+(.+)$/i);
    if (gainEqual) {
      const whoRaw = String(gainEqual[1] || '').trim().replace(/\s+$/, '');
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(whoRaw || 'you'),
        amount: { kind: 'unknown', raw: String(gainEqual[2] || '').trim() },
        raw: rawClause,
      });
    }

    const gainEqualDefault = clause.match(/^gain\s+life\s+equal\s+to\s+(.+)$/i);
    if (gainEqualDefault) {
      return withMeta({
        kind: 'gain_life',
        who: { kind: 'you' },
        amount: { kind: 'unknown', raw: String(gainEqualDefault[1] || '').trim() },
        raw: rawClause,
      });
    }

    const lose = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}loses?\\s+(\\d+|x|[a-z]+)\\s+life\\b`, 'i'));
    if (lose) {
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(lose[1]),
        amount: parseQuantity(lose[2]),
        raw: rawClause,
      });
    }

    const loseDefault = clause.match(/^lose\s+(\d+|x|[a-z]+)\s+life\b/i);
    if (loseDefault) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: parseQuantity(loseDefault[1]),
        raw: rawClause,
      });
    }

    const loseEqual = clause.match(/^(.*?)(?:loses?\s+life\s+equal\s+to)\s+(.+)$/i);
    if (loseEqual) {
      const whoRaw = String(loseEqual[1] || '').trim().replace(/\s+$/, '');
      return withMeta({
        kind: 'lose_life',
        who: parsePlayerSelector(whoRaw || 'you'),
        amount: { kind: 'unknown', raw: String(loseEqual[2] || '').trim() },
        raw: rawClause,
      });
    }

    const loseEqualDefault = clause.match(/^lose\s+life\s+equal\s+to\s+(.+)$/i);
    if (loseEqualDefault) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: { kind: 'unknown', raw: String(loseEqualDefault[1] || '').trim() },
        raw: rawClause,
      });
    }
  }

  {
    const dealDamageEqual = clause.match(/^deal\s+damage\s+equal\s+to\s+(.+?)\s+to\s+(.+)$/i);
    if (dealDamageEqual) {
      return withMeta({
        kind: 'deal_damage',
        amount: { kind: 'unknown', raw: String(dealDamageEqual[1] || '').trim() },
        target: parseObjectSelector(dealDamageEqual[2]),
        raw: rawClause,
      });
    }

    const sourceDealsDamageEqual = clause.match(
      /^(?:it|this (?:permanent|spell)|[a-z0-9 ,.'â€™/-]+)\s+deals?\s+damage\s+equal\s+to\s+(.+?)\s+to\s+(.+)$/i
    );
    if (sourceDealsDamageEqual) {
      return withMeta({
        kind: 'deal_damage',
        amount: { kind: 'unknown', raw: String(sourceDealsDamageEqual[1] || '').trim() },
        target: parseObjectSelector(sourceDealsDamageEqual[2]),
        raw: rawClause,
      });
    }

    const dealDamage = clause.match(/^deal\s+(that much|\d+|x|[a-z]+)\s+damage\s+to\s+(.+)$/i);
    if (dealDamage) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(dealDamage[1]),
        target: parseObjectSelector(dealDamage[2]),
        raw: rawClause,
      });
    }

    const sourceDealsDamage = clause.match(
      /^(?:it|this (?:permanent|spell))\s+deals?\s+(that much|\d+|x|[a-z]+)\s+damage\s+to\s+(.+)$/i
    );
    if (sourceDealsDamage) {
      return withMeta({
        kind: 'deal_damage',
        amount: parseQuantity(sourceDealsDamage[1]),
        target: parseObjectSelector(sourceDealsDamage[2]),
        raw: rawClause,
      });
    }
  }

  {
    const tapOrUntap = clause.match(/^(?:(?:you|its controller)\s+may\s+)?tap\s+or\s+untap\s+(.+)$/i);
    if (tapOrUntap) {
      return withMeta({
        kind: 'tap_or_untap',
        target: parseObjectSelector(tapOrUntap[1]),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  return null;
}
