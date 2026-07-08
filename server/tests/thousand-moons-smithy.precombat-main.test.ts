import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import {
  detectPrecombatMainTriggers,
  getPrecombatMainTriggers,
} from '../src/state/modules/triggers/turn-phases.js';

const SMITHY_ORACLE =
  'When Thousand Moons Smithy enters, create a white Gnome Soldier artifact creature token with "This token\'s power and toughness are each equal to the number of artifacts and/or creatures you control."\n' +
  'At the beginning of your first main phase, you may tap five untapped artifacts and/or creatures you control. If you do, transform Thousand Moons Smithy.';

describe('Thousand Moons Smithy precombat main trigger', () => {
  it('detects the first main phase transform trigger from oracle text', () => {
    const permanent = {
      id: 'smithy_perm',
      controller: 'p1',
      card: {
        name: 'Thousand Moons Smithy',
        type_line: 'Legendary Artifact',
        oracle_text: SMITHY_ORACLE,
      },
    };

    const triggers = detectPrecombatMainTriggers(permanent.card, permanent);

    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.mandatory).toBe(false);
    expect(String(triggers[0]?.effect || '')).toMatch(/you may tap five untapped artifacts and\/or creatures you control/i);
    expect(String(triggers[0]?.effect || '')).toMatch(/transform thousand moons smithy/i);
  });

  it('queues the trigger on the stack when advancing to precombat main', () => {
    const g = createInitialGameState('smithy_precombat_main');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.importDeckResolved(p1, [{ id: 'c1', name: 'Plains', type_line: 'Basic Land — Plains' } as any]);

    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).phase = 'beginning';
    (g.state as any).step = 'DRAW';

    (g.state as any).battlefield = [
      {
        id: 'smithy_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'smithy_card',
          name: 'Thousand Moons Smithy',
          type_line: 'Legendary Artifact',
          oracle_text: SMITHY_ORACLE,
        },
      },
    ];

    const detected = getPrecombatMainTriggers(g as any, p1);
    expect(detected).toHaveLength(1);

    g.applyEvent({ type: 'nextStep' });

    const stackTrigger = ((g.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.source === 'smithy_perm',
    );
    expect(stackTrigger).toBeTruthy();
    expect(String(stackTrigger?.description || stackTrigger?.effect || '')).toMatch(/you may tap five/i);
    expect(stackTrigger?.mandatory).toBe(false);
  });
});
