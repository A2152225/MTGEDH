import type { OracleEffectStep } from './oracleIR';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'’-]*?(?:'s|’s)? (?:controller|owner))\\s+)?";

const COUNTER_AMOUNT_PATTERN = '(?:a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';

function parseManaChoiceList(raw: string): string[] {
  const matches = String(raw || '').match(/\{[^}]+\}/g);
  return Array.isArray(matches) ? matches.map(symbol => String(symbol || '').trim()).filter(Boolean) : [];
}

export function tryParseSimpleActionClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const moreCards = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}draws?\\s+([a-z0-9]+)\\s+more\\s+cards?\\b`, 'i')
    );
    if (moreCards) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(moreCards[1]),
        amount: parseQuantity(moreCards[2]),
        raw: rawClause,
      });
    }

    const draw = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}draws?\\s+(a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i')
    );
    if (draw) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(draw[1]),
        amount: parseQuantity(draw[2]),
        raw: rawClause,
      });
    }

    const drawDefault = clause.match(/^draw\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (drawDefault) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(drawDefault[1]),
        raw: rawClause,
      });
    }
  }

  {
    const skipNextDrawStep = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her)\\s+next\\s+draw\\s+step\\b`, 'i')
    );
    if (skipNextDrawStep) {
      return withMeta({
        kind: 'skip_next_draw_step',
        who: parsePlayerSelector(skipNextDrawStep[1]),
        raw: rawClause,
      });
    }
  }

  {
    const addCounters = clause.match(new RegExp(`^put\\s+(${COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?\\s+on\\s+(.+)$`, 'i'));
    if (addCounters && !/\bonto\s+the\s+battlefield\b/i.test(clause)) {
      return withMeta({
        kind: 'add_counter',
        amount: parseQuantity(addCounters[1]),
        counter: normalizeCounterName(String(addCounters[2] || '')),
        target: parseObjectSelector(addCounters[3]),
        raw: rawClause,
      });
    }
  }

  {
    const addPlayerCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+(.+?)\\s+counters?$`, 'i')
    );
    if (addPlayerCounters) {
      return withMeta({
        kind: 'add_player_counter',
        who: parsePlayerSelector(addPlayerCounters[1]),
        amount: parseQuantity(addPlayerCounters[2]),
        counter: normalizeCounterName(String(addPlayerCounters[3] || '')),
        raw: rawClause,
      });
    }
  }

  {
    const removeCounters = clause.match(/^remove\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+)$/i);
    if (removeCounters) {
      return withMeta({
        kind: 'remove_counter',
        amount: parseQuantity(removeCounters[1]),
        counter: normalizeCounterName(String(removeCounters[2] || '')),
        target: parseObjectSelector(removeCounters[3]),
        raw: rawClause,
      });
    }
  }

  {
    const doubleCounters = clause.match(
      /^for each kind of counter on (.+),\s+put another of that kind of counter on (?:that|the) permanent$/i
    );
    if (doubleCounters) {
      return withMeta({
        kind: 'double_counters',
        target: parseObjectSelector(String(doubleCounters[1] || '').trim()),
        raw: rawClause,
      });
    }
  }

  {
    const addManaChoice = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s+or\\s+\\{[^}]+\\})+)\\s*$`, 'i')
    );
    if (addManaChoice) {
      const manaOptions = parseManaChoiceList(String(addManaChoice[2] || '').trim());
      if (manaOptions.length >= 2) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addManaChoice[1]),
          mana: manaOptions[0],
          manaOptions,
          raw: rawClause,
        });
      }
    }

    const addMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})*)\\s*$`, 'i'));
    if (addMana) {
      const mana = String(addMana[2] || '').trim();
      if (mana && !/\bor\b/i.test(clause)) {
        return withMeta({ kind: 'add_mana', who: parsePlayerSelector(addMana[1]), mana, raw: rawClause });
      }
    }
  }

  {
    const investigate = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:investigate|investigates)\\b$`, 'i'));
    if (investigate) {
      return withMeta({
        kind: 'investigate',
        who: parsePlayerSelector(investigate[1]),
        amount: { kind: 'number', value: 1 },
        raw: rawClause,
      });
    }
  }

  {
    const skipNextDrawStep = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her|its)\\s+next\\s+draw\\s+step\\b`, 'i')
    );
    if (skipNextDrawStep) {
      return withMeta({
        kind: 'skip_next_draw_step',
        who: parsePlayerSelector(skipNextDrawStep[1]),
        raw: rawClause,
      });
    }
  }

  {
    const suspectMatch = clause.match(/^suspect\s+(.+)$/i);
    if (suspectMatch) {
      return withMeta({
        kind: 'suspect',
        target: parseObjectSelector(String(suspectMatch[1] || '').trim()),
        raw: rawClause,
      });
    }
  }

  {
    const renownedMatch = clause.match(/^(it|this creature|this permanent)\s+becomes\s+renowned$/i);
    if (renownedMatch) {
      return withMeta({
        kind: 'become_renowned',
        target: parseObjectSelector(String(renownedMatch[1] || '').trim()),
        raw: rawClause,
      });
    }
  }

  {
    const turnFaceUpMatch = clause.match(/^turn\s+(.+?)\s+face up$/i);
    if (turnFaceUpMatch) {
      return withMeta({
        kind: 'turn_face_up',
        target: parseObjectSelector(String(turnFaceUpMatch[1] || '').trim()),
        raw: rawClause,
      });
    }
  }

  {
    const populate = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:populate|populates)\\b$`, 'i'));
    if (populate) {
      return withMeta({
        kind: 'populate',
        who: parsePlayerSelector(populate[1]),
        amount: { kind: 'number', value: 1 },
        raw: rawClause,
      });
    }
  }

  {
    const scry = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:scry|scries)\\s+(a|an|\\d+|x|[a-z]+)\\b`, 'i'));
    if (scry) {
      return withMeta({
        kind: 'scry',
        who: parsePlayerSelector(scry[1]),
        amount: parseQuantity(scry[2]),
        raw: rawClause,
      });
    }
  }

  {
    const surveil = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:surveil|surveils)\\s+(a|an|\\d+|x|[a-z]+)\\b`, 'i')
    );
    if (surveil) {
      return withMeta({
        kind: 'surveil',
        who: parsePlayerSelector(surveil[1]),
        amount: parseQuantity(surveil[2]),
        raw: rawClause,
      });
    }
  }

  {
    const discardHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardHand[1]),
        amount: { kind: 'number', value: 9999 },
        raw: rawClause,
      });
    }

    const discardAllInHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+all\\s+cards?\\s+in\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardAllInHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAllInHand[1]),
        amount: { kind: 'number', value: 9999 },
        raw: rawClause,
      });
    }

    const discard = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}discards?\\s+(a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i')
    );
    if (discard) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discard[1]),
        amount: parseQuantity(discard[2]),
        raw: rawClause,
      });
    }

    const discardDefault = clause.match(/^discard\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (discardDefault) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: parseQuantity(discardDefault[1]),
        raw: rawClause,
      });
    }
  }

  {
    const millUntilLand = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}reveals?\\s+cards?\\s+from\\s+the\\s+top\\s+of\\s+(?:their|your|his or her)\\s+library\\s+until\\s+(?:they|you)\\s+reveal\\s+a\\s+land\\s+card\\b`,
        'i'
      )
    );
    if (millUntilLand) {
      return withMeta({
        kind: 'mill',
        who: parsePlayerSelector(millUntilLand[1]),
        amount: { kind: 'unknown', raw: 'until they reveal a land card' },
        raw: rawClause,
      });
    }

    const mill = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}mill(?:s)?\\s+(a|an|\\d+|x|[a-z]+)\\s+cards?\\b`, 'i'));
    if (mill) {
      return withMeta({
        kind: 'mill',
        who: parsePlayerSelector(mill[1]),
        amount: parseQuantity(mill[2]),
        raw: rawClause,
      });
    }

    const millDefault = clause.match(/^mill\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (millDefault) {
      return withMeta({
        kind: 'mill',
        who: { kind: 'you' },
        amount: parseQuantity(millDefault[1]),
        raw: rawClause,
      });
    }
  }

  {
    const goad = clause.match(/^goad\s+(.+)$/i);
    if (goad) {
      return withMeta({
        kind: 'goad',
        target: parseObjectSelector(goad[1]),
        raw: rawClause,
      });
    }
  }

  return null;
}
