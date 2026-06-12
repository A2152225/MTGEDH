import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

describe('Gwenna spell-cast trigger IR primary', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('detects creature spells with power 5 or greater', () => {
    const triggers = detectSpellCastTriggers(
      {
        name: 'Gwenna, Eyes of Gaea',
        oracle_text:
          '{T}: Add two mana in any combination of colors. Spend this mana only to cast creature spells or activate abilities of creature sources.\nWhenever you cast a creature spell with power 5 or greater, put a +1/+1 counter on Gwenna and untap it.',
      },
      { id: 'perm_gwenna', controller: 'p1' },
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.spellCondition).toBe('creature');
    expect(triggers[0]?.minSpellPower).toBe(5);
    expect(triggers[0]?.effect).toMatch(/put a \+1\/\+1 counter on Gwenna and untap it/i);
  });

  it('puts a counter on Gwenna and untaps it under ORACLE_IR_TRIGGER_PRIMARY', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'gwenna_spell_cast_trigger_ir';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const gwennaId = 'perm_gwenna';
    (game.state as any).battlefield = [{
      id: gwennaId,
      controller: p1,
      owner: p1,
      tapped: true,
      counters: {},
      card: {
        id: 'gwenna_card',
        name: 'Gwenna, Eyes of Gaea',
        type_line: 'Legendary Creature — Elf Druid',
        oracle_text:
          'Whenever you cast a creature spell with power 5 or greater, put a +1/+1 counter on Gwenna and untap it.',
      },
    }];
    (game as any).gameId = gameId;

    executeTriggerEffect(
      game as any,
      p1,
      'Gwenna, Eyes of Gaea',
      'put a +1/+1 counter on Gwenna and untap it',
      {
        type: 'triggered_ability',
        controller: p1,
        source: gwennaId,
        permanentId: gwennaId,
        id: 'gwenna_trigger_stack_item',
      },
    );

    const gwenna = (game.state as any).battlefield.find((entry: any) => entry.id === gwennaId);
    expect(gwenna?.tapped).toBe(false);
    expect(gwenna?.counters?.['+1/+1']).toBe(1);
  });

  it('puts a counter on Gwenna and untaps it via IR fallback when primary is off', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';

    const gameId = 'gwenna_spell_cast_trigger_fallback';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const gwennaId = 'perm_gwenna';
    (game.state as any).battlefield = [{
      id: gwennaId,
      controller: p1,
      owner: p1,
      tapped: true,
      counters: {},
      card: {
        id: 'gwenna_card',
        name: 'Gwenna, Eyes of Gaea',
        type_line: 'Legendary Creature — Elf Druid',
      },
    }];
    (game as any).gameId = gameId;

    executeTriggerEffect(
      game as any,
      p1,
      'Gwenna, Eyes of Gaea',
      'put a +1/+1 counter on Gwenna and untap it',
      {
        type: 'triggered_ability',
        controller: p1,
        source: gwennaId,
        permanentId: gwennaId,
        id: 'gwenna_trigger_stack_item',
      },
    );

    const gwenna = (game.state as any).battlefield.find((entry: any) => entry.id === gwennaId);
    expect(gwenna?.tapped).toBe(false);
    expect(gwenna?.counters?.['+1/+1']).toBe(1);
  });
});
