import { describe, expect, it } from 'vitest';
import { cardAnalyzer, SynergyArchetype } from '../src/CardAnalyzer';
import { AIStrategy } from '../src/AIEngine';
import { inferAIStrategyFromDeckProfile } from '../src/aiEngineDeckSupport';

describe('inferAIStrategyFromDeckProfile', () => {
  it('returns BASIC when profile is missing', () => {
    expect(inferAIStrategyFromDeckProfile(null)).toBe(AIStrategy.BASIC);
    expect(inferAIStrategyFromDeckProfile(undefined)).toBe(AIStrategy.BASIC);
  });

  it('infers COMBO for combo-heavy decks', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Devoted Druid', type_line: 'Creature', oracle_text: '{T}: Add {G}.' },
      { id: '2', name: 'Vizier of Remedies', type_line: 'Creature', oracle_text: 'If you would untap a permanent, untap it an additional time.' },
      { id: '3', name: 'Demonic Tutor', type_line: 'Sorcery', oracle_text: 'Search your library for a card, put it into your hand, then shuffle.' },
      { id: '4', name: 'Thassa\'s Oracle', type_line: 'Creature', oracle_text: 'When Thassa\'s Oracle enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top and the rest on the bottom in a random order. If X is greater than or equal to the number of cards in your hand, you win the game.' },
    ] as any);

    expect(profile.primaryArchetypes).toContain(SynergyArchetype.COMBO);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.COMBO);
  });

  it('infers DEFENSIVE for aristocrat/token shells', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Zulaport Cutthroat', type_line: 'Creature — Human Rogue Ally', oracle_text: 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.' },
      { id: '2', name: 'Blood Artist', type_line: 'Creature — Vampire', oracle_text: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.' },
      { id: '3', name: 'Viscera Seer', type_line: 'Creature — Vampire Wizard', oracle_text: 'Sacrifice a creature: Scry 1.' },
      { id: '4', name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '' },
      { id: '5', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ] as any);

    expect(profile.primaryArchetypes[0]).toBe(SynergyArchetype.ARISTOCRATS);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.DEFENSIVE);
  });

  it('infers AGGRESSIVE for token/go-wide decks', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Intangible Virtue', type_line: 'Enchantment', oracle_text: 'Creature tokens you control get +1/+1 and have vigilance.' },
      { id: '2', name: 'Adeline, Resplendent Cathar', type_line: 'Legendary Creature — Human Warrior', oracle_text: 'Whenever you attack, for each opponent, create a 1/1 white Human creature token that is tapped and attacking that player or a planeswalker they control.' },
      { id: '3', name: 'Crusader of Odric', type_line: 'Creature — Human Soldier', oracle_text: 'Crusader of Odric\'s power and toughness are each equal to the number of creatures you control.' },
      { id: '4', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ] as any);

    expect(profile.primaryArchetypes).toContain(SynergyArchetype.TOKENS);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.AGGRESSIVE);
  });

  it('infers CONTROL for politics/king-maker shells with pillow fort and swaps', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Howling Mine', type_line: 'Artifact', oracle_text: 'At the beginning of each player\'s draw step, if Howling Mine is untapped, that player draws an additional card.' },
      { id: '2', name: 'Ghostly Prison', type_line: 'Enchantment', oracle_text: 'Creatures can\'t attack you unless their controller pays {2} for each creature they control that\'s attacking you.' },
      { id: '3', name: 'Sphere of Safety', type_line: 'Enchantment', oracle_text: 'Creatures can\'t attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control.' },
      { id: '4', name: 'Reins of Power', type_line: 'Instant', oracle_text: 'Untap all creatures target player controls and all creatures you control. You and that player each gain control of all creatures the other controls until end of turn. Those creatures gain haste until end of turn.' },
      { id: '5', name: 'Reverse the Sands', type_line: 'Sorcery', oracle_text: 'Target player exchanges life totals with another target player.' },
      { id: '6', name: 'Soul Conduit', type_line: 'Artifact', oracle_text: '{T}: You may pay any amount of life. Target player loses that much life.' },
      { id: '7', name: 'Summary Dismissal', type_line: 'Instant', oracle_text: 'Exile all other spells and counter all abilities.' },
      { id: '8', name: 'Swords to Plowshares', type_line: 'Instant', oracle_text: 'Exile target creature. Its controller gains 3 life.' },
    ] as any);

    expect(profile.primaryArchetypes).toContain(SynergyArchetype.POLITICS);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.CONTROL);
  });

  it('infers DEFENSIVE for goad/politics decks rather than voltron beatdown', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Shiny Impetus', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature has goad and trample.' },
      { id: '2', name: 'Vengeful Ancestor', type_line: 'Creature — Spirit Dragon', oracle_text: 'Flying\nWhenever Vengeful Ancestor enters or attacks, goad target creature.' },
      { id: '3', name: 'Grenzo, Havoc Raiser', type_line: 'Legendary Creature — Goblin Rogue', oracle_text: 'Whenever a creature you control deals combat damage to a player, choose goad or card; if goad, goad target creature that player controls.' },
      { id: '4', name: 'Spectacular Showdown', type_line: 'Sorcery', oracle_text: 'Goad all creatures you don\'t control.' },
      { id: '5', name: 'Repercussion', type_line: 'Enchantment', oracle_text: 'Whenever a creature is dealt damage, Repercussion deals that much damage to that creature\'s controller.' },
      { id: '6', name: 'Stuffy Doll', type_line: 'Artifact Creature — Scarecrow', oracle_text: 'Indestructible\nAs Stuffy Doll enters, choose a player.\nWhenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player.' },
    ] as any);

    expect(profile.primaryArchetypes[0]).toBe(SynergyArchetype.POLITICS);
    expect(profile.archetypeScores[SynergyArchetype.VOLTRON] || 0).toBeLessThan(profile.archetypeScores[SynergyArchetype.POLITICS] || 0);
    expect(Number(profile.synergyTagCounts?.goad_politics || 0)).toBeGreaterThanOrEqual(6);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.DEFENSIVE);
  });

  it('tracks opponent-facing goad auras and mass-goad commanders', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Baeloth Barrityl, Entertainer', type_line: 'Legendary Creature — Lizard Performer', oracle_text: 'Each creature you don\'t control attacks each combat if able.\nWhenever a creature you control attacks, goad target creature you don\'t control.' },
      { id: '2', name: 'Parasitic Impetus', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature an opponent controls\nEnchanted creature gets +2/+2 and has goad.' },
      { id: '3', name: 'Bloodthirsty Blade', type_line: 'Artifact — Equipment', oracle_text: 'Equipped creature gets +2/+0 and has goad.\nEquip {3}' },
      { id: '4', name: 'Blasphemous Act', type_line: 'Sorcery', oracle_text: 'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.' },
      { id: '5', name: 'Chain Reaction', type_line: 'Sorcery', oracle_text: 'Chain Reaction deals X damage to each creature, where X is the number of creatures on the battlefield.' },
    ] as any);

    expect(Number(profile.synergyTagCounts?.goad_politics || 0)).toBeGreaterThanOrEqual(4);
    expect(profile.archetypeScores[SynergyArchetype.VOLTRON] || 0).toBeLessThan(15);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.DEFENSIVE);
  });

  it('infers CONTROL for tribal token-engine shells with counter packages', () => {
    const profile = cardAnalyzer.analyzeDeck([
      { id: '1', name: 'Lullmage Mentor', type_line: 'Creature — Merfolk Wizard', oracle_text: '{1}{U}, {T}: Create a 1/1 blue Merfolk Wizard creature token.\n{T}, Tap an untapped Merfolk you control: Counter target spell unless its controller pays {1}.' },
      { id: '2', name: 'Drowner of Secrets', type_line: 'Creature — Merfolk Wizard', oracle_text: 'Tap an untapped Merfolk you control: Target player mills X cards, where X is the number of Merfolk you control.' },
      { id: '3', name: 'Merrow Reejerey', type_line: 'Creature — Merfolk Wizard', oracle_text: 'Other Merfolk creatures you control get +1/+1.\nWhenever you cast a Merfolk spell, you may tap or untap target permanent.' },
      { id: '4', name: 'Kindred Discovery', type_line: 'Enchantment — Kindred', oracle_text: 'As Kindred Discovery enters, choose a creature type.\nWhenever a creature you control of the chosen type attacks, you may draw a card.' },
      { id: '5', name: 'Cryptolith Rite', type_line: 'Enchantment', oracle_text: 'Each creature you control has "{T}: Add one mana of any color."' },
      { id: '6', name: 'Counterspell', type_line: 'Instant', oracle_text: 'Counter target spell.' },
      { id: '7', name: 'Force of Will', type_line: 'Instant', oracle_text: 'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target spell.' },
      { id: '8', name: 'Kopala, Warden of Waves', type_line: 'Legendary Creature — Merfolk Wizard', oracle_text: 'Spells your opponents cast that target Merfolk you control cost {2} more to cast.\nAbilities your opponents activate that target Merfolk you control cost {2} more to activate.' },
      { id: '9', name: 'Master of the Pearl Trident', type_line: 'Creature — Merfolk', oracle_text: 'Other Merfolk creatures you control get +1/+1 and have islandwalk.' },
      { id: '10', name: 'Lord of Atlantis', type_line: 'Creature — Merfolk', oracle_text: 'Other Merfolk creatures get +1/+1 and have islandwalk.' },
    ] as any);

    expect(profile.primaryArchetypes[0]).toBe(SynergyArchetype.TRIBAL);
    expect(Number(profile.synergyTagCounts?.tribal_engine || 0)).toBeGreaterThanOrEqual(10);
    expect(inferAIStrategyFromDeckProfile(profile)).toBe(AIStrategy.CONTROL);
  });
});
