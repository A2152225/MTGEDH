import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { applyOracleIRUncategorizedSpellFallback } from '../src/state/modules/oracleIrUncategorizedSpellFallback.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';
import { shouldSkipLegacySpellRegexHandlers } from '../src/state/modules/oracleIrSpellLegacyRouting.js';

function createBaseCtx(playerId: PlayerID): GameContext {
  const ctx = createContext('test-game') as GameContext;

  (ctx as any).state = {
    players: [{ id: playerId, name: 'Player', hasLost: false }],
    life: { [playerId]: 40 },
    battlefield: [],
    zones: {
      [playerId]: {
        library: [],
        hand: [],
        handCount: 0,
        graveyard: [],
      },
    },
    stack: [],
    endOfTurnEffects: [],
  };

  ctx.libraries.set(playerId, Array.from({ length: 20 }, (_, index) => ({
    id: `lib_${index}`,
    name: `Library Card ${index}`,
    type_line: 'Instant',
  })));

  return ctx;
}

describe('Inspiring Call Oracle IR spell primary', () => {
  it('draws and grants indestructible under ORACLE_IR_SPELL_PRIMARY without legacy regex', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const playerId = 'p1' as PlayerID;
    const ctx = createBaseCtx(playerId);
    const state = (ctx as any).state;

    state.battlefield = [
      {
        id: 'c1',
        controller: playerId,
        card: { name: 'Merfolk', type_line: 'Creature — Merfolk' },
        counters: { '+1/+1': 1 },
      },
      {
        id: 'c2',
        controller: playerId,
        card: { name: 'Elf', type_line: 'Creature — Elf' },
        counters: { '+1/+1': 2 },
      },
      {
        id: 'c3',
        controller: playerId,
        card: { name: 'Vanilla', type_line: 'Creature — Human' },
        counters: {},
      },
    ];

    const oracleText =
      'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy them.)';

    expect(shouldSkipLegacySpellRegexHandlers(oracleText, 'Inspiring Call')).toBe(true);

    const outcome = tryResolveSpellViaOracleIR(ctx, {
      controller: playerId,
      spellName: 'Inspiring Call',
      oracleText,
      sourceId: 'inspiring-call-1',
    });

    expect(outcome.handled).toBe(true);
    expect(outcome.applied).toBe(2);
    expect(state.zones[playerId].hand.length).toBe(2);

    const hasIndestructible = (perm: any) => {
      const fromTemporaryAbilities = (perm?.temporaryAbilities || []).some((entry: any) => {
        const text = typeof entry === 'string' ? entry : String(entry?.ability || '');
        return text.toLowerCase().includes('indestructible');
      });
      const fromTemporaryEffects = (perm?.temporaryEffects || []).some((effect: any) =>
        (effect.grantedAbilities || []).includes('indestructible')
        || String(effect.description || '').toLowerCase().includes('indestructible')
      );
      return fromTemporaryAbilities || fromTemporaryEffects;
    };

    expect(hasIndestructible(state.battlefield.find((perm: any) => perm.id === 'c1'))).toBe(true);
    expect(hasIndestructible(state.battlefield.find((perm: any) => perm.id === 'c2'))).toBe(true);
    expect(hasIndestructible(state.battlefield.find((perm: any) => perm.id === 'c3'))).toBe(false);
  });
});

describe('Inspiring Call uncategorized IR fallback (primary OFF)', () => {
  it('draws and grants indestructible via uncategorized fallback without legacy regex', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';

    const playerId = 'p1' as PlayerID;
    const ctx = createBaseCtx(playerId);
    const state = (ctx as any).state;

    state.battlefield = [
      {
        id: 'c1',
        controller: playerId,
        card: { name: 'Merfolk', type_line: 'Creature — Merfolk' },
        counters: { '+1/+1': 1 },
      },
      {
        id: 'c2',
        controller: playerId,
        card: { name: 'Elf', type_line: 'Creature — Elf' },
        counters: { '+1/+1': 2 },
      },
      {
        id: 'c3',
        controller: playerId,
        card: { name: 'Vanilla', type_line: 'Creature — Human' },
        counters: {},
      },
    ];

    const oracleText =
      'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy them.)';

    const applied = applyOracleIRUncategorizedSpellFallback(
      ctx,
      oracleText,
      playerId,
      'Inspiring Call',
      undefined,
      undefined,
      'inspiring-call-legacy-off',
    );

    expect(applied).toBe(2);
    expect(state.zones[playerId].hand.length).toBe(2);

    const hasIndestructible = (perm: any) =>
      (perm?.temporaryAbilities || []).some((entry: any) =>
        String(typeof entry === 'string' ? entry : entry?.ability || '').toLowerCase().includes('indestructible'),
      )
      || (perm?.temporaryEffects || []).some((effect: any) =>
        (effect.grantedAbilities || []).includes('indestructible'),
      );

    expect(hasIndestructible(state.battlefield.find((perm: any) => perm.id === 'c1'))).toBe(true);
    expect(hasIndestructible(state.battlefield.find((perm: any) => perm.id === 'c2'))).toBe(true);
    expect(hasIndestructible(state.battlefield.find((perm: any) => perm.id === 'c3'))).toBe(false);
    expect(state.zones[playerId].hand.length).toBe(2);
  });
});

describe('Court of Garenbrig distribute counters via Oracle IR', () => {
  it('distributes two +1/+1 counters among up to two target creatures with replacement doubling', () => {
    const playerId = 'p1' as PlayerID;
    const ctx = createBaseCtx(playerId);
    const state = (ctx as any).state;

    state.battlefield = [
      {
        id: 'court_1',
        controller: playerId,
        card: {
          name: 'Branching Evolution',
          type_line: 'Enchantment',
          oracle_text: 'If one or more +1/+1 counters would be put on a creature you control, twice that many +1/+1 counters are put on that creature instead.',
        },
      },
      { id: 't1', controller: playerId, card: { name: 'A', type_line: 'Creature — Merfolk' }, counters: {} },
      { id: 't2', controller: playerId, card: { name: 'B', type_line: 'Creature — Merfolk' }, counters: {} },
    ];

    const effectText = 'Distribute two +1/+1 counters among up to two target creatures.';
    const ir = parseOracleTextToIR(effectText, 'Court of Garenbrig');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: playerId,
        sourceName: 'Court of Garenbrig',
        sourceObjectType: 'ability',
        selectorContext: { chosenObjectIds: ['t1', 't2'] },
      },
      { chosenObjectIds: ['t1', 't2'] },
    );

    const result = applyOracleIRStepsOnServer(
      ctx,
      state,
      steps,
      irCtx,
      { allowOptional: true },
      {
        controller: playerId,
        triggerItem: { targets: ['t1', 't2'] },
      },
    );

    expect(result.skippedSteps).toEqual([]);
    expect(state.battlefield.find((perm: any) => perm.id === 't1')?.counters?.['+1/+1']).toBe(2);
    expect(state.battlefield.find((perm: any) => perm.id === 't2')?.counters?.['+1/+1']).toBe(2);
  });
});
