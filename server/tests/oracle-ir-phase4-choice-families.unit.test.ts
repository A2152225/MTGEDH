import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext, type GameContext } from '../src/state/context.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isSpellEffectOwnedByOracleIrPrimary } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { requiresSpellEffectProgramOrchestration } from '../src/state/modules/oracleIrEffectProgramServer.js';
import { applyInstantSorcerySpecialCaseSpellEffects } from '../src/state/modules/stackResolveSpellSpecialCaseUtils.js';
import { queueEachPlayerChooseThenDestroyRestPrompts } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerChooseDestroyRestSecretDamagePrompts.js';

// Quoted from mtg_data.db cards.text WHERE is_token = 0 (2026-08-25).
const DIVINE_RECKONING =
  'Each player chooses a creature they control. Destroy the rest.\nFlashback {5}{W}{W} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';

const PRISONERS_DILEMMA =
  "Each opponent secretly chooses silence or snitch, then the choices are revealed. If each opponent chose silence, Prisoner's Dilemma deals 4 damage to each of them. If each opponent chose snitch, Prisoner's Dilemma deals 8 damage to each of them. Otherwise, Prisoner's Dilemma deals 12 damage to each opponent who chose silence.\nFlashback {5}{R}{R}";

const SUMMONS_OF_SARUMAN =
  "Amass Orcs X. Mill X cards. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost. (To amass Orcs X, put X +1/+1 counters on an Army you control. It's also an Orc. If you don't control an Army, create a 0/0 black Orc Army creature token first.)\nFlashback—{3}{U}{R}, Exile X cards from your graveyard.";

const SUMMONS_TEST_VARIANT =
  'Amass Orcs X, then mill X cards. You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost.\nFlashback {3}{U}{R}, Exile X cards from your graveyard.';

