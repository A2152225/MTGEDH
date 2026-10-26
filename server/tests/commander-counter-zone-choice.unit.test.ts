import { afterEach, describe, expect, it } from 'vitest';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { offerCommanderZoneChoiceForArrivals } from '../src/state/modules/commanderZoneChoiceOnEntry.js';
import { syncOracleIRPlayerZonesToContext } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerZoneHydrateDelayedBridges.js';

const gameId = 'test_commander_counter_zone_choice';

function ctxWithBackground(card: any) {
  return {
    gameId,
    isReplaying: false,
    state: {
      players: [{ id: 'p_owner', graveyard: [], exile: [] }],
      zones: {
        p_owner: { hand: [], graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      },
      commandZone: {
        p_owner: {
          commanderIds: ['bg_1'],
          commanderNames: ['Haunted One'],
          commanderCards: [{ id: 'bg_1', name: 'Haunted One' }],
          inCommandZone: [],
        },
      },
    },
  } as any;
}

describe('countered commander offers the command zone', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues a command-zone choice when a Background commander arrives in the graveyard', () => {
    const card = { id: 'bg_1', name: 'Haunted One', type_line: 'Legendary Enchantment — Background', isCommander: true };
    const ctx = ctxWithBackground(card);
    offerCommanderZoneChoiceForArrivals(ctx, 'p_owner', [card], 'graveyard');

    const step = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.commanderZoneChoice === true) as any;
    expect(step).toBeTruthy();
    expect(step.playerId).toBe('p_owner');
    expect(step.commanderId).toBe('bg_1');
    expect(step.destinationZone).toBe('graveyard');
    expect(step.options.map((option: any) => option.id)).toEqual(['command', 'stay']);
  });

  it('recognizes a commander by command-zone identity when the spell lost isCommander', () => {
    const card = { id: 'bg_1_cast', name: 'Haunted One', type_line: 'Legendary Enchantment — Background' };
    const ctx = ctxWithBackground(card);
    offerCommanderZoneChoiceForArrivals(ctx, 'p_owner', [card], 'graveyard');
    const steps = ResolutionQueueManager.getQueue(gameId).steps.filter((entry: any) => entry.commanderZoneChoice === true);
    expect(steps).toHaveLength(1);
    expect((steps[0] as any).commanderName).toBe('Haunted One');
  });

  it('does not prompt for a non-commander that was countered', () => {
    const card = { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' };
    const ctx = ctxWithBackground(card);
    offerCommanderZoneChoiceForArrivals(ctx, 'p_owner', [card], 'graveyard');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('prompts when Oracle IR copies a countered commander from the player graveyard onto zones', () => {
    const card = { id: 'bg_1', name: 'Haunted One', type_line: 'Legendary Enchantment — Background', isCommander: true, zone: 'graveyard' };
    const ctx = ctxWithBackground(card);
    ctx.state.players[0].graveyard = [card];
    syncOracleIRPlayerZonesToContext(ctx, ctx.state, 'p_owner', new Map());

    expect(ctx.state.zones.p_owner.graveyard.map((entry: any) => entry.id)).toEqual(['bg_1']);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.commanderZoneChoice === true);
    expect(step).toBeTruthy();
  });
});
