import { describe, expect, it } from 'vitest';

import {
  MIN_JOIN_FORCES_POTENTIAL_MANA,
  chooseAIJoinForcesContribution,
  shouldAICastJoinForcesSpell,
} from '../src/socket/ai-handlers/aiJoinForcesDecision.js';

const MINDS_AGLOW = {
  name: 'Minds Aglow',
  mana_cost: '{U}',
  oracle_text:
    'Join forces — Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.',
};

const COLLECTIVE_VOYAGE = {
  name: 'Collective Voyage',
  mana_cost: '{G}',
  oracle_text:
    'Join forces — Starting with you, each player may pay any amount of mana. Each player searches their library for up to X basic land cards, where X is the total amount of mana paid this way, puts them onto the battlefield tapped, then shuffles.',
};

const LIGHTNING_BOLT = {
  name: 'Lightning Bolt',
  mana_cost: '{R}',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
};

const MANA_CHARGED_DRAGON = {
  name: 'Mana-Charged Dragon',
  mana_cost: '{4}{R}{R}',
  oracle_text:
    'Flying, trample\nJoin forces — Whenever this creature attacks or blocks, each player starting with you may pay any amount of mana. This creature gets +X/+0 until end of turn, where X is the total amount of mana paid this way.',
};

function basicLand(id: string, controller: string, name: string, typeLine: string) {
  return {
    id,
    controller,
    tapped: false,
    card: {
      name,
      type_line: typeLine,
      oracle_text: '',
    },
  };
}

