/**
 * Round 63 / legacy-r6: promote leftover death, combat-damage, ETB, attack,
 * spell-cast, special_runtime, and abilityActivated families. Rolls, dilemmas,
 * explores, connives, opponent-caused self-discard, and crew/saddle parse as
 * real IR (not legacyRuntimeOnly) so their existing emitters can fire once.
 * Origin parent: parseRound62Events.ts parseRound62TriggerSentence.
 * Public: parseRound63TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';
import { parseRound64TriggerSentence } from './parseRound64Events.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

const EMPTY_SUBJECT = {
  anyObject: true,
  typeGroups: [] as readonly (readonly string[])[],
  subtypeGroups: [] as readonly (readonly string[])[],
  groups: [] as readonly { types: readonly string[]; subtypes: readonly string[] }[],
  excludedWords: [] as readonly string[],
  supertypes: [] as readonly string[],
  keywordsWith: [] as readonly string[],
  keywordsWithout: [] as readonly string[],
  token: 'any' as const,
};

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

function stampSubject(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({
    ...a,
    subject: { ...a.subject, ...fields },
  }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

function combineDual(left: Parsed | null, right: Parsed | null): Parsed | null {
  if (!left || !right) return null;
  if (left.condition.event === right.condition.event) {
    return withFields(left, {
      alternatives: [...(left.condition.alternatives || []), ...(right.condition.alternatives || [])],
    });
  }
  return withFields(left, {
    pairedEvent: right.condition.event,
    pairedCondition: right.condition,
  } as any);
}

function youPerform(action: string, effect: string, fields: Record<string, unknown> = {}): Parsed {
  return {
    condition: {
      event: 'performs',
      action,
      quantity: 'one',
      alternatives: [{ controller: 'you', source: 'any', subject: { ...EMPTY_SUBJECT } }],
      ...fields,
    } as TriggerConditionIR,
    effect,
  };
}

export function parseRound63TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const rollOr = /^(whenever|when) you roll (?:a |an )?(\d+) or (\d+),\s*(.+)$/.exec(text);
  if (rollOr) return youPerform('roll_die', rollOr[4], { rollValues: [Number(rollOr[2]), Number(rollOr[3])] });

  const rollHigher = /^(whenever|when) you roll (?:a |an )?(\d+) or higher(?: on a die)?,\s*(.+)$/.exec(text);
  if (rollHigher) return youPerform('roll_die', rollHigher[3], { minRoll: Number(rollHigher[2]) });

  const rollHighest = /^(whenever|when) you roll a die's highest natural result,\s*(.+)$/.exec(text);
  if (rollHighest) return youPerform('roll_die', rollHighest[2], { highestNatural: true });

  const rollThird = /^(whenever|when) you roll your third die each turn,\s*(.+)$/.exec(text);
  if (rollThird) return youPerform('roll_die', rollThird[2], { resolveOrdinal: 3 });

  const rollNatural = /^(whenever|when) you roll a natural (\d+),\s*(.+)$/.exec(text);
  if (rollNatural) return youPerform('roll_die', rollNatural[3], { naturalRoll: Number(rollNatural[2]) });

  const rollN = /^(whenever|when) you roll (?:a |an )?(\d+),\s*(.+)$/.exec(text);
  if (rollN) return youPerform('roll_die', rollN[3], { naturalRoll: Number(rollN[2]) });

  const dilemma = /^(whenever|when) you face a dilemma,\s*(.+)$/.exec(text);
  if (dilemma) return youPerform('face_dilemma', dilemma[2]);

  const oppDiscard = /^(whenever|when) a spell or ability an opponent controls causes you to discard this card,\s*(.+)$/.exec(text);
  if (oppDiscard) {
    return withFields(reparse('whenever you discard a card, ' + oppDiscard[2]), {
      sourceIsDiscarded: true,
      causedByOpponent: true,
    } as any);
  }

  const exploresKind = /^(whenever|when) (a|another) (nontoken )?creature you control explores(?: a (land|nonland) card)?,\s*(.+)$/.exec(text);
  if (exploresKind) {
    const noun = (exploresKind[3] ? 'nontoken ' : '') + 'creature';
    const article = exploresKind[2] === 'another' ? 'another' : 'a';
    return withFields(reparse('whenever ' + article + ' ' + noun + ' you control enters, ' + exploresKind[5]), {
      event: 'performs',
      action: 'explore',
      ...(exploresKind[4] ? { exploredIsLand: exploresKind[4] === 'land' } : {}),
    } as any);
  }

  const connives = /^(whenever|when) (a|another) (nontoken )?creature you control connives,\s*(.+)$/.exec(text);
  if (connives) {
    const noun = (connives[3] ? 'nontoken ' : '') + 'creature';
    const article = connives[2] === 'another' ? 'another' : 'a';
    return withFields(reparse('whenever ' + article + ' ' + noun + ' you control enters, ' + connives[4]), {
      event: 'performs',
      action: 'connive',
    } as any);
  }

  const conniveWay = /^(whenever|when) (?:it|this creature|~) connives this way,\s*(.+)$/.exec(text);
  if (conniveWay) {
    return withFields(reparse('whenever this creature enters, ' + conniveWay[2]), {
      event: 'performs',
      action: 'connive',
      thisWay: true,
      delayedRider: true,
    } as any);
  }

  const crew = /^(whenever|when) (?:this creature|this permanent|~) (saddles a mount or crews a vehicle|crews a vehicle)( during your main phase)?,\s*(.+)$/.exec(text);
  if (crew) {
    const action = crew[2].startsWith('saddles') ? 'saddle_or_crew' : 'crew';
    return withFields(reparse('whenever this creature enters, ' + crew[4]), {
      event: 'performs',
      action,
      ...(crew[3] ? { duringMainPhase: true } : {}),
    } as any);
  }

  const oppActivate = /^(whenever|when) an opponent activates an ability of (?:an? |a )?(permanent|[a-z]+(?:, (?:or )?[a-z]+)*(?: or [a-z]+)?)(?: they control| you control)?(?: on the battlefield)?(?:, if it isn't a mana ability| that isn't a mana ability)?,\s*(.+)$/.exec(text);
  if (oppActivate) {
    const kinds = oppActivate[2].split(/,|\bor\b/).map((k) => k.trim()).filter((k) => k && k !== 'or');
    const base = reparse('whenever a ' + (kinds[0] || 'permanent') + ' an opponent controls enters, ' + oppActivate[3]);
    const stamped = kinds.length > 1
      ? stampSubject(base, {
        typeGroups: kinds.map((k) => [k]),
        groups: kinds.map((k) => ({ types: [k], subtypes: [] })),
      } as any)
      : base;
    const notMana = /isn't a mana ability/.test(text);
    return withFields(stamped, { event: 'performs', action: 'activate_ability', ...(notMana ? { notManaAbility: true } : {}) } as any);
  }

  const payCost = /^(whenever|when) you pay this cost one or more times,\s*(.+)$/.exec(text);
  if (payCost) return youPerform('pay_cost', payCost[2], { thisWay: true, delayedRider: true, quantity: 'one_or_more' });

  const revealWay = /^(whenever|when) you reveal (?:an? )(.+?) this way,\s*(.+)$/.exec(text);
  if (revealWay) {
    return withFields(reparse('whenever you discard a card, ' + revealWay[3]), {
      event: 'performs',
      action: 'reveal',
      thisWay: true,
      delayedRider: true,
    } as any);
  }

  const noOther = /^(whenever|when) you control no other ([a-z]+),\s*(.+)$/.exec(text);
  if (noOther) {
    const singular = noOther[2].replace(/ies$/, 'y').replace(/(?<!s)s$/, '');
    return withFields(reparse('when you control no ' + singular + 's, ' + noOther[3]) || reparse('when you control no ' + noOther[2] + ', ' + noOther[3]), {
      excludeSource: true,
    } as any);
  }

  const gyOrExile = /^(whenever|when) (.+?) (?:is put into a graveyard from the battlefield or is put into exile from the battlefield|dies or is put into exile(?: from the battlefield)?),\s*(.+)$/.exec(text);
  if (gyOrExile) {
    const left = reparse(gyOrExile[1] + ' ' + gyOrExile[2] + ' is put into a graveyard from the battlefield, ' + gyOrExile[3])
      || reparse(gyOrExile[1] + ' ' + gyOrExile[2] + ' dies, ' + gyOrExile[3]);
    const right = reparse(gyOrExile[1] + ' ' + gyOrExile[2] + ' is exiled, ' + gyOrExile[3]);
    const combined = combineDual(left, right);
    if (combined) return withFields(combined, { fromZone: 'battlefield' } as any);
  }

  const gyBfOrElsewhere = /^(whenever|when) (another )?((?:artifact|creature|permanent)s?) (?:is|are) put into your graveyard from the battlefield or an? \3 card is put into your graveyard from anywhere other than the battlefield,\s*(.+)$/.exec(text);
  if (gyBfOrElsewhere) {
    const kind = gyBfOrElsewhere[3].replace(/s$/, '');
    const other = gyBfOrElsewhere[2] ? 'another ' : 'a ';
    const left = reparse(gyBfOrElsewhere[1] + ' ' + other + kind + ' is put into your graveyard from the battlefield, ' + gyBfOrElsewhere[4]);
    const right = withFields(reparse(gyBfOrElsewhere[1] + ' a ' + kind + ' card is put into your graveyard from anywhere, ' + gyBfOrElsewhere[4]), { fromZone: 'not_battlefield' } as any);
    const combined = combineDual(left, right);
    if (combined) return combined;
  }

  const diesOrLibrary = /^(whenever|when) a creature dies or a creature card is put into a graveyard from a library,\s*(.+)$/.exec(text);
  if (diesOrLibrary) {
    return combineDual(
      reparse('whenever a creature dies, ' + diesOrLibrary[2]),
      withFields(reparse('whenever a creature card is put into a graveyard from anywhere, ' + diesOrLibrary[2]), { fromZone: 'library' } as any),
    );
  }

  const diesOrCz = /^(whenever|when) (.+?) dies or is put into the command zone,\s*(.+)$/.exec(text);
  if (diesOrCz) {
    return combineDual(
      reparse(diesOrCz[1] + ' ' + diesOrCz[2] + ' dies, ' + diesOrCz[3]),
      withFields(reparse(diesOrCz[1] + ' ' + diesOrCz[2] + ' leaves the battlefield, ' + diesOrCz[3]), { toZone: 'command' } as any),
    );
  }

  const diesThisWay = /^(whenever|when) (?:a |an )?(creature(?: you control)?|it) (?:dealt damage (?:this way|by [^,]+?) )?dies this turn,\s*(.+)$/.exec(text);
  if (diesThisWay) {
    const who = diesThisWay[1] === 'it' ? 'a creature' : diesThisWay[1];
    return withFields(reparse('whenever ' + who + ' dies, ' + diesThisWay[2]), { thisTurn: true, delayedRider: true, thisWay: true } as any);
  }

  const youAttackWith = /^(whenever|when) you attack (a player|an opponent|enchanted player|the player who has the initiative) with (?:one or more )?(.+?),\s*(.+)$/.exec(text);
  if (youAttackWith) {
    const target = youAttackWith[2];
    const attackedPlayer = target === 'the player who has the initiative' ? 'initiative'
      : target === 'enchanted player' ? 'enchanted'
        : target === 'an opponent' ? 'opponent' : 'any';
    const phrase = youAttackWith[3];
    const hasRel = /\b(?:you control|an opponent controls)\b/.test(phrase);
    const subject = hasRel ? phrase : phrase + ' you control';
    return withFields(reparse('whenever one or more ' + subject + ' attack, ' + youAttackWith[4]), {
      attackedPlayer,
      attackedTargetType: 'player',
      quantity: 'one_or_more',
    } as any);
  }

  const mostLifeSelf = /^(whenever|when) (.+?) attacks while you have the most life or are tied for most life,\s*(.+)$/.exec(text);
  if (mostLifeSelf) {
    return withFields(reparse(mostLifeSelf[1] + ' ' + mostLifeSelf[2] + ' attacks, ' + mostLifeSelf[3]), { sourceMostLife: true } as any);
  }

  const dmgSubtype = /^(whenever|when) (.+?) deals(?: combat)? damage to (?:a |an )?([a-z]+(?: or [a-z]+)?),\s*(.+)$/.exec(text);
  if (dmgSubtype && !/player|opponent|planeswalker|battle|creature|enchantment|artifact|land|you\b|it\b/.test(dmgSubtype[3])) {
    const subtypes = dmgSubtype[3].split(/\s+or\s+/);
    const combat = /deals combat damage/.test(text);
    const base = reparse(dmgSubtype[1] + ' ' + dmgSubtype[2] + (combat ? ' deals combat damage to a creature, ' : ' deals damage to a creature, ') + dmgSubtype[4]);
    if (base) return withFields(base, { damageRecipientSubtypes: subtypes } as any);
  }

  const dmgPlayerOrPw = /^(whenever|when) (.+?) deals combat damage to a player or planeswalker,\s*(.+)$/.exec(text);
  if (dmgPlayerOrPw) {
    return withFields(reparse(dmgPlayerOrPw[1] + ' ' + dmgPlayerOrPw[2] + ' deals combat damage to a player, ' + dmgPlayerOrPw[3]), {
      damageRecipient: 'player_or_planeswalker',
    } as any);
  }

  const dmgOrDies = /^(whenever|when) (.+?) deals combat damage to a player or dies,\s*(.+)$/.exec(text);
  if (dmgOrDies) {
    return combineDual(
      reparse(dmgOrDies[1] + ' ' + dmgOrDies[2] + ' deals combat damage to a player, ' + dmgOrDies[3]),
      reparse(dmgOrDies[1] + ' ' + dmgOrDies[2] + ' dies, ' + dmgOrDies[3]),
    );
  }

  const andOrEnter = /^(whenever|when) (.+?) and\/or one or more other (.+?) enter,\s*(.+)$/.exec(text);
  if (andOrEnter) {
    return withFields(
      combineDual(
        reparse(andOrEnter[1] + ' ' + andOrEnter[2] + ' enters, ' + andOrEnter[4]),
        reparse(andOrEnter[1] + ' another ' + andOrEnter[3] + ' enters, ' + andOrEnter[4]),
      ),
      { quantity: 'one_or_more' } as any,
    );
  }

  const entersOrAttacks = /^(whenever|when) (.+?) enters or attacks,\s*(.+)$/.exec(text);
  if (entersOrAttacks) {
    const who = entersOrAttacks[2]
      .replace(/\byou control of the chosen type\b/g, 'of the chosen type you control')
      .replace(/\ban opponent controls of the chosen type\b/g, 'of the chosen type an opponent controls');
    return combineDual(
      reparse(entersOrAttacks[1] + ' ' + who + ' enters, ' + entersOrAttacks[3]),
      reparse(entersOrAttacks[1] + ' ' + who + ' attacks, ' + entersOrAttacks[3]),
    );
  }

  const chosenTypeSpell = /^(whenever|when) you (cast a creature spell of the chosen type|cast a spell that shares a creature type with this creature),\s*(.+)$/.exec(text);
  if (chosenTypeSpell) {
    const field = chosenTypeSpell[2].includes('chosen type') ? { chosenType: true } : { sharesCreatureTypeWithSource: true };
    return stampSubject(reparse('whenever you cast a creature spell, ' + chosenTypeSpell[3]), field as any);
  }

  return parseRound64TriggerSentence(text, reparse);
}
