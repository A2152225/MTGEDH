import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { hasValidTargetsForSpell } from '../src/rules-engine/target-availability.js';
import { categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { syncDerivedContinuousEffects } from '../src/state/modules/staticEffectSpec.js';
import {
  deriveSpellSpecFromParsedTargetReqs,
  resolveCastSpellParsedTargeting,
} from '../src/socket/game-actions-handlers/gameActionsCastSpellParsedTargeting.js';
import { buildSpellTargetListFromRequirements } from '../src/socket/game-actions-handlers/gameActionsSpellTargetSelection.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const LEYLINE_OF_SANCTITY_ORACLE =
  "If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can't be the target of spells or abilities your opponents control.)";
const KAYA_BANE_ORACLE =
  "Your opponents and permanents your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n[−3]: Exile target creature.";

describe('IR-primary cast-time targeting from parseTargetRequirements', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  function requireOracle(name: string): { name: string; oracle_text: string; type_line: string } {
    const card = lookupLocalCardByNameSync(name);
    expect(card?.oracle_text, `missing local oracle for ${name}`).toBeTruthy();
    return {
      name: String(card?.name || name),
      oracle_text: String(card?.oracle_text || ''),
      type_line: String(card?.type_line || ''),
    };
  }

  it('Murder / Lightning Bolt / Wrath-style targeting uses parsed reqs without categorize', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const murder = requireOracle('Murder');
    const bolt = requireOracle('Lightning Bolt');
    const wrath = requireOracle('Wrath of God');

    expect(murder.oracle_text).toMatch(/destroy target creature/i);
    expect(bolt.oracle_text).toMatch(/deals 3 damage to any target/i);
    expect(wrath.oracle_text).toMatch(/destroy all creatures/i);

    const murderTargeting = resolveCastSpellParsedTargeting({
      cardName: murder.name,
      oracleText: murder.oracle_text,
    });
    const boltTargeting = resolveCastSpellParsedTargeting({
      cardName: bolt.name,
      oracleText: bolt.oracle_text,
    });
    const wrathTargeting = resolveCastSpellParsedTargeting({
      cardName: wrath.name,
      oracleText: wrath.oracle_text,
    });

    expect(murderTargeting.spellSpec).toBeNull();
    expect(boltTargeting.spellSpec).toBeNull();
    expect(wrathTargeting.spellSpec).toBeNull();

    expect(murderTargeting.preferParsedTargetReqs).toBe(true);
    expect(boltTargeting.preferParsedTargetReqs).toBe(true);
    expect(wrathTargeting.targetReqs.needsTargets).toBe(false);

    expect(murderTargeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
    });
    expect(boltTargeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['any'],
      minTargets: 1,
      maxTargets: 1,
    });

    // categorize still exists for tests / IR-off, but IR-primary must not need it.
    expect(categorizeSpellWithoutPrimaryRetirement(murder.name, murder.oracle_text)?.op).toBe('DESTROY_TARGET');
    expect(categorizeSpellWithoutPrimaryRetirement(bolt.name, bolt.oracle_text)?.op).toBe('ANY_TARGET_DAMAGE');
    expect(categorizeSpellWithoutPrimaryRetirement(wrath.name, wrath.oracle_text)?.op).toBe('DESTROY_ALL');

    const game = createInitialGameState('ir_primary_cast_targets');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];

    const murderTargets = buildSpellTargetListFromRequirements(game, p1, murderTargeting.targetReqs);
    expect(murderTargets.map((target) => target.id)).toEqual(['bear_1']);
    expect(murderTargets[0]?.kind).toBe('permanent');

    const boltTargets = buildSpellTargetListFromRequirements(game, p1, boltTargeting.targetReqs);
    expect(boltTargets.some((target) => target.id === 'bear_1' && target.kind === 'permanent')).toBe(true);
    expect(boltTargets.some((target) => target.id === p1 && target.kind === 'player')).toBe(true);
    expect(boltTargets.some((target) => target.id === p2 && target.kind === 'player')).toBe(true);

    expect(hasValidTargetsForSpell(game.state, p1, murder)).toBe(true);
    expect(hasValidTargetsForSpell(game.state, p1, bolt)).toBe(true);
    expect(hasValidTargetsForSpell(game.state, p1, wrath)).toBe(true);
  });

  it('empty-stack counterspells stay illegal from parsed reqs under IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const flusterstorm = requireOracle('Flusterstorm');
    const targeting = resolveCastSpellParsedTargeting({
      cardName: flusterstorm.name,
      oracleText: flusterstorm.oracle_text,
    });

    expect(targeting.spellSpec).toBeNull();
    expect(targeting.preferParsedTargetReqs).toBe(true);
    expect(targeting.targetReqs.needsTargets).toBe(true);
    expect(targeting.targetReqs.targetTypes.some((targetType) => String(targetType).includes('spell'))).toBe(true);

    const emptyState = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [],
      stack: [],
    };
    expect(hasValidTargetsForSpell(emptyState, 'p1' as PlayerID, flusterstorm)).toBe(false);
  });

  it('cast-time player lists omit hexproof opponents unless Kaya-class as-though applies', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    const mindRotStyle = {
      name: 'Target Player Discard',
      oracle_text: 'Target player discards two cards.',
      type_line: 'Sorcery',
    };
    const targetOpponent = {
      name: 'Target Opponent Discard',
      oracle_text: 'Target opponent discards two cards.',
      type_line: 'Sorcery',
    };
    const enchantPlayer = {
      name: 'Enchant Player Aura',
      oracle_text: 'Enchant player',
      type_line: 'Enchantment — Aura',
    };

    const state: any = {
      players: [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }, { id: p3, name: 'P3' }],
      battlefield: [
        {
          id: 'leyline_1',
          controller: p2,
          card: {
            name: 'Leyline of Sanctity',
            type_line: 'Enchantment',
            oracle_text: LEYLINE_OF_SANCTITY_ORACLE,
          },
        },
      ],
      stack: [],
      zones: {},
    };
    syncDerivedContinuousEffects(state);
    const game = { state };

    const playerTargeting = resolveCastSpellParsedTargeting({
      cardName: mindRotStyle.name,
      oracleText: mindRotStyle.oracle_text,
      gameState: state,
      controllerId: p1,
    });
    expect(playerTargeting.preferParsedTargetReqs).toBe(true);
    expect(playerTargeting.targetReqs.targetTypes).toEqual(['player']);

    // Production IR-primary prompt path is buildSpellTargetListFromRequirements.
    const playerTargets = buildSpellTargetListFromRequirements(game, p1, playerTargeting.targetReqs);
    const playerIds = playerTargets.filter((target) => target.kind === 'player').map((target) => target.id);
    expect(playerIds.sort()).toEqual([p1, p3].sort());
    expect(playerIds).not.toContain(p2);

    const opponentTargeting = resolveCastSpellParsedTargeting({
      cardName: targetOpponent.name,
      oracleText: targetOpponent.oracle_text,
      gameState: state,
      controllerId: p1,
    });
    const opponentTargets = buildSpellTargetListFromRequirements(game, p1, opponentTargeting.targetReqs);
    expect(opponentTargets.map((target) => target.id)).toEqual([p3]);
    expect(hasValidTargetsForSpell(state, p1, targetOpponent)).toBe(true);

    const twoPlayerState: any = {
      players: [{ id: p1, name: 'P1' }, { id: p2, name: 'P2' }],
      battlefield: state.battlefield,
      stack: [],
      zones: {},
    };
    syncDerivedContinuousEffects(twoPlayerState);
    expect(hasValidTargetsForSpell(twoPlayerState, p1, targetOpponent)).toBe(false);
    expect(hasValidTargetsForSpell(twoPlayerState, p1, mindRotStyle)).toBe(true);
    expect(hasValidTargetsForSpell(twoPlayerState, p1, enchantPlayer)).toBe(true);
    expect(hasValidTargetsForSpell(twoPlayerState, p2, enchantPlayer)).toBe(true);

    state.battlefield.push({
      id: 'kaya_1',
      controller: p1,
      card: {
        name: 'Kaya, Bane of the Dead',
        type_line: 'Legendary Planeswalker — Kaya',
        oracle_text: KAYA_BANE_ORACLE,
      },
    });
    syncDerivedContinuousEffects(state);

    const kayaTargets = buildSpellTargetListFromRequirements(game, p1, playerTargeting.targetReqs);
    expect(kayaTargets.filter((target) => target.kind === 'player').map((target) => target.id).sort()).toEqual(
      [p1, p2, p3].sort(),
    );
    const p3Targets = buildSpellTargetListFromRequirements(game, p3, playerTargeting.targetReqs);
    expect(p3Targets.filter((target) => target.kind === 'player').map((target) => target.id).sort()).toEqual(
      [p1, p3].sort(),
    );
  });

  it('Wing Snare parsed lists keep only flying creatures', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const wingSnare = requireOracle('Wing Snare');
    expect(wingSnare.oracle_text).toMatch(/destroy target creature with flying/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: wingSnare.name,
      oracleText: wingSnare.oracle_text,
    });

    expect(targeting.spellSpec).toBeNull();
    expect(targeting.preferParsedTargetReqs).toBe(true);
    expect(targeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetRestriction: { type: 'has_keyword', keyword: 'flying' },
    });

    const derived = deriveSpellSpecFromParsedTargetReqs(targeting.targetReqs);
    expect(derived?.targetRestriction).toMatchObject({ type: 'has_keyword', keyword: 'flying' });
    expect(categorizeSpellWithoutPrimaryRetirement(wingSnare.name, wingSnare.oracle_text)?.targetRestriction).toMatchObject({
      type: 'has_keyword',
      keyword: 'flying',
    });

    const game = createInitialGameState('ir_primary_wing_snare');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      },
      {
        id: 'crow_1',
        controller: p2,
        card: {
          name: 'Storm Crow',
          type_line: 'Creature — Bird',
          oracle_text: 'Flying',
          keywords: ['Flying'],
        },
      },
    ];

    const targets = buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs);
    expect(targets.map((target) => target.id)).toEqual(['crow_1']);
    expect(hasValidTargetsForSpell(game.state, p1, wingSnare)).toBe(true);

    (game.state as any).battlefield = [(game.state as any).battlefield[0]];
    expect(hasValidTargetsForSpell(game.state, p1, wingSnare)).toBe(false);
  });

  it('power-or-greater parsed lists omit weaker creatures', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const judgment = requireOracle("Legion's Judgment");
    expect(judgment.oracle_text).toMatch(/destroy target creature with power 4 or greater/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: judgment.name,
      oracleText: judgment.oracle_text,
    });

    expect(targeting.spellSpec).toBeNull();
    expect(targeting.preferParsedTargetReqs).toBe(true);
    expect(targeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      statRequirement: { stat: 'power', comparison: '>=', value: 4 },
    });

    const derived = deriveSpellSpecFromParsedTargetReqs(targeting.targetReqs);
    expect(derived?.statRequirement).toEqual({ stat: 'power', comparison: '>=', value: 4 });

    const game = createInitialGameState('ir_primary_power_threshold');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'wurm_1',
        controller: p2,
        card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4' },
      },
    ];

    const targets = buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs);
    expect(targets.map((target) => target.id)).toEqual(['wurm_1']);
  });

  it('tapped-only spells omit untapped creatures and fail hasValidTargets when none are tapped', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const assassinate = requireOracle('Assassinate');
    // Quoted from mtg_data.db (is_token = 0): "Destroy target tapped creature."
    expect(assassinate.oracle_text).toMatch(/destroy target tapped creature/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: assassinate.name,
      oracleText: assassinate.oracle_text,
    });
    expect(targeting.preferParsedTargetReqs).toBe(true);
    expect(targeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['creature'],
      targetRestriction: { type: 'tapped' },
    });

    const game = createInitialGameState('ir_primary_tapped_only');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'untapped_1',
        controller: p2,
        tapped: false,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'tapped_1',
        controller: p2,
        tapped: true,
        card: { name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
      },
    ];

    const targets = buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs);
    expect(targets.map((target) => target.id)).toEqual(['tapped_1']);
    expect(hasValidTargetsForSpell(game.state, p1, assassinate)).toBe(true);

    (game.state as any).battlefield = [(game.state as any).battlefield[0]];
    expect(buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs)).toEqual([]);
    expect(hasValidTargetsForSpell(game.state, p1, assassinate)).toBe(false);
  });

  it('attacking-or-blocking lists only combat-involved creatures', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const verdict = requireOracle('Divine Verdict');
    // Quoted from mtg_data.db (is_token = 0): "Destroy target attacking or blocking creature."
    expect(verdict.oracle_text).toMatch(/destroy target attacking or blocking creature/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: verdict.name,
      oracleText: verdict.oracle_text,
    });
    expect(targeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['creature'],
      targetRestriction: { type: 'attacked_or_blocked_this_turn' },
    });

    const game = createInitialGameState('ir_primary_attacking_or_blocking');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'idle_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'attacker_1',
        controller: p2,
        attacking: p1,
        card: { name: 'Craw Wurm', type_line: 'Creature — Wurm' },
      },
      {
        id: 'blocker_1',
        controller: p1,
        blocking: ['attacker_1'],
        card: { name: 'Wall of Wood', type_line: 'Creature — Wall' },
      },
    ];

    const targets = buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs);
    expect(targets.map((target) => target.id).sort()).toEqual(['attacker_1', 'blocker_1']);
    expect(hasValidTargetsForSpell(game.state, p1, verdict)).toBe(true);

    (game.state as any).battlefield = [(game.state as any).battlefield[0]];
    expect(hasValidTargetsForSpell(game.state, p1, verdict)).toBe(false);
  });

  it('untargeted all-attacking-creatures spells need an attacking creature', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const aetherize = requireOracle('Aetherize');
    // Quoted from mtg_data.db (is_token = 0): "Return all attacking creatures to their owner's hand."
    expect(aetherize.oracle_text).toMatch(/return all attacking creatures to their owner's hand/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: aetherize.name,
      oracleText: aetherize.oracle_text,
    });
    expect(targeting.targetReqs.needsTargets).toBe(false);

    const game = createInitialGameState('ir_primary_aetherize_attacking');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'idle_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];
    expect(hasValidTargetsForSpell(game.state, p1, aetherize)).toBe(false);

    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: p2,
        attacking: true,
        card: { name: 'Craw Wurm', type_line: 'Creature — Wurm' },
      },
    ];
    expect(hasValidTargetsForSpell(game.state, p1, aetherize)).toBe(true);

    (game.state as any).battlefield = [
      {
        id: 'attacker_string_1',
        controller: p2,
        attacking: p1,
        card: { name: 'Serra Angel', type_line: 'Creature — Angel' },
      },
    ];
    expect(hasValidTargetsForSpell(game.state, p1, aetherize)).toBe(true);
  });

  it('power-or-toughness compound lists either-stat matches', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const repel = requireOracle('Repel Calamity');
    // Quoted from mtg_data.db (is_token = 0): "Destroy target creature with power or toughness 4 or greater."
    expect(repel.oracle_text).toMatch(/destroy target creature with power or toughness 4 or greater/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: repel.name,
      oracleText: repel.oracle_text,
    });
    expect(targeting.targetReqs).toMatchObject({
      needsTargets: true,
      targetTypes: ['creature'],
      statRequirement: { stat: 'power', orStat: 'toughness', comparison: '>=', value: 4 },
    });

    const game = createInitialGameState('ir_primary_power_or_toughness');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'small_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'tall_1',
        controller: p2,
        card: { name: 'Wall of Stone', type_line: 'Creature — Wall', power: '0', toughness: '8' },
      },
      {
        id: 'wide_1',
        controller: p2,
        card: { name: 'Ball Lightning', type_line: 'Creature — Elemental', power: '6', toughness: '1' },
      },
    ];

    const targets = buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs);
    expect(targets.map((target) => target.id).sort()).toEqual(['tall_1', 'wide_1']);
    expect(hasValidTargetsForSpell(game.state, p1, repel)).toBe(true);

    (game.state as any).battlefield = [(game.state as any).battlefield[0]];
    expect(hasValidTargetsForSpell(game.state, p1, repel)).toBe(false);
  });

  it("Atraxa's Fall lists artifact, battle, enchantment, and flying creature — not artifacts only", () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const atraxaFall = requireOracle("Atraxa's Fall");
    // Quoted from mtg_data.db (is_token = 0):
    // "Destroy target artifact, battle, enchantment, or creature with flying."
    expect(atraxaFall.oracle_text).toMatch(/destroy target artifact, battle, enchantment, or creature with flying/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: atraxaFall.name,
      oracleText: atraxaFall.oracle_text,
    });
    expect(targeting.preferParsedTargetReqs).toBe(true);
    expect(targeting.targetReqs.targetTypes).toEqual(['artifact', 'battle', 'enchantment', 'creature']);
    expect(targeting.targetReqs.creatureRestriction).toMatchObject({ type: 'has_keyword', keyword: 'flying' });

    const game = createInitialGameState('ir_primary_atraxa_fall');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'sol_1',
        controller: p2,
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      },
      {
        id: 'battle_1',
        controller: p2,
        card: { name: 'Invasion of Gobakhan', type_line: 'Battle — Siege' },
      },
      {
        id: 'aura_1',
        controller: p2,
        card: { name: 'Pacifism', type_line: 'Enchantment — Aura' },
      },
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
      },
      {
        id: 'crow_1',
        controller: p2,
        card: {
          name: 'Storm Crow',
          type_line: 'Creature — Bird',
          oracle_text: 'Flying',
          keywords: ['Flying'],
        },
      },
    ];

    const targets = buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs);
    expect(targets.map((target) => target.id).sort()).toEqual(['aura_1', 'battle_1', 'crow_1', 'sol_1']);
    expect(targets.map((target) => target.id)).not.toContain('bear_1');
    expect(hasValidTargetsForSpell(game.state, p1, atraxaFall)).toBe(true);

    (game.state as any).battlefield = [(game.state as any).battlefield[3]];
    expect(hasValidTargetsForSpell(game.state, p1, atraxaFall)).toBe(false);
  });

  it('hasValidTargetsForSpell is false when only type matches but restriction fails', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    const reciprocate = requireOracle('Reciprocate');
    // Quoted from mtg_data.db (is_token = 0): "Exile target creature that dealt damage to you this turn."
    expect(reciprocate.oracle_text).toMatch(/exile target creature that dealt damage to you this turn/i);

    const targeting = resolveCastSpellParsedTargeting({
      cardName: reciprocate.name,
      oracleText: reciprocate.oracle_text,
    });
    expect(targeting.targetReqs).toMatchObject({
      targetTypes: ['creature'],
      targetRestriction: { type: 'dealt_damage_to_you_this_turn' },
    });

    const game = createInitialGameState('ir_primary_damage_this_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    (game.state as any).battlefield = [
      {
        id: 'bear_1',
        controller: p2,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
    ];

    expect(buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs)).toEqual([]);
    expect(hasValidTargetsForSpell(game.state, p1, reciprocate)).toBe(false);

    (game.state as any).creaturesThatDealtDamageToPlayer = { [p1]: { bear_1: true } };
    expect(buildSpellTargetListFromRequirements(game, p1, targeting.targetReqs).map((target) => target.id)).toEqual(['bear_1']);
    expect(hasValidTargetsForSpell(game.state, p1, reciprocate)).toBe(true);
  });
});
