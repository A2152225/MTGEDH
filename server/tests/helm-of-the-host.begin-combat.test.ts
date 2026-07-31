import { beforeAll, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { deleteGame, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ensureLocalCardLookupIndexSync } from '../src/services/localCardLookup.js';
import type { PlayerID } from '../../shared/src';

function setupToMain1(g: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  g.applyEvent({ type: 'nextTurn' });

  const sampleDeck = Array.from({ length: 20 }, (_, i) => ({
    id: `card_${i}`,
    name: `Test Card ${i}`,
    type_line: 'Creature',
    oracle_text: '',
  }));

  g.importDeckResolved(p1, sampleDeck);
  g.importDeckResolved(p2, sampleDeck.map(card => ({ ...card, id: `p2_${card.id}` })));

  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
  g.applyEvent({ type: 'nextStep' });
}

describe('Helm of the Host beginning-of-combat trigger', () => {
  let previousTriggerPrimary: string | undefined;

  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
  });

  beforeEach(() => {
    previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  });

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
  });

  it('creates a nonlegendary token copy with haste', () => {
    const g = createInitialGameState('helm_of_the_host_begin_combat');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const equippedCreatureId = 'legendary-merfolk';

    (g.state.battlefield as any[]).push(
      {
        id: equippedCreatureId,
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        summoningSickness: false,
        attachedEquipment: ['helm_1'],
        isEquipped: true,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'legendary_merfolk_card',
          name: 'Legendary Merfolk Test',
          type_line: 'Legendary Creature — Merfolk Wizard',
          oracle_text: 'Ward {1}',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'helm_1',
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        attachedTo: equippedCreatureId,
        card: {
          id: 'helm_card',
          name: 'Helm of the Host',
          type_line: 'Legendary Artifact — Equipment',
          oracle_text: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
        },
      },
    );

    g.applyEvent({ type: 'nextStep' });

    const stack = (g.state as any).stack || [];
    expect(stack.some((item: any) => item.type === 'triggered_ability' && item.source === 'helm_1')).toBe(true);

    resolveTopOfStack(g as any);

    const tokenCopies = (g.state.battlefield as any[]).filter(
      permanent => permanent.isToken && permanent.card?.name === 'Legendary Merfolk Test'
    );

    expect(tokenCopies).toHaveLength(1);

    const tokenCopy = tokenCopies[0] as any;
    expect(String(tokenCopy.card?.type_line || '').toLowerCase()).not.toContain('legendary');
    expect(String(tokenCopy.card?.oracle_text || '').toLowerCase()).toContain('haste');
    expect(tokenCopy.summoningSickness).toBe(false);
  });

  it('queues and persists the copied token\'s self ETB trigger', async () => {
    const gameId = 'helm_of_the_host_begin_combat_etb';
    await deleteGame(gameId);
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const equippedCreatureId = 'legendary-visionary';

    (g.state.battlefield as any[]).push(
      {
        id: equippedCreatureId,
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        summoningSickness: false,
        attachedEquipment: ['helm_2'],
        isEquipped: true,
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'legendary_visionary_card',
          name: 'Legendary Visionary Test',
          type_line: 'Legendary Creature — Merfolk Wizard',
          oracle_text: 'When Legendary Visionary Test enters, draw a card.',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'helm_2',
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        attachedTo: equippedCreatureId,
        card: {
          id: 'helm_card_2',
          name: 'Helm of the Host',
          type_line: 'Legendary Artifact — Equipment',
          oracle_text: "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
        },
      },
    );

    g.applyEvent({ type: 'nextStep' });

    const eventStart = getEvents(gameId).length;
    resolveTopOfStack(g as any);

    const tokenCopy = ((g.state.battlefield as any[]) || []).find(
      (permanent: any) => permanent?.isToken === true && permanent?.card?.name === 'Legendary Visionary Test',
    ) as any;
    expect(tokenCopy).toBeDefined();

    const liveTrigger = ((g.state as any).stack || []).find((item: any) => item?.source === tokenCopy.id) as any;
    expect(liveTrigger).toMatchObject({
      sourceName: 'Legendary Visionary Test',
      triggerType: 'etb',
    });

    const persistedTrigger = getEvents(gameId)
      .slice(eventStart)
      .find((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.sourceId === tokenCopy.id) as any;
    expect(persistedTrigger).toBeTruthy();
    expect(persistedTrigger.payload).toMatchObject({
      sourceId: tokenCopy.id,
      permanentId: tokenCopy.id,
      sourceName: 'Legendary Visionary Test',
      triggerType: 'etb',
    });
  });

  it('hydrates equipped creature oracle onto Helm copy tokens when the source snapshot is incomplete', () => {
    const g = createInitialGameState('helm_of_the_host_hydrate_copy');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const equippedCreatureId = 'zulaport-equipped';

    (g.state.battlefield as any[]).push(
      {
        id: equippedCreatureId,
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        summoningSickness: false,
        attachedEquipment: ['helm_3'],
        isEquipped: true,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'zulaport_card_snapshot',
          name: 'Zulaport Cutthroat',
          type_line: 'Creature — Human Rogue Ally',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'helm_3',
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        attachedTo: equippedCreatureId,
        card: {
          id: 'helm_card_3',
          name: 'Helm of the Host',
          type_line: 'Legendary Artifact — Equipment',
          oracle_text:
            "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
        },
      },
    );

    g.applyEvent({ type: 'nextStep' });
    resolveTopOfStack(g as any);

    const tokenCopy = ((g.state.battlefield as any[]) || []).find(
      (permanent: any) => permanent?.isToken === true && permanent?.card?.name === 'Zulaport Cutthroat',
    ) as any;

    expect(tokenCopy).toBeDefined();
    expect(String(tokenCopy.card?.type_line || '').toLowerCase()).not.toContain('legendary');
    expect(String(tokenCopy.card?.oracle_text || '').toLowerCase()).toContain('dies');
    expect(tokenCopy.isCopyToken).toBe(true);
    expect(tokenCopy.copyTokenOverrides?.removeLegendary).toBe(true);
  });

  it('fires hydrated death trigger when the Helm Zulaport copy token dies', () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    const g = createInitialGameState('helm_of_the_host_zulaport_death');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    (g.state as any).life = { [p1]: 40, [p2]: 40 };
    (g.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];

    const equippedCreatureId = 'zulaport-equipped-death';

    (g.state.battlefield as any[]).push(
      {
        id: equippedCreatureId,
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        summoningSickness: false,
        attachedEquipment: ['helm_death'],
        isEquipped: true,
        basePower: 1,
        baseToughness: 1,
        card: {
          id: 'zulaport_card_snapshot_death',
          name: 'Zulaport Cutthroat',
          type_line: 'Creature — Human Rogue Ally',
          power: '1',
          toughness: '1',
        },
      },
      {
        id: 'helm_death',
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        attachedTo: equippedCreatureId,
        card: {
          id: 'helm_card_death',
          name: 'Helm of the Host',
          type_line: 'Legendary Artifact — Equipment',
          oracle_text:
            "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
        },
      },
    );

    g.applyEvent({ type: 'nextStep' });
    g.resolveTopOfStack();

    const tokenCopy = ((g.state.battlefield as any[]) || []).find(
      (permanent: any) => permanent?.isToken === true && permanent?.card?.name === 'Zulaport Cutthroat',
    ) as any;
    expect(tokenCopy).toBeDefined();
    expect(String(tokenCopy.card?.oracle_text || '').toLowerCase()).toContain('dies');

    // Remove the equipped source so only the hydrated copy's death trigger fires.
    (g.state as any).battlefield = ((g.state.battlefield as any[]) || []).filter(
      (permanent: any) => permanent?.id !== equippedCreatureId,
    );

    const moved = movePermanentToGraveyard(g as any, String(tokenCopy.id), true);
    expect(moved).toBe(true);

    const stackItems = ((g.state as any).stack || []).filter((item: any) =>
      String(item?.sourceName || '').includes('Zulaport Cutthroat'),
    );
    expect(stackItems.length).toBeGreaterThan(0);
    expect(String(stackItems[0]?.controllerId || stackItems[0]?.controller || '')).toBe(activePlayer);
    expect(String(stackItems[0]?.description || stackItems[0]?.effect || '').toLowerCase()).toMatch(
      /loses 1 life/,
    );

    const opponent = activePlayer === p1 ? p2 : p1;
    g.resolveTopOfStack();
    expect((g.state.life as any)[activePlayer]).toBe(41);
    expect((g.state.life as any)[opponent]).toBe(39);
  });

  it('copies Morophon chosen creature type onto the Helm token (CR 707.2)', () => {
    const g = createInitialGameState('helm_of_the_host_morophon_chosen_type');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    setupToMain1(g, p1, p2);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const equippedCreatureId = 'morophon_1';

    (g.state.battlefield as any[]).push(
      {
        id: equippedCreatureId,
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        summoningSickness: false,
        chosenCreatureType: 'Dragon',
        attachedEquipment: ['helm_morophon'],
        isEquipped: true,
        basePower: 6,
        baseToughness: 6,
        card: {
          id: 'morophon_card',
          name: 'Morophon, the Boundless',
          type_line: 'Legendary Creature — Shapeshifter',
          oracle_text:
            'Changeling\nAs Morophon, the Boundless enters, choose a creature type.\nSpells you cast of the chosen type cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay.\nOther creatures you control of the chosen type get +1/+1.',
          power: '6',
          toughness: '6',
          chosenCreatureType: 'Dragon',
        },
      },
      {
        id: 'helm_morophon',
        controller: activePlayer,
        owner: activePlayer,
        tapped: false,
        attachedTo: equippedCreatureId,
        card: {
          id: 'helm_card_morophon',
          name: 'Helm of the Host',
          type_line: 'Legendary Artifact — Equipment',
          oracle_text:
            "At the beginning of combat on your turn, create a token that's a copy of equipped creature, except the token isn't legendary. That token gains haste.\nEquip {5}",
        },
      },
    );

    (g.state as any).morophonChosenType = { [equippedCreatureId]: 'Dragon' };

    g.applyEvent({ type: 'nextStep' });
    resolveTopOfStack(g as any);

    const tokenCopy = ((g.state.battlefield as any[]) || []).find(
      (permanent: any) =>
        permanent?.isToken === true
        && String(permanent?.card?.name || '').includes('Morophon'),
    ) as any;

    expect(tokenCopy).toBeDefined();
    expect(String(tokenCopy.chosenCreatureType || '')).toBe('Dragon');
    expect(String(tokenCopy.card?.chosenCreatureType || '')).toBe('Dragon');
    expect(String(tokenCopy.card?.type_line || '').toLowerCase()).not.toContain('legendary');
    expect(tokenCopy.copiedFromPermanentId).toBe(equippedCreatureId);
  });

});
