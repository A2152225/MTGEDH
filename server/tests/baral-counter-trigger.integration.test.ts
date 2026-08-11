import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function ensureZonesForPlayer(g: any, pid: PlayerID) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

function setupPlayerLibrary(g: any, pid: PlayerID, libraryIds: string[]) {
  const player = (g.state as any).players.find((entry: any) => entry.id === pid);
  player.library = libraryIds.map((id) => ({ id, name: id, zone: 'library' }));
  ensureZonesForPlayer(g, pid);
  (g.state as any).zones[pid].library = player.library.map((card: any) => ({ ...card }));
  (g.state as any).zones[pid].libraryCount = player.library.length;
  g.libraries = g.libraries || new Map();
  g.libraries.set(pid, player.library.map((card: any) => ({ ...card })));
}

describe('Baral counter trigger (integration)', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue('baral_force_spike_ir');
  });

  it('queues Baral optional loot after Counterspell resolves via IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'baral_force_spike_ir';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const stackBoltId = 'stack_bolt_baral';

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);
    (g as any).gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const baralPermanent = {
      id: 'baral',
      controller: p1,
      owner: p1,
      card: {
        id: 'baral_card',
        name: 'Baral, Chief of Compliance',
        type_line: 'Legendary Creature — Human Wizard',
        oracle_text:
          'Instant and sorcery spells you cast cost {1} less to cast.\nWhenever a spell or ability you control counters a spell, you may draw a card. If you do, discard a card.',
      },
    };

    g.applyEvent!({
      type: 'pushStack',
      item: {
        id: stackBoltId,
        type: 'spell',
        controller: p2,
        card: {
          id: 'bolt_card',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        },
        targets: [],
      },
    });

    g.importDeckResolved(p1, [{
      id: 'counterspell',
      name: 'Counterspell',
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      mana_cost: '{U}{U}',
    }] as any);
    g.drawCards(p1, 1);
    setupPlayerLibrary(g, p1, ['lib-1', 'lib-2', 'lib-3']);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'counterspell',
      targets: [stackBoltId],
    });

    // applyEvent/castSpell can rebuild state; place Baral after the cast so it survives resolve.
    (g.state as any).battlefield = [baralPermanent];

    expect(((g.state as any).stack || []).length).toBe(2);
    g.resolveTopOfStack();

    const stack = (g.state as any).stack || [];
    const baralTrigger = stack.find((item: any) =>
      item?.type === 'triggered_ability'
      && String(item?.card?.name || item?.sourceName || '').includes('Baral')
    );

    expect(stack.some((item: any) => item?.id === stackBoltId)).toBe(false);
    expect(baralTrigger).toBeTruthy();

    // Resolving Baral's trigger should queue the optional loot choice.
    g.resolveTopOfStack();
    const queue = ResolutionQueueManager.getQueue(gameId);
    const optionalLoot = (queue.steps || []).find((step: any) =>
      String(step?.type || '').toLowerCase() === 'option_choice'
      && (
        String(step?.sourceName || '').includes('Baral')
        || /draw/i.test(String(step?.description || ''))
      )
    );
    expect(optionalLoot).toBeTruthy();
  });
});
