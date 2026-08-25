import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { applyOracleIRUncategorizedSpellFallback } from '../src/state/modules/oracleIrUncategorizedSpellFallback.js';
import { applyInstantSorceryNibelheimAflameEffect } from '../src/state/modules/stackResolveSpellSpecialCaseUtils.js';
import { isSpellEffectOwnedByOracleIrPrimary } from '../src/state/modules/oracleIrSpellLegacyRouting.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0 (2026-08-25).
const NIBELHEIM_AFLAME =
  'Choose target creature you control. It deals damage equal to its power to each other creature. If this spell was cast from a graveyard, discard your hand and draw four cards.\nFlashback {5}{R}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';

function createNibelheimFallbackCtx(): { ctx: GameContext; playerId: PlayerID } {
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  const ctx = createContext('nibelheim_fallback') as GameContext;
  (ctx as any).state = {
    players: [{ id: playerId, name: 'P1', hasLost: false }, { id: opponentId, name: 'P2', hasLost: false }],
    life: { [playerId]: 40, [opponentId]: 40 },
    battlefield: [
      {
        id: 'source_1',
        controller: playerId,
        owner: playerId,
        damageMarked: 0,
        basePower: 3,
        baseToughness: 3,
        card: { name: 'Ifrit', type_line: 'Creature — Elemental', power: '3', toughness: '3' },
      },
      {
        id: 'ally_1',
        controller: playerId,
        owner: playerId,
        damageMarked: 0,
        card: { name: 'Giant', type_line: 'Creature — Giant', power: '5', toughness: '5' },
      },
      {
        id: 'enemy_1',
        controller: opponentId,
        owner: opponentId,
        damageMarked: 0,
        card: { name: 'Beast', type_line: 'Creature — Beast', power: '4', toughness: '4' },
      },
    ],
    zones: {
      [playerId]: {
        library: [
          { id: 'draw_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
          { id: 'draw_2', name: 'Shock', type_line: 'Instant', zone: 'library' },
          { id: 'draw_3', name: 'Faithless Looting', type_line: 'Sorcery', zone: 'library' },
          { id: 'draw_4', name: 'Tormenting Voice', type_line: 'Sorcery', zone: 'library' },
        ],
        libraryCount: 4,
        hand: [
          { id: 'hand_1', name: 'Spare Mountain', type_line: 'Basic Land — Mountain', zone: 'hand' },
          { id: 'hand_2', name: 'Spare Bolt', type_line: 'Instant', zone: 'hand' },
        ],
        handCount: 2,
        graveyard: [],
      },
      [opponentId]: { library: [], hand: [], handCount: 0, graveyard: [] },
    },
    stack: [],
    endOfTurnEffects: [],
  };
  const libraryCards = ((ctx as any).state.zones[playerId].library as any[]).map((card) => ({ ...card }));
  ctx.libraries.set(playerId, libraryCards);
  ctx.libraries.set(opponentId, []);
  return { ctx, playerId };
}

describe('Nibelheim Aflame chosen-creature power sweep IR', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('collects deal_damage from the targeted creature plus a graveyard-only discard/draw rider', () => {
    const steps = collectSpellResolutionEffectSteps(NIBELHEIM_AFLAME, 'Nibelheim Aflame');
    expect(steps).toMatchObject([
      { kind: 'choose_target_creature' },
      { kind: 'deal_damage' },
      { kind: 'conditional' },
    ]);
    expect(steps[1]).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'object_stat', stat: 'power' },
      source: { kind: 'raw', text: 'It' },
      target: { kind: 'raw', text: 'each other creature' },
    });
    const rider = steps[2] as {
      kind: 'conditional';
      condition?: { raw?: string };
      steps?: Array<{ kind: string; amount?: unknown }>;
    };
    expect(String(rider.condition?.raw || '').toLowerCase()).toContain('cast from a graveyard');
    expect((rider.steps || []).map((step) => step.kind)).toEqual(['discard', 'draw']);
  });

  it('marks the chosen-creature power sweep as IR-owned under spell primary without regressing leftover families', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(isSpellEffectOwnedByOracleIrPrimary(NIBELHEIM_AFLAME, 'Nibelheim Aflame')).toBe(true);
    expect(isSpellEffectOwnedByOracleIrPrimary(
      'Each player chooses a creature they control. Destroy the rest.\nFlashback {5}{W}{W}',
      'Divine Reckoning',
    )).toBe(true);
    expect(isSpellEffectOwnedByOracleIrPrimary(
      "Each opponent secretly chooses silence or snitch, then the choices are revealed. If each opponent chose silence, Prisoner's Dilemma deals 4 damage to each of them. If each opponent chose snitch, Prisoner's Dilemma deals 8 damage to each of them. Otherwise, Prisoner's Dilemma deals 12 damage to each opponent who chose silence.\nFlashback {5}{R}{R}",
      "Prisoner's Dilemma",
    )).toBe(true);
    expect(isSpellEffectOwnedByOracleIrPrimary(
      "Amass Orcs X. Mill X cards. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.\nFlashback—{3}{U}{R}, Exile X cards from your graveyard.",
      'Summons of Saruman',
    )).toBe(true);
  });

  it.each(['0', '1'] as const)(
    'uncategorized fallback applies the power sweep and graveyard rider at SPELL_PRIMARY=%s',
    (primary) => {
      process.env.ORACLE_IR_SPELL_PRIMARY = primary;
      const { ctx, playerId } = createNibelheimFallbackCtx();
      const applied = applyOracleIRUncategorizedSpellFallback(
        ctx,
        NIBELHEIM_AFLAME,
        playerId,
        'Nibelheim Aflame',
        undefined,
        undefined,
        'nibelheim_spell_1',
        true,
        {
          controllerId: playerId,
          sourceName: 'Nibelheim Aflame',
          sourceId: 'nibelheim_spell_1',
          castFromZone: 'graveyard',
          targetCreatureId: 'source_1',
          targetPermanentId: 'source_1',
          selectorContext: { targetCreatureId: 'source_1', targetPermanentId: 'source_1', castFromZone: 'graveyard' },
        },
        'spell',
        { targets: ['source_1'], card: { castFromGraveyard: true, castWithAbility: 'flashback' } },
        ['source_1'],
      );

      expect(applied).toBeGreaterThan(0);
      const battlefield = ctx.state.battlefield as Array<{ id: string; damageMarked?: number }>;
      expect(Number(battlefield.find((entry) => entry.id === 'source_1')?.damageMarked || 0)).toBe(0);
      expect(Number(battlefield.find((entry) => entry.id === 'ally_1')?.damageMarked || 0)).toBe(3);
      expect(Number(battlefield.find((entry) => entry.id === 'enemy_1')?.damageMarked || 0)).toBe(3);
      const zones = (ctx.state as any).zones?.[playerId];
      expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['draw_1', 'draw_2', 'draw_3', 'draw_4']);
      expect((zones?.graveyard || []).map((card: any) => card.id).sort()).toEqual(['hand_1', 'hand_2']);
    },
  );

  it('PRIMARY=0 special-case trampoline applies the same IR sweep and graveyard rider', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const { ctx, playerId } = createNibelheimFallbackCtx();
    applyInstantSorceryNibelheimAflameEffect(ctx, {
      controller: playerId,
      effectiveCard: { name: 'Nibelheim Aflame', oracle_text: NIBELHEIM_AFLAME },
      item: {
        id: 'nibelheim_spell_1',
        card: { oracle_text: NIBELHEIM_AFLAME, castFromGraveyard: true, castWithAbility: 'flashback' },
        castFromGraveyard: true,
      },
      targets: ['source_1'],
      isNibelheimAflameStyleSweep: true,
      hasNibelheimGraveyardRider: true,
    });

    const battlefield = ctx.state.battlefield as Array<{ id: string; damageMarked?: number }>;
    expect(Number(battlefield.find((entry) => entry.id === 'source_1')?.damageMarked || 0)).toBe(0);
    expect(Number(battlefield.find((entry) => entry.id === 'ally_1')?.damageMarked || 0)).toBe(3);
    expect(Number(battlefield.find((entry) => entry.id === 'enemy_1')?.damageMarked || 0)).toBe(3);
    const zones = (ctx.state as any).zones?.[playerId];
    expect((zones?.hand || []).map((card: any) => card.id)).toEqual(['draw_1', 'draw_2', 'draw_3', 'draw_4']);
  });
});
