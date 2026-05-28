import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { chooseAIOptionSelectionsForStep } from '../src/socket/ai.js';

function createPlayer(id: string, name: string, life = 40) {
  return { id, name, life } as any;
}

describe('AI option choice', () => {
  it('declines may-draw prompts when library is nearly empty', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      mayAbilityPrompt: true,
      effectText: 'Draw a card.',
      description: 'You may draw a card.',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    });

    expect(decision).toEqual({ selections: ['no'], cancelled: true });
  });

  it('pays life for shock lands when life is healthy and untapped mana matters', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI', 18)],
        life: { [playerId]: 18 },
        turnPlayer: playerId,
        phase: 'main',
        zones: {
          [playerId]: {
            hand: [{ id: 'spell1', name: 'Arcane Signet', mana_cost: '{2}' }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      shockLandChoice: true,
      payLifeAmount: 2,
      options: [
        { id: 'enter_tapped', label: 'Have it enter tapped' },
        { id: 'pay_2_life', label: 'Pay 2 life (enter untapped)' },
      ],
    });

    expect(decision).toEqual({ selections: ['pay_2_life'], cancelled: false });
  });

  it('discards an offered land for Mox Diamond', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            hand: [
              { id: 'spell_1', name: 'Useful Spell', type_line: 'Instant', oracle_text: 'Draw two cards.', cmc: 2 },
              { id: 'land_1', name: 'Plains', type_line: 'Basic Land - Plains', oracle_text: '({T}: Add {W}.)', cmc: 0 },
            ],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      moxDiamondChoice: true,
      options: [
        { id: 'decline_mox_diamond', label: 'Do not discard' },
        { id: 'land_1', label: 'Discard Plains' },
      ],
    });

    expect(decision).toEqual({ selections: ['land_1'], cancelled: false });
  });

  it('declines Mox Diamond when no offered land is available', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            hand: [{ id: 'spell_1', name: 'Useful Spell', type_line: 'Instant', oracle_text: 'Draw two cards.', cmc: 2 }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      moxDiamondChoice: true,
      options: [
        { id: 'decline_mox_diamond', label: 'Do not discard' },
      ],
    });

    expect(decision).toEqual({ selections: ['decline_mox_diamond'], cancelled: false });
  });

  it('casts a miracle prompt when the first-drawn card is payable', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        manaPool: { [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        zones: {
          [playerId]: {
            hand: [{ id: 'miracle_1', name: 'Terminus', type_line: 'Sorcery', isFirstDrawnThisTurn: true }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      miraclePrompt: true,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      options: [
        { id: 'cast_miracle', label: 'Cast for Miracle ({W})' },
        { id: 'decline', label: "Don't cast" },
      ],
    });

    expect(decision).toEqual({ selections: ['cast_miracle'], cancelled: false });
  });

  it('declines miracle prompts when the card is not payable', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        manaPool: { [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        zones: {
          [playerId]: {
            hand: [{ id: 'miracle_1', name: 'Terminus', type_line: 'Sorcery', isFirstDrawnThisTurn: true }],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      miraclePrompt: true,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      options: [
        { id: 'cast_miracle', label: 'Cast for Miracle ({W})' },
        { id: 'decline', label: "Don't cast" },
      ],
    });

    expect(decision).toEqual({ selections: ['decline'], cancelled: true });
  });

  it('chooses a valid Dredge draw replacement when the library can support it', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            graveyard: [
              { id: 'stinkweed_imp_1', name: 'Stinkweed Imp', type_line: 'Creature - Imp', oracle_text: 'Flying\nDredge 5', cmc: 3 },
            ],
            library: Array.from({ length: 12 }, (_, index) => ({ id: `library_${index + 1}` })),
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      dredgeDrawReplacementChoice: true,
      dredgeOptions: [{ cardId: 'stinkweed_imp_1', cardName: 'Stinkweed Imp', dredge: 5 }],
      options: [
        { id: 'draw', label: 'Draw a card' },
        { id: 'dredge:stinkweed_imp_1', label: 'Stinkweed Imp - Dredge 5' },
      ],
    });

    expect(decision).toEqual({ selections: ['dredge:stinkweed_imp_1'], cancelled: false });
  });

  it('draws instead of choosing Dredge when the offered graveyard card is no longer valid', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            graveyard: [],
            library: Array.from({ length: 12 }, (_, index) => ({ id: `library_${index + 1}` })),
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      dredgeDrawReplacementChoice: true,
      dredgeOptions: [{ cardId: 'stinkweed_imp_1', cardName: 'Stinkweed Imp', dredge: 5 }],
      options: [
        { id: 'draw', label: 'Draw a card' },
        { id: 'dredge:stinkweed_imp_1', label: 'Stinkweed Imp - Dredge 5' },
      ],
    });

    expect(decision).toEqual({ selections: ['draw'], cancelled: false });
  });

  it('chooses the least developed opponent for Forbidden Orchard tokens', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent 1'), createPlayer('opp2', 'Opponent 2')],
        battlefield: [
          { id: 'opp1_creature_1', controller: 'opp1', card: { name: 'Colossal Dreadmaw', type_line: 'Creature - Dinosaur', power: '6' } },
          { id: 'opp1_rock_1', controller: 'opp1', card: { name: 'Sol Ring', type_line: 'Artifact' } },
          { id: 'opp2_land_1', controller: 'opp2', card: { name: 'Island', type_line: 'Basic Land - Island' } },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      forbiddenOrchardTargetChoice: true,
      options: [
        { id: 'opp1', label: 'Opponent 1' },
        { id: 'opp2', label: 'Opponent 2' },
      ],
    });

    expect(decision).toEqual({ selections: ['opp2'], cancelled: false });
  });

  it('chooses the least developed opponent for looked-at-card chooser prompts', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent 1', 40), createPlayer('opp2', 'Opponent 2', 25)],
        life: { [playerId]: 40, opp1: 40, opp2: 25 },
        battlefield: [
          { id: 'opp1_creature_1', controller: 'opp1', card: { name: 'Questing Beast', type_line: 'Creature - Beast', power: '4', toughness: '4' } },
          { id: 'opp1_artifact_1', controller: 'opp1', card: { name: 'Arcane Signet', type_line: 'Artifact' } },
          { id: 'opp2_land_1', controller: 'opp2', card: { name: 'Island', type_line: 'Basic Land - Island' } },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      choosePlayerForLookedAtCardsChoice: true,
      options: [
        { id: 'opp1', label: 'Opponent 1' },
        { id: 'opp2', label: 'Opponent 2' },
      ],
    });

    expect(decision).toEqual({ selections: ['opp2'], cancelled: false });
  });

  it('pays mana for Blight-or-pay spell additional costs when affordable', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        manaPool: { [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 5 } },
        pendingSpellCasts: {
          cast_1: { effectId: 'cast_1', cardId: 'spell_1', cardName: 'Blight Blast', manaCost: '{1}' },
        },
        battlefield: [
          { id: 'creature_1', controller: playerId, card: { name: 'Useful Creature', type_line: 'Creature - Soldier', power: '2', toughness: '2' } },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      spellAdditionalCostBlightOrPay: true,
      spellAdditionalCostEffectId: 'cast_1',
      spellAdditionalCostOrPay: '{3}',
      options: [
        { id: 'blight_cost', label: 'Blight 1' },
        { id: 'pay_mana_cost', label: 'Pay {3}' },
      ],
    });

    expect(decision).toEqual({ selections: ['pay_mana_cost'], cancelled: false });
  });

  it('chooses Blight for Blight-or-pay spell additional costs when mana is unavailable', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        manaPool: { [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        pendingSpellCasts: {
          cast_1: { effectId: 'cast_1', cardId: 'spell_1', cardName: 'Blight Blast', manaCost: '{1}' },
        },
        battlefield: [
          { id: 'creature_1', controller: playerId, card: { name: 'Spare Creature', type_line: 'Creature - Soldier', power: '1', toughness: '1' } },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      spellAdditionalCostBlightOrPay: true,
      spellAdditionalCostEffectId: 'cast_1',
      spellAdditionalCostOrPay: '{3}',
      options: [
        { id: 'pay_mana_cost', label: 'Pay {3}' },
        { id: 'blight_cost', label: 'Blight 1' },
      ],
    });

    expect(decision).toEqual({ selections: ['blight_cost'], cancelled: false });
  });

  it('chooses Lost Mine for Venture dungeon prompts even when it is not first', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      ventureChooseDungeon: true,
      options: [
        { id: 'tomb', label: 'Tomb of Annihilation' },
        { id: 'mad_mage', label: 'Dungeon of the Mad Mage' },
        { id: 'lost_mine', label: 'Lost Mine of Phandelver' },
      ],
    });

    expect(decision).toEqual({ selections: ['lost_mine'], cancelled: false });
  });

  it('chooses immediate resource rooms for Venture room prompts', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      ventureChooseRoom: true,
      options: [
        { id: 'twisted_caverns', label: "Twisted Caverns - Target creature can't attack until your next turn." },
        { id: 'goblin_bazaar', label: 'Goblin Bazaar - Create a Treasure token.' },
      ],
    });

    expect(decision).toEqual({ selections: ['goblin_bazaar'], cancelled: false });
  });

  it('accepts administrative confirmation prompts for AI seats', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const importDecision = chooseAIOptionSelectionsForStep(game, playerId, {
      importWipeConfirm: true,
      options: [
        { id: 'decline', label: 'Reject' },
        { id: 'accept', label: 'Approve' },
      ],
    });
    const judgeDecision = chooseAIOptionSelectionsForStep(game, playerId, {
      judgeConfirm: true,
      options: [
        { id: 'decline', label: 'Reject' },
        { id: 'accept', label: 'Approve' },
      ],
    });

    expect(importDecision).toEqual({ selections: ['accept'], cancelled: false });
    expect(judgeDecision).toEqual({ selections: ['accept'], cancelled: false });
  });

  it('exerts legal attacking creatures for exert prompts', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        battlefield: [
          { id: 'attacker_1', controller: playerId, attacking: true, card: { name: 'Glorybringer', type_line: 'Creature - Dragon' } },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      exertChoice: true,
      exertAttackerId: 'attacker_1',
      options: [
        { id: 'normal', label: 'Attack normally' },
        { id: 'exert', label: 'Exert' },
      ],
    });

    expect(decision).toEqual({ selections: ['exert'], cancelled: false });
  });

  it('chooses a deterministic low-index MDFC land face independent of option order', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      mdfcFaceChoice: true,
      options: [
        { id: '1', label: 'Back Face', description: 'Land - Add one mana of any color.' },
        { id: '0', label: 'Front Face', description: 'Land - Add one mana of any color.' },
      ],
    });

    expect(decision).toEqual({ selections: ['0'], cancelled: false });
  });

  it('uses reveal-until-nonland spell-bottom prompts when a nonland can be hit', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        stack: [{ id: 'spell_1', type: 'spell' }],
        zones: {
          [playerId]: {
            library: [
              { id: 'land_1', name: 'Island', type_line: 'Basic Land - Island' },
              { id: 'spell_2', name: 'Lightning Bolt', type_line: 'Instant' },
            ],
          },
        },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      spellBottomRevealUntilNonlandChoice: true,
      triggeringStackItemId: 'spell_1',
      revealFromLibraryPlayerId: playerId,
      options: [
        { id: 'no', label: 'Decline' },
        { id: 'yes', label: 'Use ability' },
      ],
    });

    expect(decision).toEqual({ selections: ['yes'], cancelled: false });
  });

  it('casts free revealed and off-zone spell prompts when the card is available', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: {
          [playerId]: {
            exile: [{ id: 'exile_spell_1', name: 'Wildfire', type_line: 'Sorcery' }],
            graveyard: [{ id: 'grave_spell_1', name: 'Deep Analysis', type_line: 'Sorcery' }],
          },
        },
      },
    } as any;

    const revealedDecision = chooseAIOptionSelectionsForStep(game, playerId, {
      castRevealedFromLibraryChoice: true,
      castRevealedFromLibraryCard: { id: 'hit_1', name: 'Lightning Bolt', type_line: 'Instant' },
      options: [
        { id: 'decline', label: 'Decline' },
        { id: 'cast', label: 'Cast Lightning Bolt' },
      ],
    });
    const exileDecision = chooseAIOptionSelectionsForStep(game, playerId, {
      castFromExileCardId: 'exile_spell_1',
      castFromExileCard: { id: 'exile_spell_1', name: 'Wildfire', type_line: 'Sorcery' },
      options: [
        { id: 'decline', label: 'Decline' },
        { id: 'cast', label: 'Cast Wildfire' },
      ],
    });
    const graveyardDecision = chooseAIOptionSelectionsForStep(game, playerId, {
      castFromGraveyardCardId: 'grave_spell_1',
      castFromGraveyardCard: { id: 'grave_spell_1', name: 'Deep Analysis', type_line: 'Sorcery' },
      options: [
        { id: 'decline', label: 'Decline' },
        { id: 'cast', label: 'Cast Deep Analysis' },
      ],
    });

    expect(revealedDecision).toEqual({ selections: ['cast'], cancelled: false });
    expect(exileDecision).toEqual({ selections: ['cast'], cancelled: false });
    expect(graveyardDecision).toEqual({ selections: ['cast'], cancelled: false });
  });

  it('chooses the higher-value pile for its own split-pile hand choice', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: { [playerId]: { hand: [] } },
        battlefield: [],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      choosePileFromSplitChoice: true,
      choosePileFromSplitChosenAction: 'move_cards',
      choosePileFromSplitMovePlayerId: playerId,
      choosePileFromSplitChosenDestination: 'hand',
      choosePileFromSplitOtherDestination: 'library',
      choosePileFromSplitItems: [
        { id: 'c1', name: 'Wastes', type_line: 'Basic Land', oracle_text: 'Add {C}.', cmc: 0 },
        { id: 'c2', name: 'Impulse', type_line: 'Instant', oracle_text: 'Draw a card.', cmc: 1 },
        { id: 'c3', name: 'Terminate', type_line: 'Instant', oracle_text: 'Destroy target creature.', cmc: 2 },
      ],
      choosePileFromSplitPileA: ['c1'],
      choosePileFromSplitPileB: ['c2', 'c3'],
      options: [
        { id: 'pileA', label: 'Pile A' },
        { id: 'pileB', label: 'Pile B' },
      ],
    });

    expect(decision).toEqual({ selections: ['pileB'], cancelled: false });
  });

  it('chooses the lower-value pile when it must sacrifice one split pile', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        battlefield: [
          { id: 'perm1', controller: playerId, card: { name: 'Treasure', type_line: 'Artifact Token', cmc: 0 } },
          { id: 'perm2', controller: playerId, card: { name: 'Consecrated Sphinx', type_line: 'Creature - Sphinx', oracle_text: 'Whenever an opponent draws a card, you may draw two cards.', cmc: 6 } },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      choosePileFromSplitChoice: true,
      choosePileFromSplitChosenAction: 'sacrifice_permanents',
      choosePileFromSplitTargetPlayerId: playerId,
      choosePileFromSplitPileA: ['perm1'],
      choosePileFromSplitPileB: ['perm2'],
      options: [
        { id: 'pileB', label: 'Pile B' },
        { id: 'pileA', label: 'Pile A' },
      ],
    });

    expect(decision).toEqual({ selections: ['pileA'], cancelled: false });
  });

  it('chooses mutate mode for mutate cast prompts', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      mutateCastModeChoice: true,
      mutateCardId: 'gemrazer_1',
      options: [
        { id: 'cast_normal', label: 'Cast Normally' },
        { id: 'cast_mutate', label: 'Cast with Mutate ({1}{G}{G})' },
      ],
    });

    expect(decision).toEqual({ selections: ['cast_mutate'], cancelled: false });
  });

  it('chooses the Mirrormind Crown replacement when an equipped creature snapshot is available', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      mirrormindCrownTokenReplacementChoice: true,
      mirrormindCrownEquippedCreatureCard: { name: 'Elvish Visionary', type_line: 'Creature - Elf' },
      options: [
        { id: 'replace', label: 'Replace with copy tokens' },
        { id: 'normal', label: 'Create normal tokens' },
      ],
    });

    expect(decision).toEqual({ selections: ['replace'], cancelled: false });
  });

  it('pays attack costs when enough non-attacking mana sources are available', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        battlefield: [
          {
            id: 'attacker_1',
            controller: playerId,
            tapped: false,
            card: { name: 'Silvercoat Lion', type_line: 'Creature - Cat', oracle_text: '' },
          },
          {
            id: 'forest_1',
            controller: playerId,
            tapped: false,
            card: { name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '{T}: Add {G}.' },
          },
          {
            id: 'forest_2',
            controller: playerId,
            tapped: false,
            card: { name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '{T}: Add {G}.' },
          },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      attackCostPayment: true,
      attackCostAmount: 2,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: 'opp1' }],
      options: [
        { id: 'pay_attack_cost', label: 'Pay {2} and attack' },
        { id: 'cancel_attack', label: 'Cancel attack' },
      ],
    });

    expect(decision).toEqual({ selections: ['pay_attack_cost'], cancelled: false });
  });

  it('moves commanders to the command zone for commander zone prompts', () => {
    const playerId = 'ai1' as PlayerID;
    const game = { state: { players: [createPlayer(playerId, 'AI')] } } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      commanderZoneChoice: true,
      commanderId: 'commander_1',
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it go to graveyard' },
      ],
    });

    expect(decision).toEqual({ selections: ['command'], cancelled: false });
  });

  it('handles optional triggered effect-program prompts without the legacy flag', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        zones: { [playerId]: { library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] } },
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      effectProgramPrompt: true,
      effectProgramFamily: 'optional_triggered_ability',
      effectText: 'draw a card',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    });

    expect(decision).toEqual({ selections: ['no'], cancelled: true });
  });

  it('declines mana ward when the AI cannot pay', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI')],
        manaPool: { [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } },
        zones: {
          [playerId]: {
            hand: [],
          },
        },
        stack: [
          {
            id: 'spell1',
            card: {
              id: 'spell-card',
              name: 'Beast Within',
              type_line: 'Instant',
              oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
              mana_cost: '{2}{G}',
            },
          },
        ],
      },
    } as any;

    const decision = chooseAIOptionSelectionsForStep(game, playerId, {
      wardPayment: true,
      wardPaymentType: 'mana',
      wardCost: '{2}',
      wardTriggeredBy: 'spell1',
      options: [
        { id: 'pay_ward_cost', label: 'Pay {2}' },
        { id: 'decline_ward_cost', label: 'Decline (counter)' },
      ],
    });

    expect(decision).toEqual({ selections: ['decline_ward_cost'], cancelled: false });
  });
});