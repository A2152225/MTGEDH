import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

describe('round 58 final sweep', () => {
  it('Arcee, Paradox, Deep Gnome, Volo, Thought Prison, Circle', () => {
    expect(cond('Whenever you cast a spell that targets one or more creatures or Vehicles you control, put counters on it.')?.targets).toBe('creature_or_vehicle_you_control');
    const arcee = cond('Whenever you cast a spell that targets one or more creatures or Vehicles you control, put counters on it.');
    expect(triggerConditionMatches(arcee, { id: 'sp', controllerId: 'p1', typeLine: 'Instant', anyObject: true } as any, src(), {
      targetPermanents: [{ typeLine: 'Artifact — Vehicle', controllerId: 'p1' }],
    } as any)).toBe(true);
    expect(triggerConditionMatches(arcee, { id: 'sp', controllerId: 'p1', typeLine: 'Instant', anyObject: true } as any, src(), {
      targetPermanents: [{ typeLine: 'Land', controllerId: 'p1' }],
    } as any)).toBe(false);

    expect(cond("At the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep.")?.upkeepOrdinal).toBe('first');
    expect(cond("Whenever one or more lands enter under an opponent's control without being played, search.")?.withoutBeingPlayed).toBe(true);
    expect(cond("Whenever you cast a creature spell that doesn't share a creature type with a creature you control or a creature card in your graveyard, copy it.")?.noSharedCreatureTypeWithBattlefieldOrGraveyard).toBe(true);
    const volo = cond("Whenever you cast a creature spell that doesn't share a creature type with a creature you control or a creature card in your graveyard, copy it.");
    expect(triggerConditionMatches(volo, { id: 'sp', controllerId: 'p1', typeLine: 'Creature — Elf', anyObject: true } as any, src(), {
      sharesCreatureTypeWithBattlefield: false, sharesCreatureTypeWithGraveyard: false,
    } as any)).toBe(true);
    expect(triggerConditionMatches(volo, { id: 'sp', controllerId: 'p1', typeLine: 'Creature — Elf', anyObject: true } as any, src(), {
      sharesCreatureTypeWithBattlefield: true, sharesCreatureTypeWithGraveyard: false,
    } as any)).toBe(false);

    const prison = cond('Whenever a player casts a spell that shares a color or mana value with the exiled card, deal 2 damage.');
    expect(prison?.sharesColorOrManaValueWithExiled).toBe(true);
    expect(triggerConditionMatches(prison, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', colors: ['r'], anyObject: true } as any, src(), {
      exiledCardColors: ['r'], spellColors: ['r'], spellManaValue: 3, exiledCardManaValue: 5,
    } as any)).toBe(true);
    expect(triggerConditionMatches(prison, { id: 'sp', controllerId: 'p2', typeLine: 'Instant', colors: ['u'], anyObject: true } as any, src(), {
      exiledCardColors: ['r'], spellColors: ['u'], spellManaValue: 5, exiledCardManaValue: 5,
    } as any)).toBe(true);

    expect(cond('Whenever an opponent casts a Vampire spell with the same name as a card exiled with this enchantment, you gain 2 life.')?.sameNameAsExiledWithSource).toBe(true);
  });

  it('Sacred Ground, Diabolic, Firesong, Skophos, Watcher', () => {
    expect(cond('Whenever a spell or ability an opponent controls causes a land to be put into your graveyard from the battlefield, return it.')?.causedByOpponent).toBe(true);
    expect(cond('When the creature put onto the battlefield with this enchantment dies, exile it.')?.linkedWithSource).toBe(true);
    expect(cond('Whenever a white instant or sorcery spell causes you to gain life, deal 3 damage.')?.lifeGainCausedByWhiteInstantOrSorcery).toBe(true);
    const sk = cond('Whenever another creature becomes the target of an ability of a land you control named Labyrinth of Skophos, fight.', 'Skophos Maze-Warden');
    expect(sk?.abilitySourceNamed).toBe('labyrinth of skophos');
    expect(triggerConditionMatches(sk, { id: 'c2', controllerId: 'p2', typeLine: 'Creature' } as any, src(), {
      abilitySourceName: 'Labyrinth of Skophos', abilitySourceTypeLine: 'Land', targetingControllerId: 'p1', targetingKind: 'ability',
    } as any)).toBe(true);
    const watcher = cond("Whenever you remove a time counter from this card while it's exiled, surveil 1.");
    expect(watcher?.whileExiled).toBe(true);
    expect(watcher?.placedCounter).toBe('time');
    expect(watcher?.legacyRuntimeOnly).toBeFalsy();
  });

  it('Talion, Pure Intentions, Most Dangerous Gamer', () => {
    const talion = cond('Whenever an opponent casts a spell with mana value, power, or toughness equal to the chosen number, draw a card.');
    expect(talion?.chosenManaValue).toBe(true);
    expect(talion?.chosenPowerOrToughness).toBe(true);
    expect(triggerConditionMatches(talion, { id: 'sp', controllerId: 'p2', typeLine: 'Creature', anyObject: true } as any, src(), {
      chosenManaValue: 3, spellManaValue: 2, spellPower: 3, spellToughness: 1,
    } as any)).toBe(true);
    expect(triggerConditionMatches(talion, { id: 'sp', controllerId: 'p2', typeLine: 'Creature', anyObject: true } as any, src(), {
      chosenManaValue: 3, spellManaValue: 2, spellPower: 1, spellToughness: 1,
    } as any)).toBe(false);

    expect(cond('Whenever a spell or ability an opponent controls causes you to discard cards this turn, return them.')?.thisTurn).toBe(true);
    expect(cond('Whenever you claim the prize of an Attraction, destroy target permanent.')?.action).toBe('claim_attraction_prize');
  });

  it('Strionic reminder stubs do not parse as real trigger clauses', () => {
    // These fragments are reminder text, not oracle triggers; parsers should leave them null.
    expect(parseTriggerClause('when,')).toBeNull();
    expect(parseTriggerClause('whenever,')).toBeNull();
    expect(parseTriggerClause('at.')).toBeNull();
  });
});
