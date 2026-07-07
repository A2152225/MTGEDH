import { describe, expect, it } from 'vitest';
import { viewFor } from '../src/state/modules/view.js';
import { getContinuousGrantedAbilitiesForPermanent, syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import { collectBattlefieldAbilityBadgesForView } from '../src/state/modules/battlefieldAbilityBadges.js';

describe('Agent of the Shadow Thieves badge regression', () => {
  it('does not show indestructible/deathtouch on background or commander before attack trigger', () => {
    const p1 = 'p1';
    const oracle =
      'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."';

    const state: any = {
      players: [{ id: p1, name: 'P1' }, { id: 'p2', name: 'P2' }],
      startingLife: 40,
      life: { p1: 40, p2: 40 },
      turnPlayer: p1,
      step: 'declareAttackers',
      phase: 'combat',
      zones: {
        p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
        p2: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      },
      stack: [],
      commandZone: {
        p1: { commanderIds: ['cmd_card'], commanderNames: ['Test Commander'] },
      },
      battlefield: [
        {
          id: 'cmd_1',
          controller: p1,
          owner: p1,
          isCommander: true,
          counters: {},
          card: {
            id: 'cmd_card',
            name: 'Test Commander',
            type_line: 'Legendary Creature — Human Rogue',
            power: '2',
            toughness: '2',
          },
        },
        {
          id: 'bg_1',
          controller: p1,
          owner: p1,
          card: {
            id: 'bg_card',
            name: 'Agent of the Shadow Thieves',
            type_line: 'Legendary Enchantment — Background',
            oracle_text: oracle,
          },
        },
      ],
    };

    syncDerivedContinuousEffects(state);

    const bg = state.battlefield.find((p: any) => p.id === 'bg_1');
    const cmd = state.battlefield.find((p: any) => p.id === 'cmd_1');

    const ctx: any = {
      state,
      libraries: new Map(),
      commandZone: state.commandZone,
      inactive: new Set(),
      poison: {},
      experience: {},
      grants: new Map(),
    };

    const view = viewFor(ctx, p1, false);
    const viewBg = view.battlefield.find((p: any) => p.id === 'bg_1');
    const viewCmd = view.battlefield.find((p: any) => p.id === 'cmd_1');

    const normalize = (abilities: unknown) =>
      (Array.isArray(abilities) ? abilities : []).map((a) => String(a).toLowerCase());

    expect(normalize(collectBattlefieldAbilityBadgesForView(bg, getContinuousGrantedAbilitiesForPermanent(bg, state)))).not.toEqual(
      expect.arrayContaining(['deathtouch', 'indestructible']),
    );
    expect(normalize((viewBg as any)?.grantedAbilities)).not.toEqual(
      expect.arrayContaining(['deathtouch', 'indestructible']),
    );
    expect(normalize((viewCmd as any)?.grantedAbilities)).not.toEqual(
      expect.arrayContaining(['deathtouch', 'indestructible']),
    );
  });

  it('strips polluted grantedAbilities from the client view on commander-grant backgrounds', () => {
    const p1 = 'p1';
    const oracle =
      'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, put a +1/+1 counter on this creature. It gains deathtouch and indestructible until end of turn."';

    const state: any = {
      players: [{ id: p1, name: 'P1' }],
      startingLife: 40,
      life: { p1: 40 },
      turnPlayer: p1,
      step: 'main1',
      phase: 'precombatMain',
      zones: {
        p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      },
      stack: [],
      commandZone: { p1: { commanderIds: [], commanderNames: [] } },
      battlefield: [
        {
          id: 'bg_1',
          controller: p1,
          owner: p1,
          grantedAbilities: ['deathtouch', 'indestructible'],
          card: {
            id: 'bg_card',
            name: 'Agent of the Shadow Thieves',
            type_line: 'Legendary Enchantment — Background',
            oracle_text: oracle,
          },
        },
      ],
    };

    const ctx: any = {
      state,
      libraries: new Map(),
      commandZone: state.commandZone,
      inactive: new Set(),
      poison: {},
      experience: {},
      grants: new Map(),
    };

    const viewBg = viewFor(ctx, p1, false).battlefield.find((p: any) => p.id === 'bg_1');
    expect((viewBg as any)?.grantedAbilities || []).toEqual([]);
  });
});
