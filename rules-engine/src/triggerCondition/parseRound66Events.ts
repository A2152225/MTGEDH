/**
 * Round 66 leftover trigger promotions.
 * Origin parent: parseRound65Events.ts parseRound65TriggerSentence (final null).
 * Public: parseRound66TriggerSentence.
 *
 * Rewrites census leftovers onto sentences the older parser already accepts,
 * then stamps filters the matcher already enforces.
 */
import {
  type Parsed65 as Parsed,
  withFields65 as withFields,
  stampSubject65 as stampSubject,
  combineDual65 as combineDual,
  compose65,
  emptySubject65,
} from './parseRound65Helpers.js';
import { parseRound67TriggerSentence } from './parseRound67Events.js';

type Reparse = (sentence: string) => Parsed | null;

function creatureType(subtype: string): Record<string, unknown> {
  return {
    typeGroups: [['creature']],
    subtypeGroups: [[subtype]],
    groups: [{ types: ['creature'], subtypes: [subtype] }],
  };
}

function thisWay(base: Parsed | null): Parsed | null {
  return withFields(base, { delayedRider: true, thisWay: true });
}

/** Keyword reminders quote another trigger ("(Whenever it attacks, ...)"). Drop those so the cast clause still parses. */
function scrubNestedTrigger(effect: string): string {
  return effect
    .replace(/\([^)]*\b(?:whenever|when)\b[^)]*\)/gi, ' ')
    .replace(/\([^)]*\b(?:whenever|when)\b[^)]*$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRound66TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const landOpp = /^(whenever|when) a land enters under an opponent's control,\s*(.+)$/.exec(text);
  if (landOpp) return reparse('whenever a land an opponent controls enters, ' + landOpp[2]);

  const instantOrSorcery = /^(whenever|when) you cast an instant or sorcery spell,\s*(.+)$/.exec(text);
  if (instantOrSorcery) {
    const effect = scrubNestedTrigger(instantOrSorcery[2]) || instantOrSorcery[2];
    return combineDual(
      reparse('whenever you cast an instant spell, ' + effect),
      reparse('whenever you cast a sorcery spell, ' + effect),
    );
  }

  const nonToy = /^(whenever|when) one or more non-toy creatures you control attack a player,\s*(.+)$/.exec(text);
  if (nonToy) {
    return stampSubject(
      reparse('whenever one or more creatures you control attack a player, ' + nonToy[2]),
      {
        typeGroups: [['creature']],
        subtypeGroups: [],
        groups: [{ types: ['creature'], subtypes: [] }],
        excludedWords: ['toy'],
      },
    );
  }

  const blocksColor = /^(whenever|when) a creature blocks a (black or red|red or black) creature,\s*(.+)$/.exec(text);
  if (blocksColor) {
    return withFields(reparse('whenever a creature blocks, ' + blocksColor[3]), {
      blockPartner: {
        ...emptySubject65,
        anyObject: false,
        typeGroups: [['creature']],
        groups: [{ types: ['creature'], subtypes: [] }],
        colors: ['b', 'r'],
      },
    });
  }

  const desert = /^(whenever|when) you sacrifice a desert and whenever a desert card is put into your graveyard from your hand or library,\s*(.+)$/.exec(text);
  if (desert) {
    const gy = withFields(
      reparse('whenever a desert card is put into your graveyard from your hand, ' + desert[2]),
      { fromZone: 'hand_or_library' },
    );
    return combineDual(reparse('whenever you sacrifice a desert, ' + desert[2]), gy);
  }

  const etbLose = /^(when|whenever) this enchantment enters and whenever an opponent loses the game,\s*(.+)$/.exec(text);
  if (etbLose) {
    return combineDual(
      reparse('whenever this enchantment enters, ' + etbLose[2]),
      withFields(reparse('whenever a player loses the game, ' + etbLose[2]), { losesGame: 'not_you' }),
    );
  }

  const heroes = /^(whenever|when) one or more heroes you control deal damage to a player,\s*(.+)$/.exec(text);
  if (heroes) {
    return withFields(
      stampSubject(
        reparse('whenever a creature you control deals damage to a player, ' + heroes[2]),
        creatureType('hero'),
      ),
      { quantity: 'one_or_more' },
    );
  }

  const removeCounter = /^(whenever|when) you remove a counter this way,\s*(.+)$/.exec(text);
  if (removeCounter) return thisWay(reparse('whenever a counter is removed from this permanent, ' + removeCounter[2]));

  const putCreature = /^(whenever|when) you put a creature card onto the battlefield this way,\s*(.+)$/.exec(text);
  if (putCreature) return thisWay(reparse('whenever a creature enters under your control, ' + putCreature[2]));

  const exileNonland = /^(whenever|when) one or more nonland cards are exiled this way,\s*(.+)$/.exec(text);
  if (exileNonland) {
    return thisWay(stampSubject(
      reparse('whenever one or more cards are exiled, ' + exileNonland[2]),
      { excludedWords: ['land'] },
    ));
  }

  const excess = /^(whenever|when) excess damage is dealt to the creature an opponent controls this way,\s*(.+)$/.exec(text);
  if (excess) {
    const base = reparse('whenever a creature an opponent controls is dealt damage, ' + excess[2])
      || reparse('whenever a creature is dealt damage, ' + excess[2]);
    return withFields(base, { delayedRider: true, thisWay: true, requiresExcess: true });
  }

  const equipAttach = /^(whenever|when) one or more equipment become attached to that creature this way,\s*(.+)$/.exec(text);
  if (equipAttach) {
    return compose65('becomes_attached', equipAttach[2], {
      delayedRider: true,
      thisWay: true,
      quantity: 'one_or_more',
    }, {
      typeGroups: [['artifact']],
      subtypeGroups: [['equipment']],
      groups: [{ types: ['artifact'], subtypes: ['equipment'] }],
    });
  }

  const putEquip = /^(whenever|when) you put one or more equipment onto the battlefield this way,\s*(.+)$/.exec(text);
  if (putEquip) {
    return compose65('enters', putEquip[2], {
      delayedRider: true,
      thisWay: true,
      quantity: 'one_or_more',
      controller: 'you',
    }, {
      typeGroups: [['artifact']],
      subtypeGroups: [['equipment']],
      groups: [{ types: ['artifact'], subtypes: ['equipment'] }],
    });
  }

  const noSuchCounters = /^(whenever|when) you control no permanents with ([a-z]+) counters on them,\s*(.+)$/.exec(text);
  if (noSuchCounters) {
    return compose65('controls_none', noSuchCounters[3], { controller: 'you' }, {
      anyObject: true,
      counters: [{ name: noSuchCounters[2], minimum: 1 }],
    });
  }

  const eerieRoom = /^(whenever|when) this creature or another enchantment you control enters and whenever you fully unlock a room,\s*(.+)$/.exec(text);
  if (eerieRoom) {
    return combineDual(
      reparse('whenever this creature or another enchantment you control enters, ' + eerieRoom[2]),
      compose65('room_fully_unlocked', eerieRoom[2], { controller: 'you' }),
    );
  }

  const abilityWordEtb = /^(whenever|when) another creature you control enters and whenever you activate a ([a-z-]+) ability,\s*(.+)$/.exec(text);
  if (abilityWordEtb) {
    return combineDual(
      withFields(reparse('whenever you activate an ability, ' + abilityWordEtb[3]), { abilityWord: abilityWordEtb[2] }),
      reparse('whenever another creature you control enters, ' + abilityWordEtb[3]),
    );
  }

  const doomMv = /^(whenever|when) you cast a spell with mana value equal to the number of ([a-z]+) counters on this (?:enchantment|permanent|creature),\s*(.+)$/.exec(text);
  if (doomMv) {
    return withFields(reparse('whenever you cast a spell, ' + doomMv[3]), { manaValueEqualsSourceCounter: doomMv[2] });
  }

  const teamworkCast = /^(whenever|when) you cast a spell using teamwork,\s*(.+)$/.exec(text);
  if (teamworkCast) {
    return withFields(reparse('whenever you cast a spell, ' + teamworkCast[2]), { teamworkCast: true });
  }

  const tenuous = /^(when|whenever) you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control,\s*(.+)$/.exec(text);
  if (tenuous) {
    const you = withFields(reparse('whenever one or more creatures you control attack, ' + tenuous[2]), {
      attackedPlayer: 'enchanted',
      quantity: 'one_or_more',
    });
    const they = withFields(reparse('whenever a creature attacks, ' + tenuous[2]), {
      attackedPlayer: 'you',
      quantity: 'one_or_more',
    });
    if (you && they) {
      return withFields(you, {
        pairedEvent: 'attacks',
        pairedCondition: {
          ...they.condition,
          alternatives: they.condition.alternatives.map((alt) => ({ ...alt, controller: 'enchanted_player' as const })),
        },
      });
    }
  }

  const artifactTap = /^(whenever|when) (an artifact(?: an opponent controls)?|enchanted artifact) becomes tapped or (?:an opponent|a player) activates (?:an artifact's ability|an ability of enchanted artifact) without \{t\} in its activation cost,\s*(.+)$/.exec(text);
  if (artifactTap) {
    const subj = artifactTap[2].includes('opponent')
      ? 'an artifact an opponent controls'
      : artifactTap[2] === 'enchanted artifact' ? 'enchanted artifact' : 'an artifact';
    const tap = reparse('whenever ' + subj + ' becomes tapped, ' + artifactTap[3]);
    return combineDual(
      withFields(tap, { event: 'performs', action: 'activate_ability', notTapCost: true }),
      tap,
    );
  }

  const toughnessDamage = /^(whenever|when) a source you control deals noncombat damage to a creature equal to that creature's toughness,\s*(.+)$/.exec(text);
  if (toughnessDamage) {
    return compose65('deals_damage', toughnessDamage[2], {
      controller: 'you',
      damageKind: 'noncombat',
      damageRecipient: 'creature',
      damageEqualsRecipientToughness: true,
    });
  }

  const mentor = /^(whenever|when) equipped creature mentors a creature,\s*(.+)$/.exec(text);
  if (mentor) {
    return compose65('performs', mentor[2], { action: 'mentor', source: 'equipped', controller: 'any' }, {
      anyObject: false,
      typeGroups: [['creature']],
      groups: [{ types: ['creature'], subtypes: [] }],
    });
  }

  const spellHitsThis = /^(whenever|when) a spell deals damage to this creature,\s*(.+)$/.exec(text);
  if (spellHitsThis) {
    return compose65('deals_damage', spellHitsThis[2], {
      controller: 'any',
      damageRecipient: 'source',
      damageSourceIsSpell: true,
    });
  }

  const chosenDraw = /^(when|whenever) the chosen player draws a card with the chosen name,\s*(.+)$/.exec(text);
  if (chosenDraw) {
    return withFields(reparse('whenever a player draws a card, ' + chosenDraw[2]), {
      chosenPlayer: true,
      requiresChosenDrawnName: true,
    });
  }

  const noContract = /^(whenever|when) this permanent deals combat damage to a player who doesn't have a ([a-z]+) counter,\s*(.+)$/.exec(text);
  if (noContract) {
    return withFields(reparse('whenever this permanent deals combat damage to a player, ' + noContract[3]), {
      damagedPlayerMissingCounter: noContract[2],
    });
  }

  const scryBottom = /^(whenever|when) you choose to put one or more cards on the bottom of your library while scrying,\s*(.+)$/.exec(text);
  if (scryBottom) {
    return withFields(reparse('whenever you scry, ' + scryBottom[2]), { scryToBottom: true });
  }

  return parseRound67TriggerSentence(text);
}
