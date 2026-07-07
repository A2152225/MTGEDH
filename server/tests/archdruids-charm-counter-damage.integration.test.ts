import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const ARCHDRUIDS_CHARM_TEXT =
  'Choose one —\n'
  + '• Search your library for a creature or land card and reveal it. Put it onto the battlefield tapped if it\'s a land card. Otherwise, put it into your hand. Then shuffle.\n'
  + '• Put a +1/+1 counter on target creature you control. It deals damage equal to its power to target creature you don\'t control.\n'
  + '• Exile target artifact or enchantment.';

function joinTwoPlayers(game: ReturnType<typeof createInitialGameState>) {
  const pCaster = 'p_caster' as PlayerID;
  const pOpponent = 'p_opponent' as PlayerID;
  game.applyEvent!({ type: 'join', playerId: pCaster, name: 'Caster' } as any);
  game.applyEvent!({ type: 'join', playerId: pOpponent, name: 'Opponent' } as any);
  return { pCaster, pOpponent };
}

describe("Archdruid's Charm counter-then-damage mode", () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('puts +1/+1 on friendly creature and deals that power to chosen opponent creature', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const gameId = 'archdruids_charm_counter_damage';
    const game = createInitialGameState(gameId);
    const { pCaster, pOpponent } = joinTwoPlayers(game);

    (game.state as any).battlefield = [
      {
        id: 'friendly_elf',
        controller: pCaster,
        owner: pCaster,
        card: {
          id: 'elf_card',
          name: 'Llanowar Elves',
          type_line: 'Creature — Elf Druid',
          power: '1',
          toughness: '1',
        },
        power: 1,
        toughness: 1,
      },
      {
        id: 'opponent_bear',
        controller: pOpponent,
        owner: pOpponent,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
        power: 2,
        toughness: 2,
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: pCaster,
      spellName: "Archdruid's Charm",
      oracleText: ARCHDRUIDS_CHARM_TEXT,
      sourceId: 'archdruids-charm-stack',
      targets: ['friendly_elf', 'opponent_bear'],
      selectedModeIds: ['mode_2'],
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBeGreaterThanOrEqual(2);

    const friendly = (game.state as any).battlefield.find((entry: any) => entry.id === 'friendly_elf');
    const opponent = (game.state as any).battlefield.find((entry: any) => entry.id === 'opponent_bear');

    expect(friendly?.counters?.['+1/+1']).toBe(1);
    expect(friendly?.damage || friendly?.markedDamage || 0).toBe(0);
    expect(opponent?.damage || opponent?.markedDamage || 0).toBe(2);
  });
});
