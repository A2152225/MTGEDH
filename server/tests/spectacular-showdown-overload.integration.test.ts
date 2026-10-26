import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { resolveStackItemEffectiveCard } from '../src/state/modules/stackResolveEffectiveCardUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const GAME_ID = 'spectacular-showdown-overload';

function creature(id: string, controller: string, name: string) {
  return {
    id,
    controller,
    owner: controller,
    card: { name, type_line: 'Creature', power: '2', toughness: '2' },
    counters: {},
  };
}

function createCtx(): GameContext {
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  const ctx = createContext(GAME_ID) as GameContext;
  (ctx as any).state = {
    players: [
      { id: playerId, name: 'P1', hasLost: false, life: 40 },
      { id: opponentId, name: 'P2', hasLost: false, life: 40 },
    ],
    life: { [playerId]: 40, [opponentId]: 40 },
    turnNumber: 4,
    battlefield: [
      creature('mine', playerId, 'Goblin'),
      creature('theirs', opponentId, 'Bear'),
      {
        id: 'mountain',
        controller: playerId,
        owner: playerId,
        card: { name: 'Mountain', type_line: 'Basic Land — Mountain' },
        counters: {},
      },
    ],
    zones: {
      [playerId]: { library: [], hand: [], graveyard: [], exile: [] },
      [opponentId]: { library: [], hand: [], graveyard: [], exile: [] },
    },
    stack: [],
  };
  return ctx;
}

describe('Spectacular Showdown overload', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    ResolutionQueueManager.clearAllSteps(GAME_ID);
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
  });

  it('overloaded resolution puts a double strike counter on each creature and goads those creatures', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const printed = lookupLocalCardByNameSync('Spectacular Showdown');
    const oracleText = String(printed?.oracle_text || '').trim();
    expect(oracleText).toMatch(/double strike counter on target creature/i);

    const card = {
      id: 'showdown',
      name: 'Spectacular Showdown',
      type_line: 'Sorcery',
      oracle_text: oracleText,
    };
    const { effectiveCard } = resolveStackItemEffectiveCard(
      { alternateCostId: 'overload', card },
      card,
    );
    expect(String(effectiveCard.oracle_text)).toMatch(/double strike counter on each creature/i);
    expect(String(effectiveCard.oracle_text)).not.toMatch(/on target creature/i);
    expect(card.oracle_text).toMatch(/on target creature/i);

    const ctx = createCtx();
    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: 'p1' as PlayerID,
      spellName: 'Spectacular Showdown',
      oracleText: String(effectiveCard.oracle_text),
      sourceId: 'showdown-stack',
      targets: [],
      sourceItem: { id: 'showdown-stack', alternateCostId: 'overload', card },
      card,
      effectiveCard,
    });

    expect(outcome.handled).toBe(true);
    const battlefield = ((ctx as any).state.battlefield || []) as any[];
    const byId = Object.fromEntries(battlefield.map((perm) => [perm.id, perm]));
    expect(byId.mine.counters['double strike']).toBe(1);
    expect(byId.theirs.counters['double strike']).toBe(1);
    expect(byId.mountain.counters?.['double strike']).toBeUndefined();
    expect(byId.mine.goadedBy).toContain('p1');
    expect(byId.theirs.goadedBy).toContain('p1');
    expect(byId.mountain.goadedBy).toBeUndefined();
  });

  it('a normal cast puts the counter and goad on the chosen creature only', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const printed = lookupLocalCardByNameSync('Spectacular Showdown');
    const oracleText = String(printed?.oracle_text || '').trim();
    const card = {
      id: 'showdown-normal',
      name: 'Spectacular Showdown',
      type_line: 'Sorcery',
      oracle_text: oracleText,
    };
    const { effectiveCard } = resolveStackItemEffectiveCard({ card }, card);
    expect(String(effectiveCard.oracle_text)).toMatch(/on target creature/i);

    const ctx = createCtx();
    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: 'p1' as PlayerID,
      spellName: 'Spectacular Showdown',
      oracleText: String(effectiveCard.oracle_text),
      sourceId: 'showdown-normal-stack',
      targets: ['theirs'],
      card,
      effectiveCard,
    });

    expect(outcome.handled).toBe(true);
    const battlefield = ((ctx as any).state.battlefield || []) as any[];
    const byId = Object.fromEntries(battlefield.map((perm) => [perm.id, perm]));
    expect(byId.theirs.counters['double strike']).toBe(1);
    expect(byId.theirs.goadedBy).toContain('p1');
    expect(byId.mine.counters?.['double strike']).toBeUndefined();
    expect(byId.mine.goadedBy).toBeUndefined();
  });
});
