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