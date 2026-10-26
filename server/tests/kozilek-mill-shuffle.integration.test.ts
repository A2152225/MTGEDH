import { beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';

const ALTAR_EFFECT = 'each opponent mills a card.';

describe('Kozilek shuffle when milled', () => {
  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
  });

  it('shuffles the graveyard into the library when Altar of the Brood mills Kozilek', () => {
    const game = createInitialGameState('kozilek_altar_mill');
    const altarController = 'p1' as PlayerID;
    const milledPlayer = 'p2' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: altarController, name: 'Altar player' } as any);
    game.applyEvent!({ type: 'join', playerId: milledPlayer, name: 'Kozilek player' } as any);

    expect(isTriggerEffectOwnedByOracleIrPrimary(ALTAR_EFFECT, 'Altar of the Brood')).toBe(true);

    const printed = lookupLocalCardByNameSync('Kozilek, Butcher of Truth');
    expect(printed?.oracle_text).toMatch(/when kozilek is put into a graveyard from anywhere/i);
    expect(printed?.oracle_text).toMatch(/shuffles their graveyard into their library/i);

    const kozilek = { ...(printed || {}), id: 'kozilek', zone: 'library' };
    const island = { id: 'island', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' };
    const alreadyInGraveyard = { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', zone: 'graveyard' };

    const milledOwner = (game.state as any).players.find((entry: any) => entry.id === milledPlayer);
    milledOwner.library = [kozilek, island];
    milledOwner.graveyard = [alreadyInGraveyard];

    (game.state as any).zones[milledPlayer].library = [kozilek, island];
    (game.state as any).zones[milledPlayer].libraryCount = 2;
    (game.state as any).zones[milledPlayer].graveyard = [alreadyInGraveyard];
    (game.state as any).zones[milledPlayer].graveyardCount = 1;
    (game as any).libraries.set(milledPlayer, [kozilek, island]);

    executeTriggerEffect(game as any, altarController, 'Altar of the Brood', ALTAR_EFFECT, {
      type: 'triggered_ability',
      controller: altarController,
      sourceName: 'Altar of the Brood',
      triggerType: 'another_permanent_etb',
      description: ALTAR_EFFECT,
      effect: ALTAR_EFFECT,
    });

    const zones = (game.state as any).zones[milledPlayer];
    const libraryIds = ((game as any).libraries.get(milledPlayer) || []).map((card: any) => card.id);
    const zoneLibraryIds = (zones.library || []).map((card: any) => card.id);
    const playerLibraryIds = (milledOwner.library || []).map((card: any) => card.id);

    expect(zones.graveyard).toEqual([]);
    expect(zones.graveyardCount).toBe(0);
    expect(milledOwner.graveyard).toEqual([]);
    expect(libraryIds).toEqual(expect.arrayContaining(['kozilek', 'bolt', 'island']));
    expect(libraryIds).toHaveLength(3);
    expect(zoneLibraryIds).toEqual(expect.arrayContaining(['kozilek', 'bolt', 'island']));
    expect(playerLibraryIds).toEqual(expect.arrayContaining(['kozilek', 'bolt', 'island']));
  });

  it('replay of a mill event shuffles Kozilek and the other milled cards together', () => {
    const game = createInitialGameState('kozilek_mill_replay');
    const milledPlayer = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: milledPlayer, name: 'P1' } as any);

    const printed = lookupLocalCardByNameSync('Kozilek, Butcher of Truth');
    const kozilek = { ...(printed || {}), id: 'kozilek', zone: 'library' };
    const otherMilled = { id: 'other', name: 'Starstorm', type_line: 'Instant', zone: 'library' };
    const alreadyInGraveyard = { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', zone: 'graveyard' };

    (game.state as any).zones[milledPlayer].graveyard = [alreadyInGraveyard];
    (game.state as any).zones[milledPlayer].graveyardCount = 1;
    (game as any).libraries.set(milledPlayer, [kozilek, otherMilled, { id: 'island', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' }]);

    game.applyEvent!({ type: 'mill', playerId: milledPlayer, count: 2 } as any);

    const zones = (game.state as any).zones[milledPlayer];
    const libraryIds = ((game as any).libraries.get(milledPlayer) || []).map((card: any) => card.id);
    expect(zones.graveyard).toEqual([]);
    expect(libraryIds).toEqual(expect.arrayContaining(['kozilek', 'other', 'bolt', 'island']));
    expect(libraryIds).toHaveLength(4);
  });
});
