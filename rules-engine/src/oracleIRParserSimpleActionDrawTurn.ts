/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause draw / skip-draw / extra-turn clauses
 * Public: tryParseSimpleActionDrawTurnClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import {
  buildQuantityStepFromClauseParts,
  isSimpleCardQuantityTail,
  quantityTailSupportsDynamicQuantity,
} from './oracleIRParserQuantityHelpers';
import {
  PLAYER_SUBJECT_PREFIX,
  DRAW_AMOUNT_WORD_PATTERN,
  parseDrawAmount,
  parseSmallNumber,
  normalizeDrawClauseForParse,
  sharedDrawSelector,
} from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionDrawTurnClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const drawClauseBase = normalizeOracleText(clause).trim();
    if (!/^create(?:s)?\b/i.test(drawClauseBase)) {
    const drawClause = normalizeDrawClauseForParse(clause);

    const havePlayerDraw = drawClause.match(new RegExp(`^(?:(?:target opponent|that opponent|defending player|the defending player|that player)\\s+may\\s+have\\s+|you\\s+may\\s+have\\s+)(you|target player|target opponent|that player|that opponent)\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i'));
    if (havePlayerDraw) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(havePlayerDraw[1]),
        amount: parseQuantity(havePlayerDraw[2]),
        optional: true,
        raw: rawClause,
        });
    }

    const sharedDraw = drawClause.match(new RegExp(`^you\\s+and\\s+(.+?)\\s+each\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i'));
    if (sharedDraw) {
      return withMeta({
        kind: 'draw',
        who: sharedDrawSelector(sharedDraw[1]),
        amount: parseQuantity(sharedDraw[2]),
        raw: rawClause,
        });
    }

    const targetOpponentsEachDraw = drawClause.match(
      new RegExp(`^any\\s+number\\s+of\\s+target\\s+opponents\\s+each\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i')
    );
    if (targetOpponentsEachDraw) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_opponents' },
        amount: parseQuantity(targetOpponentsEachDraw[1]),
        raw: rawClause,
        });
    }

    const targetPlayersEachDraw = drawClause.match(
      new RegExp(`^any\\s+number\\s+of\\s+target\\s+players(?:\\s+other\\s+than\\s+that\\s+player)?\\s+each\\s+draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN})\\s+cards?\\b`, 'i')
    );
    if (targetPlayersEachDraw) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: parseQuantity(targetPlayersEachDraw[1]),
        raw: rawClause,
        });
    }

    const targetPlayersEachDrawEqual = drawClause.match(
      /^any\s+number\s+of\s+target\s+players(?:\s+other\s+than\s+that\s+player)?\s+each\s+draws?\s+cards?\s+equal\s+to\s+(.+?)(?:,\s*then\b[\s\S]*)?$/i
    );
    if (targetPlayersEachDrawEqual) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: parseDrawAmount(targetPlayersEachDrawEqual[1]),
        raw: rawClause,
        });
    }

    const drawEqual = drawClause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+cards?\\s+equal\\s+to\\s+(.+?)(?:,\\s*then\\b[\\s\\S]*)?$`, 'i'));
    if (drawEqual) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawEqual[1]),
        amount: parseDrawAmount(drawEqual[2]),
        raw: rawClause,
        });
    }

    const drawEqualPower = drawClause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+cards?\\s+equal\\s+to\\s+its\\s+power$`, 'i'));
    if (drawEqualPower) {
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawEqualPower[1]),
        amount: { kind: 'source_power' },
        raw: rawClause,
        });
    }

    const drawForEach = drawClause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+a\\s+card\\s+for\\s+each\\s+(.+)$`, 'i'));
    if (drawForEach) {
      const forEachText = String(drawForEach[2] || '').trim();
      const amountText = `a card for each ${forEachText}`;
      const parsedAmount = parseQuantity(amountText);
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawForEach[1]),
        amount: parsedAmount.kind === 'reference_amount'
          ? parsedAmount
          : { kind: 'reference_amount', raw: amountText },
        raw: rawClause,
        });
    }

    const drawAdditional = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+(?:(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|an?)\\s+)?additional\\s+cards?\\b`,
        'i'
      )
    );
    if (drawAdditional) {
      const amountPart = String(drawAdditional[2] || 'an').trim();
      const suffix = /^(?:an?|one|1)$/i.test(amountPart) ? 'card' : 'cards';
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(drawAdditional[1]),
        amount: parseQuantity(`${amountPart} additional ${suffix}`),
        raw: rawClause,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }

    const moreCards = drawClause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+(${DRAW_AMOUNT_WORD_PATTERN}|[a-z0-9]+)\\s+more\\s+cards?\\b`, 'i')
    );
    if (moreCards) {

    const targetPlayersEachDrawEqual = drawClause.match(
      /^any\s+number\s+of\s+target\s+players(?:\s+other\s+than\s+that\s+player)?\s+each\s+draws?\s+cards?\s+equal\s+to\s+(.+?)(?:,\s*then\b[\s\S]*)?$/i
    );
    if (targetPlayersEachDrawEqual) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'any_number_of_target_players' },
        amount: parseDrawAmount(targetPlayersEachDrawEqual[1]),
        raw: rawClause,
        });
    }
      return withMeta({
        kind: 'draw',
        who: parsePlayerSelector(moreCards[1]),
        amount: parseQuantity(moreCards[2]),
        raw: rawClause,
        });
    }

    const drawAndLose = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}draws?\\s+((?:a card|a|an|\\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\s+and\\s+loses?\\s+(\\d+|x)\\s+life$`,
        'i'
      )
    );
    if (drawAndLose) {
      const who = parsePlayerSelector(drawAndLose[1]);
      return withMeta({
        kind: 'draw',
        who,
        amount: parseQuantity(String(drawAndLose[2] || '').trim()),
        raw: rawClause,
      });
    }

    const drawAndReveal = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}draws?\\s+((?:a card|a|an|\\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\s+and\\s+reveal(?:s)?\\s+it$`,
        'i'
      )
    );
    if (drawAndReveal) {
      const who = parsePlayerSelector(drawAndReveal[1]);
      return withMeta({
        kind: 'draw',
        who,
        amount: parseQuantity(String(drawAndReveal[2] || '').trim()),
        raw: rawClause,
      });
    }

    const drawAndSacrificeBare = drawClause.match(
      /^draw\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?)\s+and\s+sacrifices?\s+(.+)$/i
    );
    if (drawAndSacrificeBare) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(drawAndSacrificeBare[1] || '').trim()),
        raw: rawClause,
      });
    }

    const drawAndSacrifice = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}draws?\\s+((?:a card|a|an|\\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\s+and\\s+sacrifices?\\s+(.+)$`,
        'i'
      )
    );
    if (drawAndSacrifice) {
      const who = parsePlayerSelector(drawAndSacrifice[1]);
      return withMeta({
        kind: 'draw',
        who,
        amount: parseQuantity(String(drawAndSacrifice[2] || '').trim()),
        raw: rawClause,
      });
    }

    const drawAndConvert = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}draws?\\s+((?:a card|a|an|\\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\s+and\\s+convert(?:s)?\\s+.+$`,
        'i'
      )
    );
    if (drawAndConvert) {
      const who = parsePlayerSelector(drawAndConvert[1]);
      return withMeta({
        kind: 'draw',
        who,
        amount: parseQuantity(String(drawAndConvert[2] || '').trim()),
        raw: rawClause,
      });
    }

    const bareDrawThenDiscard = drawClause.match(
      /^draw\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?),\s*then\s+discards?\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?)\.?$/i,
    );
    if (bareDrawThenDiscard) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(bareDrawThenDiscard[1] || '').trim().replace(/\s+cards?$/i, '')),
        raw: rawClause,
      });
    }

    const bareDrawCommaLose = drawClause.match(
      /^draw\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?),\s*lose\s+((?:that much|that many|\d+|x|[a-z]+)\s+life),?\s*(?:and\s+.+)?$/i,
    );
    if (bareDrawCommaLose) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(bareDrawCommaLose[1] || '').trim().replace(/\s+cards?$/i, '')),
        raw: rawClause,
      });
    }

    const youDrawCommaLose = drawClause.match(
      /^you\s+draw\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?),\s*lose\s+((?:that much|that many|\d+|x|[a-z]+)\s+life),?\s*(?:and\s+.+)?$/i,
    );
    if (youDrawCommaLose) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(youDrawCommaLose[1] || '').trim().replace(/\s+cards?$/i, '')),
        raw: rawClause,
      });
    }

    const drawThenDiscard = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}draws?\\s+((?:a card|a|an|\\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?),\\s*then\\s+discards?\\s+((?:a card|a|an|\\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\.?$`,
        'i',
      ),
    );
    if (drawThenDiscard) {
      const who = parsePlayerSelector(drawThenDiscard[1]);
      return withMeta({
        kind: 'draw',
        who,
        amount: parseQuantity(String(drawThenDiscard[2] || '').trim().replace(/\s+cards?$/i, '')),
        raw: rawClause,
      });
    }

    const bareDrawUntapThenDiscard = drawClause.match(
      /^draw\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?),\s+untap\s+(.+?),\s*then\s+discards?\s+((?:a card|a|an|\d+|x|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+cards?)\.?$/i,
    );
    if (bareDrawUntapThenDiscard) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(bareDrawUntapThenDiscard[1] || '').trim().replace(/\s+cards?$/i, '')),
        raw: rawClause,
      });
    }

    const bareDrawAndAdditionalForEach = drawClause.match(
      /^draw\s+a\s+card\s+and\s+an\s+additional\s+card\s+for\s+each\s+of\s+(.+)$/i,
    );
    if (bareDrawAndAdditionalForEach) {
      const forEachTail = String(bareDrawAndAdditionalForEach[1] || '').trim();
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'reference_amount', raw: `a card and an additional card for each of ${forEachTail}` },
        raw: rawClause,
      });
    }

    const youDrawAndCreatureBuff = drawClause.match(
      /^you\s+draw\s+(x|\d+)\s+cards?\s+and\s+(?:the\s+)?(.+?)\s+get\s+(.+?)(?:,\s*where\s+x\s+is\s+.+)?\.?$/i,
    );
    if (youDrawAndCreatureBuff) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(youDrawAndCreatureBuff[1] || '').trim()),
        raw: rawClause,
      });
    }

    const bareDrawInsteadIf = drawClause.match(
      /^draw\s+((?:a card|a|an|\d+|two|three|four|five|six|seven|eight|nine|ten|x|[a-z]+)\s+cards?)\s+instead\s+if\s+(.+)$/i,
    );
    if (bareDrawInsteadIf) {
      const amountRaw = String(bareDrawInsteadIf[1] || '').trim().replace(/\s+cards?$/i, '');
      return withMeta({
        kind: 'conditional',
        condition: { kind: 'if', raw: String(bareDrawInsteadIf[2] || '').trim() },
        steps: [{
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(amountRaw || 'a card'),
          raw: `draw ${String(bareDrawInsteadIf[1] || '').trim()}`,
        } as OracleEffectStep],
        raw: rawClause,
      } as OracleEffectStep);
    }

    const bareDrawIfCondition = drawClause.match(
      /^draw\s+((?:a card|a|an|\d+|two|three|four|five|six|seven|eight|nine|ten|x|[a-z]+)\s+cards?)\s+if\s+(.+)$/i,
    );
    if (bareDrawIfCondition) {
      const amountRaw = String(bareDrawIfCondition[1] || '').trim().replace(/\s+cards?$/i, '');
      return withMeta({
        kind: 'conditional',
        condition: { kind: 'if', raw: String(bareDrawIfCondition[2] || '').trim() },
        steps: [{
          kind: 'draw',
          who: { kind: 'you' },
          amount: parseQuantity(amountRaw || 'a card'),
          raw: `draw ${String(bareDrawIfCondition[1] || '').trim()}`,
        } as OracleEffectStep],
        raw: rawClause,
      } as OracleEffectStep);
    }

    const drawIfCondition = drawClause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+((?:a card|a|an|\\d+|two|three|four|five|six|seven|eight|nine|ten|x|[a-z]+)\\s+cards?)\\s+if\\s+(.+)$`,
        'i',
      ),
    );
    if (drawIfCondition) {
      const who = parsePlayerSelector(drawIfCondition[1]);
      const amountRaw = String(drawIfCondition[2] || '').trim().replace(/\s+cards?$/i, '');
      return withMeta({
        kind: 'conditional',
        condition: { kind: 'if', raw: String(drawIfCondition[3] || '').trim() },
        steps: [{
          kind: 'draw',
          who,
          amount: parseQuantity(amountRaw || 'a card'),
          raw: `${String(drawIfCondition[1] || '').trim()} draws ${String(drawIfCondition[2] || '').trim()}`,
        } as OracleEffectStep],
        raw: rawClause,
      } as OracleEffectStep);
    }

    const drawReplacement = drawClause.match(
      /^(?:until end of turn,\s+)?if you would draw a card,\s+draw\s+(.+?)\s+instead\.?["']?$/i
    );
    if (drawReplacement) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount: parseQuantity(String(drawReplacement[1] || '').trim()),
        replacementOf: 'draw_card',
        duration: 'end_of_turn',
        raw: rawClause,
      } as OracleEffectStep);
    }

    const drawFromNeighborLibrary = drawClause.match(
      /^each player draws a card from the library of the player to their right$/i
    );
    if (drawFromNeighborLibrary) {
      return withMeta({
        kind: 'draw',
        who: { kind: 'each_player' },
        amount: { kind: 'number', value: 1 },
        raw: rawClause,
      });
    }

    const drawWhereXBare = drawClause.match(/^draw\s+x\s+cards,\s*where\s+x\s+is\s+(.+)$/i);
    if (drawWhereXBare) {
      return buildQuantityStepFromClauseParts({
        kind: 'draw',
        who: { kind: 'you' },
        quantityTail: `X cards, where X is ${String(drawWhereXBare[1] || '').trim()}`,
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }

    const drawWhereXSubject = drawClause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+x\\s+cards,\\s*where\\s+x\\s+is\\s+(.+)$`, 'i')
    );
    if (drawWhereXSubject) {
      return buildQuantityStepFromClauseParts({
        kind: 'draw',
        who: parsePlayerSelector(drawWhereXSubject[1]),
        quantityTail: `X cards, where X is ${String(drawWhereXSubject[2] || '').trim()}`,
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }

    const drawTail = drawClause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?draws?\\s+(.+)$`, 'i')
    );
    if (drawTail && quantityTailSupportsDynamicQuantity(String(drawTail[2] || ''))) {
      return buildQuantityStepFromClauseParts({
        kind: 'draw',
        who: parsePlayerSelector(drawTail[1]),
        quantityTail: String(drawTail[2] || '').trim(),
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }
    if (drawTail && isSimpleCardQuantityTail(String(drawTail[2] || ''))) {
      return buildQuantityStepFromClauseParts({
        kind: 'draw',
        who: parsePlayerSelector(drawTail[1]),
        quantityTail: String(drawTail[2] || '').trim(),
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }

    const drawUntilEndQuote = drawClause.match(/^draw (?:a card|(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) cards?)["'] until end of turn$/i);
    if (drawUntilEndQuote) {
      const countRaw = String(drawUntilEndQuote[1] || 'a card').trim();
      const amount = countRaw === 'a card'
        ? { kind: 'number' as const, value: 1 }
        : parseQuantity(`${countRaw} cards`);
      return withMeta({
        kind: 'draw',
        who: { kind: 'you' },
        amount,
        duration: 'end_of_turn',
        raw: rawClause,
      } as OracleEffectStep);
    }

    const drawDefaultTail = drawClause.match(/^(?:may\s+)?draw\s+(.+)$/i);
    if (drawDefaultTail && quantityTailSupportsDynamicQuantity(String(drawDefaultTail[1] || ''))) {
      return buildQuantityStepFromClauseParts({
        kind: 'draw',
        who: { kind: 'you' },
        quantityTail: String(drawDefaultTail[1] || '').trim(),
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }
    if (drawDefaultTail && isSimpleCardQuantityTail(String(drawDefaultTail[1] || ''))) {
      return buildQuantityStepFromClauseParts({
        kind: 'draw',
        who: { kind: 'you' },
        quantityTail: String(drawDefaultTail[1] || '').trim(),
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }
    }
  }

  {
    const skipNextDrawStep = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her)\\s+(?:next\\s+)?draw\\s+step\\b`, 'i')
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
    const afterThatTurnExtra = clause.match(
      /^after\s+that\s+turn,?\s+(that\s+player|that\s+opponent|they)\s+takes?\s+an?\s+extra\s+turn\b/i
    );
    if (afterThatTurnExtra) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(String(afterThatTurnExtra[1] || 'that player').trim()),
        raw: rawClause,
      });
    }

    const takeExtraTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:take|takes)\\s+an?\\s+extra\\s+turn(?:\\s+after\\s+this\\s+one)?\\b`, 'i')
    );
    if (takeExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(takeExtraTurn[1]),
        raw: rawClause,
        });
    }
  }

  {
    const normalizedAdditionalCombatClause = clause.replace(/[."]+\s*$/, '').trim();
    const addMultipleExtraCombat = normalizedAdditionalCombatClause.match(
      /^(?:after\s+this\s+main\s+phase,?\s+there\s+are|this\s+main\s+phase\s+is\s+followed\s+by)\s+(.+?)\s+additional\s+combat\s+phases$/i
    );
    if (addMultipleExtraCombat) {
      const count = parseSmallNumber(String(addMultipleExtraCombat[1] || '').trim());
      if (count && count > 0) {
        return withMeta({
          kind: 'add_extra_combat',
          ...(count > 1 ? { count } : {}),
          raw: rawClause,
        });
      }
    }

    const addExtraCombat = clause.match(
      /^(?:(?:after|and after)\s+(?:this\s+phase|this\s+main\s+phase|this\s+combat\s+phase|the\s+second\s+main\s+phase\s+this\s+turn),?\s+)?(?:there(?:'|’)s|there\s+is)\s+an\s+additional\s+combat\s+phase(?:\s+after\s+this\s+phase)?(?:,?\s+followed\s+by\s+an\s+additional\s+main\s+phase)?[."]*$/i
    );
    if (addExtraCombat) {
      return withMeta({
        kind: 'add_extra_combat',
        followedByAdditionalMain: /followed by an additional main phase/i.test(normalizedAdditionalCombatClause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    if (/^choose\s+a\s+card\s+type\s*$/i.test(clause)) {
      return withMeta({
        kind: 'player_choice',
        choice: 'card_type',
        raw: rawClause,
      });
    }

    if (/^choose\s+a\s+letter\s*$/i.test(clause)) {
      return withMeta({
        kind: 'player_choice',
        choice: 'letter',
        raw: rawClause,
      });
    }

    if (/^choose\s+odd\s+or\s+even\s*$/i.test(clause)) {
      return withMeta({
        kind: 'player_choice',
        choice: 'odd_even',
        options: ['odd', 'even'],
        raw: rawClause,
      });
    }
  }

    const chooseTwoTargetCreatures = clause.match(/^choose\s+(target\s+creature\s+you\s+control\s+and\s+target\s+creature\s+(?:an\s+opponent\s+controls|you\s+don(?:'|â€™)?t\s+control))$/i);
    if (chooseTwoTargetCreatures) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseTwoTargetCreatures[1] || '').trim()),
        raw: rawClause,
      });
    }

    const chooseActivePlayerCreature = clause.match(/^choose\s+(target\s+non-wall\s+creature\s+the\s+active\s+player\s+has\s+controlled\s+continuously\s+since\s+the\s+beginning\s+of\s+the\s+turn)$/i);
    if (chooseActivePlayerCreature) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseActivePlayerCreature[1] || '').trim()),
        raw: rawClause,
      });
    }

  {
    const gainClassLevel = clause.match(/^level\s+(\d+)\.?$/i);
    if (gainClassLevel) {
      return withMeta({
        kind: 'gain_class_level',
        level: Number.parseInt(String(gainClassLevel[1] || '0'), 10),
        raw: rawClause,
        });
    }
  }

  {
    const exiledCardPermission = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\s+)?(cast|play)s?\s+(the exiled card|that card|this card|it)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+its\s+mana\s+cost)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?$`, 'i')
    );
    if (exiledCardPermission) {
      return withMeta({
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(exiledCardPermission[1]),
        what: parseObjectSelector(String(exiledCardPermission[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(clause) ? 'this_turn' : 'during_resolution',
        permission: String(exiledCardPermission[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(clause) || undefined,
        optional: true,
        raw: rawClause,
      });
    }

    const castOrHandPermission = clause.match(/^(?:you\s+may\s+)?cast\s+(it|that card|the exiled card)\s+without\s+paying\s+its\s+mana\s+cost\s+or\s+put\s+it\s+into\s+your\s+hand$/i);
    if (castOrHandPermission) {
      return withMeta({
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(castOrHandPermission[1] || '').trim()),
        duration: 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        optional: true,
        raw: rawClause,
      });
    }
  }

  {
    const copyStackObject = clause.match(/^copy\s+(target\s+.+)$/i);
    if (copyStackObject && /\b(?:spell|spells|ability|abilities)\b/i.test(String(copyStackObject[1] || ''))) {
      if (/^\s*\d+\s*\|/i.test(rawClause)) return null;
      return withMeta({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: parseObjectSelector(String(copyStackObject[1] || '').trim()),
        raw: rawClause,
      });
    }

    const copyThatStackObject = clause.match(/^copy\s+(that\s+(?:spell|ability))$/i);
    if (copyThatStackObject) {
      if (/^\s*\d+\s*\|/i.test(rawClause)) return null;
      return withMeta({
        kind: 'copy_spell',
        subject: 'target_spell',
        target: parseObjectSelector(String(copyThatStackObject[1] || '').trim()),
        raw: rawClause,
      });
    }
  }

  {
    const voteGainControl = clause.match(/^for\s+each\s+.+?\s+vote,\s+choose\s+(.+?)\s+and\s+gain\s+control\s+of\s+it$/i);
    if (voteGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(voteGainControl[1] || 'it').trim()),
        newController: { kind: 'you' },
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const reciprocalControl = clause.match(/^you\s+and\s+(?:that|target)\s+opponent\s+each\s+gain\s+control\s+of\s+all\s+creatures\s+the\s+other\s+controls\s+until\s+end\s+of\s+turn$/i);
    if (reciprocalControl) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector('all creatures you control'),
        second: parseObjectSelector('all creatures that opponent controls'),
        raw: rawClause,
      });
    }

    const leadingUntilGainControl = clause.match(/^until\s+end\s+of\s+turn,\s+gain\s+control\s+of\s+(.+)$/i);
    if (leadingUntilGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(leadingUntilGainControl[1] || '').trim()),
        newController: { kind: 'you' },
        duration: 'until_end_of_turn',
        raw: rawClause,
        });
    }

    const havePlayerGainControl = clause.match(/^(?:you\s+may\s+)?have\s+(.+?)\s+gain\s+control\s+of\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
    if (havePlayerGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(havePlayerGainControl[2] || '').trim()),
        newController: parsePlayerSelector(String(havePlayerGainControl[1] || '').trim()),
        duration: 'until_end_of_turn',
        optional: true,
        raw: rawClause,
        });
    }

    const untapThenGainControl = clause.match(/^(that\s+player|target\s+player|they)\s+untaps?\s+(.+?)\s+and\s+gains?\s+control\s+of\s+it$/i);
    if (untapThenGainControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(untapThenGainControl[2] || 'it').trim()),
        newController: parsePlayerSelector(String(untapThenGainControl[1] || '').trim()),
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const targetPlayerGainsControl = clause.match(/^(target\s+player(?:\s+other\s+than\s+.+?)?)\s+gains?\s+control\s+of\s+(.+)$/i);
    if (targetPlayerGainsControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(targetPlayerGainsControl[2] || '').trim()),
        newController: parsePlayerSelector(String(targetPlayerGainsControl[1] || '').trim()),
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const lifeTotalPlayerGainsControl = clause.match(/^(the\s+player\s+with\s+the\s+(?:lowest|most)\s+life\s+total?|the\s+player\s+with\s+the\s+most\s+life)\s+gains?\s+control\s+of\s+(.+)$/i);
    if (lifeTotalPlayerGainsControl) {
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(String(lifeTotalPlayerGainsControl[2] || '').trim()),
        newController: parsePlayerSelector(String(lifeTotalPlayerGainsControl[1] || '').trim()),
        duration: 'indefinite',
        raw: rawClause,
        });
    }

    const gainControl = clause.match(
      new RegExp(`^(?:for\\s+each\\s+opponent,\\s+)?${PLAYER_SUBJECT_PREFIX}gain(?:s)?\\s+control\\s+of\\s+(.+?)(?:\\s+(until\\s+end\\s+of\\s+turn|during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura\\s+is\\s+attached\\s+to\\s+it|for\\s+as\\s+long\\s+as\\s+you\\s+control\\s+[^.]+))?$`, 'i')
    );
    if (gainControl) {
      const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\s+end\s+of\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /during\s+that\s+(?:player|opponent)['\u2019]?s\s+next\s+turn/i.test(durationRaw)
          ? 'during_that_players_next_turn'
          : /aura\s+is\s+attached/i.test(durationRaw)
            ? 'as_long_as_attached'
            : /as\s+long\s+as\s+you\s+control/i.test(durationRaw)
              ? 'as_long_as_control_source'
              : 'indefinite';
      return withMeta({
        kind: 'gain_control',
        what: parseObjectSelector(gainControl[2]),
        newController: parsePlayerSelector(gainControl[1]),
        duration,
        raw: rawClause,
        });
    }
  }

  {
    const exchangeControl = clause.match(/^(?:you\s+may\s+)?exchange\s+control\s+of\s+(.+?)\s+and\s+(.+)$/i);
    if (exchangeControl) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector(String(exchangeControl[1] || '').trim()),
        second: parseObjectSelector(String(exchangeControl[2] || '').trim()),
        raw: rawClause,
      });
    }

    const exchangeTwoTargets = clause.match(/^(?:you\s+may\s+)?exchange\s+control\s+of\s+two\s+(?:other\s+)?target\s+(.+)$/i);
    if (exchangeTwoTargets) {
      const targetText = String(exchangeTwoTargets[1] || '').trim().replace(/s\b/i, '');
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector(`first target ${targetText}`),
        second: parseObjectSelector(`second target ${targetText}`),
        raw: rawClause,
      });
    }

    const exchangeThose = clause.match(/^exchange\s+control\s+of\s+those\s+permanents$/i);
    if (exchangeThose) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector('first of those permanents'),
        second: parseObjectSelector('second of those permanents'),
        raw: rawClause,
      });
    }

    const playersExchangeThose = clause.match(/^those\s+players\s+exchange\s+control\s+of\s+those\s+creatures$/i);
    if (playersExchangeThose) {
      return withMeta({
        kind: 'exchange_control',
        first: parseObjectSelector('first of those creatures'),
        second: parseObjectSelector('second of those creatures'),
        raw: rawClause,
      });
    }
  }
  return null;
}
