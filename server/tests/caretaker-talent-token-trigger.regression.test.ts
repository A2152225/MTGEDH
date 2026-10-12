import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import type { PlayerID } from '../../shared/src';

// Issues #48/#49 (game_mv4dicck, Caretaker's Talent): it drew when an OPPONENT's token entered
// (March of the World Ooze's Elephant) and could draw more than once a turn.
const ORACLE = "(Gain the next level as a sorcery to add its ability.)\nWhenever one or more tokens you control enter, draw a card. This ability triggers only once each turn.\n{W}: Level 2\nWhen this Class becomes level 2, create a token that's a copy of target token you control.\n{3}{W}: Level 3\nCreature tokens you control get +2/+2.";
const a = 'a' as PlayerID;
const b = 'b' as PlayerID;

function setup() {
  const game: any = createInitialGameState(`t_caretaker_${Math.random().toString(36).slice(2, 7)}`);
  game.applyEvent({ type: 'join', playerId: a, name: 'A' });
  game.applyEvent({ type: 'join', playerId: b, name: 'B' });
  game.state.turnPlayer = a;
  game.state.phase = 'precombatMain';
  game.state.step = 'MAIN1';
  game.state.stack = [];
  game.state.battlefield.push({
    id: 'ct', controller: a, owner: a, tapped: false, counters: {},
    card: { id: 'ct_c', name: "Caretaker's Talent", type_line: 'Enchantment — Class', oracle_text: ORACLE },
  });
  return game;
}

const caretakerTriggers = (game: any) =>
  (game.state.stack || []).filter((item: any) => item?.sourceName === "Caretaker's Talent");

const elephant = { colors: ['G'], typeLine: 'Token Creature — Elephant' };
const soldier = { colors: ['W'], typeLine: 'Token Creature — Soldier' };

describe("Caretaker's Talent token trigger (#48/#49)", () => {
  it("does not trigger when an opponent's token enters", () => {
    const game = setup();
    createToken(game, b, 'Elephant', 1, 6, 6, elephant);
    expect(caretakerTriggers(game)).toHaveLength(0);
  });

  it('triggers once for your token, then not again the same turn', () => {
    const game = setup();
    createToken(game, a, 'Soldier', 1, 1, 1, soldier);
    expect(caretakerTriggers(game)).toHaveLength(1);
    expect(String(caretakerTriggers(game)[0].effect)).toBe('draw a card.');
    createToken(game, a, 'Soldier', 1, 1, 1, soldier);
    createToken(game, a, 'Soldier', 2, 1, 1, soldier);
    expect(caretakerTriggers(game)).toHaveLength(1);
  });

  it('counts noncreature tokens (Treasure) and resets on a new turn', () => {
    const game = setup();
    createToken(game, a, 'Treasure', 1, undefined, undefined, {
      colors: [], typeLine: 'Token Artifact — Treasure', abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'], isArtifact: true,
    });
    expect(caretakerTriggers(game)).toHaveLength(1);
    game.state.stack = [];
    game.state.oncePerTurnTriggersFiredThisTurn = {}; // what the next turn's start does
    createToken(game, a, 'Soldier', 1, 1, 1, soldier);
    expect(caretakerTriggers(game)).toHaveLength(1);
  });
});


