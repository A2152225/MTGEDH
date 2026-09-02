/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause add-mana / choose-color / choose-type clauses
 * Public: tryParseSimpleActionAddManaChoiceClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import {
  PLAYER_SUBJECT_PREFIX,
  COUNTER_AMOUNT_PATTERN,
  buildRepeatedMana,
  parseSmallNumber,
  parseAddManaAmountExpression,
  parseManaChoiceList,
} from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionAddManaChoiceClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const addAnyColorLandCouldProduceMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+(?:one\\s+)?(?:color|type)\\s+(?:that\\s+)?.+?\\s+could\\s+produce\\s*$`, 'i')
    );
    if (addAnyColorLandCouldProduceMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorLandCouldProduceMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAnyColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(?:an\\s+additional\\s+)?(?:a|an|1|one)\\s+mana\\s+of\\s+any\\s+(?:one\\s+)?color\\s*$`, 'i')
    );
    if (addAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        raw: rawClause,
        });
    }

    const addThatMuchAnyColor = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+that\\s+much\\s+mana\\s+of\\s+any(?:\\s+one)?\\s+color\\s*$`, 'i')
    );
    if (addThatMuchAnyColor) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatMuchAnyColor[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'that much' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatMuchAnyColorDefault = clause.match(
      /^add\s+that\s+much\s+mana\s+of\s+any(?:\s+one)?\s+color\s*$/i
    );
    if (addThatMuchAnyColorDefault) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'that much' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const signedArtBoxMana = clause.match(/^add one mana of any color signed in this card's art box by someone who has illustrated a printed magic card\.?$/i);
    if (signedArtBoxMana) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addEachChosenColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(?:a|an|one)\\s+mana\\s+of\\s+each\\s+of\\s+the\\s+chosen\\s+colors\\s*$`, 'i'));
    if (addEachChosenColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addEachChosenColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        amount: { kind: 'reference_amount', raw: 'the chosen colors' },
        raw: rawClause,
      });
    }

    const addReferenceBoundAnyColorMana = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+(?:a\\s+color\\s+written\\s+on\\s+this\\s+permanent|any\\s+color\\s+chosen\\s+as\\s+you\\s+drafted\\s+cards\\s+named\\s+this\\s+permanent|any\\s+color\\s+that\\s+appears\\s+on\\s+.+|any\\s+color\\s+that\\s+shares\\s+a\\s+color\\s+with\\s+.+)\\s*$`,
        'i'
      )
    );
    if (addReferenceBoundAnyColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addReferenceBoundAnyColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addCircledColorsMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+either\\s+of\\s+the\\s+circled\\s+colors\\s*$`, 'i'));
    if (addCircledColorsMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addCircledColorsMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addGuildColorsMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+your\\s+guild(?:'|â€™)?s\\s+colors\\s*$`, 'i'));
    if (addGuildColorsMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addGuildColorsMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addRepeatedAnyColorForRemovedCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+color\\s+for\\s+each\\s+charge\\s+counter\\s+removed\\s+this\\s+way\\s*$`, 'i')
    );
    if (addRepeatedAnyColorForRemovedCounters) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addRepeatedAnyColorForRemovedCounters[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'the number of charge counters removed this way' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatColorForChargeCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+that\\s+color\\s+for\\s+each\\s+charge\\s+counter\\s+on\\s+this\\s+artifact\\s*$`, 'i')
    );
    if (addThatColorForChargeCounters) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatColorForChargeCounters[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'the number of charge counters on this artifact' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatColorForDifferentPowers = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+that\\s+color\\s+for\\s+each\\s+different\\s+power\\s+among\\s+creatures\\s+you\\s+control\\s*$`, 'i')
    );
    if (addThatColorForDifferentPowers) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatColorForDifferentPowers[1]),
        mana: '{W}',
        amount: { kind: 'reference_amount', raw: 'the number of different powers among creatures you control' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAnyColorFromReferenceMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+(?:any\\s+of\\s+the\\s+exiled\\s+(?:card(?:'|â€™)?s|cards(?:'|â€™)?)\\s+colors|any\\s+color\\s+among\\s+.+)\\s*$`, 'i')
    );
    if (addAnyColorFromReferenceMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAnyColorFromReferenceMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }
  }

  {
    const addVariableColorMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+x\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+colors\\s*$`, 'i'));
    if (addVariableColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addVariableColorMana[1]),
        mana: '{W}',
        amount: { kind: 'x' },
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAmountEqualXPlusOne = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+x\\s+plus\\s+one\\s*$`, 'i'));
    if (addAmountEqualXPlusOne) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAmountEqualXPlusOne[1]),
        mana: String(addAmountEqualXPlusOne[2] || '').trim(),
        amount: { kind: 'reference_amount', raw: 'x plus one' },
        raw: rawClause,
      });
    }

    const addBasePlusArtCounters = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}),\\s+plus\\s+an\\s+additional\\s+(\\{[^}]+\\})\\s+for\\s+each\\s+art\\s+counter\\s+on\\s+this\\s+permanent\\s*$`, 'i')
    );
    if (addBasePlusArtCounters) {
      const baseMana = String(addBasePlusArtCounters[2] || '').trim();
      const bonusMana = String(addBasePlusArtCounters[3] || '').trim();
      if (baseMana && baseMana === bonusMana) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addBasePlusArtCounters[1]),
          mana: baseMana,
          amount: { kind: 'reference_amount', raw: 'the number of art counters on this permanent plus one' },
          raw: rawClause,
        });
      }
    }

    const addAmountEqualSymbol = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+(.+)\\s*$`, 'i'));
    if (addAmountEqualSymbol) {
      const amount = parseAddManaAmountExpression(String(addAmountEqualSymbol[3] || '').trim());
      if (amount) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAmountEqualSymbol[1]),
          mana: String(addAmountEqualSymbol[2] || '').trim(),
          amount,
          raw: rawClause,
        });
      }
    }

    const addChosenColorAmount = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+mana\\s+of\\s+that\\s+color\\s+equal\\s+to\\s+(.+)\\s*$`, 'i')
    );
    if (addChosenColorAmount) {
      const amount = parseAddManaAmountExpression(String(addChosenColorAmount[2] || '').trim());
      if (amount) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addChosenColorAmount[1]),
          mana: '{W}',
          amount,
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addAmountEqualToPower = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+(.+?)(?:'|â€™)?s\\s+power\\s*$`, 'i'));
    if (addAmountEqualToPower) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAmountEqualToPower[1]),
        mana: '{X}',
        manaOptions: [String(addAmountEqualToPower[2] || '').trim()],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addTwoDifferentColors = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+two\\s+mana\\s+of\\s+different\\s+colors\\s*$`, 'i'));
    if (addTwoDifferentColors) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addTwoDifferentColors[1]),
        mana: '{W}{U}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addTwoOfOneColorAndTwoOfAnother = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+two\\s+mana\\s+of\\s+any\\s+one\\s+color\\s+and\\s+two\\s+mana\\s+of\\s+any\\s+other\\s+color\\s*$`, 'i')
    );
    if (addTwoOfOneColorAndTwoOfAnother) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addTwoOfOneColorAndTwoOfAnother[1]),
        mana: '{W}{W}{U}{U}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAmountEqualToManaValue = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+(\\{[^}]+\\})\\s+equal\\s+to\\s+(.+?)(?:'|â€™)?s\\s+mana\\s+value\\s*$`, 'i'));
    if (addAmountEqualToManaValue) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addAmountEqualToManaValue[1]),
        mana: '{X}',
        manaOptions: [String(addAmountEqualToManaValue[2] || '').trim()],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addAdditionalManaNoSubject = clause.match(/^add\s+an\s+additional\s+(\{[^}]+\})$/i);
    if (addAdditionalManaNoSubject) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: String(addAdditionalManaNoSubject[1] || '').trim(),
        raw: rawClause,
      });
    }

    const addManaForEach = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\})\\s+for\\s+each\\s+(.+)$`, 'i'));
    if (addManaForEach) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addManaForEach[1]),
        mana: String(addManaForEach[2] || '').trim(),
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addThatMuchMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+that\\s+much\\s+(\\{[^}]+\\})\\s*$`, 'i'));
    if (addThatMuchMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatMuchMana[1]),
        mana: String(addThatMuchMana[2] || '').trim(),
        amount: { kind: 'reference_amount', raw: 'that much' },
        raw: rawClause,
      });
    }

    const addTwiceThatMuchMana = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+twice\\s+that\\s+much\\s+(\\{[^}]+\\})\\s*$`, 'i'));
    if (addTwiceThatMuchMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addTwiceThatMuchMana[1]),
        mana: String(addTwiceThatMuchMana[2] || '').trim(),
        amount: { kind: 'reference_amount', raw: 'twice that much' },
        raw: rawClause,
      });
    }

    const addThatMuchAnyCombinationRg = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+that\\s+much\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+\\{R\\}\\s+and\\/or\\s+\\{G\\}\\s*$`, 'i')
    );
    if (addThatMuchAnyCombinationRg) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addThatMuchAnyCombinationRg[1]),
        mana: '{R}',
        amount: { kind: 'reference_amount', raw: 'that much' },
        manaOptions: ['{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addFixedOrChosenColor = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[WUBRGC]\\})\\s+or\\s+one\\s+mana\\s+of\\s+the\\s+chosen\\s+color$`, 'i'));
    if (addFixedOrChosenColor) {
      const fixed = String(addFixedOrChosenColor[2] || '').trim();
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addFixedOrChosenColor[1]),
        mana: fixed,
        manaOptions: [fixed, '{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addDevotionChosenColor = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+an\\s+amount\\s+of\\s+mana\\s+of\\s+that\\s+color\\s+equal\\s+to\\s+your\\s+devotion\\s+to\\s+that\\s+color$`, 'i'));
    if (addDevotionChosenColor) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addDevotionChosenColor[1]),
        mana: '{X}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addCountedSingleColor = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+(\\{[WUBRGC]\\})$`, 'i'));
    if (addCountedSingleColor) {
      const manaCount = parseSmallNumber(addCountedSingleColor[2]);
      const symbol = String(addCountedSingleColor[3] || '').trim();
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addCountedSingleColor[1]),
          mana: buildRepeatedMana(symbol, manaCount),
          raw: rawClause,
        });
      }
    }

    const addAnyOneColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+mana\\s+of\\s+any\\s+one\\s+color\\s*$`, 'i')
    );
    if (addAnyOneColorMana) {
      const manaCount = parseSmallNumber(addAnyOneColorMana[2]);
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyOneColorMana[1]),
          mana: buildRepeatedMana('{W}', manaCount),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addCountedChosenColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+mana\\s+of\\s+the\\s+chosen\\s+color\\s*$`, 'i')
    );
    if (addCountedChosenColorMana) {
      const manaCount = parseSmallNumber(addCountedChosenColorMana[2]);
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addCountedChosenColorMana[1]),
          mana: '{W}',
          ...(manaCount === 1 ? {} : { amount: { kind: 'number' as const, value: manaCount } }),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addAnyCombinationSpecificOptions = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN}|that\\s+much)\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+(.+)\\s*$`, 'i')
    );
    if (addAnyCombinationSpecificOptions) {
      const countRaw = String(addAnyCombinationSpecificOptions[2] || '').trim().toLowerCase();
      const optionsText = String(addAnyCombinationSpecificOptions[3] || '').trim();
      const manaOptions = parseManaChoiceList(optionsText);
      const amount = countRaw === 'that much'
        ? ({ kind: 'reference_amount', raw: 'that much' } as const)
        : parseQuantity(countRaw);
      if (manaOptions.length >= 2 && amount.kind !== 'unknown') {
        const fixedCount = amount.kind === 'number' ? amount.value : null;
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyCombinationSpecificOptions[1]),
          mana: fixedCount && fixedCount > 0 ? buildRepeatedMana(manaOptions[0], fixedCount) : manaOptions[0],
          ...(fixedCount && fixedCount > 0 ? {} : { amount }),
          manaOptions,
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    const addAnyCombinationGuildColors = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN}|that\\s+much)\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+your\\s+guild(?:'|â€™)?s\\s+colors\\s*$`,
        'i'
      )
    );
    if (addAnyCombinationGuildColors) {
      const countRaw = String(addAnyCombinationGuildColors[2] || '').trim().toLowerCase();
      const amount = countRaw === 'that much'
        ? ({ kind: 'reference_amount', raw: 'that much' } as const)
        : parseQuantity(countRaw);
      if (amount.kind !== 'unknown') {
        const fixedCount = amount.kind === 'number' ? amount.value : null;
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyCombinationGuildColors[1]),
          mana: fixedCount && fixedCount > 0 ? buildRepeatedMana('{W}', fixedCount) : '{W}',
          ...(fixedCount && fixedCount > 0 ? {} : { amount }),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const addManaForEachColor = clause.match(/^for\s+each\s+color\s+among\s+.+?,\s+adds?\s+one\s+mana\s+of\s+that\s+color$/i);
    if (addManaForEachColor) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
      });
    }
  }

  {
    const addAnyCombinationColorMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+colors\\s*$`, 'i')
    );
    if (addAnyCombinationColorMana) {
      const manaCount = parseSmallNumber(addAnyCombinationColorMana[2]);
      if (manaCount && manaCount > 0) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addAnyCombinationColorMana[1]),
          mana: buildRepeatedMana('{W}', manaCount),
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const COLOR_WORD_TO_MANA: Record<string, string> = {
      white: '{W}',
      blue: '{U}',
      black: '{B}',
      red: '{R}',
      green: '{G}',
    };
    const ALL_COLOR_MANA = ['{W}', '{U}', '{B}', '{R}', '{G}'] as const;
    const asEntersPrefix = '(?:as\\s+.+?\\s+enters(?:\\s+the\\s+battlefield)?,\\s+)?';

    // Compound as-enters choices — return the first step here; postprocess expands the rest.
    // "choose a color and a creature type"
    const chooseColorAndCreatureType = clause.match(
      new RegExp(`^${asEntersPrefix}choose\\s+a\\s+colou?r\\s+and\\s+a\\s+creature\\s+type\\s*$`, 'i'),
    );
    if (chooseColorAndCreatureType) {
      return withMeta({
        kind: 'choose_color',
        manaOptions: [...ALL_COLOR_MANA],
        raw: rawClause,
      });
    }

    // "choose a color and an opponent" / "choose a color and a player"
    const chooseColorAndPlayer = clause.match(
      new RegExp(`^${asEntersPrefix}choose\\s+a\\s+colou?r\\s+and\\s+(an\\s+opponent|a\\s+player)\\s*$`, 'i'),
    );
    if (chooseColorAndPlayer) {
      return withMeta({
        kind: 'choose_color',
        manaOptions: [...ALL_COLOR_MANA],
        raw: rawClause,
      });
    }

    // "choose a color word" (Swirl the Mists)
    const chooseColorWord = clause.match(
      new RegExp(`^${asEntersPrefix}choose\\s+a\\s+colou?r\\s+word\\s*$`, 'i'),
    );
    if (chooseColorWord) {
      return withMeta({
        kind: 'choose_color',
        manaOptions: [...ALL_COLOR_MANA],
        raw: rawClause,
      });
    }

    // "choose a color other than green"
    const chooseColorOtherThan = clause.match(
      new RegExp(
        `^${asEntersPrefix}(?:you\\s+may\\s+)?choose\\s+a\\s+colou?r\\s+other\\s+than\\s+(white|blue|black|red|green)\\s*$`,
        'i',
      ),
    );
    if (chooseColorOtherThan) {
      const excluded = COLOR_WORD_TO_MANA[String(chooseColorOtherThan[1] || '').toLowerCase()];
      const manaOptions = ALL_COLOR_MANA.filter((symbol) => symbol !== excluded);
      return withMeta({
        kind: 'choose_color',
        manaOptions,
        ...(/you\s+may\s+choose/i.test(clause) ? { optional: true as const } : {}),
        raw: rawClause,
      });
    }

    const chooseColor = clause.match(
      new RegExp(`^${asEntersPrefix}(?:you\\s+may\\s+)?choose\\s+a\\s+colou?r\\s*$`, 'i'),
    );
    if (chooseColor) {
      return withMeta({
        kind: 'choose_color',
        manaOptions: [...ALL_COLOR_MANA],
        ...(/you\s+may\s+choose/i.test(clause) ? { optional: true as const } : {}),
        raw: rawClause,
      });
    }
  }

  {
    const asEntersPrefix = '(?:as\\s+.+?\\s+enters(?:\\s+the\\s+battlefield)?,\\s+)?';
    const chooseCreatureTypeOtherThan = clause.match(
      new RegExp(`^${asEntersPrefix}choose\\s+a\\s+creature\\s+type\\s+other\\s+than\\s+(.+?)\\s*$`, 'i'),
    );
    if (chooseCreatureTypeOtherThan) {
      const excludedRaw = String(chooseCreatureTypeOtherThan[1] || '').trim();
      const excludedTypes = excludedRaw
        ? excludedRaw.split(/\s*,\s*|\s+or\s+/i).map((part) => part.trim()).filter(Boolean)
        : [];
      return withMeta({
        kind: 'choose_creature_type',
        ...(excludedTypes.length > 0 ? { excludedTypes } : {}),
        raw: rawClause,
      });
    }

    const chooseCreatureType = clause.match(
      new RegExp(`^${asEntersPrefix}choose\\s+a\\s+creature\\s+type\\s*$`, 'i'),
    );
    if (chooseCreatureType) {
      return withMeta({
        kind: 'choose_creature_type',
        raw: rawClause,
      });
    }

    if (/^(?:then\s+)?choose\s+(?:any\s+|a\s+|an\s+)?(?:creature\s+)?card\s+name$/i.test(clause)) {
      return withMeta({
        kind: 'choose_card_name',
        raw: rawClause,
      });
    }

    const lookAtHand = clause.match(/^(?:as\s+.+?\s+enters,\s*)?look\s+at\s+(?:an\s+opponent|target\s+opponent)(?:'|’)?s\s+hand$/i);
    if (lookAtHand) {
      return withMeta({
        kind: 'look_hand',
        who: { kind: 'target_opponent' },
        raw: rawClause,
      });
    }

    const lookAtTheirHand = clause.match(/^look\s+at\s+their\s+hand$/i);
    if (lookAtTheirHand) {
      return withMeta({
        kind: 'look_hand',
        who: { kind: 'target_player' },
        raw: rawClause,
      });
    }
  }

  {
    const chooseBasicLandType = clause.match(
      /^(?:as\s+.+?\s+enters(?:\s+the\s+battlefield)?,?\s+)?choose\s+a\s+basic\s+land\s+type\s*$/i,
    );
    if (chooseBasicLandType) {
      return withMeta({
        kind: 'choose_basic_land_type',
        raw: rawClause,
      });
    }
  }

  {
    const chooseCardName = clause.match(
      /^(?:secretly\s+)?choose\s+a\s+(?:nonland\s+)?card\s+name(?:\s+other\s+than\s+a\s+basic\s+land\s+card\s+name)?\s*$/i
    );
    if (chooseCardName) {
      return withMeta({
        kind: 'choose_card_name',
        raw: rawClause,
        });
    }
  }

  {
    const triggeredChoosePrefix = clause.match(
      /^(?:at the beginning of (?:your|each player's) (?:upkeep|end step),?\s+)(choose\s+.+)$/i
    );
    const chooseClause = triggeredChoosePrefix ? String(triggeredChoosePrefix[1] || '').trim() : clause;

    const chooseTargetPlayers = chooseClause.match(
      /^choose\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+target\s+players?\.?$/i
    );
    if (chooseTargetPlayers) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector('target players'),
        raw: rawClause,
      });
    }

    const chooseCountedTargets = chooseClause.match(
      /^choose\s+(up\s+to\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|\d+|a|an)\s+(other\s+)?(target\s+.+)$/i
    );
    if (chooseCountedTargets) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseCountedTargets[4] || '').trim()),
        ...(chooseCountedTargets[1] || /^(?:a|an)$/i.test(String(chooseCountedTargets[2] || '')) ? { optional: true } : {}),
        raw: rawClause,
      });
    }

    const chooseTargetCreature = chooseClause.match(
      /^choose\s+(up to one\s+)?target\s+creature(?:\s+(you control|an opponent controls|your opponents control))?\s*$/i
    );
    if (chooseTargetCreature) {
      const targetText = chooseTargetCreature[2]
        ? `target creature ${chooseTargetCreature[2].toLowerCase()}`
        : 'target creature';
      return withMeta({
        kind: 'choose_target_creature',
        target: { kind: 'raw', text: targetText },
        ...(chooseTargetCreature[1] ? { optional: true } : {}),
        raw: rawClause,
        });
    }

    const chooseTargetObject = chooseClause.match(/^choose\s+(up to one\s+)?(target\s+.+)$/i);
    if (
      chooseTargetObject &&
      /\b(?:spell|permanent|card|artifact|enchantment|land|planeswalker|battle)\b/i.test(String(chooseTargetObject[2] || '')) &&
      !/^target\s+(?:opponent|player)\b/i.test(String(chooseTargetObject[2] || ''))
    ) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseTargetObject[2] || '').trim()),
        ...(chooseTargetObject[1] ? { optional: true } : {}),
        raw: rawClause,
        });
    }
  }

  {
    const addChosenColorMana = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+(?:an\\s+additional\\s+)?one\\s+mana\\s+of\\s+(?:the\\s+chosen|that)\\s+color\\s*$`,
        'i'
      )
    );
    if (addChosenColorMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addChosenColorMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        requiresChosenMana: true,
        raw: rawClause,
        });
    }

    const voterExtraTurn = clause.match(/^each\s+player\s+who\s+voted\s+for\s+.+?\s+takes?\s+an?\s+extra\s+turn\s+after\s+this\s+one\b/i);
    if (voterExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: { kind: 'each_player' },
        raw: rawClause,
        });
    }
  }
  return null;
}
