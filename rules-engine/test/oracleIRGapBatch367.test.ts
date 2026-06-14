import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport';
import { evaluateExtendedConditionalClause } from '../src/oracleIRExecutorConditionalStepSupportExtended';

const controllerId = 'p1' as PlayerID;

const baseParams = {
  raw: '',
  controllerId,
  ctx: { controllerId, sourceId: 'bf-source' } as any,
  lastActionOutcome: null,
  lastMovedCards: [],
  lastDiscardedCards: [],
};

describe('Oracle IR gap batch 367 — nine condition clusters', () => {
  it('evaluates modified, no-goblins, and graveyard-turn clauses', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              type_line: 'Legendary Creature — Human',
              counters: { '+1/+1': 1 },
            },
          ],
        } as GameState,
        normalizedRaw: "it's modified",
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          players: [{ id: controllerId }],
          battlefield: [{ id: 'bf-human', controller: controllerId, type_line: 'Creature — Human' }],
        } as GameState,
        normalizedRaw: 'you control no goblins',
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn: true,
        } as GameState,
        normalizedRaw: 'an artifact or creature was put into a graveyard from the battlefield this turn',
      })
    ).toBe(true);
  });

  it('evaluates colored-mana, she-was, mad-dog, mutate, raka, and not-kicked clauses', () => {
    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          stack: [
            {
              id: 'stack-spell-1',
              manaSpentBreakdown: { colorless: 2, white: 0, blue: 0, black: 0, red: 0, green: 0 },
            },
          ],
        } as GameState,
        normalizedRaw: 'no colored mana was spent to cast it',
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              type_line: 'Legendary Creature — Human Noble Ally',
            },
          ],
        } as GameState,
        normalizedRaw: 'she was a nonland creature',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "this creature didn't attack or come under your control this turn" },
        nextState: {
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              type_line: 'Creature — Dog',
              attackedThisTurn: false,
              cameUnderYourControlThisTurn: false,
              gainedControlThisTurn: false,
              enteredThisTurn: false,
            },
          ],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          stack: [{ id: 'stack-spell-1', oracle_text: 'Mutate {1}{G}', type_line: 'Creature — Frog' }],
        } as GameState,
        normalizedRaw: 'it has mutate',
        ctx: { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' },
      })
    ).toBe(true);

    expect(
      evaluateExtendedConditionalClause({
        ...baseParams,
        nextState: {
          battlefield: [
            { id: 'bf-white', controller: controllerId, type_line: 'Creature — Soldier', colors: ['W'] },
          ],
        } as GameState,
        normalizedRaw: 'you control a white or blue permanent',
      })
    ).toBe(true);

    expect(
      evaluateConditionalWrapperCondition({
        condition: { kind: 'if', raw: "this creature wasn't kicked" },
        nextState: {
          battlefield: [{ id: 'bf-source', controller: controllerId, type_line: 'Creature — Elemental', wasKicked: false }],
        } as GameState,
        controllerId,
        ctx: { controllerId, sourceId: 'bf-source' },
        lastActionOutcome: null,
      })
    ).toBe(true);
  });

  it('executes Ian the Reckless modified branch without condition gap', () => {
    const ir = parseOracleTextToIR(
      "When Ian the Reckless attacks, if it's modified, you may have it deal damage equal to its power to you and any target.",
      'Ian the Reckless'
    );
    const step = ir.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(step).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-source',
            controller: controllerId,
            type_line: 'Legendary Creature — Human',
            counters: { '+1/+1': 1 },
            attacking: true,
          },
        ],
      } as GameState,
      [step!],
      { controllerId, sourceId: 'bf-source' }
    );
    expect(result.automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')).toBe(false);
  });

  it('executes Stenchskipper, Ichor Shade, Void Mirror without condition gaps', () => {
    const stenchskipper = parseOracleTextToIR(
      'At the beginning of your upkeep, if you control no Goblins, sacrifice this creature.',
      'Stenchskipper'
    );
    const stenchStep = stenchskipper.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          players: [{ id: controllerId }],
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Human' },
          ],
        } as GameState,
        [stenchStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const ichor = parseOracleTextToIR(
      'Whenever an artifact or creature is put into a graveyard from the battlefield, if an artifact or creature was put into a graveyard from the battlefield this turn, put a +1/+1 counter on this creature.',
      'Ichor Shade'
    );
    const ichorStep = ichor.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        { artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn: true } as GameState,
        [ichorStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const voidMirror = parseOracleTextToIR(
      'Whenever a player casts a spell, if no colored mana was spent to cast it, counter that spell.',
      'Void Mirror'
    );
    const voidStep = voidMirror.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          stack: [
            {
              id: 'stack-spell-1',
              manaSpentBreakdown: { colorless: 2, white: 0, blue: 0, black: 0, red: 0, green: 0 },
            },
          ],
        } as GameState,
        [voidStep!],
        { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);
  });

  it('executes Princess Yue, Mad Dog, Pollywog, Raka, Skizzik without condition gaps', () => {
    const yue = parseOracleTextToIR(
      'When Princess Yue dies, if she was a nonland creature, return this card to the battlefield tapped under your control.',
      'Princess Yue'
    );
    const yueStep = yue.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              type_line: 'Legendary Creature — Human Noble Ally',
            },
          ],
        } as GameState,
        [yueStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const madDog = parseOracleTextToIR(
      "At the beginning of your end step, if this creature didn't attack or come under your control this turn, sacrifice it.",
      'Mad Dog'
    );
    const madStep = madDog.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          battlefield: [
            {
              id: 'bf-source',
              controller: controllerId,
              type_line: 'Creature — Dog',
              attackedThisTurn: false,
              cameUnderYourControlThisTurn: false,
              gainedControlThisTurn: false,
              enteredThisTurn: false,
            },
          ],
        } as GameState,
        [madStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const pollywog = parseOracleTextToIR(
      'Whenever you cast a creature spell, if it has mutate, draw a card, then discard a card.',
      'Pollywog Symbiote'
    );
    const pollyStep = pollywog.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          stack: [{ id: 'stack-spell-1', oracle_text: 'Mutate {1}{G}', type_line: 'Creature — Frog' }],
        } as GameState,
        [pollyStep!],
        { controllerId, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const raka = parseOracleTextToIR(
      'At the beginning of your upkeep, if you control a white or blue permanent, this enchantment deals 1 damage to target creature.',
      'Raka Sanctuary'
    );
    const rakaStep = raka.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          battlefield: [
            { id: 'bf-enchant', controller: controllerId, type_line: 'Enchantment' },
            { id: 'bf-white', controller: controllerId, type_line: 'Creature — Soldier', colors: ['W'] },
          ],
        } as GameState,
        [rakaStep!],
        { controllerId, sourceId: 'bf-enchant' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);

    const skizzik = parseOracleTextToIR(
      "At the beginning of your end step, if this creature wasn't kicked, sacrifice it.",
      'Skizzik'
    );
    const skizzikStep = skizzik.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'conditional');
    expect(
      applyOracleIRStepsToGameState(
        {
          battlefield: [
            { id: 'bf-source', controller: controllerId, type_line: 'Creature — Elemental', wasKicked: false },
          ],
        } as GameState,
        [skizzikStep!],
        { controllerId, sourceId: 'bf-source' }
      ).automationGaps?.some((g) => g.reasonCode === 'unsupported_condition_clause')
    ).toBe(false);
  });
});
