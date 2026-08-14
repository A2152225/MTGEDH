import { describe, expect, it } from 'vitest';

import { viewFor } from '../src/state/modules/view.js';

function makeCtx(overrides: Record<string, any> = {}) {
  const p1 = 'p1';
  const p2 = 'p2';
  const hiddenCard = {
    id: 'hidden_1',
    name: 'Secret Cultivator',
    type_line: 'Creature — Elf Druid',
    oracle_text: 'When this creature enters, draw a card.',
    image_uris: { small: 'https://example.test/secret.jpg' },
  };
  const state: any = {
    players: [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }],
    startingLife: 40,
    life: { p1: 40, p2: 40 },
    turnPlayer: p1,
    step: 'MAIN1',
    phase: 'main',
    stack: [],
    commandZone: {},
    zones: {
      p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      p2: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    },
    battlefield: [
      {
        id: 'mosswort_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'mosswort_card',
          name: 'Mosswort Bridge',
          type_line: 'Land',
          oracle_text: 'Hideaway 4',
        },
        hideawayCard: { card: hiddenCard },
      },
    ],
    ...overrides.state,
  };
  if (overrides.exile) {
    state.zones.p1.exile = overrides.exile;
    state.zones.p1.exileCount = overrides.exile.length;
  }
  return {
    p1,
    p2,
    hiddenCard,
    ctx: {
      state,
      libraries: new Map(),
      commandZone: state.commandZone,
      inactive: new Set(),
      poison: {},
      experience: {},
      grants: new Map(),
    } as any,
  };
}

describe('hideaway exile visibility', () => {
  it('puts a legacy hideaway card into exile for the controller and masks it for opponents', () => {
    const { ctx, p1, p2 } = makeCtx();

    const controllerView = viewFor(ctx, p1, false);
    const opponentView = viewFor(ctx, p2, false);

    const controllerExile = (controllerView.zones as any)?.p1?.exile || [];
    const opponentExile = (opponentView.zones as any)?.p1?.exile || [];

    expect(controllerExile).toHaveLength(1);
    expect(controllerExile[0]).toMatchObject({
      id: 'hidden_1',
      name: 'Secret Cultivator',
      known: true,
      faceDown: true,
      hideawaySourcePermanentId: 'mosswort_1',
    });

    expect(opponentExile).toHaveLength(1);
    expect(opponentExile[0]).toMatchObject({
      id: 'hidden_1',
      faceDown: true,
      known: false,
      hideawaySourcePermanentId: 'mosswort_1',
    });
    expect(opponentExile[0].name).toBeUndefined();

    const controllerLand = controllerView.battlefield.find((p: any) => p.id === 'mosswort_1') as any;
    const opponentLand = opponentView.battlefield.find((p: any) => p.id === 'mosswort_1') as any;
    expect(controllerLand.hideawayCard?.card?.name).toBe('Secret Cultivator');
    expect(opponentLand.hideawayCard).toEqual({ present: true });
    expect(opponentLand.hideawayCard?.card).toBeUndefined();
  });

  it('does not duplicate a hideaway card already stored in exile', () => {
    const { ctx, p1 } = makeCtx({
      exile: [{
        id: 'hidden_1',
        name: 'Secret Cultivator',
        zone: 'exile',
        faceDown: true,
        hideawaySourcePermanentId: 'mosswort_1',
        canBeExaminedBy: ['p1'],
      }],
    });

    const view = viewFor(ctx, p1, false);
    const exile = (view.zones as any)?.p1?.exile || [];
    expect(exile).toHaveLength(1);
    expect(exile[0].id).toBe('hidden_1');
  });
});
