/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause token / life / lose-game clauses
 * Public: tryParseSimpleActionTokenLifeClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionTokenLifeClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

    const thosePlusAdditionalTreasure = clause.match(
      /^if you would create one or more treasure tokens,\s+instead create those tokens plus an additional treasure token$/i,
    );
    if (thosePlusAdditionalTreasure) {
      return withMeta({
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'reference_amount', raw: 'those tokens plus an additional Treasure token' },
        token: 'Treasure',
        raw: rawClause,
      });
    }

    const tokenReplacement = clause.match(/^twice\s+that\s+many\s+of\s+those\s+tokens\s+are\s+created$/i);
    if (tokenReplacement) {
      return withMeta({
        kind: 'modify_token_creation',
        who: { kind: 'you' },
        tokenTypes: ['token'],
        mode: 'add_additional_token',
        additionalAmount: { kind: 'reference_amount', raw: 'that many' },
        raw: rawClause,
      });
    }

    const createChosenNameCopy = clause.match(/^create\s+a\s+copy\s+of\s+the\s+card\s+with\s+the\s+chosen\s+name$/i);
    if (createChosenNameCopy) {
      return withMeta({
        kind: 'create_token',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        token: 'copy of the card with the chosen name',
        raw: rawClause,
      });
    }

    const untilNextTurnSpellCostChange = clause.match(
      /^(?:until your next turn,\s*)?(.+?\bspells?\s+(?:you|that player)\s+casts?)\s+cost\s+(\{[^}]+\})\s+(less|more)\s+to\s+cast(?:\s+until your next turn)?$/i,
    );
    if (untilNextTurnSpellCostChange && /\buntil your next turn\b/i.test(clause)) {
      const targetText = String(untilNextTurnSpellCostChange[1] || '').trim();
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(/\bthat player\b/i.test(targetText) ? 'that player' : 'you'),
        duration: 'until_next_turn',
        effectText: [`${targetText} cost ${String(untilNextTurnSpellCostChange[2] || '').trim()} ${String(untilNextTurnSpellCostChange[3] || '').trim()} to cast`],
        raw: rawClause,
      });
    }

    const spellCostChange = clause.match(/^(.+?\s+spells?\s+(?:you\s+cast|you\s+control)?)\s+cost\s+(\{[^}]+\})\s+(less|more)\s+to\s+cast$/i);
    if (spellCostChange) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellCostChange[1] || '').trim()),
        effectText: [`cost ${String(spellCostChange[2] || '').trim()} ${String(spellCostChange[3] || '').trim()} to cast`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const domainCostReduction = clause.match(/^(?:domain\s+-\s+)?this\s+spell\s+costs?\s+(\{[^}]+\})\s+less\s+to\s+cast\s+for\s+each\s+basic\s+land\s+type\s+among\s+lands\s+you\s+control$/i);
    if (domainCostReduction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this spell'),
        effectText: [`costs ${String(domainCostReduction[1] || '').trim()} less to cast for each basic land type among lands you control`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const spellsCantBeCountered = clause.match(/^(.+?\s+spells?\s+you\s+control)\s+can(?:'|â€™)?t\s+be\s+countered$/i);
    if (spellsCantBeCountered) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellsCantBeCountered[1] || '').trim()),
        effectText: ["can't be countered"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const spellCantBeCopied = clause.match(/^(.+?)\s+can(?:not|(?:'|â€™)t)\s+be\s+copied$/i);
    if (spellCantBeCopied) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellCantBeCopied[1] || '').trim()),
        effectText: ["can't be copied"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const chosenTypeCostLess = clause.match(/^spells\s+you\s+cast\s+of\s+the\s+chosen\s+type\s+cost\s+(\{[^}]+\})\s+less\s+to\s+cast$/i);
    if (chosenTypeCostLess) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('spells you cast of the chosen type'),
        effectText: [`cost ${String(chosenTypeCostLess[1] || '').trim()} less to cast`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const genericSpellCostReduction = clause.match(/^(.+?)\s+costs?\s+(\{[^}]+\})\s+less\s+to\s+cast$/i);
    if (genericSpellCostReduction) {
      const targetText = String(genericSpellCostReduction[1] || '').trim();
      const effectText = [`costs ${String(genericSpellCostReduction[2] || '').trim()} less to cast`];
      if (/\bthis turn\b/i.test(targetText)) {
        return withMeta({
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(targetText),
          duration: 'this_turn',
          effectText,
          raw: rawClause,
        });
      }

      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(targetText),
        effectText,
        duration: 'static',
        raw: rawClause,
      });
    }

    const permanentsEnterTapped = clause.match(/^(.+?)\s+enter\s+tapped$/i);
    if (permanentsEnterTapped && /\b(?:creatures?|artifacts?|lands?|permanents?)\b/i.test(String(permanentsEnterTapped[1] || ''))) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(permanentsEnterTapped[1] || '').trim()),
        effectText: ['enter tapped'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const allAbleBlockTarget = clause.match(
      /^all\s+creatures(?:\s+(your\s+opponents\s+control))?(?:\s+with\s+(.+?))?\s+able\s+to\s+block\s+(.+?)\s+this\s+turn\s+do\s+so$/i
    );
    if (allAbleBlockTarget) {
      const blockerText = [
        'all creatures',
        String(allAbleBlockTarget[1] || '').trim(),
        allAbleBlockTarget[2] ? `with ${String(allAbleBlockTarget[2] || '').trim()}` : '',
        'able to block',
      ]
        .filter(Boolean)
        .join(' ');
      return withMeta({
        kind: 'force_block',
        blocker: parseObjectSelector(blockerText),
        attacker: parseObjectSelector(String(allAbleBlockTarget[3] || '').trim()),
        duration: 'end_of_turn',
        raw: rawClause,
      });
    }

    const doublePowerUntilEot = clause.match(/^double\s+(.+?)(?:'|â€™)?s\s+power\s+until\s+end\s+of\s+turn$/i);
    if (doublePowerUntilEot) {
      return withMeta({
        kind: 'modify_pt',
        target: parseObjectSelector(String(doublePowerUntilEot[1] || '').trim()),
        power: 0,
        toughness: 0,
        duration: 'end_of_turn',
        raw: rawClause,
      });
    }

    const excessDamageToController = clause.match(/^excess\s+damage\s+is\s+dealt\s+to\s+(.+?)(?:'|â€™)?s\s+controller\s+instead$/i);
    if (excessDamageToController) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(excessDamageToController[1] || '').trim()),
        effectText: ['excess damage is dealt to its controller instead'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const ifPlayerDoesCounter = clause.match(/^if\s+a\s+player\s+does,\s*counter\s+this\s+permanent$/i);
    if (ifPlayerDoesCounter) {
      return withMeta({
        kind: 'counter_spell',
        target: parseObjectSelector('this permanent'),
        raw: rawClause,
      });
    }

    const becomesArtifactCreatureEot = clause.match(/^(it|this\s+permanent)\s+becomes\s+an\s+artifact\s+creature\s+until\s+end\s+of\s+turn$/i);
    if (becomesArtifactCreatureEot) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(becomesArtifactCreatureEot[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['becomes an artifact creature'],
        raw: rawClause,
      });
    }

    const remainsTappedUntapRestriction = clause.match(/^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+its\s+controller(?:'|â€™)?s\s+untap\s+step\s+for\s+as\s+long\s+as\s+(.+?)\s+remains\s+tapped$/i);
    if (remainsTappedUntapRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(remainsTappedUntapRestriction[1] || '').trim()),
        effectText: [`doesn't untap while ${String(remainsTappedUntapRestriction[2] || '').trim()} remains tapped`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const staticUntapLock = clause.match(/^(.+?)\s+do(?:es)?(?:n't|\s+not)\s+untap\s+during\s+their\s+controllers?(?:'|â€™)?\s+untap\s+steps$/i);
    if (staticUntapLock) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(staticUntapLock[1] || '').trim()),
        effectText: ["don't untap during their controllers' untap steps"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const handsRevealed = clause.match(/^(.+?)\s+play\s+with\s+their\s+hands\s+revealed$/i);
    if (handsRevealed) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(handsRevealed[1] || '').trim()),
        effectText: ['play with their hands revealed'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const areTokens = clause.match(/^(.+?)\s+are\s+tokens$/i);
    if (areTokens) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(areTokens[1] || '').trim()),
        effectText: ['are tokens'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const cantPlayLandsThisTurn = clause.match(/^(.+?)\s+can(?:not|(?:'|â€™)t)\s+play\s+lands\s+this\s+turn$/i);
    if (cantPlayLandsThisTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(cantPlayLandsThisTurn[1] || '').trim()),
        duration: 'this_turn',
        effectText: ["can't play lands this turn"],
        raw: rawClause,
      });
    }

    const nextTurnInstantSorceryLock = clause.match(
      /^(.+?)\s+can(?:not|(?:'|â€™)t)\s+cast\s+instant\s+or\s+sorcery\s+spells\s+during\s+that\s+player(?:'|â€™)?s\s+next\s+turn$/i
    );
    if (nextTurnInstantSorceryLock) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(nextTurnInstantSorceryLock[1] || '').trim()),
        duration: 'until_next_turn',
        effectText: ["can't cast instant or sorcery spells during that player's next turn"],
        raw: rawClause,
      });
    }

    const noMaxHandSize = clause.match(/^(.+?)\s+ha(?:ve|s)\s+no\s+maximum\s+hand\s+size(?:\s+for\s+the\s+rest\s+of\s+the\s+game)?$/i);
    if (noMaxHandSize) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(noMaxHandSize[1] || '').trim()),
        effectText: ['have no maximum hand size'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const doublePowerToughness = clause.match(/^double\s+(.+?)(?:'|â€™)?s\s+power\s+and\s+toughness\s+until\s+end\s+of\s+turn$/i);
    if (doublePowerToughness) {
      return withMeta({
        kind: 'modify_pt',
        target: parseObjectSelector(String(doublePowerToughness[1] || '').trim()),
        power: 0,
        toughness: 0,
        duration: 'end_of_turn',
        raw: rawClause,
      });
    }

    if (/^you\s+do(?:n't|\s+not)\s+lose\s+the\s+game\s+for\s+having\s+0\s+or\s+less\s+life$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: ["don't lose the game for having 0 or less life"],
        duration: 'static',
        raw: rawClause,
      });
    }

    const castAsThoughFlash = clause.match(/^(?:you\s+may\s+)?cast\s+(.+?)\s+spells\s+as\s+though\s+they\s+had\s+flash$/i);
    if (castAsThoughFlash) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(`you casting ${String(castAsThoughFlash[1] || '').trim()} spells`),
        effectText: ['may cast as though they had flash'],
        duration: 'static',
        raw: rawClause,
      });
    }

    if (/^(?:your\s+opponents|each\s+opponent)\s+can't\s+cast\s+spells\s+during\s+your\s+turn$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('your opponents'),
        effectText: ["can't cast spells during your turn"],
        duration: 'static',
        raw: rawClause,
      });
    }

    if (/^each\s+opponent\s+can\s+cast\s+spells\s+only\s+any\s+time\s+they\s+could\s+cast\s+a\s+sorcery$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('each opponent'),
        effectText: ['can cast spells only any time they could cast a sorcery'],
        duration: 'static',
        raw: rawClause,
      });
    }

    // Covered earlier with excludedTypes population; keep a late fallback for safety.
    const chooseCreatureTypeOtherThanFallback = clause.match(/^choose\s+a\s+creature\s+type\s+other\s+than\s+(.+)$/i);
    if (chooseCreatureTypeOtherThanFallback) {
      const excludedRaw = String(chooseCreatureTypeOtherThanFallback[1] || '').trim();
      const excludedTypes = excludedRaw
        ? excludedRaw.split(/\s*,\s*|\s+or\s+/i).map((part) => part.trim()).filter(Boolean)
        : [];
      return withMeta({
        kind: 'choose_creature_type',
        ...(excludedTypes.length > 0 ? { excludedTypes } : {}),
        raw: rawClause,
      });
    }

    const chooseAnyNumberTargetCreatures = clause.match(/^choose\s+any\s+number\s+of\s+target\s+creatures$/i);
    if (chooseAnyNumberTargetCreatures) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector('any number of target creatures'),
        optional: true,
        raw: rawClause,
      });
    }

    const noncreatureCostIncrease = clause.match(/^(.+?)\s+costs?\s+(\{[^}]+\})\s+more\s+to\s+cast$/i);
    if (noncreatureCostIncrease) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(noncreatureCostIncrease[1] || '').trim()),
        effectText: [`costs ${String(noncreatureCostIncrease[2] || '').trim()} more to cast`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const losesDefender = clause.match(/^(this\s+creature|it|target\s+creature)\s+loses\s+defender\s+until\s+end\s+of\s+turn$/i);
    if (losesDefender) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(losesDefender[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['loses defender'],
        raw: rawClause,
      });
    }

    const temporaryLoseKeywords = clause.match(/^(.+?)\s+loses?\s+([a-z, ]+)\s+until\s+end\s+of\s+turn$/i);
    if (temporaryLoseKeywords) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(temporaryLoseKeywords[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: [`lose ${String(temporaryLoseKeywords[2] || '').trim()}`],
        raw: rawClause,
      });
    }

    if (/^if\s+you\s+cast\s+a\s+spell\s+this\s+way,\s+pay\s+life\s+equal\s+to\s+its\s+mana\s+value\s+rather\s+than\s+pay\s+its\s+mana\s+cost$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('spell cast this way'),
        effectText: ['pay life equal to its mana value rather than pay its mana cost'],
        duration: 'static',
        raw: rawClause,
      });
    }

    if (/^it\s+creates\s+twice\s+that\s+many\s+of\s+those\s+tokens$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('it'),
        effectText: ['doubles token creation'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const additionalMana = clause.match(/^its\s+controller\s+adds\s+an\s+additional\s+((?:\{[^}]+\})+)$/i);
    if (additionalMana) {
      return withMeta({
        kind: 'add_mana',
        who: { kind: 'target_player' },
        mana: String(additionalMana[1] || '').trim(),
        raw: rawClause,
      });
    }

    if (/^only\s+your\s+opponents\s+may\s+activate\s+this\s+ability$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this ability'),
        effectText: ['only your opponents may activate this ability'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const gainTwiceThatMuchLife = clause.match(/^(.+?)\s+gain(?:s)?\s+twice\s+that\s+much\s+life$/i);
    if (gainTwiceThatMuchLife) {
      return withMeta({
        kind: 'gain_life',
        who: parsePlayerSelector(String(gainTwiceThatMuchLife[1] || '').trim()),
        amount: { kind: 'reference_amount', raw: 'twice that much' },
        raw: rawClause,
      });
    }

    const alternateLandReturnCost = clause.match(/^you\s+may\s+pay\s+(\{[^}]+\})\s+and\s+return\s+(.+?)\s+to\s+its\s+owner(?:'|â€™)?s\s+hand\s+rather\s+than\s+pay\s+this\s+spell(?:'|â€™)?s\s+mana\s+cost$/i);
    if (alternateLandReturnCost) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may pay ${String(alternateLandReturnCost[1] || '').trim()} and return ${String(alternateLandReturnCost[2] || '').trim()} to its owner's hand rather than pay this spell's mana cost`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const alternateTapCost = clause.match(/^if\s+you\s+control\s+a\s+(plains|island|swamp|mountain|forest),\s+you\s+may\s+tap\s+an\s+untapped\s+creature\s+you\s+control\s+rather\s+than\s+pay\s+this\s+spell(?:'|â€™)?s\s+mana\s+cost$/i);
    if (alternateTapCost) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may tap an untapped creature you control rather than pay this spell's mana cost if you control a ${String(alternateTapCost[1] || '').trim().toLowerCase()}`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const flashSurcharge = clause.match(/^(?:you\s+may\s+)?cast\s+this\s+spell\s+as\s+though\s+it\s+had\s+flash\s+if\s+you\s+pay\s+(.+?)\s+more\s+to\s+cast\s+it$/i);
    if (flashSurcharge) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may cast this spell as though it had flash if you pay ${String(flashSurcharge[1] || '').trim()} more to cast it`],
        duration: 'static',
        raw: rawClause,
        });
    }

    if (/^(?:you\s+may\s+)?have\s+this\s+creature\s+assign\s+its\s+combat\s+damage\s+as\s+though\s+it\s+weren(?:'|â€™)?t\s+blocked$/i.test(clause)) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('this creature'),
        duration: 'this_turn',
        effectText: ['assign combat damage as though it were not blocked'],
        raw: rawClause,
        });
    }

    if (
      /^attach to it any number of auras on the battlefield and you may put onto the battlefield attached to it any number of aura cards that could enchant it from your graveyard and\/or hand$/i.test(
        clause
      )
    ) {
      return withMeta({
        kind: 'attach',
        attachment: parseObjectSelector('any number of auras on the battlefield and aura cards from your graveyard and/or hand'),
        to: parseObjectSelector('it'),
        optional: true,
        raw: rawClause,
      });
    }

    const attachToTarget = clause.match(/^attach\s+to\s+(.+)$/i);
    if (attachToTarget) {
      return withMeta({
        kind: 'attach',
        attachment: parseObjectSelector('this permanent'),
        to: parseObjectSelector(String(attachToTarget[1] || '').trim()),
        raw: rawClause,
        });
    }

    const chooseTwoCreatures = clause.match(/^choose\s+(target\s+creature\s+you\s+control\s+and\s+target\s+creature\s+you\s+don(?:'|â€™)?t\s+control)$/i);
    if (chooseTwoCreatures) {
      return withMeta({
        kind: 'choose_target_creature',
        target: parseObjectSelector(String(chooseTwoCreatures[1] || '').trim()),
        raw: rawClause,
        });
    }

    const sourceDamageCantBePrevented = clause.match(/^damage\s+that\s+would\s+be\s+dealt\s+by\s+(.+?)\s+can(?:not|(?:'|â€™)t)\s+be\s+prevented$/i);
    if (sourceDamageCantBePrevented) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(sourceDamageCantBePrevented[1] || '').trim()),
        effectText: ["damage it deals can't be prevented"],
        duration: 'static',
        raw: rawClause,
        });
    }

    if (/^damage\s+can(?:not|'t)\s+be\s+prevented$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('damage'),
        effectText: ["can't be prevented"],
        duration: 'static',
        raw: rawClause,
        });
    }

    const castOnlyRestriction = clause.match(/^cast\s+this\s+spell\s+only\s+during\s+(.+)$/i);
    if (castOnlyRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this spell'),
        effectText: [`cast only during ${String(castOnlyRestriction[1] || '').trim()}`],
        duration: 'static',
        raw: rawClause,
        });
    }

    const spellPerTurnRestriction = clause.match(/^(.+?)\s+can(?:not|(?:'|â€™)t)\s+cast\s+more\s+than\s+one\s+spell\s+each\s+turn$/i);
    if (spellPerTurnRestriction) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(spellPerTurnRestriction[1] || '').trim()),
        effectText: ["can't cast more than one spell each turn"],
        duration: 'static',
        raw: rawClause,
        });
    }

    const alternateCost = clause.match(/^(?:you\s+may\s+)?pay\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)\s+rather\s+than\s+pay\s+this\s+spell(?:'|â€™)?s\s+mana\s+cost$/i);
    if (alternateCost) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('you'),
        effectText: [`may pay ${String(alternateCost[1] || '').replace(/\s+/g, '')} rather than pay this spell's mana cost`],
        duration: 'static',
        raw: rawClause,
        });
    }

    const eachPlayerChooseLands = clause.match(/^each\s+player\s+chooses\s+a\s+number\s+of\s+lands\s+they\s+control\s+equal\s+to\s+the\s+number\s+of\s+lands\s+controlled\s+by\s+the\s+player\s+who\s+controls\s+the\s+fewest$/i);
    if (eachPlayerChooseLands) {
      return withMeta({
        kind: 'player_choice',
        choice: 'number_of_lands',
        raw: rawClause,
      });
    }

    const enchantedLandType = clause.match(/^(enchanted\s+land)\s+is\s+an?\s+(plains|island|swamp|mountain|forest)$/i);
    if (enchantedLandType) {
      const landType = String(enchantedLandType[2] || '').trim().toLowerCase();
      const normalizedLandType = (landType.charAt(0).toUpperCase() + landType.slice(1)) as 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest';
      return withMeta({
        kind: 'set_basic_land_type',
        target: parseObjectSelector(String(enchantedLandType[1] || '').trim()),
        landType: normalizedLandType,
        duration: 'static',
        raw: rawClause,
      });
    }

    const payLife = clause.match(/^(?:you\s+may\s+)?pay\s+(\d+)\s+life$/i);
    if (payLife) {
      return withMeta({
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: { kind: 'number', value: Number.parseInt(String(payLife[1] || '0'), 10) || 0 },
        optional: true,
        raw: rawClause,
        });
    }

    const discardUpTo = clause.match(/^discard\s+up\s+to\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?$/i);
    if (discardUpTo) {
      return withMeta({
        kind: 'discard',
        who: { kind: 'you' },
        amount: parseQuantity(String(discardUpTo[1] || '').trim()),
        optional: true,
        raw: rawClause,
        });
    }

    if (/^(?:your\s+opponents|each\s+opponent)\s+can(?:not|'t)\s+gain\s+life$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('your opponents'),
        effectText: ["can't gain life"],
        duration: 'static',
        raw: rawClause,
        });
    }

    const chosenColorProtection = clause.match(/^(enchanted\s+creature)\s+has\s+protection\s+from\s+the\s+chosen\s+color$/i);
    if (chosenColorProtection) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(chosenColorProtection[1] || '').trim()),
        effectText: ['protection from the chosen color'],
        duration: 'while_attached',
        raw: rawClause,
        });
    }

    if (/^if\s+you\s+(?:don(?:'|â€™)?t|can(?:'|â€™)?t),\s*you\s+lose\s+the\s+game$/i.test(clause)) {
      return withMeta({
        kind: 'lose_game',
        raw: rawClause,
        });
    }
  return null;
}