describe('Phase 4 leftover choice-family IR ownership', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('collects Divine Reckoning as each_player_choose_then_destroy_rest only', () => {
    const steps = collectSpellResolutionEffectSteps(DIVINE_RECKONING, 'Divine Reckoning');
    expect(steps.map((step) => step.kind)).toEqual(['each_player_choose_then_destroy_rest']);
    expect(steps[0]).toMatchObject({
      keepTypes: ['creature'],
      keepCount: 1,
    });
    expect(steps.some((step) => step.kind === 'destroy')).toBe(false);
  });

  it('collects Prisoner\'s Dilemma as secret_opponent_choice_damage only', () => {
    const steps = collectSpellResolutionEffectSteps(PRISONERS_DILEMMA, "Prisoner's Dilemma");
    expect(steps.map((step) => step.kind)).toEqual(['secret_opponent_choice_damage']);
    expect(steps[0]).toMatchObject({
      choices: ['silence', 'snitch'],
      secret: true,
      allFirstDamage: 4,
      allSecondDamage: 8,
      mixedFirstDamage: 12,
    });
    expect(steps.some((step) => step.kind === 'deal_damage')).toBe(false);
  });

  it('collects Summons of Saruman with mill plus may_cast_from_among, not graveyard permission', () => {
    const steps = collectSpellResolutionEffectSteps(SUMMONS_OF_SARUMAN, 'Summons of Saruman');
    expect(steps.some((step) => step.kind === 'mill')).toBe(true);
    expect(steps.some((step) => step.kind === 'may_cast_from_among')).toBe(true);
    expect(steps.some((step) => step.kind === 'grant_graveyard_permission')).toBe(false);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
    const mayCast = steps.find((step) => step.kind === 'may_cast_from_among');
    expect(mayCast).toMatchObject({
      among: 'milled_this_way',
      cardTypes: ['instant', 'sorcery'],
      withoutPayingManaCost: true,
    });
  });

  it('also parses the comma-then Summons mill lead used by flashback tests', () => {
    const steps = collectSpellResolutionEffectSteps(SUMMONS_TEST_VARIANT, 'Summons of Saruman');
    expect(steps.some((step) => step.kind === 'may_cast_from_among')).toBe(true);
    expect(steps.some((step) => step.kind === 'grant_graveyard_permission')).toBe(false);
  });

  it('keeps Summons mill-from-among may-cast on direct IR, not Effect Program Yes/No', () => {
    const corpusSteps = collectSpellResolutionEffectSteps(SUMMONS_OF_SARUMAN, 'Summons of Saruman');
    const testVariantSteps = collectSpellResolutionEffectSteps(SUMMONS_TEST_VARIANT, 'Summons of Saruman');
    expect(requiresSpellEffectProgramOrchestration(corpusSteps)).toBe(false);
    expect(requiresSpellEffectProgramOrchestration(testVariantSteps)).toBe(false);
  });

  it('marks the three leftover families as IR-owned under spell primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(isSpellEffectOwnedByOracleIrPrimary(DIVINE_RECKONING, 'Divine Reckoning')).toBe(true);
    expect(isSpellEffectOwnedByOracleIrPrimary(PRISONERS_DILEMMA, "Prisoner's Dilemma")).toBe(true);
    expect(isSpellEffectOwnedByOracleIrPrimary(SUMMONS_OF_SARUMAN, 'Summons of Saruman')).toBe(true);
  });

  it('PRIMARY=0 Divine special-case trampolines to IR and queues survivor choices', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const { ctx, playerId, opponentId, gameId } = createDivineChoiceCtx();
    applyInstantSorcerySpecialCaseSpellEffects(ctx, {
      controller: playerId,
      card: { id: 'divine_spell_1', name: 'Custom Reckoning', oracle_text: DIVINE_RECKONING },
      effectiveCard: { name: 'Custom Reckoning', oracle_text: DIVINE_RECKONING },
      item: { id: 'divine_spell_1', card: { oracle_text: DIVINE_RECKONING } },
      gameId,
      spellXValue: undefined,
      isRiteOfHarmonyStyleWindow: false,
      isDivineReckoningStyleChoice: true,
      isPrisonersDilemmaStyleChoice: false,
      isSummonsOfSarumanStyle: false,
    });

    const queued = ResolutionQueueManager.getQueue(gameId).steps
      .filter((step: any) => step?.divineReckoningChoice === true);
    expect(queued.map((step: any) => String(step.playerId))).toEqual([playerId, opponentId]);
    expect((queued[0] as any).validTargets.map((target: any) => target.id).sort()).toEqual(['p1_keep', 'p1_rest']);
    ResolutionQueueManager.clearAllSteps(gameId);
  });

  it('PRIMARY=1 Divine special-case no-ops; extracted helper queues survivor choices', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const { ctx, playerId, opponentId, gameId } = createDivineChoiceCtx();
    const divineCard = { id: 'divine_spell_1', name: 'Custom Reckoning', oracle_text: DIVINE_RECKONING };
    applyInstantSorcerySpecialCaseSpellEffects(ctx, {
      controller: playerId,
      card: divineCard,
      effectiveCard: { name: 'Custom Reckoning', oracle_text: DIVINE_RECKONING },
      item: { id: 'divine_spell_1', card: { oracle_text: DIVINE_RECKONING } },
      gameId,
      spellXValue: undefined,
      isRiteOfHarmonyStyleWindow: false,
      isDivineReckoningStyleChoice: true,
      isPrisonersDilemmaStyleChoice: false,
      isSummonsOfSarumanStyle: false,
    });
    expect(
      ResolutionQueueManager.getQueue(gameId).steps
        .filter((step: any) => step?.divineReckoningChoice === true),
    ).toEqual([]);

    queueEachPlayerChooseThenDestroyRestPrompts(ctx, {
      controller: playerId,
      card: divineCard,
      effectiveCard: { name: 'Custom Reckoning', oracle_text: DIVINE_RECKONING },
      item: { id: 'divine_spell_1', card: { oracle_text: DIVINE_RECKONING } },
      gameId,
    });

    const queued = ResolutionQueueManager.getQueue(gameId).steps
      .filter((step: any) => step?.divineReckoningChoice === true);
    expect(queued.map((step: any) => String(step.playerId))).toEqual([playerId, opponentId]);
    ResolutionQueueManager.clearAllSteps(gameId);
  });

  it('PRIMARY=0 Prisoner special-case trampolines to IR and queues secret silence/snitch choices', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const { ctx, playerId, opponentId, gameId } = createPrisonerChoiceCtx();
    applyInstantSorcerySpecialCaseSpellEffects(ctx, {
      controller: playerId,
      card: { id: 'prisoner_spell_1', name: 'Custom Dilemma', oracle_text: PRISONERS_DILEMMA },
      effectiveCard: { name: 'Custom Dilemma', oracle_text: PRISONERS_DILEMMA },
      item: { id: 'prisoner_spell_1', card: { oracle_text: PRISONERS_DILEMMA } },
      gameId,
      spellXValue: undefined,
      isRiteOfHarmonyStyleWindow: false,
      isDivineReckoningStyleChoice: false,
      isPrisonersDilemmaStyleChoice: true,
      isSummonsOfSarumanStyle: false,
    });

    const queued = ResolutionQueueManager.getQueue(gameId).steps
      .filter((step: any) => step?.prisonersDilemmaChoice === true);
    expect(queued.map((step: any) => String(step.playerId))).toEqual([opponentId]);
    expect((queued[0] as any).secretChoice).toBe(true);
    expect((queued[0] as any).options.map((option: any) => option.id)).toEqual(['silence', 'snitch']);
    ResolutionQueueManager.clearAllSteps(gameId);
  });

  it('PRIMARY=0 Summons special-case trampolines to IR mill/amass and queues may-cast', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const { ctx, playerId, gameId } = createSummonsChoiceCtx();
    applyInstantSorcerySpecialCaseSpellEffects(ctx, {
      controller: playerId,
      card: { id: 'summons_spell_1', name: 'Custom Summons', oracle_text: SUMMONS_OF_SARUMAN },
      effectiveCard: { name: 'Custom Summons', oracle_text: SUMMONS_OF_SARUMAN },
      item: { id: 'summons_spell_1', card: { oracle_text: SUMMONS_OF_SARUMAN } },
      gameId,
      spellXValue: 2,
      isRiteOfHarmonyStyleWindow: false,
      isDivineReckoningStyleChoice: false,
      isPrisonersDilemmaStyleChoice: false,
      isSummonsOfSarumanStyle: true,
    });

    const battlefield = ctx.state.battlefield as Array<{ card?: { type_line?: string } }>;
    expect(battlefield.some((permanent) => String(permanent.card?.type_line || '').toLowerCase().includes('army'))).toBe(true);
    const zones = (ctx.state as any).zones?.[playerId];
    expect((zones?.graveyard || []).map((card: any) => card.id).sort()).toEqual(['mill_bolt', 'mill_land']);
    const queued = ResolutionQueueManager.getQueue(gameId).steps;
    expect(queued.some((step: any) => step?.triggeredAbilityMayCastFromGraveyard === true)).toBe(true);
    ResolutionQueueManager.clearAllSteps(gameId);
  });
});

