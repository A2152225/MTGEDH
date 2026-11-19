import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applySpaceSculptorOptionChoice,
  queueSpaceSculptorSectorChoices,
  tryResolveSpaceSculptorAbility,
} from '../src/state/modules/spaceSculptor.js';
import { applySpaceSculptorSectorEffect } from '../src/state/modules/spaceSculptorEffects.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

const sculptorText = 'Space sculptor (Space Beleren divides the battlefield into alpha, beta, and gamma sectors.)';

describe('space sculptor sectors', () => {
  it('asks a player who does not control the sculptor first, then restricts blocks to that sector', () => {
    const game = createInitialGameState('t_space_sculptor');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    game.state.activePlayer = p1;
    game.state.turnNumber = 4;
    game.state.battlefield = [
      { id: 'beleren', controller: p1, owner: p1, loyalty: 3, counters: { loyalty: 3 }, card: { name: 'Space Beleren', type_line: 'Legendary Planeswalker — Jace', oracle_text: sculptorText, loyalty: '3' } },
      { id: 'opp', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' } },
      { id: 'mine', controller: p1, owner: p1, card: { name: 'Cat', type_line: 'Creature — Cat', oracle_text: '' } },
    ];

    expect(queueSpaceSculptorSectorChoices(game as any)).toBe(true);
    const firstStep = ResolutionQueueManager.getQueue('t_space_sculptor').steps[0] as any;
    expect(String(firstStep.playerId)).toBe(p2);
    expect(String(firstStep.spaceSculptorPermanentId)).toBe('opp');

    ResolutionQueueManager.completeStep('t_space_sculptor', String(firstStep.id), { playerId: p2, selections: ['alpha'] } as any);
    const assigned = applySpaceSculptorOptionChoice(game as any, firstStep, 'alpha');
    expect(assigned).toEqual({ ok: true });
    expect(game.state.battlefield.find((permanent: any) => permanent.id === 'opp').sector).toBe('alpha');

    const mineStep = ResolutionQueueManager.getQueue('t_space_sculptor').steps.find((step: any) => step.spaceSculptorPermanentId === 'mine');
    expect(String(mineStep?.playerId)).toBe(p1);
    applySpaceSculptorOptionChoice(game as any, mineStep, 'beta');
    applySpaceSculptorSectorEffect(game as any, { spaceSculptorEffect: 'counters' }, 'alpha');
    const countered = game.state.battlefield.find((permanent: any) => permanent.id === 'opp');
    const spared = game.state.battlefield.find((permanent: any) => permanent.id === 'mine');
    expect(Number(countered.counters?.['+1/+1'] || 0)).toBeGreaterThan(0);
    expect(Number(spared.counters?.['+1/+1'] || 0)).toBe(0);

    tryResolveSpaceSculptorAbility(game as any, {
      sourceName: 'Space Beleren',
      description: 'Creatures in each sector can be blocked this turn only by creatures in the same sector.',
    }, p1);
    const opp = game.state.battlefield.find((permanent: any) => permanent.id === 'opp');
    const mine = game.state.battlefield.find((permanent: any) => permanent.id === 'mine');
    expect(canBlockAttacker(mine, opp, game.state.battlefield, p1, game.state).canBlock).toBe(false);

    game.state.spaceSculptorSectors.mine = 'alpha';
    mine.sector = 'alpha';
    expect(canBlockAttacker(mine, opp, game.state.battlefield, p1, game.state).canBlock).toBe(true);
  });
});
