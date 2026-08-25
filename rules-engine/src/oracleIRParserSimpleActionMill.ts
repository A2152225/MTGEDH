/**
 * Origin parent: oracleIRParserSimpleActionClauses.ts
 * Cluster moved: tryParseSimpleActionClause mill / reveal-until-land / activate-limit clauses
 * Public: tryParseSimpleActionMillClauses
 */

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';
import { buildMillStepFromClauseParts, tryParsePlayerMillClause } from './oracleIRParserQuantityHelpers';
import {
  PLAYER_SUBJECT_PREFIX,
  normalizePossessiveObjectReference,
} from './oracleIRParserSimpleActionHelpers';
import type { SimpleActionClauseParseArgs } from './oracleIRParserSimpleActionHelpers';

export function tryParseSimpleActionMillClauses(args: SimpleActionClauseParseArgs): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
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
        amount: { kind: 'reveal_until_land' },
        raw: rawClause,
        });
    }

    const enchantedPlayerMill = tryParsePlayerMillClause({ clause, rawClause, withMeta });
    if (enchantedPlayerMill) return enchantedPlayerMill;

    const tapMillACard = clause.match(/^\{T\}(?::|,)?\s*mill\s+(?:a|one)\s+card\.?$/i);
    if (tapMillACard) {
      return buildMillStepFromClauseParts({
        who: { kind: 'you' },
        quantityTail: 'one card',
        rawClause,
        withMeta,
      });
    }

    const anyTargetsMill = clause.match(
      /^any\s+number\s+of\s+target\s+players\s+each\s+mills?\s+(.+)$/i
    );
    if (anyTargetsMill) {
      return buildMillStepFromClauseParts({
        who: { kind: 'any_number_of_target_players' },
        quantityTail: String(anyTargetsMill[1] || '').trim(),
        rawClause,
        withMeta,
      });
    }

    const mill = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}mills?\\s+(.+)$`, 'i')
    );
    if (mill && !/\.\s+\S/.test(String(mill[2] || ''))) {
      return buildMillStepFromClauseParts({
        who: parsePlayerSelector(mill[1]),
        quantityTail: String(mill[2] || '').trim(),
        rawClause,
        withMeta,
      });
    }

    const putsTopIntoGraveyard = clause.match(
      /^target\s+player\s+puts\s+the\s+top\s+(.+?)\s+of\s+their\s+library\s+into\s+their\s+graveyard$/i
    );
    if (putsTopIntoGraveyard) {
      return buildMillStepFromClauseParts({
        who: { kind: 'target_player' },
        quantityTail: String(putsTopIntoGraveyard[1] || '').trim(),
        rawClause,
        withMeta,
      });
    }

    const optionalYouMill = clause.match(/^you\s+may\s+mill\s+(.+)$/i);
    if (optionalYouMill && !/\.\s+\S/.test(String(optionalYouMill[1] || ''))) {
      return buildMillStepFromClauseParts({
        who: { kind: 'you' },
        quantityTail: String(optionalYouMill[1] || '').trim(),
        rawClause,
        withMeta,
        optional: true,
      });
    }

    const millDefault = clause.match(/^mills?\s+(.+)$/i);
    if (millDefault && !/\.\s+\S/.test(String(millDefault[1] || ''))) {
      return buildMillStepFromClauseParts({
        who: { kind: 'you' },
        quantityTail: String(millDefault[1] || '').trim(),
        rawClause,
        withMeta,
      });
    }
  }

  {
    const goad = clause.match(/^(?:for\s+each\s+opponent,\s+)?goad\s+(.+)$/i);
    if (goad) {
      return withMeta({
        kind: 'goad',
        target: parseObjectSelector(goad[1]),
        raw: rawClause,
        });
    }
  }

  {
    const detain = clause.match(/^detain\s+(.+)$/i);
    if (detain) {
      return withMeta({
        kind: 'detain',
        target: parseObjectSelector(detain[1]),
        raw: rawClause,
        });
    }
  }

  {
    const losesAbilitiesCantAttack = clause.match(/^(.+?)\s+loses all abilities and can(?:'|\u2019)?t attack(?:\s+this\s+turn)?$/i);
    if (losesAbilitiesCantAttack) {
      return withMeta({
        kind: 'cant_attack',
        target: parseObjectSelector(String(losesAbilitiesCantAttack[1] || '').trim()),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
      });
    }

    const prefixCantAttackOrBlockUntilNextTurn = clause.match(
      /^until your next turn,\s*(.+?)\s+can(?:'|\u2019)?t attack or block$/i,
    );
    if (prefixCantAttackOrBlockUntilNextTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(prefixCantAttackOrBlockUntilNextTurn[1] || '').trim()),
        duration: 'until_next_turn',
        effectText: ["can't attack or block"],
        raw: rawClause,
      });
    }

    const suffixCantAttackOrBlockUntilNextTurn = clause.match(
      /^(.+?)\s+can(?:'|\u2019)?t attack or block until your next turn$/i,
    );
    if (suffixCantAttackOrBlockUntilNextTurn) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(suffixCantAttackOrBlockUntilNextTurn[1] || '').trim()),
        duration: 'until_next_turn',
        effectText: ["can't attack or block"],
        raw: rawClause,
      });
    }

    const cantAttack = clause.match(/^(.+?)\s+can(?:'|\u2019)?t attack(?:\s+this\s+turn)?$/i);
    if (cantAttack) {
      return withMeta({
        kind: 'cant_attack',
        target: parseObjectSelector(cantAttack[1]),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  {
    const losesAbilitiesCantBlock = clause.match(/^(.+?)\s+loses all abilities and can(?:'|\u2019)?t block(?:\s+this\s+turn)?$/i);
    if (losesAbilitiesCantBlock) {
      return withMeta({
        kind: 'cant_block',
        target: parseObjectSelector(String(losesAbilitiesCantBlock[1] || '').trim()),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
      });
    }

    const cantBlock = clause.match(/^(.+?)\s+can(?:'|\u2019)?t block(?:\s+this\s+turn)?$/i);
    if (cantBlock) {
      return withMeta({
        kind: 'cant_block',
        target: parseObjectSelector(cantBlock[1]),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  {
    const compoundCantActivateUntap = clause.match(
      /^(.+?)\s+does(?:n't|\s+not)\s+untap\s+during\s+its\s+controller(?:'|\u2019)?s\s+untap\s+step\s+and\s+its\s+activated\s+abilities\s+can(?:'|\u2019)?t\s+be\s+activated$/i
    );
    if (compoundCantActivateUntap) {
      return withMeta({
        kind: 'cant_activate_abilities',
        target: parseObjectSelector(normalizePossessiveObjectReference(compoundCantActivateUntap[1])),
        duration: 'static',
        raw: rawClause,
      });
    }

    const cantActivateAbilities = clause.match(/^(.+?)\s+activated abilities\s+can't\s+be\s+activated(?:\s+this\s+turn)?$/i);
    if (cantActivateAbilities) {
      return withMeta({
        kind: 'cant_activate_abilities',
        target: parseObjectSelector(normalizePossessiveObjectReference(cantActivateAbilities[1])),
        duration: /\bthis\s+turn$/i.test(clause) ? 'end_of_turn' : 'static',
        raw: rawClause,
        });
    }
  }

  {
    const mustBeBlocked = clause.match(/^(.+?)\s+must\s+be\s+blocked\s+if\s+able$/i);
    if (mustBeBlocked) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(mustBeBlocked[1] || '').trim()),
        effectText: ['must be blocked if able'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const attacksIfAble = clause.match(/^(.+?)\s+attacks(?:\s+(.+?))?\s+this\s+turn\s+if\s+able$/i);
    if (attacksIfAble) {
      const attackTarget = String(attacksIfAble[2] || '').trim();
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(attacksIfAble[1] || '').trim()),
        duration: 'this_turn',
        effectText: [attackTarget ? `attacks ${attackTarget} this turn if able` : 'attacks this turn if able'],
        raw: rawClause,
        });
    }

    const attacksNextCombat = clause.match(/^(.+?)\s+attacks\s+during\s+its\s+controller(?:'|â€™)?s\s+next\s+combat\s+phase\s+if\s+able$/i);
    if (attacksNextCombat) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(attacksNextCombat[1] || '').trim()),
        duration: 'until_next_turn',
        effectText: ["attacks during its controller's next combat phase if able"],
        raw: rawClause,
      });
    }

    const cantBlockThis = clause.match(/^(.+?)\s+can(?:not|'t)\s+block\s+(.+?)\s+this\s+turn$/i);
    if (cantBlockThis) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(cantBlockThis[1] || '').trim()),
        duration: 'this_turn',
        effectText: [`can't block ${String(cantBlockThis[2] || '').trim()}`],
        raw: rawClause,
        });
    }

    const assignsToughnessDamage = clause.match(/^each\s+creature\s+you\s+control\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power$/i);
    if (assignsToughnessDamage) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('each creature you control'),
        effectText: ['assigns combat damage equal to its toughness rather than its power'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const toughnessGreaterDamage = clause.match(/^each\s+creature\s+you\s+control\s+with\s+toughness\s+greater\s+than\s+its\s+power\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power$/i);
    if (toughnessGreaterDamage) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('each creature you control with toughness greater than its power'),
        effectText: ['assigns combat damage equal to its toughness rather than its power'],
        duration: 'static',
        raw: rawClause,
      });
    }

    const enchantedNoUntap = clause.match(/^(enchanted\s+(?:permanent|creature|artifact|land))\s+does(?:n't|\s+not)\s+untap\s+during\s+its\s+controller(?:'|â€™)?s\s+untap\s+step$/i);
    if (enchantedNoUntap) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(enchantedNoUntap[1] || '').trim()),
        effectText: ["doesn't untap during its controller's untap step"],
        duration: 'while_attached',
        raw: rawClause,
        });
    }

    const gainsSuspend = clause.match(/^if\s+it\s+does(?:n't|\s+not)\s+have\s+suspend,\s*it\s+gains\s+suspend$/i);
    if (gainsSuspend) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('it'),
        abilities: ['suspend'],
        effectText: ['if it does not have suspend, it gains suspend'],
        duration: 'static',
        raw: rawClause,
        });
    }

    const doubleDamage = clause.match(/^it\s+deals\s+double\s+that\s+damage$/i);
    if (doubleDamage) {
      return withMeta({
        kind: 'modify_damage',
        mode: 'add',
        amount: { kind: 'reference_amount', raw: 'that damage' },
        damageFilter: 'any',
        raw: rawClause,
        });
    }

    const doubleDamageToTarget = clause.match(/^it\s+deals\s+double\s+that\s+damage\s+to\s+(.+)$/i);
    if (doubleDamageToTarget) {
      return withMeta({
        kind: 'modify_damage',
        mode: 'add',
        amount: { kind: 'reference_amount', raw: 'that damage' },
        damageFilter: 'any',
        targetFilter: String(doubleDamageToTarget[1] || '').trim(),
        raw: rawClause,
      });
    }

    if (/^the\s+same\s+is\s+true\s+for\s+creature\s+spells\s+you\s+control\s+and\s+creature\s+cards\s+you\s+own\s+that\s+aren't\s+on\s+the\s+battlefield$/i.test(clause)) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('creature spells you control and creature cards you own that are not on the battlefield'),
        effectText: ['the same is true'],
        duration: 'static',
        raw: rawClause,
        });
    }
  }

  {
    const activateLimit = clause.match(/^activate\s+no\s+more\s+than\s+(.+?)\s+each\s+turn$/i);
    if (activateLimit) {
      return withMeta({
        kind: 'grant_static_ability',
        target: parseObjectSelector('this ability'),
        effectText: [`activate no more than ${String(activateLimit[1] || '').trim()} each turn`],
        duration: 'static',
        raw: rawClause,
      });
    }

    const activatedAbilitiesCantBeActivated = clause.match(/^activated\s+abilities\s+of\s+(.+?)\s+can(?:'|â€™)?t\s+be\s+activated\s+unless\s+they(?:'|â€™)?re\s+mana\s+abilities$/i);
    if (activatedAbilitiesCantBeActivated) {
      return withMeta({
        kind: 'cant_activate_abilities',
        target: parseObjectSelector(String(activatedAbilitiesCantBeActivated[1] || '').trim()),
        duration: 'static',
        raw: rawClause,
      });
    }
  }
  return null;
}
