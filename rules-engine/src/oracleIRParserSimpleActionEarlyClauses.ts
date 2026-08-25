/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause early combat / tap / sacrifice / search / dice / shuffle clauses
 * Public: tryParseSimpleActionEarlyClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { normalizeClauseForParse, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { normalizeCounterName, splitSacrificeObjectAndCondition } from './oracleIRParserSacrificeHelpers';
import { tryParseExileTopClause, tryParseLookTopClause } from './oracleIRParserQuantityHelpers';
import {
  PLAYER_SUBJECT_PREFIX,
  COUNTER_AMOUNT_PATTERN,
  parseSmallNumber,
  parseManaOptionGroupList,
  parseAddManaAmountExpression,
  countTicketSymbols,
} from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionEarlyClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const tryParseSimpleActionClause = args.parseRest;

  {
    // "Tap the creature, remove it from combat, and creatures it was blocking
    // that had become blocked by only that creature this combat become unblocked."
    // The target was selected by an antecedent action, so preserve the contextual
    // creature reference for the executor instead of re-targeting.
    const removeFromCombat = clause.match(
      /^(?:tap|untap)\s+(?:the|that)\s+creature,\s*remove it from combat(?:,\s*and\s*creatures it was blocking that had become blocked by only that creature this combat become unblocked)?\.?$/i,
    );
    if (removeFromCombat) {
      return withMeta({
        kind: 'remove_from_combat',
        target: parseObjectSelector('that creature'),
        unblockCreaturesBlockedOnlyByIt: /become unblocked/i.test(clause),
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    if (/^redistribute any number of players(?:'|'|') life totals\.?$/i.test(clause)) {
      return withMeta({
        kind: 'redistribute_life_totals',
        who: { kind: 'any_number_of_target_players' },
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    // Join Forces — Starting with you, each player may pay any amount of mana.
    // Also: "each player starting with you may pay any amount of mana" (attack/block triggers).
    const joinForcesPay = clause.match(
      /^(?:join forces\s*[-—–]\s*)?(?:starting with you,\s*)?each player(?: starting with you)? may pay any amount of mana\.?$/i,
    );
    if (joinForcesPay) {
      return withMeta({
        kind: 'join_forces',
        who: { kind: 'each_player' },
        startingWith: 'you',
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    // "That player taps an untapped artifact, creature, or land they control for each
    // fade counter on this artifact." (Tangle Wire). The leading "a"/"an" before "untapped"
    // is grammatical (one permanent per counter), not the tap amount — the real amount comes
    // from the trailing "for each <counter> counter on this <noun>" clause.
    const tapForEachCounterOnThis = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}taps?\\s+(?:a|an)\\s+untapped\\s+(.+?)\\s+(?:you|they)\\s+control\\s+for\\s+each\\s+([a-z][a-z '-]*?)\\s+counters?\\s+on\\s+this\\s+([a-z]+)\\.?$`,
        'i'
      )
    );
    if (tapForEachCounterOnThis) {
      const subject = String(tapForEachCounterOnThis[1] || '').trim();
      const filter = String(tapForEachCounterOnThis[2] || '').trim();
      const counterName = normalizeCounterName(String(tapForEachCounterOnThis[3] || '').trim());
      const sourceNoun = String(tapForEachCounterOnThis[4] || 'permanent').trim();
      return withMeta({
        kind: 'tap_matching_permanents',
        who: subject ? parsePlayerSelector(subject) : { kind: 'you' },
        amount: { kind: 'reference_amount', raw: `the number of ${counterName} counters on this ${sourceNoun}` },
        filter,
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    const oppositionAgentSearchExile = clause.match(
      /^while an opponent is searching their library, they exile each card they find\.?$/i
    );
    if (oppositionAgentSearchExile) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this permanent'),
        effectText: [String(clause || '').trim()],
        duration: 'static',
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    const unlessThatPlayerPays = clause.match(
      /^(.+?)\s+unless\s+(that\s+player|that\s+opponent|its\s+controller|they)\s+pays?\s+(\{[^}]+\})\.?$/i,
    );
    if (unlessThatPlayerPays) {
      const innerClause = String(unlessThatPlayerPays[1] || '').trim();
      const innerStep = tryParseSimpleActionClause({
        clause: innerClause,
        rawClause: innerClause,
        withMeta,
      });
      if (innerStep && innerStep.kind !== 'unknown') {
        // "You may [effect] unless that player pays {C}" is ability-level optional
        // (controller may/tax), not a nested may wrapping the tax step. Marking
        // unless_pays optional caused a second Yes/No before the pay prompt.
        const nestedSteps = (innerStep as { optional?: boolean }).optional === true
          ? [{ ...innerStep, optional: undefined } as typeof innerStep]
          : [innerStep];
        return withMeta({
          kind: 'unless_pays_mana',
          who: parsePlayerSelector(String(unlessThatPlayerPays[2] || 'that player').trim()),
          mana: String(unlessThatPlayerPays[3] || '').trim(),
          steps: nestedSteps,
          raw: rawClause,
        });
      }
    }
  }

  {
    const namedCardMode = clause.match(/^([A-Za-z][A-Za-z0-9' ,\-]+?)\s*\(([^)]+)\)\.?$/);
    if (namedCardMode && !/^(when|whenever|if|choose|target|at the beginning)\b/i.test(clause)) {
      const inner = String(namedCardMode[2] || '').trim();
      const innerClause = normalizeClauseForParse(inner).clause;
      const innerParsed = tryParseSimpleActionClause({
        clause: innerClause,
        rawClause: clause,
        withMeta,
      });
      if (innerParsed && innerParsed.kind !== 'unknown') {
        return innerParsed;
      }
      const damageTo = inner.match(/^(\d+|x)\s+damage\s+to\s+(.+?)\.?$/i);
      if (damageTo) {
        return withMeta({
          kind: 'deal_damage',
          amount: parseQuantity(String(damageTo[1] || '').trim()),
          target: parseObjectSelector(String(damageTo[2] || '').trim()),
          raw: rawClause,
        });
      }
      const searchFor = inner.match(/^search(?:es)?\s+(?:your\s+library\s+)?for\s+(.+?)\.?$/i);
      if (searchFor) {
        return withMeta({
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'raw', text: String(searchFor[1] || '').trim() },
          destination: 'hand',
          revealFound: false,
          raw: rawClause,
        });
      }
    }
  }

  const lookTop = tryParseLookTopClause({ clause, rawClause, withMeta });
  if (lookTop) return lookTop;

  const exileTop = tryParseExileTopClause({ clause, rawClause, withMeta });
  if (exileTop) return exileTop;

  {
    const exiledCardPermission = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?(cast|play)s?\\s+(the\\s+exiled\\s+card|that\\s+card|this\\s+card|it)(?:\\s+from\\s+exile)?(?:\\s+without\\s+paying\\s+its\\s+mana\\s+cost)?(?:\\s+this\\s+turn)?(?:\\s+if\\s+.+)?$`, 'i')
    );
    if (exiledCardPermission) {
      return withMeta({
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(exiledCardPermission[1]),
        what: parseObjectSelector(String(exiledCardPermission[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(clause) ? 'this_turn' : 'during_resolution',
        permission: String(exiledCardPermission[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(clause) || undefined,
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    const selfDamageRemoveCounter = clause.match(
      /^if\s+damage\s+would\s+be\s+dealt\s+to\s+(.+?)\s+while\s+it\s+has\s+(?:a|an|one|one\s+or\s+more|\d+|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it,\s+prevent\s+that\s+damage\s+and\s+remove\s+(a|an|one|\d+|[a-z]+)\s+(.+?)\s+counters?\s+from\s+(.+)$/i
    );
    if (selfDamageRemoveCounter) {
      const recipientText = String(selfDamageRemoveCounter[1] || '').trim();
      const removeAmountText = String(selfDamageRemoveCounter[3] || '').trim();
      const removeCounterText = String(selfDamageRemoveCounter[4] || '').trim();
      const removeTargetText = String(selfDamageRemoveCounter[5] || '').trim();
      return withMeta({
        kind: 'conditional',
        condition: {
          kind: 'if',
          raw: `damage would be dealt to ${recipientText} while it has ${String(selfDamageRemoveCounter[2] || '').trim()} counters on it`,
        },
        steps: [
          {
            kind: 'prevent_damage',
            amount: 'all',
            recipientTarget: parseObjectSelector(recipientText),
            duration: 'this_turn',
            raw: 'prevent that damage',
          },
          {
            kind: 'remove_counter',
            amount: parseQuantity(removeAmountText),
            counter: normalizeCounterName(removeCounterText),
            target: parseObjectSelector(removeTargetText),
            raw: `remove ${removeAmountText} ${removeCounterText} counter from ${removeTargetText}`,
          },
        ],
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    const basicLandTypeChoice = clause.match(
      /^(.+?)\s+becomes\s+the\s+basic\s+land\s+type\s+of\s+your\s+choice(?:\s+until\s+end\s+of\s+turn)?$/i
    );
    if (basicLandTypeChoice) {
      return withMeta({
        kind: 'set_basic_land_type',
        target: parseObjectSelector(String(basicLandTypeChoice[1] || '').trim()),
        landType: 'choice',
        duration: /\buntil\s+end\s+of\s+turn\b/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
      });
    }
  }

  {
    if (/^if you would lose the game,\s+instead exile this creature and your life total becomes equal to your starting life total$/i.test(clause)) {
      return withMeta({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you would lose the game' },
        steps: [{
          kind: 'move_zone',
          what: parseObjectSelector('this creature'),
          to: 'exile',
          raw: 'exile this creature',
        } as OracleEffectStep],
        raw: rawClause,
      } as OracleEffectStep);
    }

    if (/^if you cast a creature spell this way,\s+it gains haste until end of turn$/i.test(clause)) {
      return withMeta({
        kind: 'conditional',
        condition: { kind: 'if', raw: 'you cast a creature spell this way' },
        steps: [{
          kind: 'grant_temporary_ability',
          target: parseObjectSelector('it'),
          effectText: ['haste'],
          duration: 'end_of_turn',
          raw: 'it gains haste until end of turn',
        } as OracleEffectStep],
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    if (/^for each opponent,\s+create\s+a\s+token\s+copy\s+that\s+attacks\s+that\s+opponent\s+this\s+turn\s+if\s+able$/i.test(clause)) {
      return withMeta({
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'copy',
        attacking: 'each_opponent',
        raw: rawClause,
      });
    }
  }

  {
    const sacrifice = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}sacrifices?\\s+(.+)$`, 'i'));
    if (sacrifice) {
      const parsedObject = splitSacrificeObjectAndCondition(String(sacrifice[2] || '').trim());
      return withMeta({
        kind: 'sacrifice',
        who: parsePlayerSelector(sacrifice[1] || 'you'),
        what: parseObjectSelector(parsedObject.objectText),
        ...(parsedObject.condition ? { condition: parsedObject.condition } : {}),
        raw: rawClause,
      });
    }
  }

  const addManaEqualToEnchantedPermanentManaCost = clause.match(
    new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+mana\\s+equal\\s+to\\s+enchanted\\s+permanent(?:'|â€™)?s\\s+mana\\s+cost\\s*$`, 'i')
  );
  if (addManaEqualToEnchantedPermanentManaCost) {
    return withMeta({
      kind: 'add_mana',
      who: parsePlayerSelector(addManaEqualToEnchantedPermanentManaCost[1]),
      mana: '{C}',
      amount: { kind: 'reference_amount', raw: "enchanted permanent's mana cost" },
      raw: rawClause,
    });
  }

  {
    if (/^end the turn$/i.test(clause)) {
      return withMeta({
        kind: 'end_turn',
        raw: rawClause,
      });
    }

    // Mandate of Peace / similar: "End the combat phase." (reminder text optional)
    if (/^end the combat phase\b/i.test(clause)) {
      return withMeta({
        kind: 'end_combat_phase',
        exileStack: true,
        raw: rawClause,
      });
    }

    const addVariableColorManaWhereX = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+x\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+colors,?\\s+where\\s+x\\s+is\\s+(.+)\\s*$`, 'i')
    );
    if (addVariableColorManaWhereX) {
      const amount = parseAddManaAmountExpression(String(addVariableColorManaWhereX[2] || '').trim());
      if (amount) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addVariableColorManaWhereX[1]),
          mana: '{W}',
          amount,
          manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }

    // Omnath, Locus of All: "add three mana in any combination of its colors"
    const addCombinationOfItsColors = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+(a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+mana\\s+in\\s+any\\s+combination\\s+of\\s+its\\s+colors$`,
        'i',
      ),
    );
    if (addCombinationOfItsColors) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addCombinationOfItsColors[1]),
        mana: '{C}',
        amount: parseQuantity(String(addCombinationOfItsColors[2] || '').trim()),
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        manaOptionsScope: 'referenced_permanent_colors',
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const subjectlessAddCombinationOfItsColors = clause.match(
      /^adds?\s+(a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\s+mana\s+in\s+any\s+combination\s+of\s+its\s+colors$/i,
    );
    if (subjectlessAddCombinationOfItsColors) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{C}',
        amount: parseQuantity(String(subjectlessAddCombinationOfItsColors[1] || '').trim()),
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        manaOptionsScope: 'referenced_permanent_colors',
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const skipNextTurn = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her)\\s+next\\s+turn$`, 'i'));
    if (skipNextTurn) {
      return withMeta({
        kind: 'skip_next_turn',
        who: parsePlayerSelector(skipNextTurn[1]),
        raw: rawClause,
      });
    }
    const skipThatTurn = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+that\\s+turn$`, 'i'));
    if (skipThatTurn) {
      return withMeta({
        kind: 'skip_next_turn',
        who: parsePlayerSelector(skipThatTurn[1]),
        raw: rawClause,
      });
    }

    const changeTarget = clause.match(/^(?:you\s+may\s+)?change\s+the\s+targets?\s+of\s+(.+?)(?:\s+to\s+(.+))?$/i);
    if (changeTarget && /\b(?:spell|ability|abilities)\b/i.test(String(changeTarget[1] || ''))) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector(String(changeTarget[1] || '').trim()),
        ...(changeTarget[2] ? { newTarget: parseObjectSelector(String(changeTarget[2] || '').trim()) } : {}),
        optional: /^you\s+may\s+/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const changeATarget = clause.match(/^(?:you\s+may\s+)?change\s+a\s+target\s+of\s+(.+?)\s+to\s+(.+?)(?:\s+if\s+able)?$/i);
    if (changeATarget && /\b(?:spell|ability|abilities)\b/i.test(String(changeATarget[1] || ''))) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector(String(changeATarget[1] || '').trim()),
        newTarget: parseObjectSelector(String(changeATarget[2] || '').trim()),
        optional: /^you\s+may\s+/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const contextualChangeTarget = clause.match(/^(?:you\s+may\s+)?change\s+the\s+target\s+to\s+(.+?)(?:\s+if\s+able)?$/i);
    if (contextualChangeTarget) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector('the spell or ability'),
        newTarget: parseObjectSelector(String(contextualChangeTarget[1] || '').trim()),
        optional: /^you\s+may\s+/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const reselectAtRandom = clause.match(
      /^reselect\s+(?:the\s+|its\s+)?targets?\s+at\s+random(?:\s+for\s+(.+))?$/i
    );
    if (reselectAtRandom) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector(String(reselectAtRandom[1] || 'it').trim()),
        newTarget: parseObjectSelector('at random'),
        random: true,
        raw: rawClause,
      });
    }

    const newTargetsCantBe = clause.match(/^the\s+new\s+targets?\s+can(?:'|’)t\s+be\s+(.+)$/i);
    if (newTargetsCantBe) {
      return withMeta({
        kind: 'change_target',
        target: parseObjectSelector('it'),
        exclude: parseObjectSelector(String(newTargetsCantBe[1] || '').trim()),
        raw: rawClause,
      });
    }

    const changeText = clause.match(/^change\s+the\s+text\s+of\s+(.+?)\s+by\s+replacing\s+all\s+instances\s+of\s+one\s+color\s+word\s+with\s+another$/i);
    if (changeText) {
      return withMeta({
        kind: 'player_choice',
        choice: 'text_change',
        target: parseObjectSelector(String(changeText[1] || '').trim()),
        raw: rawClause,
      });
    }

    if (/^if\s+you\s+do,\s*proliferate$/i.test(clause)) {
      return withMeta({ kind: 'proliferate', raw: rawClause });
    }
    // Leave "if you do, proliferate twice" as unknown for expandRepeatedProliferateUnknownAbilities.
  }

  {
    const putSticker = clause.match(/^(?:you\s+may\s+)?put\s+(?:a|an)\s+((?:(?:name|art|ability|power\s+and\s+toughness|power\/toughness)\s+)?sticker)\s+on\s+(.+)$/i);
    if (putSticker) {
      return withMeta({
        kind: 'put_sticker',
        sticker: parseObjectSelector(putSticker[1]),
        target: parseObjectSelector(putSticker[2]),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const addRepeatedManaForEach = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})+)\\s+for\\s+each\\s+(.+)$`, 'i'));
    if (addRepeatedManaForEach) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addRepeatedManaForEach[1]),
        mana: String(addRepeatedManaForEach[2] || '').replace(/\s+/g, '').trim(),
        requiresChosenMana: true,
        raw: rawClause,
      });
    }

    const addManaChoiceForEach = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}adds?\\s+((?:\\{[^}]+\\})+(?:(?:\\s*,\\s*|\\s+or\\s+|\\s*,\\s*or\\s*)(?:\\{[^}]+\\})+)+)\\s+for\\s+each\\s+(.+)$`,
        'i'
      )
    );
    if (addManaChoiceForEach) {
      const manaOptions = parseManaOptionGroupList(String(addManaChoiceForEach[2] || '').trim());
      if (manaOptions.length >= 2) {
        return withMeta({
          kind: 'add_mana',
          who: parsePlayerSelector(addManaChoiceForEach[1]),
          mana: manaOptions[0],
          manaOptions,
          requiresChosenMana: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const searchBattlefieldMultiple = clause.match(
      new RegExp(
        `^search your library for up to (${COUNTER_AMOUNT_PATTERN}) (.+?) cards(?:,\\s*where\\s+x\\s+is\\s+(.+?))?\\s*,\\s*(?:reveal them,\\s*)?put (?:them|those cards) onto the battlefield( tapped)?(?: under your control)?(?:,\\s*(?:then\\s+)?shuffle(?: your library)?)?$`,
        'i'
      )
    );
    if (searchBattlefieldMultiple) {
      const amountToken = String(searchBattlefieldMultiple[1] || '').trim().toLowerCase();
      const whereRaw = String(searchBattlefieldMultiple[3] || '').trim();
      const maxResults = parseSmallNumber(searchBattlefieldMultiple[1]);
      if ((maxResults && maxResults > 0) || amountToken === 'x' || whereRaw) {
        return withMeta({
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'raw', text: String(searchBattlefieldMultiple[2] || '').trim() },
          destination: 'battlefield',
          entersTapped: Boolean(searchBattlefieldMultiple[4]),
          shuffle: /\bshuffle\b/i.test(clause) || undefined,
          ...(maxResults && maxResults > 0 ? { maxResults } : {}),
          ...(whereRaw ? { whereX: { kind: 'where', raw: whereRaw } } : {}),
          optional: true,
          raw: rawClause,
        });
      }
    }
  }

  {
    const addTicketCountersWord = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+(${COUNTER_AMOUNT_PATTERN})\\s+\\{TK\\}\\s*$`, 'i'),
    );
    if (addTicketCountersWord) {
      const ticketCount = parseSmallNumber(String(addTicketCountersWord[2] || '').trim());
      if (ticketCount && ticketCount > 0) {
        return withMeta({
          kind: 'add_player_counter',
          who: parsePlayerSelector(addTicketCountersWord[1]),
          amount: { kind: 'number', value: ticketCount },
          counter: 'ticket',
          raw: rawClause,
        });
      }
    }

    const addTicketCounters = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}get(?:s)?\\s+((?:\\{TK\\})+)\\s*$`, 'i'));
    if (addTicketCounters) {
      const ticketCount = countTicketSymbols(String(addTicketCounters[2] || ''));
      if (ticketCount > 0) {
        return withMeta({
          kind: 'add_player_counter',
          who: parsePlayerSelector(addTicketCounters[1]),
          amount: { kind: 'number', value: ticketCount },
          counter: 'ticket',
          raw: rawClause,
        });
      }
    }
  }

  {
    const becomeAura = clause.match(
      /^(.+?)\s+loses\s+this\s+ability\s+and\s+becomes\s+an?\s+aura\s+enchantment\s+with\s+enchant\s+(.+)$/i
    );
    if (becomeAura) {
      return withMeta({
        kind: 'become_aura',
        target: parseObjectSelector(becomeAura[1]),
        enchant: parseObjectSelector(becomeAura[2]),
        losesThisAbility: true,
        duration: 'until_effect_ends',
        raw: rawClause,
      });
    }

    const contextualBecomeAura = clause.match(/^(it|this\s+permanent|this\s+enchantment)\s+becomes\s+an?\s+aura\s+with\s+enchant\s+(.+)$/i);
    if (contextualBecomeAura) {
      return withMeta({
        kind: 'become_aura',
        target: parseObjectSelector(contextualBecomeAura[1]),
        enchant: parseObjectSelector(contextualBecomeAura[2]),
        duration: 'until_effect_ends',
        raw: rawClause,
      });
    }
  }

  {
    const searchBattlefield = clause.match(
      /^search your library for (?:up to one |a |an )(.+?) card(?:,\s*|\s+and\s+)(reveal it,\s*)?put (?:it|that card) onto the battlefield( tapped)?(?: under your control)?(?:,\s*(?:then\s+)?shuffle(?: your library)?)?$/i
    );
    if (searchBattlefield) {
      return withMeta({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: String(searchBattlefield[1] || '').trim() },
        destination: 'battlefield',
        revealFound: Boolean(searchBattlefield[2]),
        entersTapped: Boolean(searchBattlefield[3]),
        shuffle: /\bshuffle\b/i.test(clause) || undefined,
        maxResults: 1,
        raw: rawClause,
      });
    }
  }


  {
    const flipCoin = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}flips?\\s+a\\s+coin$`, 'i'));
    if (flipCoin) {
      return withMeta({
        kind: 'flip_coin',
        who: parsePlayerSelector(flipCoin[1]),
        raw: rawClause,
        });
    }

    const flipUntilLoss = clause.match(/^flip\s+a\s+coin\s+until\s+you\s+lose\s+a\s+flip$/i);
    if (flipUntilLoss) {
      return withMeta({
        kind: 'flip_coin',
        who: { kind: 'you' },
        repeatUntil: 'lose_flip',
        raw: rawClause,
      });
    }

  }

    const putCountersEqualToPower = clause.match(/^put\s+(?:a\s+number\s+of\s+)?(.+?)\s+counters?\s+equal\s+to\s+(?:its|this\s+permanent's)\s+power\s+on\s+(.+)$/i);
    if (putCountersEqualToPower) {
      return withMeta({
        kind: 'add_counter',
        amount: { kind: 'object_stat', subject: 'it', stat: 'power' },
        counter: normalizeCounterName(String(putCountersEqualToPower[1] || '').trim()),
        target: parseObjectSelector(String(putCountersEqualToPower[2] || '').trim()),
        raw: rawClause,
      });
    }

  {
    const rollDie = clause.match(/^roll\s+a\s+d(\d+)$/i);
    if (rollDie) {
      return withMeta({
        kind: 'roll_die',
        who: { kind: 'you' },
        sides: Number.parseInt(String(rollDie[1] || '0'), 10),
        raw: rawClause,
        });
    }
  }

  {
    const rollSixSidedDice = clause.match(
      /^roll\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+six-sided\s+(?:die|dice)$/i
    );
    if (rollSixSidedDice) {
      const count = parseSmallNumber(rollSixSidedDice[1]);
      if (count && count > 0) {
        return withMeta({
          kind: 'roll_die',
          who: { kind: 'you' },
          sides: 6,
          count,
          raw: rawClause,
          });
      }
    }
  }
  {
    const searchTop = clause.match(
      /^search your library for (?:up to one |a |an )(?:(.+?)\s+)?card(?:,\s*reveal it)?,\s*(?:then\s+)?shuffle(?: your library)? and put (?:it|that card) on top$/i
    );
    if (searchTop) {
      return withMeta({
        kind: 'search_library',
        who: { kind: 'you' },
        criteria: { kind: 'raw', text: String(searchTop[1] || '').trim() },
        destination: 'top',
        ...(/reveal it/i.test(clause) ? { revealFound: true } : {}),
        shuffle: true,
        maxResults: 1,
        raw: rawClause,
        });
    }
  }

  {
    const shuffleLibrary = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}shuffle(?:s)?(?:\\s+(?:your|their|his or her)\\s+library)?$`, 'i')
    );
    if (shuffleLibrary) {
      return withMeta({
        kind: 'shuffle_library',
        who: parsePlayerSelector(shuffleLibrary[1]),
        raw: rawClause,
        });
    }

    // Parallel Thoughts: "Shuffle that pile and put it back on top of your library."
    const shufflePileOntoLibrary = clause.match(
      /^shuffle that pile and put it back on top of (?:your|their|his or her) library$/i,
    );
    if (shufflePileOntoLibrary) {
      return withMeta({
        kind: 'move_zone',
        what: parseObjectSelector('that pile'),
        to: 'library',
        toRaw: 'on top of your library',
        libraryPlacement: 'top',
        order: 'random',
        raw: rawClause,
      } as OracleEffectStep);
    }
  }

  {
    const opponentCausedSearchPrevention = clause.match(
      /^spells\s+and\s+abilities\s+your\s+opponents\s+control\s+can't\s+cause\s+their\s+controller\s+to\s+search\s+their\s+library$/i
    );
    if (opponentCausedSearchPrevention) {
      return withMeta({
        kind: 'prevent_library_search',
        who: { kind: 'each_opponent' },
        source: parseObjectSelector('spells and abilities your opponents control'),
        duration: 'static',
        raw: rawClause,
        });
    }

    const genericSearchPrevention = clause.match(
      /^(players|each\s+player|your\s+opponents|opponents|each\s+opponent)\s+can't\s+search\s+(?:libraries|their\s+libraries)$/i
    );
    if (genericSearchPrevention) {
      return withMeta({
        kind: 'prevent_library_search',
        who: /opponents?|each\s+opponent/i.test(String(genericSearchPrevention[1] || ''))
          ? { kind: 'each_opponent' }
          : { kind: 'each_player' },
        duration: 'static',
        raw: rawClause,
        });
    }
  }

  {
    const addCommanderIdentityMana = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}adds?\\s+one\\s+mana\\s+of\\s+any\\s+color\\s+in\\s+your\\s+commander'?s\\s+color\\s+identity\\s*$`, 'i')
    );
    if (addCommanderIdentityMana) {
      return withMeta({
        kind: 'add_mana',
        who: parsePlayerSelector(addCommanderIdentityMana[1]),
        mana: '{W}',
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        manaOptionsScope: 'commander_color_identity',
        requiresChosenMana: true,
        raw: rawClause,
        });
    }
  }
  return null;
}
