import { describe, expect, it } from 'vitest';
import { buildSpellTargetListFromRequirements } from '../src/socket/game-actions.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';

const SINK_ORACLE = "Return target spell or nonland permanent an opponent controls to its owner's hand.";

describe('Sink into Stupor targets', () => {
  it('accepts an opponent spell or nonland permanent, not your own spell or a land', () => {
    const reqs = parseTargetRequirements(SINK_ORACLE);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toEqual(['spell', 'nonland permanent']);
    expect(reqs.targetControllerConstraint).toBe('opponent');

    const game = {
      state: {
        players: [{ id: 'p1', name: 'A2' }, { id: 'p2', name: 'King2' }],
        battlefield: [
          { id: 'omnath', controller: 'p1', card: { name: 'Omnath, Locus of Mana', type_line: 'Legendary Creature — Elemental' } },
          { id: 'sol-ring', controller: 'p2', card: { name: 'Sol Ring', type_line: 'Artifact' } },
          { id: 'forest', controller: 'p2', card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
        ],
        stack: [
          { id: 'stack_swords', type: 'spell', controller: 'p2', card: { name: 'Swords to Plowshares', type_line: 'Instant' } },
          { id: 'stack_own', type: 'spell', controller: 'p1', card: { name: 'Ponder', type_line: 'Sorcery' } },
        ],
      },
    };

    const targets = buildSpellTargetListFromRequirements(game, 'p1', reqs);
    expect(targets.map((target) => target.id).sort()).toEqual(['sol-ring', 'stack_swords']);
  });
});