function buildGame(battlefield: any[]) {
  return {
    state: {
      players: [
        { id: 'ai', name: 'AI', life: 40 },
        { id: 'p2', name: 'P2', life: 40 },
        { id: 'p3', name: 'P3', life: 40 },
      ],
      battlefield,
      manaPool: {
        ai: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p3: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    },
  } as any;
}

describe('AI Join Forces cast gate', () => {
  it('uses a table-mana floor of 2', () => {
    expect(MIN_JOIN_FORCES_POTENTIAL_MANA).toBe(2);
  });

  it('does not gate non-Join-Forces spells', () => {
    const game = buildGame([basicLand('island-ai', 'ai', 'Island', 'Basic Land — Island')]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', LIGHTNING_BOLT)).toBe(true);
  });

  it('does not treat Mana-Charged Dragon as a Join Forces spell to delay', () => {
    const game = buildGame([basicLand('mountain-ai', 'ai', 'Mountain', 'Basic Land — Mountain')]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', MANA_CHARGED_DRAGON)).toBe(true);
  });

  it('skips Minds Aglow when the caster has 0 leftover and the table has no extra mana', () => {
    const game = buildGame([basicLand('island-ai', 'ai', 'Island', 'Basic Land — Island')]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', MINDS_AGLOW)).toBe(false);
  });

  it('skips when other players only have 1 possible mana and leftover is 0', () => {
    const game = buildGame([
      basicLand('island-ai', 'ai', 'Island', 'Basic Land — Island'),
      basicLand('island-p2', 'p2', 'Island', 'Basic Land — Island'),
    ]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', MINDS_AGLOW)).toBe(false);
  });

  it('casts once other players have at least 2 possible mana', () => {
    const game = buildGame([
      basicLand('island-ai', 'ai', 'Island', 'Basic Land — Island'),
      basicLand('island-p2', 'p2', 'Island', 'Basic Land — Island'),
      basicLand('island-p3', 'p3', 'Island', 'Basic Land — Island'),
    ]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', MINDS_AGLOW)).toBe(true);
  });

  it('casts Collective Voyage when the caster has leftover mana after paying {G}', () => {
    const game = buildGame([
      basicLand('forest-ai-1', 'ai', 'Forest', 'Basic Land — Forest'),
      basicLand('forest-ai-2', 'ai', 'Forest', 'Basic Land — Forest'),
      basicLand('forest-ai-3', 'ai', 'Forest', 'Basic Land — Forest'),
    ]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', COLLECTIVE_VOYAGE)).toBe(true);
  });

  it('ignores tapped opponent lands as possible Join Forces mana', () => {
    const game = buildGame([
      basicLand('island-ai', 'ai', 'Island', 'Basic Land — Island'),
      {
        ...basicLand('island-p2', 'p2', 'Island', 'Basic Land — Island'),
        tapped: true,
      },
      {
        ...basicLand('island-p3', 'p3', 'Island', 'Basic Land — Island'),
        tapped: true,
      },
    ]);
    expect(shouldAICastJoinForcesSpell(game, 'ai', MINDS_AGLOW)).toBe(false);
  });
});

describe('AI Join Forces contribution', () => {
  const drawStep = {
    cardName: 'Minds Aglow',
    effectDescription:
      'Join forces — Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.',
    availableMana: 5,
    playerId: 'p2',
  };

  const landStep = {
    cardName: 'Collective Voyage',
    effectDescription:
      'Join forces — Starting with you, each player may pay any amount of mana. Each player searches their library for up to X basic land cards, where X is the total amount of mana paid this way, puts them onto the battlefield tapped, then shuffles.',
    availableMana: 4,
    playerId: 'p2',
  };

  const millStep = {
    cardName: 'Shared Trauma',
    effectDescription:
      'Join forces — Starting with you, each player may pay any amount of mana. Each player mills X cards, where X is the total amount of mana paid this way.',
    availableMana: 5,
    playerId: 'p2',
  };

  const pumpStep = {
    cardName: 'Mana-Charged Dragon',
    effectDescription:
      'Whenever this creature attacks or blocks, each player starting with you may pay any amount of mana. This creature gets +X/+0 until end of turn, where X is the total amount of mana paid this way.',
    availableMana: 5,
    playerId: 'p2',
  };

  const tokenStep = {
    cardName: 'Alliance of Arms',
    effectDescription:
      'Join forces — Starting with you, each player may pay any amount of mana. Each player creates X 1/1 white Soldier creature tokens, where X is the total amount of mana paid this way.',
    availableMana: 5,
    playerId: 'p2',
  };

  const offTurnGame = {
    state: {
      turnPlayer: 'ai',
      activePlayer: 'ai',
    },
  } as any;

  it('contributes leftover available mana when the AI initiated', () => {
    expect(chooseAIJoinForcesContribution(offTurnGame, { ...drawStep, isInitiator: true, availableMana: 3 })).toBe(3);
    expect(chooseAIJoinForcesContribution(offTurnGame, { isInitiator: true, availableMana: 0 })).toBe(0);
  });

  it('pays into Minds Aglow as a non-initiator because everyone draws X', () => {
    expect(chooseAIJoinForcesContribution(offTurnGame, { ...drawStep, isInitiator: false })).toBe(4);
  });

  it('pays into Collective Voyage as a non-initiator because everyone ramps X lands', () => {
    expect(chooseAIJoinForcesContribution(offTurnGame, { ...landStep, isInitiator: false })).toBe(3);
  });

  it('dumps small leftover into shared draw/lands without holding up 1', () => {
    expect(chooseAIJoinForcesContribution(offTurnGame, {
      ...drawStep,
      isInitiator: false,
      availableMana: 2,
    })).toBe(2);
    expect(chooseAIJoinForcesContribution(offTurnGame, {
      ...landStep,
      isInitiator: false,
      availableMana: 1,
    })).toBe(1);
  });

  it('does not pump an opponent Mana-Charged Dragon or mill the table', () => {
    expect(chooseAIJoinForcesContribution(offTurnGame, { ...pumpStep, isInitiator: false })).toBe(0);
    expect(chooseAIJoinForcesContribution(offTurnGame, { ...millStep, isInitiator: false })).toBe(0);
    expect(chooseAIJoinForcesContribution(offTurnGame, { availableMana: 5 })).toBe(0);
  });

  it('adds a modest amount to shared soldier tokens', () => {
    expect(chooseAIJoinForcesContribution(offTurnGame, { ...tokenStep, isInitiator: false })).toBe(2);
  });
});
