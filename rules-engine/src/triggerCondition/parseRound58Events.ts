/**
 * Round 58 final sweep: Arcee dual target, Paradox first upkeep, Deep Gnome unplayed
 * lands, Volo no-shared-type, Thought Prison shares color/MV with exiled, Circle
 * same-name-as-exiled Vampire, Sacred Ground opp-caused land-to-GY, Diabolic linked
 * dies, Firesong white I/S causes lifegain, Skophos named-land ability target,
 * Watcher remove-time-while-exiled (promote), Talion MV|power|toughness chosen,
 * Pure Intentions opp-caused discard this turn, Most Dangerous Gamer claim prize.
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound58TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

function stampSubject(base: Parsed | null, patch: Record<string, unknown>): Parsed | null {
  if (!base) return null;
  const alts = (base.condition.alternatives || []).map((a) => ({
    ...a,
    subject: { ...a.subject, ...patch },
  }));
  return { ...base, condition: { ...base.condition, alternatives: alts } as TriggerConditionIR };
}

export function parseRound58TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  // Arcee: cast spell that targets creatures or Vehicles you control
  const arcee = /^(?:whenever|when)\s+you cast a spell that targets one or more creatures or vehicles you control,\s*(.+)$/.exec(text);
  if (arcee) {
    return withFields(reparse('whenever you cast a spell that targets one or more creatures you control, ' + arcee[1]), {
      targets: 'creature_or_vehicle_you_control',
    } as any);
  }

  // Paradox Haze: enchanted player's first upkeep each turn
  const paradox = /^at the beginning of enchanted player'?s? first upkeep each turn,\s*(.+)$/.exec(text);
  if (paradox) {
    return withFields(reparse("at the beginning of enchanted player's upkeep, " + paradox[1]), {
      upkeepOrdinal: 'first',
      onceEachTurn: true,
    } as any);
  }

  // Deep Gnome: lands enter under opponent's control without being played
  const deepGnome = /^(?:whenever|when)\s+one or more lands enter(?: the battlefield)? under an opponent'?s? control without being played,\s*(.+)$/.exec(text);
  if (deepGnome) {
    return withFields(reparse("whenever a land an opponent controls enters, " + deepGnome[1]), {
      quantity: 'one_or_more',
      withoutBeingPlayed: true,
      onceEachTurn: /do this only once each turn/i.test(text) ? true : undefined,
    } as any);
  }

  // Volo: creature spell that doesn't share a creature type with BF or GY
  const volo = /^(?:whenever|when)\s+you cast a creature spell that doesn'?t share a creature type with a creature you control or a creature card in your graveyard,\s*(.+)$/.exec(text);
  if (volo) {
    return withFields(reparse('whenever you cast a creature spell, ' + volo[1]), {
      noSharedCreatureTypeWithBattlefieldOrGraveyard: true,
    } as any);
  }

  // Thought Prison: shares a color or mana value with the exiled card
  const thoughtPrison = /^(?:whenever|when)\s+a player casts a spell that shares a color or mana value with the exiled card,\s*(.+)$/.exec(text);
  if (thoughtPrison) {
    return withFields(reparse('whenever a player casts a spell, ' + thoughtPrison[1]), {
      sharesColorOrManaValueWithExiled: true,
    } as any);
  }

  // Circle of Confinement: Vampire spell with same name as card exiled with this
  const circle = /^(?:whenever|when)\s+an opponent casts a vampire spell with the same name as a card exiled with (?:this enchantment|this permanent|~),\s*(.+)$/.exec(text);
  if (circle) {
    return stampSubject(
      withFields(reparse('whenever an opponent casts a Vampire spell, ' + circle[1]), {
        sameNameAsExiledWithSource: true,
        exiledWithSource: true,
      } as any),
      {},
    );
  }

  // Sacred Ground: opp spell/ability causes land to your GY from BF
  const sacred = /^(?:whenever|when)\s+a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield,\s*(.+)$/.exec(text);
  if (sacred) {
    return withFields(reparse('whenever a land is put into your graveyard from the battlefield, ' + sacred[1]), {
      causedByOpponent: true,
      fromZone: 'battlefield',
    } as any);
  }

  // Diabolic Servitude: creature put onto BF with this enchantment dies
  const diabolic = /^(?:whenever|when)\s+the creature put onto the battlefield with (?:this enchantment|this permanent|~) dies,\s*(.+)$/.exec(text);
  if (diabolic) {
    return withFields(reparse('whenever a creature dies, ' + diabolic[1]), {
      linkedWithSource: true,
      putOntoBattlefieldWithSource: true,
    } as any);
  }

  // Firesong: white instant or sorcery spell causes you to gain life
  const firesong = /^(?:whenever|when)\s+a white instant or sorcery spell causes you to gain life,\s*(.+)$/.exec(text);
  if (firesong) {
    return withFields(reparse('whenever you gain life, ' + firesong[1]), {
      lifeGainCausedByWhiteInstantOrSorcery: true,
    } as any);
  }

  // Skophos: target of ability of land you control named Labyrinth of Skophos
  // Self-name normalize can rewrite "Skophos" inside the land name to "this permanent".
  const skophos = /^(?:whenever|when)\s+another creature becomes the target of an ability of a land you control named (labyrinth of (?:skophos|this permanent|~)),\s*(.+)$/.exec(text);
  if (skophos) {
    return withFields(reparse('whenever another creature becomes the target of an ability you control, ' + skophos[2]), {
      abilitySourceNamed: 'labyrinth of skophos',
      abilitySourceType: 'land',
    } as any);
  }

  // Watcher of Hours: you remove a time counter from this card while it's exiled
  const watcher = /^(?:whenever|when)\s+you remove a(?:n)? (time|[a-z-]+) counter from (this card|this permanent|~) while it'?s exiled,\s*(.+)$/.exec(text);
  if (watcher) {
    return withFields(reparse('whenever a counter is removed from this permanent, ' + watcher[3]), {
      placedCounter: watcher[1],
      whileExiled: true,
      causedByYou: true,
    } as any);
  }

  // Talion: mana value, power, or toughness equal to the chosen number
  // Inventory family truncates to "with mana value" — match both full and truncated normalized forms.
  const talion = /^(?:whenever|when)\s+an opponent casts a spell with mana value(?:, power, or toughness)? equal to the chosen number,\s*(.+)$/.exec(text)
    || /^(?:whenever|when)\s+an opponent casts a spell with mana value, power, or toughness equal to the chosen number,\s*(.+)$/.exec(text);
  if (talion) {
    return withFields(reparse('whenever an opponent casts a spell, ' + talion[1]), {
      chosenManaValue: true,
      chosenPowerOrToughness: true,
    } as any);
  }
  // Truncated inventory key / partial wording still seen after normalize in some paths
  const talionShort = /^(?:whenever|when)\s+an opponent casts a spell with mana value,\s*(.+)$/.exec(text);
  if (talionShort && /power|toughness|chosen/.test(talionShort[1]) === false) {
    // Only if the effect starts immediately after truncated "mana value," — rare; skip false positives
  }

  // Pure Intentions: opp causes you to discard cards this turn
  const pure = /^(?:whenever|when)\s+a spell or ability an opponent controls causes you to discard cards this turn,\s*(.+)$/.exec(text);
  if (pure) {
    return withFields(reparse('whenever you discard a card, ' + pure[1]), {
      causedByOpponent: true,
      thisTurn: true,
    } as any);
  }

  // Most Dangerous Gamer: claim the prize of an Attraction
  const gamer = /^(?:whenever|when)\s+you claim the prize of an attraction,\s*(.+)$/.exec(text);
  if (gamer) {
    return withFields(reparse('whenever you roll to visit your attractions, ' + gamer[1]), {
      action: 'claim_attraction_prize',
    } as any);
  }

  return null;
}
