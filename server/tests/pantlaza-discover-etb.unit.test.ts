import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { queuePermanentEntersBattlefieldTriggerStackItems } from '../src/state/modules/stackResolvePermanentEtbTriggerUtils.js';
import { recordDoThisOnlyOnceEachTurnOnAccept } from '../src/state/modules/triggerDoThisOnlyOnceEachTurn.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

// Oracle from oracle-cards.jsonl (Pantlaza, Sun-Favored)
const PANTLAZA_ORACLE =
  "Whenever Pantlaza or another Dinosaur you control enters, you may discover X, where X is that creature's toughness. Do this only once each turn. (Exile cards from the top of your library until you exile a nonland card with that mana value or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order.)";

function pantlazaPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Pantlaza, Sun-Favored',
      type_line: 'Legendary Creature — Dinosaur',
      oracle_text: PANTLAZA_ORACLE,
      power: '4',
      toughness: '4',
    },
  };
}

function dinosaurPermanent(id: string, controller: string, toughness = '6') {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Ghalta, Primal Hunger',
      type_line: 'Legendary Creature — Elder Dinosaur',
      oracle_text: '',
      power: '12',
      toughness,
    },
  };
}

function bearPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
}

describe('Pantlaza, Sun-Favored discover ETB', () => {
  it('detects named-or-another dinosaur ETB with toughness-bound discover', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Pantlaza, Sun-Favored',
        type_line: 'Legendary Creature — Dinosaur',
        oracle_text: PANTLAZA_ORACLE,
      },
      { id: 'pantlaza_1', controller: 'p1' },
    );

    const named = triggers.find((t) => t.triggerType === 'named_or_another_typed_etb');
    expect(named).toBeDefined();
    expect(String((named as any)?.requiredTypePhrase || '')).toMatch(/dinosaur/i);
    expect((named as any)?.doThisOnlyOnceEachTurn).toBe(true);
    expect(String(named?.effect || '')).toMatch(/discover x/i);
    expect(String(named?.effect || '')).toMatch(/that creature's toughness/i);
    expect(named?.mandatory).toBe(false);
  });

  it('queues on Pantlaza entering and binds X to his toughness', () => {
    const g = createInitialGameState('t_pantlaza_self_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    (g.state.battlefield as any).push(pantlaza);

    queueSelfETBTriggersForPermanent(g as any, pantlaza, p1);
    const stacked = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.xValue).toBe(4);
    expect(stacked?.interveningIfSubjectPermanentId).toBe(pantlaza.id);
    expect(stacked?.doThisOnlyOnceEachTurn).toBe(true);
  });

  it('queues when another dinosaur you control enters, using that creature\'s toughness', () => {
    const g = createInitialGameState('t_pantlaza_other_dino');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    const ghalta = dinosaurPermanent('ghalta_1', p1, '12');
    (g.state.battlefield as any).push(pantlaza, ghalta);

    triggerETBEffectsForPermanent(g as any, ghalta, p1);
    const stacked = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.xValue).toBe(12);
    expect(stacked?.interveningIfSubjectPermanentId).toBe(ghalta.id);
  });

  it('queues when Temple Altisaur (Creature — Dinosaur) enters, using its toughness', () => {
    const g = createInitialGameState('t_pantlaza_temple_altisaur');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    const temple = {
      id: 'temple_altisaur_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'temple_altisaur_card',
        name: 'Temple Altisaur',
        type_line: 'Creature — Dinosaur',
        oracle_text:
          'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.',
        power: '3',
        toughness: '4',
      },
    };
    (g.state.battlefield as any).push(pantlaza, temple);

    triggerETBEffectsForPermanent(g as any, temple, p1);
    const stacked = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.xValue).toBe(4);
    expect(stacked?.interveningIfSubjectPermanentId).toBe(temple.id);
  });

  it('queues from the live creature-spell ETB path when another Dinosaur is played', () => {
    const g = createInitialGameState('t_pantlaza_live_spell_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    const temple = {
      id: 'temple_altisaur_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'temple_altisaur_card',
        name: 'Temple Altisaur',
        type_line: 'Creature — Dinosaur',
        oracle_text:
          'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.',
        power: '3',
        toughness: '4',
      },
    };
    (g.state.battlefield as any).push(pantlaza, temple);

    queuePermanentEntersBattlefieldTriggerStackItems(g as any, {
      controller: p1,
      card: temple.card,
      effectiveCard: temple.card,
      newPermanent: temple,
      newPermId: temple.id,
      isCreature: true,
    });

    const stacked = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
    );
    expect(stacked).toBeTruthy();
    expect(stacked?.xValue).toBe(4);
    expect(stacked?.interveningIfSubjectPermanentId).toBe(temple.id);
    expect(stacked?.doThisOnlyOnceEachTurn).toBe(true);
    expect(stacked?.source).toBe(pantlaza.id);
  });

  it('does not queue for a non-Dinosaur creature', () => {
    const g = createInitialGameState('t_pantlaza_bear');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    const bear = bearPermanent('bear_1', p1);
    (g.state.battlefield as any).push(pantlaza, bear);

    triggerETBEffectsForPermanent(g as any, bear, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
      ),
    ).toBe(false);
  });

  it('does not queue again after the optional discover is accepted this turn', () => {
    const g = createInitialGameState('t_pantlaza_once');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    (g.state.battlefield as any).push(pantlaza);
    queueSelfETBTriggersForPermanent(g as any, pantlaza, p1);
    const first = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Pantlaza, Sun-Favored',
    );
    expect(first).toBeTruthy();

    recordDoThisOnlyOnceEachTurnOnAccept(g.state, first);
    g.state.stack = [] as any;

    const ghalta = dinosaurPermanent('ghalta_1', p1);
    (g.state.battlefield as any).push(ghalta);
    triggerETBEffectsForPermanent(g as any, ghalta, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Pantlaza, Sun-Favored' && s?.triggerType === 'named_or_another_typed_etb',
      ),
    ).toBe(false);
  });

  it('queues a cast-or-put-in-hand prompt for the Discover hit', () => {
    const gameId = 't_pantlaza_discover_prompt';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    ResolutionQueueManager.removeQueue(gameId);

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
      { id: 'ghalta-1', name: 'Ghalta, Primal Hunger', type_line: 'Legendary Creature — Elder Dinosaur', cmc: 12, mana_value: 12 },
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, mana_value: 1 },
    ];
    player.exile = [];
    player.hand = [];
    (g as any).libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    (g.state.battlefield as any).push(pantlazaPermanent('pantlaza_1', p1));

    const ir = parseOracleTextToIR(PANTLAZA_ORACLE, 'Pantlaza, Sun-Favored');
    const steps = ir.abilities.find((ability) =>
      ability.steps.some((step) => step.kind === 'impulse_exile_top'),
    )?.steps ?? [];
    expect(steps.some((step) => step.kind === 'impulse_exile_top')).toBe(true);

    applyOracleIRStepsOnServer(
      g as any,
      g.state as any,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'pantlaza_1',
        sourceName: 'Pantlaza, Sun-Favored',
        xValue: 4,
        targetPermanentId: 'pantlaza_1',
        chosenObjectIds: ['pantlaza_1'],
        selectorContext: { chosenObjectIds: ['pantlaza_1'], targetPermanentId: 'pantlaza_1' },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
      { controller: p1, sourceId: 'pantlaza_1', sourceName: 'Pantlaza, Sun-Favored' },
    );

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    const exileNames = (playerAfter?.exile || []).map((card: any) => String(card?.name || ''));
    expect(exileNames).toContain('Lightning Bolt');

    const prompt = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (step: any) =>
        step?.type === ResolutionStepType.OPTION_CHOICE &&
        String(step?.castFromExileCardId || '') === 'bolt-1',
    );
    expect(prompt).toBeTruthy();
    expect((prompt as any)?.castFromExileDeclineDestination).toBe('hand');
    expect((prompt as any)?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cast' }),
        expect.objectContaining({ id: 'decline', label: expect.stringMatching(/hand/i) }),
      ]),
    );

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('queues cast-or-hand from executeTriggerEffect using the stacked ETB item', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    const gameId = 't_pantlaza_discover_execute';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    ResolutionQueueManager.removeQueue(gameId);
    (g as any).gameId = gameId;

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
      { id: 'ghalta-1', name: 'Ghalta, Primal Hunger', type_line: 'Legendary Creature — Elder Dinosaur', cmc: 12, mana_value: 12 },
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1, mana_value: 1 },
    ];
    player.exile = [];
    player.hand = [];
    (g as any).libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    const pantlaza = pantlazaPermanent('pantlaza_1', p1);
    (g.state.battlefield as any).push(pantlaza);

    executeTriggerEffect(
      g as any,
      p1,
      'Pantlaza, Sun-Favored',
      "you may discover X, where X is that creature's toughness",
      {
        id: 'pantlaza_etb',
        source: pantlaza.id,
        permanentId: pantlaza.id,
        sourceId: pantlaza.id,
        triggerType: 'named_or_another_typed_etb',
        xValue: 4,
        interveningIfSubjectPermanentId: pantlaza.id,
        doThisOnlyOnceEachTurn: true,
        mandatory: false,
        optionalTriggeredAbilityDecisionApplied: true,
        card: pantlaza.card,
      },
    );

    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    const exileNames = (playerAfter?.exile || []).map((card: any) => String(card?.name || ''));
    expect(exileNames).toContain('Lightning Bolt');

    const prompt = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (step: any) =>
        step?.type === ResolutionStepType.OPTION_CHOICE &&
        String(step?.castFromExileCardId || '') === 'bolt-1',
    );
    expect(prompt).toBeTruthy();
    expect((prompt as any)?.castFromExileDeclineDestination).toBe('hand');

    ResolutionQueueManager.removeQueue(gameId);
  });
});
