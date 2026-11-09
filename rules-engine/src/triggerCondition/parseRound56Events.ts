/**
 * Round 56 trigger wordings: ability-resolves (Tyvar / Gimli Nth), choice-gated
 * (chosen player / name / mana value), reflexive "this way" (Priority Boarding /
 * Inferno power), typed bounce, untap-or-lose-control OR, Dark Depths named-counter
 * state, combat/owner/block-partner gates, and activate-ability stubs.
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound56TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const WORD_N: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twenty: 20,
};

const SELF = '(?:~|this creature|this permanent|this artifact|this enchantment|this token)';

export function parseRound56TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // --- Ability resolves -------------------------------------------------
  const manaAbilityResolves = /^(?:whenever|when)\s+a mana ability of (this creature|this permanent|~) resolves,\s*(.+)$/.exec(text);
  if (manaAbilityResolves) {
    return withFields(reparse('whenever you activate an ability, ' + manaAbilityResolves[2]), {
      action: 'mana_ability_resolve',
      abilityResolves: true,
    } as any);
  }
  const abilityResolvesNth = /^(?:whenever|when)\s+this ability resolves for the (first|second|third|fourth|fifth|\d+)(?:st|nd|rd|th)? time this turn,\s*(.+)$/.exec(text);
  if (abilityResolvesNth) {
    const n = WORD_N[abilityResolvesNth[1]] ?? Number(abilityResolvesNth[1]);
    return withFields(reparse('whenever you activate an ability, ' + abilityResolvesNth[2]), {
      action: 'ability_resolve',
      abilityResolves: true,
      resolveOrdinal: n,
    } as any);
  }

  // --- Choice-gated -----------------------------------------------------
  // Promote off Round-37 legacy stubs (chosen name / chosen number MV).
  const castChosenName = /^(?:whenever|when)\s+(an opponent|a player|you)\s+casts? a spell with the chosen name,\s*(.+)$/.exec(text);
  if (castChosenName) {
    const who = castChosenName[1] === 'you' ? 'you' : castChosenName[1] === 'an opponent' ? 'an opponent' : 'a player';
    return withFields(reparse(`whenever ${who} casts a spell, ` + castChosenName[2]), {
      chosenName: true,
      requiresChosenName: true,
    } as any);
  }
  const castChosenMv = /^(?:whenever|when)\s+(an opponent|a player|you)\s+casts? a spell with mana value equal to the chosen number,\s*(.+)$/.exec(text);
  if (castChosenMv) {
    const who = castChosenMv[1] === 'you' ? 'you' : castChosenMv[1] === 'an opponent' ? 'an opponent' : 'a player';
    return withFields(reparse(`whenever ${who} casts a spell, ` + castChosenMv[2]), {
      chosenManaValue: true,
    } as any);
  }
  const castChosenNameFirst = /^(?:whenever|when)\s+you cast a spell with the chosen name for the first time this turn,\s*(.+)$/.exec(text);
  if (castChosenNameFirst) {
    return withFields(reparse('whenever you cast a spell, ' + castChosenNameFirst[1]), {
      chosenName: true,
      requiresChosenName: true,
      onceEachTurn: true,
      ordinal: 'first',
    } as any);
  }
  const chosenPlayerCasts = /^(?:whenever|when)\s+the chosen player casts? a spell,\s*(.+)$/.exec(text);
  if (chosenPlayerCasts) {
    return withFields(reparse('whenever a player casts a spell, ' + chosenPlayerCasts[1]), {
      chosenPlayer: true,
    } as any);
  }
  const damageChosenPlayers = /^(?:whenever|when)\s+damage is dealt to one of the chosen players,\s*(.+)$/.exec(text);
  if (damageChosenPlayers) {
    return withFields(reparse('whenever a player is dealt damage, ' + damageChosenPlayers[1]), {
      chosenPlayer: true,
      playerSubject: true,
    } as any);
  }
  const chosenColorDeals = /^(?:whenever|when)\s+a creature of the chosen color deals damage to (you|you or a white creature you control),\s*(.+)$/.exec(text);
  if (chosenColorDeals) {
    const base = withFields(reparse('whenever a creature deals damage to a player, ' + chosenColorDeals[2]), {
      damageRecipient: 'player',
    } as any);
    if (!base) return null;
    // Stamp chosenColor onto the subject filter.
    const alts = (base.condition.alternatives || []).map((a) => ({
      ...a,
      subject: { ...a.subject, chosenColor: true },
    }));
    return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
  }

  // --- Reflexive "this way" ---------------------------------------------
  const revealMvLess = /^(?:whenever|when)\s+you reveal a card with mana value less than the result this way,\s*(.+)$/.exec(text);
  if (revealMvLess) {
    return withFields(reparse('whenever you cast a spell, ' + revealMvLess[1]), {
      action: 'reveal',
      manaValueLessThanResult: true,
      // Keep as IR stub; runtime still needs roll/reveal context.
    } as any);
  }
  // Force performs via activate reparse so event is IR-emitted.
  const powerBecomes = /^(?:whenever|when)\s+(?:its|this creature'?s?|~'?s?) power becomes (\d+|twenty|[nN]) this way,\s*(.+)$/.exec(text);
  if (powerBecomes) {
    const n = (powerBecomes[1] === 'N' || powerBecomes[1] === 'n') ? 20 : (WORD_N[powerBecomes[1]] ?? Number(powerBecomes[1]));
    if (!Number.isFinite(n)) return null;
    return withFields(reparse('whenever you activate an ability, ' + powerBecomes[2]), {
      action: 'power_becomes',
      powerBecomes: n,
      abilityResolves: true,
    } as any);
  }
  const excessThisWay = /^(?:whenever|when)\s+it deals excess damage this way,\s*(.+)$/.exec(text);
  if (excessThisWay) {
    return withFields(reparse('whenever this creature deals damage, ' + excessThisWay[1]), {
      requiresExcess: true,
    } as any);
  }

  // --- Typed bounce -----------------------------------------------------
  const typedBounce = /^(?:whenever|when)\s+(one or more (?:other )?noncreature permanents(?: you control)?|a noncreature permanent(?: you control)?)\s+(?:is|are) returned to (?:your |its owner's |a player's )?hand(?: from the battlefield)?,\s*(.+)$/.exec(text);
  if (typedBounce) {
    // Reparse a generic permanent bounce (does not rematch this noncreature pattern), then stamp noncreature.
    const base = reparse('whenever a permanent is returned to your hand from the battlefield, ' + typedBounce[2]);
    if (base) {
      const alts = (base.condition.alternatives || []).map((a) => ({
        ...a,
        subject: {
          ...a.subject,
          typeGroups: [['permanent']],
          excludedWords: [...(a.subject?.excludedWords || []), 'creature'],
        },
      }));
      return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
    }
  }

  // --- Untap OR lose control --------------------------------------------
  const untapOrLose = /^(?:whenever|when)\s+(this creature|this permanent|~)\s+becomes? untapped or you lose control of \1,\s*(.+)$/.exec(text);
  if (untapOrLose) {
    return withFields(reparse(`when ${untapOrLose[1]} becomes untapped, ` + untapOrLose[2]), {
      pairedEvent: 'loses_control',
    } as any);
  }

  // --- Dark Depths / named no-counters (also patched in Round 8) --------
  const noNamedCounters = /^(?:whenever|when)\s+(this (?:enchantment|creature|permanent|artifact|land)|~)\s+has no ([a-z][a-z0-9/+-]*) counters on it,\s*(.+)$/.exec(text);
  if (noNamedCounters) {
    return withFields(reparse(`when ${noNamedCounters[1]} has no counters on it, ` + noNamedCounters[3]), {
      noCounters: noNamedCounters[2],
    } as any);
  }

  // --- Combat / damage generics -----------------------------------------
  const damageToOwner = /^(?:whenever|when)\s+a creature deals combat damage to its owner,\s*(.+)$/.exec(text);
  if (damageToOwner) {
    return withFields(reparse('whenever a creature deals combat damage to a player, ' + damageToOwner[1]), {
      damageRecipientOwner: true,
    } as any);
  }
  const blockedLesser = /^(?:whenever|when)\s+a creature becomes blocked by a creature with lesser power,\s*(.+)$/.exec(text);
  if (blockedLesser) {
    return withFields(reparse('whenever a creature becomes blocked, ' + blockedLesser[1]), {
      blockPartnerLesserPower: true,
    } as any);
  }
  const playerOrPermanentTarget = /^(?:whenever|when)\s+a player or permanent becomes the target of (an ability you control|a spell or ability you control|a spell you control),\s*(.+)$/.exec(text);
  if (playerOrPermanentTarget) {
    const kind = /spell/.test(playerOrPermanentTarget[1]) && !/ability/.test(playerOrPermanentTarget[1])
      ? 'a spell you control'
      : /spell or ability/.test(playerOrPermanentTarget[1])
        ? 'a spell or ability you control'
        : 'an ability you control';
    return withFields(reparse(`whenever a permanent becomes the target of ${kind}, ` + playerOrPermanentTarget[2]), {
      orPlayerSubject: true,
    } as any);
  }
  const dealtNOrMoreSelf = /^(?:whenever|when)\s+(this creature|this permanent|this token|~)\s+(?:is )?dealt (\d+) or more damage,\s*(.+)$/.exec(text);
  if (dealtNOrMoreSelf) {
    return withFields(reparse(`whenever ${dealtNOrMoreSelf[1]} is dealt damage, ` + dealtNOrMoreSelf[3]), {
      minDamageAmount: Number(dealtNOrMoreSelf[2]),
    } as any);
  }
  const dealsNOrMoreSelf = /^(?:whenever|when)\s+(this creature|this permanent|this token|~)\s+deals (\d+) or more damage(?: to (an opponent|a player|you))?,?\s*(.+)$/.exec(text);
  if (dealsNOrMoreSelf) {
    const recipient = dealsNOrMoreSelf[3]
      ? (dealsNOrMoreSelf[3] === 'an opponent' ? 'an opponent' : dealsNOrMoreSelf[3] === 'you' ? 'you' : 'a player')
      : null;
    const rebuilt = recipient
      ? `whenever ${dealsNOrMoreSelf[1]} deals damage to ${recipient}, ${dealsNOrMoreSelf[4]}`
      : `whenever ${dealsNOrMoreSelf[1]} deals damage, ${dealsNOrMoreSelf[4]}`;
    return withFields(reparse(rebuilt), {
      minDamageAmount: Number(dealsNOrMoreSelf[2]),
    } as any);
  }
  const noncombatNamed = /^(?:whenever|when)\s+([a-z][a-z0-9' -]{1,40}?)\s+is dealt noncombat damage,\s*(.+)$/.exec(text);
  if (noncombatNamed && !/^(this|another|an|a|each|one|you|enchanted|equipped|your|the|that|its)\b/.test(noncombatNamed[1])) {
    return withFields(reparse('whenever this creature is dealt damage, ' + noncombatNamed[2]), {
      damageKind: 'noncombat',
      requireSubjectName: noncombatNamed[1].trim().toLowerCase(),
    } as any);
  }
  const creaturesBlock = /^(?:whenever|when)\s+one or more creatures block(?: a creature)?,\s*(.+)$/.exec(text);
  if (creaturesBlock) {
    return withFields(reparse('whenever a creature blocks, ' + creaturesBlock[1]), {
      quantity: 'one_or_more',
    } as any);
  }
  const tokenDealsToPw = /^(?:whenever|when)\s+this token deals damage to a planeswalker,\s*(.+)$/.exec(text);
  if (tokenDealsToPw) {
    return withFields(reparse('whenever this creature deals damage, ' + tokenDealsToPw[1]), {
      damageRecipient: 'planeswalker' as any,
    } as any);
  }
  const tokenBlocks = /^(?:whenever|when)\s+this token blocks a creature,\s*(.+)$/.exec(text);
  if (tokenBlocks) {
    return withFields(reparse('whenever this creature blocks a creature, ' + tokenBlocks[1]), {} as any);
  }

  // --- Activate ability stubs -------------------------------------------
  const activateOf = /^(?:whenever|when)\s+you activate an ability of an? (artifact|elemental|creature|enchantment)(?:, if it isn't a mana ability)?,\s*(.+)$/.exec(text);
  if (activateOf) {
    const kind = activateOf[1];
    const action = kind === 'artifact' ? 'activate_artifact'
      : kind === 'elemental' ? 'activate_elemental'
      : kind === 'enchantment' ? 'activate_enchantment'
      : 'activate_creature';
    const base = reparse("whenever you activate an ability that isn't a mana ability, " + activateOf[2]);
    if (!base) return null;
    let condition = { ...base.condition, action } as any;
    if (kind === 'artifact' || kind === 'elemental' || kind === 'enchantment') {
      // Retarget subject type when possible.
      const alts = (condition.alternatives || []).map((a: any) => ({
        ...a,
        subject: {
          ...a.subject,
          typeGroups: kind === 'elemental' ? a.subject?.typeGroups : [[kind]],
          subtypeGroups: kind === 'elemental' ? [['elemental']] : a.subject?.subtypeGroups,
        },
      }));
      condition = { ...condition, alternatives: alts };
    }
    return { ...base, condition };
  }
  const activateNamed = /^(?:whenever|when)\s+you activate (?:an? )?(ninjutsu|eternalize|embalm|eternalize or embalm) ability,\s*(.+)$/.exec(text);
  if (activateNamed) {
    const action = /ninjutsu/.test(activateNamed[1]) ? 'activate_ninjutsu'
      : /eternalize or embalm/.test(activateNamed[1]) ? 'activate_eternalize_or_embalm'
      : /eternalize/.test(activateNamed[1]) ? 'activate_eternalize'
      : 'activate_embalm';
    return withFields(reparse("whenever you activate an ability that isn't a mana ability, " + activateNamed[2]), {
      action,
    } as any);
  }
  const activateAbilitySticker = /^(?:whenever|when)\s+you put an ability sticker on a creature,\s*(.+)$/.exec(text);
  if (activateAbilitySticker) {
    return withFields(reparse('whenever you put an art sticker on a creature, ' + activateAbilitySticker[1]), {
      action: 'place_ability_sticker',
    } as any);
  }

  // --- Copy-trigger stubs (lightweight) ---------------------------------
  const copyTrigger = /^(?:whenever|when)\s+you (?:copy a spell|create a token that'?s a copy of (?:a|target) [^,]+),\s*(.+)$/.exec(text);
  if (copyTrigger) {
    return withFields(reparse('whenever you cast a spell, ' + copyTrigger[1]), {
      action: 'copy',
      spellCopied: true,
    } as any);
  }

  return null;
}
