/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause blight / heal / investigate / scry / surveil clauses
 * Public: tryParseSimpleActionBlightScryClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import {
  buildQuantityStepFromClauseParts,
  isSimpleCardQuantityTail,
  quantityTailSupportsDynamicQuantity,
} from './oracleIRParserQuantityHelpers';
import { PLAYER_SUBJECT_PREFIX, COUNTER_AMOUNT_PATTERN } from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionBlightScryClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const blightSelf = clause.match(
      new RegExp(`^blight\\s+(${COUNTER_AMOUNT_PATTERN}|x)(?:\\s*,\\s+where\\s+x\\s+is\\s+(.+))?\\s*\\.?(?:\\s*\\(.*\\))?$`, 'i')
    );
    if (blightSelf) {
      const whereX = blightSelf[2]
        ? ({ kind: 'where', raw: String(blightSelf[2] || '').trim() } as const)
        : undefined;
      return withMeta({
        kind: 'blight',
        who: { kind: 'you' },
        amount: parseQuantity(String(blightSelf[1] || '1').trim()),
        ...(whereX ? { whereX } : {}),
        raw: rawClause,
      });
    }
  }

  {
    const blight = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?blights?\\s+(${COUNTER_AMOUNT_PATTERN}|x)(?:\\s*,\\s+where\\s+x\\s+is\\s+(.+))?\\s*\\.?(?:\\s*\\(.*\\))?$`,
        'i'
      )
    );
    if (blight) {
      const whoRaw = String(blight[1] || 'you').trim() || 'you';
      const whereX = blight[3]
        ? ({ kind: 'where', raw: String(blight[3] || '').trim() } as const)
        : undefined;
      return withMeta({
        kind: 'blight',
        who: parsePlayerSelector(whoRaw),
        amount: parseQuantity(String(blight[2] || '1').trim()),
        ...(whereX ? { whereX } : {}),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }
  }

  {
    const heal = clause.match(
      /^(?:heal|heals?)\s+(?:(all|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?damage\s+(?:from|on)\s+(.+?)\s*\.?(?:\s*\(.*\))?$/i,
    );
    if (heal) {
      const amountRaw = String(heal[1] || 'all').trim();
      return withMeta({
        kind: 'remove_marked_damage',
        target: parseObjectSelector(String(heal[2] || '').trim()),
        amount: /^all$/i.test(amountRaw) ? 'all' : parseQuantity(amountRaw),
        raw: rawClause,
      });
    }
  }

  {
    const investigate = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?(?:investigate|investigates)(?:\\s+(twice|that many|that much|\\d+|x)(?:\\s+times)?)?(?:,\\s+where\\s+x\\s+is\\s+(.+))?$`,
        'i'
      )
    );
    if (investigate) {
      const whoRaw = String(investigate[1] || 'you').trim() || 'you';
      const whereX = investigate[3]
        ? ({ kind: 'where', raw: String(investigate[3] || '').trim() } as const)
        : undefined;
      const amountRaw = String(investigate[2] || '1').trim();
      return withMeta({
        kind: 'investigate',
        who: parsePlayerSelector(whoRaw),
        amount: /^twice$/i.test(amountRaw) ? { kind: 'number', value: 2 } : parseQuantity(amountRaw || '1'),
        ...(whereX ? { whereX } : {}),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }
  }

  {
    const skipNextDrawStep = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}skip(?:s)?\\s+(?:your|their|his or her|its)\\s+(?:next\\s+)?draw\\s+step\\b`, 'i')
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
    const monstrosityMatch = clause.match(/^monstrosity\s+(a|an|\d+|x|[a-z]+)$/i);
    if (monstrosityMatch) {
      return withMeta({
        kind: 'monstrosity',
        target: parseObjectSelector('this permanent'),
        amount: parseQuantity(monstrosityMatch[1]),
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
    const transformMatch = clause.match(
      /^transform\s+(this\s+(?:land|creature|permanent|enchantment|artifact|equipment)|.+?)(?:[.]\s*.*)?$/i
    );
    if (transformMatch) {
      const captured = String(transformMatch[1] || '').trim();
      const targetText = /^this\s+/i.test(captured) ? captured : 'this permanent';
      return withMeta({
        kind: 'turn_face_up',
        target: parseObjectSelector(targetText),
        raw: rawClause,
        });
    }
  }

  {
    const convertMatch = clause.match(/^convert\s+(?:this\s+permanent|.+?)(?:[.]\s*.*)?$/i);
    if (convertMatch) {
      return withMeta({
        kind: 'turn_face_up',
        target: parseObjectSelector('this permanent'),
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
    const turnFaceDownMatch = clause.match(/^turn\s+(.+?)\s+face down$/i);
    if (turnFaceDownMatch) {
      return withMeta({
        kind: 'turn_face_down',
        target: parseObjectSelector(String(turnFaceDownMatch[1] || '').trim()),
        raw: rawClause,
        });
    }
  }

  {
    const creatureTypeChoiceMatch = clause.match(/^(.+?)\s+becomes\s+the\s+creature\s+type\s+of\s+your\s+choice\s+until\s+end\s+of\s+turn$/i);
    if (creatureTypeChoiceMatch) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(creatureTypeChoiceMatch[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['becomes the creature type of your choice'],
        raw: rawClause,
        });
    }

    const colorChoiceMatch = clause.match(/^(.+?)\s+becomes\s+the\s+color\s+of\s+your\s+choice\s+until\s+end\s+of\s+turn$/i);
    if (colorChoiceMatch) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(colorChoiceMatch[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['becomes the color of your choice'],
        raw: rawClause,
      });
    }

    const chosenTypeAdditionMatch = clause.match(/^(this\s+creature|this\s+permanent|it|creatures\s+you\s+control)\s+(?:is|are)\s+the\s+chosen\s+type\s+in\s+addition\s+to\s+(?:its|their)\s+other\s+types$/i);
    if (chosenTypeAdditionMatch) {
      return withMeta({
        kind: 'add_types',
        target: parseObjectSelector(String(chosenTypeAdditionMatch[1] || '').trim()),
        addTypes: ['chosen type'],
        raw: rawClause,
      });
    }

    const chosenColorStaticMatch = clause.match(/^(.+?)\s+(?:is|are)\s+the\s+chosen\s+color$/i);
    if (chosenColorStaticMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(chosenColorStaticMatch[1] || '').trim()),
        effectText: ['is the chosen color'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const tokensGainHasteMatch = clause.match(/^(those\s+tokens|these\s+tokens|the\s+tokens|tokens\s+created\s+this\s+way)\s+gain\s+haste$/i);
    if (tokensGainHasteMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(tokensGainHasteMatch[1] || '').trim()),
        abilities: ['haste'],
        raw: rawClause,
      });
    }

    const partyClassAdditionMatch = clause.match(/^(this\s+permanent|this\s+creature|it)\s+is\s+also\s+a\s+Cleric,\s+Rogue,\s+Warrior,\s+and\s+Wizard$/i);
    if (partyClassAdditionMatch) {
      return withMeta({
        kind: 'add_types',
        target: parseObjectSelector(String(partyClassAdditionMatch[1] || '').trim()),
        addTypes: ['Cleric', 'Rogue', 'Warrior', 'Wizard'],
        raw: rawClause,
      });
    }

    const enchantedPermanentTypeLock = clause.match(/^(enchanted\s+permanent)\s+is\s+an\s+enchantment\s+and\s+loses\s+all\s+other\s+card\s+types$/i);
    if (enchantedPermanentTypeLock) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(enchantedPermanentTypeLock[1] || '').trim()),
        effectText: ['is an enchantment and loses all other card types'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const equippedPermanentCreatureType = clause.match(
      /^(equipped\s+permanent)\s+isn(?:'|â€™)t\s+a\s+planeswalker\s+and\s+is\s+a\s+creature\s+in\s+addition\s+to\s+its\s+other\s+types$/i
    );
    if (equippedPermanentCreatureType) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(equippedPermanentCreatureType[1] || '').trim()),
        effectText: ["isn't a planeswalker and is a creature in addition to its other types"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const globalColorlessMatch = clause.match(
      /^(all\s+cards\s+that\s+aren(?:'|â€™)?t\s+on\s+the\s+battlefield,\s+spells,\s+and\s+permanents)\s+are\s+colorless$/i
    );
    if (globalColorlessMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(globalColorlessMatch[1] || '').trim()),
        effectText: ['are colorless'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const globalChosenColorMatch = clause.match(
      /^(all\s+cards\s+that\s+aren(?:'|â€™)?t\s+on\s+the\s+battlefield,\s+spells,\s+and\s+permanents)\s+are\s+the\s+chosen\s+color\s+in\s+addition\s+to\s+their\s+other\s+colors$/i
    );
    if (globalChosenColorMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(globalChosenColorMatch[1] || '').trim()),
        effectText: ['are the chosen color in addition to their other colors'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const typeAdditionMatch = clause.match(
      /^(all\s+.+?)\s+are\s+(.+?)\s+in\s+addition\s+to\s+their\s+other\s+types$/i
    );
    if (typeAdditionMatch) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(typeAdditionMatch[1] || '').trim()),
        effectText: [`are ${String(typeAdditionMatch[2] || '').trim()} in addition to their other types`],
        duration: 'static',
        raw: rawClause,
      });
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

    const specificBasicLandType = clause.match(/^(.+?)\s+becomes\s+(?:an?\s+)?(plains|island|swamp|mountain|forest)(?:\s+(?:until\s+end\s+of\s+turn|for\s+as\s+long\s+as\s+.+|until\s+.+?\s+leaves\s+the\s+battlefield|in\s+addition\s+to\s+its\s+other\s+types))?$/i);
    if (specificBasicLandType) {
      const landType = String(specificBasicLandType[2] || '').trim().toLowerCase();
      const normalizedLandType = (landType.charAt(0).toUpperCase() + landType.slice(1)) as 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest';
      return withMeta({
        kind: 'set_basic_land_type',
        target: parseObjectSelector(String(specificBasicLandType[1] || '').trim()),
        landType: normalizedLandType,
        duration: /\buntil\s+end\s+of\s+turn\b/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
      });
    }

    const permanentCopy = clause.match(/^(.+?)\s+becomes\s+a\s+copy\s+of\s+(.+?)(?:\s+until\s+end\s+of\s+turn,\s+except\s+(.+)|,\s+except\s+(.+))?$/i);
    if (permanentCopy) {
      const targetText = String(permanentCopy[1] || '').trim();
      const sourceText = String(permanentCopy[2] || '').trim();
      const turnScopedExceptionText = String(permanentCopy[3] || '').trim();
      const staticExceptionText = String(permanentCopy[4] || '').trim();
      if (turnScopedExceptionText) {
        return withMeta({
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(targetText),
          duration: 'end_of_turn',
          effectText: [`becomes a copy of ${sourceText}`, `except ${turnScopedExceptionText}`],
          raw: rawClause,
        });
      }
      return withMeta({
        kind: 'copy_permanent',
        target: parseObjectSelector(targetText),
        source: parseObjectSelector(sourceText),
        ...(staticExceptionText ? { retainAbilityText: staticExceptionText } : {}),
        raw: rawClause,
      });
    }

    const targetBecomesPtType = clause.match(/^(.+?)\s+becomes\s+(?:an?\s+)?(\d+)\s*\/\s*(\d+)\s+(.+?)(?:\s+for\s+as\s+long\s+as\s+.+)?$/i);
    if (targetBecomesPtType) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(targetBecomesPtType[1] || '').trim()),
        power: Number.parseInt(String(targetBecomesPtType[2] || '0'), 10),
        toughness: Number.parseInt(String(targetBecomesPtType[3] || '0'), 10),
        effectText: [`becomes ${String(targetBecomesPtType[4] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const artifactCreatureBecomes = clause.match(/^(.+?)\s+becomes\s+an\s+artifact\s+creature(?:\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\s*\/\s*(\d+))?(?:\s+for\s+as\s+long\s+as\s+.+)?$/i);
    if (artifactCreatureBecomes) {
      const power = artifactCreatureBecomes[2] ? Number.parseInt(String(artifactCreatureBecomes[2]), 10) : undefined;
      const toughness = artifactCreatureBecomes[3] ? Number.parseInt(String(artifactCreatureBecomes[3]), 10) : undefined;
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(artifactCreatureBecomes[1] || '').trim()),
        ...(power !== undefined ? { power } : {}),
        ...(toughness !== undefined ? { toughness } : {}),
        effectText: ['becomes an artifact creature', ...(power !== undefined && toughness !== undefined ? [`base power and toughness ${power}/${toughness}`] : [])],
        duration: 'static',
        raw: rawClause,
      });
    }

    const targetBecomesNamedState = clause.match(/^(.+?)\s+becomes\s+(prepared|unprepared|an?\s+enchantment(?:\s+and\s+loses\s+all\s+abilities\s+until\s+a\s+player\s+casts\s+a\s+creature\s+spell)?|an?\s+treasure\s+artifact\s+with\s+"[^"]+"\s+and\s+loses\s+all\s+other\s+card\s+types\s+and\s+abilities|an?\s+[a-z][a-z -]+)$/i);
    if (targetBecomesNamedState) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(targetBecomesNamedState[1] || '').trim()),
        effectText: [`becomes ${String(targetBecomesNamedState[2] || '').trim()}`],
        duration: 'static',
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
    const scryCandidates = [clause];
    const triggeredScryMatch = clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggeredScryMatch) scryCandidates.push(String(triggeredScryMatch[1] || '').trim());

    for (const scryClause of scryCandidates) {
      const scryTail = scryClause.match(
        new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?(?:scry|scries)\\s+(.+)$`, 'i')
      );
      if (!scryTail) continue;

      const quantityTail = String(scryTail[2] || '').trim();
      if (!quantityTailSupportsDynamicQuantity(quantityTail)) continue;

      return buildQuantityStepFromClauseParts({
        kind: 'scry',
        who: parsePlayerSelector(scryTail[1]),
        quantityTail,
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(scryClause) || undefined,
      });
    }
  }

  {
    const surveilCandidates = [clause];
    const triggeredSurveilMatch = clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggeredSurveilMatch) surveilCandidates.push(String(triggeredSurveilMatch[1] || '').trim());

    for (const surveilClause of surveilCandidates) {
      const surveilTail = surveilClause.match(
        new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:surveil|surveils)\\s+(.+)$`, 'i')
      );
      if (!surveilTail) continue;

      const quantityTail = String(surveilTail[2] || '').trim();
      if (!quantityTailSupportsDynamicQuantity(quantityTail)) continue;

      return buildQuantityStepFromClauseParts({
        kind: 'surveil',
        who: parsePlayerSelector(surveilTail[1]),
        quantityTail,
        rawClause,
        withMeta,
      });
    }
  }

  {
    const fateseal = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:fateseal|fateseals)\\s+(a|an|\\d+|x|[a-z]+)\\b`, 'i'));
    if (fateseal) {
      return withMeta({
        kind: 'fateseal',
        who: parsePlayerSelector(fateseal[1]),
        target: { kind: 'target_opponent' },
        amount: parseQuantity(fateseal[2]),
        raw: rawClause,
        });
    }
  }

  {
    const timeTravel = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:time\\s+travel)(?:\\s+(a|an|\\d+|x|[a-z]+)\\s+times?)?\\b`, 'i')
    );
    if (timeTravel) {
      return withMeta({
        kind: 'time_travel',
        who: parsePlayerSelector(timeTravel[1]),
        amount: parseQuantity(timeTravel[2] || '1'),
        raw: rawClause,
        });
    }
  }

  {
    const discardUnless = clause.match(
      /^(?:then\s+)?discard\s+a\s+card\s+unless\s+(.+)$/i,
    );
    if (discardUnless) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        unlessCondition: { kind: 'if', raw: String(discardUnless[1] || '').trim() },
        raw: rawClause,
      });
    }

    const discardUnlessTyped = clause.match(
      /^discard\s+(two cards unless you discard an instant or sorcery card or a creature card with flying)$/i,
    );
    if (discardUnlessTyped) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: {
          kind: 'reference_amount',
          raw: String(discardUnlessTyped[1] || '').trim().toLowerCase(),
        },
        raw: rawClause,
      });
    }

    const discardHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardHand[1]),
        amount: { kind: 'number', value: 9999 },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardAllInHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+all\\s+(?:the\\s+)?cards?\\s+in\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardAllInHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAllInHand[1]),
        amount: { kind: 'number', value: 9999 },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardAllFromHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+all\\s+cards\\s+from\\s+(?:your|their)\\s+hand\\b`, 'i')
    );
    if (discardAllFromHand) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAllFromHand[1]),
        amount: { kind: 'number', value: 9999 },
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const discardAllInHandDefault = clause.match(/^discard\s+all\s+(?:the\s+)?cards?\s+in\s+your\s+hand\b/i);
    if (discardAllInHandDefault) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 9999 },
        raw: rawClause,
        });
    }

    const discardTargeted = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+(that\\s+card|those\\s+cards|it)\\b`, 'i')
    );
    if (discardTargeted) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardTargeted[1]),
        amount: { kind: 'number', value: 1 },
        target: parseObjectSelector(discardTargeted[2]),
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    const discardAnotherRandom = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+another\\s+card\\s+at\\s+random\\b`, 'i'),
    );
    if (discardAnotherRandom) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAnotherRandom[1]),
        amount: { kind: 'number', value: 1 },
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const discardHalf = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+half\\s+the\\s+cards\\s+in\\s+(?:their|your)\\s+hand,\\s+rounded\\s+(up|down)$`, 'i')
    );
    if (discardHalf) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardHalf[1]),
        amount: { kind: 'reference_amount', raw: `half_hand_rounded_${String(discardHalf[2] || '').trim().toLowerCase()}` },
        optional: /\\bmay\\b/i.test(clause) || undefined,
        raw: rawClause,
        });
    }

    // Vanish into Memory: "discard cards equal to that creature's toughness"
    const discardEqualToCreatureStat = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+cards\\s+equal\\s+to\\s+(that\\s+creature(?:'s|\\u2019s)?\\s+(?:power|toughness)|its\\s+(?:power|toughness))$`,
        'i',
      ),
    );
    if (discardEqualToCreatureStat) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardEqualToCreatureStat[1]),
        amount: { kind: 'reference_amount', raw: String(discardEqualToCreatureStat[2] || '').trim() },
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const subjectlessDiscardEqualToCreatureStat = clause.match(
      /^discards?\s+cards\s+equal\s+to\s+(that\s+creature(?:'s|\u2019s)?\s+(?:power|toughness)|its\s+(?:power|toughness))$/i,
    );
    if (subjectlessDiscardEqualToCreatureStat) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'reference_amount', raw: String(subjectlessDiscardEqualToCreatureStat[1] || '').trim() },
        raw: rawClause,
      });
    }

    const subjectlessDiscardHalf = clause.match(/^(?:then\s+)?discards?\s+half\s+the\s+cards\s+in\s+(?:their|your)\s+hand(?:,\s+rounded\s+(up|down))?$/i);
    if (subjectlessDiscardHalf) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'each_player' },
        amount: { kind: 'reference_amount', raw: `half_hand_rounded_${String(subjectlessDiscardHalf[1] || 'up').trim().toLowerCase()}` },
        raw: rawClause,
      });
    }

    const discardAndLose = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+(a card|(?:a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\s+and\\s+loses?\\s+(\\d+|x)\\s+life$`,
        'i'
      )
    );
    if (discardAndLose) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(discardAndLose[1]),
        amount: parseQuantity(String(discardAndLose[2] || '').trim()),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const discardForEach = clause.match(
      new RegExp(
        `^${PLAYER_SUBJECT_PREFIX}(?:may\\s+)?discards?\\s+(?:a card|(?:a|an|\\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)\\s+cards?)\\s+for\\s+each\\s+(.+)$`,
        'i',
      ),
    );
    if (discardForEach) {
      const who = parsePlayerSelector(discardForEach[1]);
      const amountText = `a card for each ${String(discardForEach[2] || '').trim()}`;
      return withMeta({
        kind: 'discard',
        who,
        amount: parseQuantity(amountText),
        optional: /\bmay\b/i.test(clause) || undefined,
        raw: rawClause,
      });
    }

    const discardTail = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:also\\s+)?(?:may\\s+)?discards?\\s+(.+)$`, 'i')
    );
    const discardTailText = String(discardTail?.[2] || '');
    if (
      discardTail &&
      !/,\s*mills?\b/i.test(discardTailText) &&
      (isSimpleCardQuantityTail(discardTailText) || /,\s*where\s+x\s+is\s+/i.test(discardTailText))
    ) {
      return buildQuantityStepFromClauseParts({
        kind: 'discard',
        who: parsePlayerSelector(discardTail[1]),
        quantityTail: String(discardTail[2] || '').trim(),
        rawClause,
        withMeta,
        optional: /\bmay\b/i.test(clause) || undefined,
      });
    }

    const eachPlayerWhoCantDiscard = clause.match(/^each\s+player\s+who\s+can't\s+discards?\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (eachPlayerWhoCantDiscard) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'each_player' },
        amount: parseQuantity(eachPlayerWhoCantDiscard[1]),
        raw: rawClause,
      });
    }

    const mayHaveDiscard = clause.match(/^(?:you\s+may\s+)?have\s+(target\s+opponent|target\s+player|that\s+opponent|that\s+player|an\s+opponent)\s+discard\s+(a|an|\d+|x|[a-z]+)\s+cards?\b/i);
    if (mayHaveDiscard) {
      return withMeta({
        kind: 'discard',
        who: parsePlayerSelector(mayHaveDiscard[1]),
        amount: parseQuantity(mayHaveDiscard[2]),
        optional: true,
        raw: rawClause,
      });
    }

    const discardTargetedDefault = clause.match(/^discard\s+(that\s+card|it)\b/i);
    if (discardTargetedDefault) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        target: parseObjectSelector(discardTargetedDefault[1]),
        raw: rawClause,
        });
    }

    const discardDefaultTail = clause.match(/^discard\s+(.+)$/i);
    if (discardDefaultTail && isSimpleCardQuantityTail(String(discardDefaultTail[1] || ''))) {
      return buildQuantityStepFromClauseParts({
        kind: 'discard',
        who: { kind: 'you' },
        quantityTail: String(discardDefaultTail[1] || '').trim(),
        rawClause,
        withMeta,
      });
    }
  }

  {
    const lookHand = clause.match(
      /^(?:you\s+)?look\s+at\s+(target opponent|target player|that opponent|that player|each opponent|each player|an opponent|your|their|his or her)(?:'s|’s)?\s+hand\b/i
    );
    if (lookHand) {
      const rawWho = String(lookHand[1] || '').trim().toLowerCase();
      const selectorText = rawWho === 'an opponent' ? 'target opponent' : rawWho;
      return withMeta({
        kind: 'look_hand',
        who: parsePlayerSelector(selectorText),
        raw: rawClause,
        });
    }

    const revealHand = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}reveals?\\s+(?:your|their|his or her)\\s+hand\\b`, 'i')
    );
    if (revealHand) {
      return withMeta({
        kind: 'reveal_hand',
        who: parsePlayerSelector(revealHand[1]),
        raw: rawClause,
        });
    }

    const revealRandomCard = clause.match(new RegExp(`^${PLAYER_SUBJECT_PREFIX}reveals?\\s+a\\s+card\\s+at\\s+random\\s+from\\s+(?:your|their|his or her)\\s+hand$`, 'i'));
    if (revealRandomCard) {
      return withMeta({
        kind: 'reveal_hand',
        who: parsePlayerSelector(revealRandomCard[1]),
        raw: rawClause,
        });
    }
  }
  return null;
}
