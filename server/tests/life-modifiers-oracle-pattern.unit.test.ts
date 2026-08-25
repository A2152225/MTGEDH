import { describe, expect, it } from 'vitest';

import {
  canGainLife,
  canLifeChange,
  detectLifeModifiers,
  lifeGainBecomesLoss,
  processLifeChange,
} from '../src/state/modules/game-state-effects.js';
import { applyLifeGain } from '../src/state/utils.js';
import { canPlayerPayLife } from '../src/state/modules/game-state-effects-handlers/gameStateEffectsLifeModifierOraclePatterns.js';
import { collectOraclePatternLifeGainReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecLifeGainOracleTemplates.js';
import { collectOraclePatternLifeLossReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecLifeLossOracleTemplates.js';
import { evaluateLifeLossReplacementEvent } from '../src/state/modules/replacement-effects.js';

// Oracle text copied from mtg_data.db (is_token = 0).
const PLATINUM_EMPERION_ORACLE =
  "Your life total can't change. (You can't gain or lose life. You can't pay any amount of life except 0.)";
const TAINTED_REMEDY_ORACLE =
  'If an opponent would gain life, that player loses that much life instead.';
const EREBOS_ORACLE =
  "Indestructible\nAs long as your devotion to black is less than five, Erebos isn't a creature. (Each {B} in the mana costs of permanents you control counts toward your devotion to black.)\nYour opponents can't gain life.\n{1}{B}, Pay 2 life: Draw a card.";
const SULFURIC_VORTEX_ORACLE =
  "At the beginning of each player's upkeep, this enchantment deals 2 damage to that player.\nIf a player would gain life, that player gains no life instead.";
const LEYLINE_OF_PUNISHMENT_ORACLE =
  "If this card is in your opening hand, you may begin the game with it on the battlefield.\nPlayers can't gain life.\nDamage can't be prevented.";
const ANGEL_OF_JUBILATION_ORACLE =
  "Flying\nOther nonblack creatures you control get +1/+1.\nPlayers can't pay life or sacrifice creatures to cast spells or activate abilities.";
const ARCHFIEND_OF_DESPAIR_ORACLE =
  "Flying\nYour opponents can't gain life.\nAt the beginning of each end step, each opponent loses life equal to the life that player lost this turn. (Damage causes loss of life.)";
const WOUND_REFLECTION_ORACLE =
  'At the beginning of each end step, each opponent loses life equal to the life they lost this turn. (Damage causes loss of life.)';
const LIFE_GAIN_DOUBLE_ORACLE =
  'If you would gain life, you gain twice that much life instead.';
// mtg_data.db is_token=0 Bloodletter of Aclazotz
const BLOODLETTER_ORACLE =
  'Flying\nIf an opponent would lose life during your turn, they lose twice that much life instead. (Damage causes loss of life.)';
const PLAYER_LIFE_LOSS_DOUBLE_ORACLE =
  'If a player would lose life during your turn, they lose twice that much life instead.';
// mtg_data.db is_token=0 Grievous Wound
const GRIEVOUS_WOUND_ORACLE =
  "Enchant player\nEnchanted player can't gain life.\nWhenever enchanted player is dealt damage, they lose half their life, rounded up.";
// mtg_data.db is_token=0 Quest Compleated Beast
const SINGULAR_OPPONENT_CANT_GAIN_ORACLE =
  "Menace, Lifelink, Toxic 2\nQuest Compleated Beast can't be blocked by tokens.\nYour opponent can't gain life or remove poison counters.\nWhenever Quest Compleated Beast deals combat damage to an opponent, it deals that much damage to target battle that player is protecting.";
// mtg_data.db is_token=0 Roiling Vortex — activated this-turn, not a continuous static
const ROILING_VORTEX_ORACLE =
  "At the beginning of each player's upkeep, this enchantment deals 1 damage to them.\nWhenever a player casts a spell, if no mana was spent to cast that spell, this enchantment deals 5 damage to that player.\n{R}: Your opponents can't gain life this turn.";

function makeCtx(partial: Record<string, unknown>) {
  return { state: partial } as any;
}

describe('oracle-pattern life modifiers (no LIFE_MODIFIERS name table)', () => {
  it('renamed Platinum Emperion oracle locks life total, gain, loss, and pay-life', () => {
    const ctx = makeCtx({
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      battlefield: [{
        id: 'lock_1',
        controller: 'p1',
        card: { name: 'Custom Life Lock', oracle_text: PLATINUM_EMPERION_ORACLE, type_line: 'Artifact Creature — Golem' },
      }],
    });

    expect(canLifeChange(ctx, 'p1')).toBe(false);
    expect(canLifeChange(ctx, 'p2')).toBe(true);
    expect(canGainLife(ctx, 'p1')).toBe(false);
    expect(canPlayerPayLife(ctx, 'p1')).toBe(false);
    expect(processLifeChange(ctx, 'p1', 5, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Life total can't change",
    });
    expect(processLifeChange(ctx, 'p1', 5, false)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Life total can't change",
    });
    expect(detectLifeModifiers(ctx, 'p1').some((m) => m.type === 'cant_change')).toBe(true);
    expect(detectLifeModifiers(ctx, 'p1').every((m) => !String(m.cardName).toLowerCase().includes('emperion'))).toBe(true);
  });

  it("a card named Platinum Emperion without the can't-change clause does not lock life", () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'fake_1',
        controller: 'p1',
        card: {
          name: 'Platinum Emperion',
          oracle_text: 'Flying',
          type_line: 'Artifact Creature — Golem',
        },
      }],
    });

    expect(canLifeChange(ctx, 'p1')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 3, true)).toMatchObject({ finalAmount: 3, prevented: false });
  });

  it('playerProtection.lifeCannotChange locks life without a Teferi card name', () => {
    const ctx = makeCtx({
      playerProtection: {
        p1: { lifeCannotChange: true, expiresAtCleanup: true },
      },
      battlefield: [],
    });

    expect(canLifeChange(ctx, 'p1')).toBe(false);
    expect(canLifeChange(ctx, 'p2')).toBe(true);
    const detected = detectLifeModifiers(ctx, 'p1');
    expect(detected.some((m) => m.type === 'cant_change' && m.expiresAtCleanup === true)).toBe(true);
    expect(detected.every((m) => !String(m.cardName).toLowerCase().includes('teferi'))).toBe(true);
    expect(processLifeChange(ctx, 'p1', 2, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Life total can't change",
    });
  });

  it('renamed Tainted Remedy reverses opponent life gain via ReplacementEffectSpec', () => {
    const ctx = makeCtx({
      life: { p1: 30, p2: 40 },
      battlefield: [{
        id: 'remedy_1',
        controller: 'p2',
        card: { name: 'Custom Bitter Medicine', oracle_text: TAINTED_REMEDY_ORACLE, type_line: 'Enchantment' },
      }],
    });

    expect(lifeGainBecomesLoss(ctx, 'p1')).toBe(true);
    expect(lifeGainBecomesLoss(ctx, 'p2')).toBe(false);
    expect(canGainLife(ctx, 'p1')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 4, true)).toMatchObject({
      finalAmount: -4,
      prevented: false,
      reason: 'Life gain becomes life loss',
    });
    expect(processLifeChange(ctx, 'p2', 4, true)).toMatchObject({ finalAmount: 4, prevented: false });
    expect(
      collectOraclePatternLifeGainReplacementSpecsFromState(ctx.state).some(
        (spec) => spec.instead.replaceLifeGainWith === 'loss' && spec.sourceName === 'Custom Bitter Medicine',
      ),
    ).toBe(true);
  });

  it('custom 616.1 order uses the reverse source name, not tainted remedy', () => {
    const ctx = makeCtx({
      life: { p1: 30, p2: 40 },
      replacementEffectPreferences: {
        p1: {
          life_gain: {
            mode: 'custom',
            useCustomOrder: true,
            customOrder: ['Generic Life Doubler', 'Custom Bitter Medicine'],
          },
        },
      },
      battlefield: [
        {
          id: 'doubler_1',
          controller: 'p1',
          card: { name: 'Generic Life Doubler', oracle_text: LIFE_GAIN_DOUBLE_ORACLE },
        },
        {
          id: 'remedy_1',
          controller: 'p2',
          card: { name: 'Custom Bitter Medicine', oracle_text: TAINTED_REMEDY_ORACLE },
        },
      ],
    });

    expect(processLifeChange(ctx, 'p1', 3, true)).toMatchObject({
      finalAmount: -6,
      prevented: false,
      reason: 'Life gain becomes life loss',
    });
  });

  it('renamed Erebos / Archfiend oracle prevents opponent life gain only', () => {
    const erebos = makeCtx({
      battlefield: [{
        id: 'god_1',
        controller: 'p2',
        card: { name: 'Custom Underworld God', oracle_text: EREBOS_ORACLE, type_line: 'Legendary Enchantment Creature — God' },
      }],
    });
    expect(canGainLife(erebos, 'p1')).toBe(false);
    expect(canGainLife(erebos, 'p2')).toBe(true);
    expect(processLifeChange(erebos, 'p1', 2, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Can't gain life",
    });
    expect(processLifeChange(erebos, 'p2', 2, true)).toMatchObject({ finalAmount: 2, prevented: false });

    const archfiend = makeCtx({
      battlefield: [{
        id: 'fiend_1',
        controller: 'p2',
        card: { name: 'Custom Despair Fiend', oracle_text: ARCHFIEND_OF_DESPAIR_ORACLE, type_line: 'Creature — Demon' },
      }],
    });
    expect(canGainLife(archfiend, 'p1')).toBe(false);
    expect(canGainLife(archfiend, 'p2')).toBe(true);
  });

  it('renamed Sulfuric Vortex current oracle and Leyline prevent all players from gaining', () => {
    const vortex = makeCtx({
      battlefield: [{
        id: 'vortex_1',
        controller: 'p1',
        card: { name: 'Custom Acid Storm', oracle_text: SULFURIC_VORTEX_ORACLE, type_line: 'Enchantment' },
      }],
    });
    expect(canGainLife(vortex, 'p1')).toBe(false);
    expect(canGainLife(vortex, 'p2')).toBe(false);
    expect(processLifeChange(vortex, 'p1', 3, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Can't gain life",
    });

    const leyline = makeCtx({
      battlefield: [{
        id: 'leyline_1',
        controller: 'p2',
        card: { name: 'Custom Punishment Leyline', oracle_text: LEYLINE_OF_PUNISHMENT_ORACLE, type_line: 'Enchantment' },
      }],
    });
    expect(canGainLife(leyline, 'p1')).toBe(false);
    expect(canGainLife(leyline, 'p2')).toBe(false);
  });

  it("renamed Angel of Jubilation oracle stops all players paying life (restriction, not a replacement)", () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'angel_1',
        controller: 'p1',
        card: { name: 'Custom Jubilant Angel', oracle_text: ANGEL_OF_JUBILATION_ORACLE, type_line: 'Creature — Angel' },
      }],
    });

    expect(canPlayerPayLife(ctx, 'p1')).toBe(false);
    expect(canPlayerPayLife(ctx, 'p2')).toBe(false);
    expect(canGainLife(ctx, 'p1')).toBe(true);
    expect(canLifeChange(ctx, 'p1')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 3, true)).toMatchObject({ finalAmount: 3, prevented: false });
    expect(detectLifeModifiers(ctx, 'p2').some((m) => m.type === 'cant_lose')).toBe(true);
    expect(detectLifeModifiers(ctx, 'p1').every((m) => !String(m.cardName).toLowerCase().includes('jubilation'))).toBe(true);
  });

  it('Wound Reflection current oracle is an end-step trigger, not a life-loss replacement', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'wound_1',
        controller: 'p1',
        card: { name: 'Custom Wound Mirror', oracle_text: WOUND_REFLECTION_ORACLE, type_line: 'Enchantment' },
      }],
    });

    expect(detectLifeModifiers(ctx, 'p2').some((m) => m.type === 'damage_doubled')).toBe(false);
    expect(collectOraclePatternLifeLossReplacementSpecsFromState(ctx.state)).toEqual([]);
    expect(processLifeChange(ctx, 'p2', 5, false)).toMatchObject({ finalAmount: 5, prevented: false });
    expect(canGainLife(ctx, 'p2')).toBe(true);
  });

  it('renamed Bloodletter oracle doubles opponent life loss only on the controller turn', () => {
    const ctx = makeCtx({
      turnPlayer: 'p1',
      battlefield: [{
        id: 'letter_1',
        controller: 'p1',
        card: {
          name: 'Custom Aclazotz Bat',
          oracle_text: BLOODLETTER_ORACLE,
          type_line: 'Creature — Vampire Demon',
        },
      }],
    });

    expect(processLifeChange(ctx, 'p2', 5, false)).toMatchObject({ finalAmount: 10, prevented: false });
    expect(processLifeChange(ctx, 'p1', 5, false)).toMatchObject({ finalAmount: 5, prevented: false });
    expect(
      collectOraclePatternLifeLossReplacementSpecsFromState(ctx.state).some(
        (spec) => spec.instead.modify === 'double' && spec.sourceName === 'Custom Aclazotz Bat',
      ),
    ).toBe(true);
    expect(
      collectOraclePatternLifeLossReplacementSpecsFromState(ctx.state).every(
        (spec) => !String(spec.sourceName).toLowerCase().includes('bloodletter'),
      ),
    ).toBe(true);

    const evaluated = evaluateLifeLossReplacementEvent({
      state: ctx.state,
      playerId: 'p2',
      amount: 4,
    });
    expect(evaluated).toMatchObject({
      applied: true,
      effectId: 'life-loss-modified',
      originalAmount: 4,
      replacementAmount: 8,
    });

    const otherTurn = makeCtx({
      turnPlayer: 'p2',
      battlefield: [{
        id: 'letter_1',
        controller: 'p1',
        card: { name: 'Custom Aclazotz Bat', oracle_text: BLOODLETTER_ORACLE },
      }],
    });
    expect(processLifeChange(otherTurn, 'p2', 5, false)).toMatchObject({ finalAmount: 5, prevented: false });
  });

  it('generic "a player would lose life during your turn" doubles any player on the controller turn', () => {
    const ctx = makeCtx({
      turnPlayer: 'p1',
      battlefield: [{
        id: 'generic_1',
        controller: 'p1',
        card: { name: 'Custom Life Doubler', oracle_text: PLAYER_LIFE_LOSS_DOUBLE_ORACLE },
      }],
    });

    expect(processLifeChange(ctx, 'p1', 3, false)).toMatchObject({ finalAmount: 6, prevented: false });
    expect(processLifeChange(ctx, 'p2', 3, false)).toMatchObject({ finalAmount: 6, prevented: false });
  });

  it('skips Alchemy A- names with Bloodletter-class life-loss oracle', () => {
    const ctx = makeCtx({
      turnPlayer: 'p1',
      battlefield: [{
        id: 'alchemy_letter',
        controller: 'p1',
        card: { name: 'A-Custom Aclazotz Bat', oracle_text: BLOODLETTER_ORACLE },
      }],
    });

    expect(processLifeChange(ctx, 'p2', 5, false)).toMatchObject({ finalAmount: 5, prevented: false });
    expect(collectOraclePatternLifeLossReplacementSpecsFromState(ctx.state)).toEqual([]);
  });

  it('renamed Grievous Wound oracle prevents only the enchanted player from gaining', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'wound_aura_1',
        controller: 'p2',
        attachedTo: 'p1',
        card: {
          name: 'Custom Grievous Curse',
          oracle_text: GRIEVOUS_WOUND_ORACLE,
          type_line: 'Enchantment — Aura',
        },
      }],
    });

    expect(canGainLife(ctx, 'p1')).toBe(false);
    expect(canGainLife(ctx, 'p2')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 4, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Can't gain life",
    });
    expect(processLifeChange(ctx, 'p2', 4, true)).toMatchObject({ finalAmount: 4, prevented: false });
    expect(
      collectOraclePatternLifeGainReplacementSpecsFromState(ctx.state).some(
        (spec) => spec.match?.gainingPlayerIsEnchantedBySource === true
          && spec.sourceName === 'Custom Grievous Curse',
      ),
    ).toBe(true);
  });

  it('renamed singular "your opponent can\'t gain life" oracle prevents opponent gain only', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'beast_1',
        controller: 'p2',
        card: {
          name: 'Custom Compleated Beast',
          oracle_text: SINGULAR_OPPONENT_CANT_GAIN_ORACLE,
          type_line: 'Legendary Creature — Phyrexian Beast',
        },
      }],
    });

    expect(canGainLife(ctx, 'p1')).toBe(false);
    expect(canGainLife(ctx, 'p2')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 2, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Can't gain life",
    });
    expect(
      collectOraclePatternLifeGainReplacementSpecsFromState(ctx.state).every(
        (spec) => !String(spec.sourceName).toLowerCase().includes('quest'),
      ),
    ).toBe(true);
  });

  it('does not treat Roiling Vortex this-turn activation as a continuous can\'t-gain static', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'vortex_act_1',
        controller: 'p2',
        card: { name: 'Custom Roiling Storm', oracle_text: ROILING_VORTEX_ORACLE, type_line: 'Enchantment' },
      }],
    });

    expect(canGainLife(ctx, 'p1')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 3, true)).toMatchObject({ finalAmount: 3, prevented: false });
    expect(collectOraclePatternLifeGainReplacementSpecsFromState(ctx.state)).toEqual([]);
  });

  it('lasting preventLifeGain still blocks gain without a card-name table', () => {
    const state = {
      lastingEffects: [{ type: 'preventLifeGain', targetPlayer: 'p1', source: 'Custom This-Turn Lock' }],
      battlefield: [],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
    };
    const ctx = makeCtx(state);

    expect(canGainLife(ctx, 'p1')).toBe(false);
    expect(canGainLife(ctx, 'p2')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 2, true)).toMatchObject({
      finalAmount: 0,
      prevented: true,
      reason: "Can't gain life",
    });
    expect(processLifeChange(ctx, 'p2', 2, true)).toMatchObject({ finalAmount: 2, prevented: false });
    expect(applyLifeGain(state, 'p1', 2, 'Test Gain')).toMatchObject({ actualChange: 0 });
    expect(applyLifeGain({ ...state, lastingEffects: [] }, 'p2', 2, 'Test Gain')).toMatchObject({
      actualChange: 2,
    });
  });

  it('cleanup expires this-turn preventLifeGain but keeps rest-of-game locks', () => {
    const thisTurn = { type: 'preventLifeGain', duration: 'this_turn', targetPlayer: 'p1', source: 'Custom Bloodcrack' };
    const legacy = { type: 'preventLifeGain', targetPlayer: 'p2', source: 'Custom Legacy Lock' };
    const restOfGame = { type: 'preventLifeGain', duration: 'game', targetPlayer: 'p1', source: 'Custom Nemesis Lock' };
    const state = {
      lastingEffects: [thisTurn, legacy, restOfGame],
      battlefield: [],
      players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
      life: { p1: 40, p2: 40 },
    };
    const expiringDurations = new Set(['end_of_turn', 'until_end_of_turn', 'this_turn', 'eot']);
    state.lastingEffects = state.lastingEffects.filter((effect) => {
      const type = String(effect?.type || '');
      const duration = String((effect as { duration?: string }).duration || '').trim().toLowerCase();
      if (type !== 'preventLifeGain') return true;
      if (!duration || expiringDurations.has(duration)) return false;
      return true;
    });

    expect(state.lastingEffects).toEqual([restOfGame]);
    const ctx = makeCtx(state);
    expect(canGainLife(ctx, 'p1')).toBe(false);
    expect(canGainLife(ctx, 'p2')).toBe(true);
  });

  it('skips Alchemy A- names with the same opponents-can\'t-gain-life oracle', () => {
    const ctx = makeCtx({
      battlefield: [{
        id: 'alchemy_1',
        controller: 'p2',
        card: {
          name: 'A-Custom Underworld God',
          oracle_text: "Your opponents can't gain life.",
          type_line: 'Legendary Enchantment Creature — God',
        },
      }],
    });

    expect(canGainLife(ctx, 'p1')).toBe(true);
    expect(processLifeChange(ctx, 'p1', 2, true)).toMatchObject({ finalAmount: 2, prevented: false });
    expect(collectOraclePatternLifeGainReplacementSpecsFromState(ctx.state)).toEqual([]);
  });
});
