import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import {
  applyOnCastKeywordAndPlotEvents,
  ON_CAST_KEYWORD_COPY_EVENT,
  PLOT_LIBRARY_TOP_EVENT,
} from '../src/state/modules/apply-event-handlers/applyEventOnCastKeywordAndPlotReplay.js';

function makeCtx(state: any): any {
  return {
    state,
    bumpSeq() {
      this.seq = (this.seq || 0) + 1;
    },
    seq: 0,
  };
}

describe('plotLibraryTop applyEvent replay', () => {
  it('moves the library-top card to exile as plotted and is idempotent', () => {
    const card = { id: 'fblthp_top', name: 'Island', type_line: 'Basic Land — Island' };
    const ctx = makeCtx({
      battlefield: [{ id: 'land_1', controller: 'p1', tapped: false }],
      stack: [],
      manaPool: { p1: { blue: 2, colorless: 0 } },
      zones: {
        p1: { library: [card, { id: 'other', name: 'Forest' }], libraryCount: 2, exile: [], exileCount: 0 },
      },
    });

    applyEvent(ctx, {
      type: PLOT_LIBRARY_TOP_EVENT,
      playerId: 'p1',
      cardId: 'fblthp_top',
      cost: '{U}',
      card,
      manaPayment: { tappedPermanents: ['land_1'], paymentManaDelta: { blue: -1 } },
    } as any);

    const zones = ctx.state.zones.p1;
    expect(zones.library.map((c: any) => c.id)).toEqual(['other']);
    expect(zones.libraryCount).toBe(1);
    expect(zones.exile).toHaveLength(1);
    expect(zones.exile[0]).toMatchObject({
      id: 'fblthp_top',
      isPlotted: true,
      plotCost: '{U}',
      plottedBy: 'p1',
      zone: 'exile',
    });
    expect(ctx.state.battlefield[0].tapped).toBe(true);
    expect(ctx.state.manaPool.p1.blue).toBe(1);

    applyEvent(ctx, {
      type: PLOT_LIBRARY_TOP_EVENT,
      playerId: 'p1',
      cardId: 'fblthp_top',
      cost: '{U}',
      card,
      manaPayment: { tappedPermanents: ['land_1'], paymentManaDelta: { blue: -1 } },
    } as any);
    expect(zones.exile).toHaveLength(1);
    expect(ctx.state.manaPool.p1.blue).toBe(1);
  });

  it('restores a plotted card from the event snapshot if it is no longer in the library', () => {
    const card = { id: 'snap_1', name: 'Preordain', type_line: 'Sorcery', oracle_text: 'Scry 2, then draw a card.' };
    const ctx = makeCtx({
      battlefield: [],
      stack: [],
      zones: { p1: { library: [], libraryCount: 0, exile: [], exileCount: 0 } },
    });
    expect(applyOnCastKeywordAndPlotEvents(ctx, {
      type: PLOT_LIBRARY_TOP_EVENT,
      playerId: 'p1',
      cardId: 'snap_1',
      cost: '{U}',
      card,
    } as any)).toBe(true);
    expect(ctx.state.zones.p1.exile[0]).toMatchObject({ id: 'snap_1', isPlotted: true, name: 'Preordain' });
  });
});

describe('onCastKeywordCopy applyEvent replay', () => {
  it('puts the casualty/conspire/demonstrate copy on the stack with the persisted id', () => {
    const original = {
      id: 'spell_1',
      type: 'spell',
      controller: 'p1',
      card: { id: 'shock', name: 'Shock', grantedCasualty: 2 },
      targets: [{ playerId: 'p2' }],
    };
    const ctx = makeCtx({ battlefield: [], stack: [{ ...original }] });

    applyEvent(ctx, {
      type: ON_CAST_KEYWORD_COPY_EVENT,
      sourceStackItemId: 'spell_1',
      copiedStackItemId: 'copy_casualty_1',
      controllerId: 'p1',
      reason: 'Casualty',
      copy: { ...original, id: 'copy_casualty_1' },
    } as any);

    expect(ctx.state.stack).toHaveLength(2);
    expect(ctx.state.stack[0].copiedForCasualty).toBe(true);
    expect(ctx.state.stack[1]).toMatchObject({
      id: 'copy_casualty_1',
      controller: 'p1',
      card: { name: 'Shock' },
    });

    applyEvent(ctx, {
      type: ON_CAST_KEYWORD_COPY_EVENT,
      sourceStackItemId: 'spell_1',
      copiedStackItemId: 'copy_casualty_1',
      controllerId: 'p1',
      reason: 'Casualty',
    } as any);
    expect(ctx.state.stack).toHaveLength(2);
  });

  it('can restore a demonstrate copy for an opponent controller', () => {
    const original = {
      id: 'spell_demo',
      type: 'spell',
      controller: 'p1',
      card: { name: 'Creative Technique', grantedDemonstrate: true },
    };
    const ctx = makeCtx({ battlefield: [], stack: [{ ...original }] });
    applyEvent(ctx, {
      type: ON_CAST_KEYWORD_COPY_EVENT,
      sourceStackItemId: 'spell_demo',
      copiedStackItemId: 'copy_demo_opp',
      controllerId: 'p2',
      reason: 'DemonstrateOpponent',
      copy: { ...original, id: 'copy_demo_opp', controller: 'p2' },
    } as any);
    expect(ctx.state.stack[0].copiedForDemonstrateOpponent).toBe(true);
    expect(ctx.state.stack[1]).toMatchObject({ id: 'copy_demo_opp', controller: 'p2' });
  });
});
