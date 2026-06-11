import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('Ouroboroid begin combat counters', () => {
  it('parses power-scaled each-creature counters with where X clause', () => {
    const text = "put X +1/+1 counters on each creature you control, where X is this creature's power";
    const ir = parseOracleTextToIR(text);
    const step = ir.abilities?.[0]?.steps?.[0] as any;
    expect(step?.kind).toBe('add_counter');
    expect(step?.whereX?.raw).toBe("this creature's power");
    expect(step?.target?.text).toBe('each creature you control');
  });

  it('puts X +1/+1 counters on each creature you control where X is source power', () => {
    const gameId = 't_ouroboroid_begin_combat';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const ouroboroidId = 'ouro_1';
    const merfolkId = 'merfolk_1';
    (game.state as any).battlefield = [
      {
        id: ouroboroidId,
        controller: p1,
        owner: p1,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'card_ouroboroid',
          name: 'Ouroboroid',
          type_line: 'Creature — Snake',
          power: '3',
          toughness: '3',
          oracle_text: "At the beginning of combat on your turn, put X +1/+1 counters on each creature you control, where X is this creature's power.",
        },
      },
      {
        id: merfolkId,
        controller: p1,
        owner: p1,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'card_merfolk',
          name: 'Merfolk',
          type_line: 'Creature — Merfolk',
          power: '1',
          toughness: '1',
        },
      },
    ];

    executeTriggerEffect(
      (game as any).ctx || game,
      p1,
      'Ouroboroid',
      "put X +1/+1 counters on each creature you control, where X is this creature's power",
      {
        source: ouroboroidId,
        permanentId: ouroboroidId,
        triggerType: 'begin_combat',
      },
    );

    const battlefield = (game.state as any).battlefield as any[];
    const ouroboroid = battlefield.find((perm) => perm.id === ouroboroidId);
    const merfolk = battlefield.find((perm) => perm.id === merfolkId);

    expect(ouroboroid?.counters?.['+1/+1']).toBe(3);
    expect(merfolk?.counters?.['+1/+1']).toBe(3);
  });
});
