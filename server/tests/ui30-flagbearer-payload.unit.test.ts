import { describe, expect, it, vi } from 'vitest';

const game: any = { state: { battlefield: [] as any[], players: [{ id: 'p1' }, { id: 'p2' }] } };
vi.mock('../src/socket/util.js', async (orig) => ({ ...(await orig() as any), ensureGame: () => game }));

import { sanitizeStepForClient } from '../src/socket/resolution-handlers/sanitizeStepForClient.js';
import { ResolutionStepType } from '../src/state/resolution/index.js';

function perm(id: string, type: string, oracle: string, controller: string): any {
  return { id, controller, owner: controller, card: { id: id + '_c', name: id, type_line: type, oracle_text: oracle } };
}

describe('ui30 Flagbearer ids in TARGET_SELECTION payload', () => {
  it('lists required Flagbearers for an opponent-controlled Standard Bearer', () => {
    game.state.battlefield = [
      perm('sb', 'Creature \u2014 Kor Flagbearer', 'While choosing targets as part of casting a spell or activating an ability, your opponents must choose at least one Flagbearer on the battlefield if able.', 'p2'),
      perm('bear', 'Creature \u2014 Bear', '', 'p2'),
    ];
    const step: any = { id: 't1', type: ResolutionStepType.TARGET_SELECTION, playerId: 'p1', sourceId: 'x', sourceName: 'Shock', description: 'Choose target', spellCastContext: { cardId: 'x' }, validTargets: [{ id: 'sb', label: 'sb' }, { id: 'bear', label: 'bear' }], minTargets: 1, maxTargets: 1 };
    const out = sanitizeStepForClient('ui30_fb', step);
    expect(out.requiredFlagbearerIds).toEqual(['sb']);
  });

  it('omits the field when the caster controls the Flagbearer source', () => {
    game.state.battlefield[0].controller = 'p1';
    const step: any = { id: 't2', type: ResolutionStepType.TARGET_SELECTION, playerId: 'p1', sourceId: 'x', spellCastContext: { cardId: 'x' }, validTargets: [{ id: 'sb' }, { id: 'bear' }], minTargets: 1, maxTargets: 1 };
    expect(sanitizeStepForClient('ui30_fb', step).requiredFlagbearerIds).toBeUndefined();
  });
});