function createDivineChoiceCtx(): {
  ctx: GameContext;
  playerId: PlayerID;
  opponentId: PlayerID;
  gameId: string;
} {
  const gameId = `phase4_divine_${Math.random().toString(36).slice(2, 8)}`;
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  const ctx = createContext(gameId) as GameContext;
  (ctx as any).state = {
    players: [
      { id: playerId, name: 'P1', hasLost: false },
      { id: opponentId, name: 'P2', hasLost: false },
    ],
    life: { [playerId]: 40, [opponentId]: 40 },
    battlefield: [
      creature('p1_keep', playerId, 'Faithful Knight'),
      creature('p1_rest', playerId, 'Devout Soldier'),
      creature('p2_keep', opponentId, 'Watchful Griffin'),
      creature('p2_rest', opponentId, 'Silent Monk'),
    ],
    zones: {
      [playerId]: { library: [], hand: [], graveyard: [] },
      [opponentId]: { library: [], hand: [], graveyard: [] },
    },
    stack: [],
    turnPlayer: playerId,
  };
  return { ctx, playerId, opponentId, gameId };
}

function createPrisonerChoiceCtx(): {
  ctx: GameContext;
  playerId: PlayerID;
  opponentId: PlayerID;
  gameId: string;
} {
  const gameId = `phase4_prisoner_${Math.random().toString(36).slice(2, 8)}`;
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  const ctx = createContext(gameId) as GameContext;
  (ctx as any).state = {
    players: [
      { id: playerId, name: 'P1', hasLost: false },
      { id: opponentId, name: 'P2', hasLost: false },
    ],
    life: { [playerId]: 40, [opponentId]: 40 },
    battlefield: [],
    zones: {
      [playerId]: { library: [], hand: [], graveyard: [] },
      [opponentId]: { library: [], hand: [], graveyard: [] },
    },
    stack: [],
    turnPlayer: playerId,
  };
  return { ctx, playerId, opponentId, gameId };
}

function createSummonsChoiceCtx(): {
  ctx: GameContext;
  playerId: PlayerID;
  gameId: string;
} {
  const gameId = `phase4_summons_${Math.random().toString(36).slice(2, 8)}`;
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;
  const ctx = createContext(gameId) as GameContext;
  const library = [
    { id: 'mill_bolt', name: 'Lightning Bolt', type_line: 'Instant', mana_value: 1, zone: 'library' },
    { id: 'mill_land', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
  ];
  (ctx as any).state = {
    players: [
      { id: playerId, name: 'P1', hasLost: false },
      { id: opponentId, name: 'P2', hasLost: false },
    ],
    life: { [playerId]: 40, [opponentId]: 40 },
    battlefield: [],
    zones: {
      [playerId]: { library: library.map((card) => ({ ...card })), hand: [], graveyard: [], libraryCount: 2 },
      [opponentId]: { library: [], hand: [], graveyard: [] },
    },
    stack: [],
    turnPlayer: playerId,
  };
  ctx.libraries.set(playerId, library.map((card) => ({ ...card })));
  ctx.libraries.set(opponentId, []);
  return { ctx, playerId, gameId };
}

function creature(id: string, controller: PlayerID, name: string) {
  return {
    id,
    controller,
    owner: controller,
    card: { name, type_line: 'Creature' },
  };
}
