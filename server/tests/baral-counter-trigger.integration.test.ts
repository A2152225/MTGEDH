import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';

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

function setupBaralCounterScenario(gameId: string) {
  process.env.ORACLE_IR_SPELL_PRIMARY = '1';
  process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

  const g = createInitialGameState(gameId);
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;
  const stackBoltId = `stack_bolt_${gameId}`;

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
  (g.state as any).battlefield = [baralPermanent];

  const hand = Array.isArray((g.state as any).zones[p1].hand) ? (g.state as any).zones[p1].hand : [];
  hand.push({ id: 'keep-1', name: 'Island', type_line: 'Basic Land — Island', zone: 'hand' });
  (g.state as any).zones[p1].hand = hand;
  (g.state as any).zones[p1].handCount = hand.length;

  return { g, p1, p2, stackBoltId };
}

describe('Baral counter trigger (integration)', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue('baral_force_spike_ir');
    ResolutionQueueManager.removeQueue('baral_single_may');
  });

  it('queues a single IR Effect Program may choice after Counterspell (no stack deferral)', () => {
    const gameId = 'baral_force_spike_ir';
    const { g, p1, stackBoltId } = setupBaralCounterScenario(gameId);

    expect(((g.state as any).stack || []).length).toBe(2);
    g.resolveTopOfStack(); // Counterspell → Baral trigger on stack

    const stack = (g.state as any).stack || [];
    const baralTrigger = stack.find((item: any) =>
      item?.type === 'triggered_ability'
      && String(item?.card?.name || item?.sourceName || '').includes('Baral')
    );
    expect(stack.some((item: any) => item?.id === stackBoltId)).toBe(false);
    expect(baralTrigger).toBeTruthy();

    g.resolveTopOfStack(); // Baral resolves → one EP may prompt

    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const stackDeferral = pending.find((step: any) =>
      String(step?.effectProgramFamily || '') === 'optional_triggered_ability'
    );
    expect(stackDeferral).toBeUndefined();

    const mayChoice = pending.find((step: any) =>
      step.type === ResolutionStepType.OPTION_CHOICE
      && /you may draw a card/i.test(String(step?.description || ''))
    );
    expect(mayChoice).toBeTruthy();
    expect(String((mayChoice as any)?.effectProgramFamily || '')).toBe('trigger_resolution');
    expect(pending.filter((step: any) => step.type === ResolutionStepType.OPTION_CHOICE)).toHaveLength(1);
  });

  it('after accepting the single may, draws and queues discard without a second may', () => {
    const gameId = 'baral_single_may';
    const { g, p1 } = setupBaralCounterScenario(gameId);

    g.resolveTopOfStack();
    g.resolveTopOfStack();

    const mayChoice = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find((step: any) =>
      step.type === ResolutionStepType.OPTION_CHOICE
      && /you may draw a card/i.test(String(step?.description || ''))
    ) as any;
    expect(mayChoice).toBeTruthy();

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(mayChoice.id), {
      stepId: String(mayChoice.id),
      playerId: p1,
      selections: ['yes'],
      cancelled: false,
      timestamp: Date.now(),
    });
    expect(completedStep).toBeTruthy();
    expect((completedStep as any)?.effectProgramPrompt).toBe(true);

    resumeEffectProgramResolution({
      game: g as any,
      gameId,
      step: completedStep!,
      response: completedStep!.response!,
      persistPrompt: true,
    });

    const pending = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const secondMay = pending.find((step: any) =>
      step.type === ResolutionStepType.OPTION_CHOICE
      && /you may draw a card/i.test(String(step?.description || ''))
    );
    expect(secondMay).toBeUndefined();
    expect(pending.some((step: any) =>
      String(step?.effectProgramFamily || '') === 'optional_triggered_ability'
    )).toBe(false);

    const discardStep = pending.find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION);
    const handAfter = (g.state as any).zones?.[p1]?.hand || [];
    expect(Boolean(discardStep) || handAfter.length >= 2).toBe(true);
  });
});
