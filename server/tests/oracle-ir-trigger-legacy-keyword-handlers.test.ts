import { describe, expect, it, vi } from 'vitest';



import type { PlayerID } from '../../shared/src/index.js';



vi.mock('../src/state/modules/triggerKeywordChoiceUtils.js', () => ({

  enqueueSupportedKeywordChoiceStep: vi.fn(() => false),

}));



import { applyRetiredTriggerLegacyKeywordTriggerFallback } from '../src/state/modules/oracleIrTriggerLegacyKeywordHandlers.js';

import { enqueueSupportedKeywordChoiceStep } from '../src/state/modules/triggerKeywordChoiceUtils.js';



describe('oracleIrTriggerLegacyKeywordHandlers', () => {

  it('returns false when no keywords are detected', () => {

    expect(applyRetiredTriggerLegacyKeywordTriggerFallback({

      ctx: {} as any,

      controller: 'p1' as PlayerID,

      sourceName: 'Vanilla Creature',

      description: 'A vanilla creature with no keywords.',

      triggerItem: { source: 'perm-1', triggerType: 'cast' },

      state: { players: [{ id: 'p1' }, { id: 'p2' }] },

      triggerCard: { name: 'Vanilla Creature', oracle_text: 'A vanilla creature with no keywords.' },

      battlefield: [{ id: 'perm-1', controller: 'p1', card: { name: 'Vanilla Creature', oracle_text: 'A vanilla creature with no keywords.' } }],

    })).toBe(false);

  });



  it('queues extort keyword choice on cast', () => {

    vi.mocked(enqueueSupportedKeywordChoiceStep).mockReturnValue(true);

    const state = {

      players: [{ id: 'p1' }, { id: 'p2' }],

      pendingKeywordChoice: [],

    };



    expect(applyRetiredTriggerLegacyKeywordTriggerFallback({

      ctx: { gameId: 'g1' } as any,

      controller: 'p1' as PlayerID,

      sourceName: 'Blind Obedience',

      description: 'Extort',

      triggerItem: { source: 'perm-1', triggerType: 'cast' },

      state,

      triggerCard: { name: 'Blind Obedience', oracle_text: 'Extort' },

      battlefield: [{

        id: 'perm-1',

        controller: 'p1',

        card: { name: 'Blind Obedience', oracle_text: 'Extort' },

      }],

    })).toBe(true);



    expect(enqueueSupportedKeywordChoiceStep).toHaveBeenCalledWith(

      expect.anything(),

      expect.objectContaining({ id: 'perm-1' }),

      'Blind Obedience',

      'perm-1',

      expect.objectContaining({ keyword: 'extort' }),

    );

    expect(state.pendingKeywordChoice).toHaveLength(0);

  });



  it('falls back to pendingKeywordChoice when queue step is unsupported', () => {

    vi.mocked(enqueueSupportedKeywordChoiceStep).mockReturnValue(false);

    const state = {

      players: [{ id: 'p1' }, { id: 'p2' }],

      pendingKeywordChoice: [],

    };



    expect(applyRetiredTriggerLegacyKeywordTriggerFallback({

      ctx: { gameId: 'g1' } as any,

      controller: 'p1' as PlayerID,

      sourceName: 'Blind Obedience',

      description: 'Extort',

      triggerItem: { source: 'perm-1', triggerType: 'cast' },

      state,

      triggerCard: { name: 'Blind Obedience', oracle_text: 'Extort' },

      battlefield: [{

        id: 'perm-1',

        controller: 'p1',

        card: { name: 'Blind Obedience', oracle_text: 'Extort' },

      }],

    })).toBe(true);



    expect(state.pendingKeywordChoice).toHaveLength(1);

    expect(state.pendingKeywordChoice[0]).toMatchObject({

      keyword: 'extort',

      playerId: 'p1',

      permanentId: 'perm-1',

      sourceName: 'Blind Obedience',

      sourceId: 'perm-1',

    });

  });

});


