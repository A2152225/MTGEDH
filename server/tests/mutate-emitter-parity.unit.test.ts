import { describe, expect, it } from 'vitest';
import { detectMutateTriggers } from '../src/state/modules/triggered-abilities.js';
import { queueMutateTriggeredAbilities } from '../src/state/modules/stackResolvePermanentEntryUtils.js';

function makeCtx(permanent: any) {
  const state: any = {
    seq: 1,
    stack: [],
    battlefield: [permanent],
    players: [{ id: 'p1' }, { id: 'p2' }],
  };
  return {
    state,
    gameId: 'mutate_emitter_parity',
    bumpSeq() {
      state.seq = Number(state.seq || 0) + 1;
    },
    isReplaying: false,
  } as any;
}

describe('mutate emitter — detector is on the live queue path', () => {
  it('detects whenever-this-creature-mutates templates', () => {
    const triggers = detectMutateTriggers({
      name: 'Sample Starrix',
      oracle_text: 'Whenever this creature mutates, exile cards from the top of your library until you exile a nonland card.',
    }, { id: 'starrix_1', controller: 'p1' });
    expect(triggers.some((trigger) => trigger.triggerType === 'mutates')).toBe(true);
  });

  it('queues a mutate trigger without duplicating the generic parser hit', () => {
    const permanent = {
      id: 'starrix_1',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'starrix_card',
        name: 'Sample Starrix',
        type_line: 'Creature — Beast',
        oracle_text: 'Whenever this creature mutates, draw a card.',
      },
    };
    const ctx = makeCtx(permanent);
    queueMutateTriggeredAbilities(ctx, permanent, 'p1');
    const mutateItems = ctx.state.stack.filter((item: any) => /draw a card/i.test(String(item.description || item.effect || '')));
    expect(mutateItems.length).toBe(1);
  });
});
