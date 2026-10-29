import { describe, expect, it } from 'vitest';
import {
  getCopiedSpellReplaySteps,
  getCopiedStackObjectReplaySteps,
  resolveCopiedTargetSpellStackItem,
  resolveCopiedSpellSourceCards,
  resolveCopySpellCount,
  resolveOtherCreaturesCopyCouldTargetCount,
  resolveThisSpellCopyReplaySteps,
  shouldDeferStackSpellCopyToServer,
} from '../src/oracleIRExecutorCopySpellSupport';

describe('oracleIRExecutorCopySpellSupport', () => {
  it('defers stack-target copy_spell steps when server bridge flag is set', () => {
    expect(shouldDeferStackSpellCopyToServer(
      { controllerId: 'p1', deferStackSpellCopiesToServer: true } as any,
      { kind: 'copy_spell', subject: 'target_spell', raw: 'copy target instant or sorcery spell' } as any,
    )).toBe(true);
    expect(shouldDeferStackSpellCopyToServer(
      { controllerId: 'p1', deferStackSpellCopiesToServer: true } as any,
      { kind: 'copy_spell', subject: 'linked_exiled_cards', raw: 'copy the exiled card' } as any,
    )).toBe(false);
  });

  it('parses replay steps from oracle text on card-like objects', () => {
    const steps = getCopiedSpellReplaySteps({
      name: 'Lightning Bolt',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    });
    expect(steps.some((step) => step.kind === 'deal_damage')).toBe(true);
  });

  it('resolves this-spell replay steps from audit copyReplaySteps context', () => {
    const replaySteps = [{ kind: 'destroy', raw: 'destroy target creature.' } as any];
    const resolved = resolveThisSpellCopyReplaySteps({
      steps: [{ kind: 'copy_spell', subject: 'this_spell', raw: 'copy this spell' } as any],
      stepIndex: 0,
      state: { stack: [] } as any,
      ctx: { controllerId: 'p1', copyReplaySteps: replaySteps } as any,
    });
    expect(resolved).toEqual(replaySteps);
  });

  it('resolves copied stack abilities for ability-copy steps', () => {
    const steps = getCopiedStackObjectReplaySteps(
      {
        id: 'stack-ability-1',
        type: 'ability',
        abilityText: 'Draw a card.',
      },
      { kind: 'copy_spell', subject: 'target_spell', target: { kind: 'raw', text: 'that ability' }, raw: 'copy that ability' } as any
    );
    expect(steps.some((step) => step.kind === 'draw')).toBe(true);
  });

  it('finds linked exiled instant cards for linked_exiled_cards copy steps', () => {
    const resolution = resolveCopiedSpellSourceCards({
      state: {
        players: [
          {
            id: 'p1',
            exile: [
              {
                id: 'exile-linked-spell-1',
                name: 'Lightning Bolt',
                type_line: 'Instant',
                oracle_text: 'Lightning Bolt deals 3 damage to any target.',
                exiledWith: 'bf-source',
              },
            ],
          },
        ],
      } as any,
      step: { kind: 'copy_spell', subject: 'linked_exiled_cards', raw: 'copy the exiled card' } as any,
      ctx: { controllerId: 'p1', sourceId: 'bf-source' } as any,
      lastMovedCards: [],
    });
    expect(resolution.cards?.length).toBe(1);
    expect(getCopiedSpellReplaySteps(resolution.cards?.[0]).length).toBeGreaterThan(0);
  });

  it('resolves this-spell replay from a following target_spell copy step', () => {
    const steps = [
      {
        kind: 'copy_spell',
        subject: 'this_spell',
        raw: 'copy it for each time you cast your commander from the command zone this game',
      },
      {
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'target instant or sorcery spell' },
        raw: 'copy target instant or sorcery spell',
      },
    ] as any[];
    const resolved = resolveThisSpellCopyReplaySteps({
      steps,
      stepIndex: 0,
      state: { stack: [] } as any,
      ctx: { controllerId: 'p1' } as any,
    });
    expect(resolved).toEqual([steps[1]]);
  });

  it('counts other creatures the copied ability could target for Agrus-style copies', () => {
    const state = {
      stack: [{
        id: 'ability_1',
        type: 'ability',
        controller: 'p1',
        targets: ['agrus_1'],
        copyRetargetValidTargets: [
          { id: 'agrus_1', type: 'permanent' },
          { id: 'bear_1', type: 'permanent' },
          { id: 'bear_2', type: 'permanent' },
        ],
      }],
      battlefield: [
        { id: 'agrus_1', controller: 'p1', card: { type_line: 'Legendary Creature' } },
        { id: 'bear_1', controller: 'p1', card: { type_line: 'Creature — Bear' } },
        { id: 'bear_2', controller: 'p1', card: { type_line: 'Creature — Bear' } },
      ],
    } as any;
    const step = {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that ability' },
      copies: {
        kind: 'reference_amount',
        raw: 'for each other creature you control that ability could target',
      },
      raw: 'copy that ability for each other creature you control that ability could target',
    } as const;
    const ctx = { controllerId: 'p1', targetSpellId: 'ability_1' } as any;

    expect(resolveOtherCreaturesCopyCouldTargetCount(state, 'p1', step, ctx)).toBe(2);
    expect(resolveCopySpellCount(state, 'p1', step, ctx)).toBe(2);
  });

  it('counts any other creature the spell could target when the reference omits you control', () => {
    const state = {
      stack: [{
        id: 'spell_1',
        type: 'spell',
        controller: 'p2',
        targets: ['nephilim_1'],
        copyRetargetValidTargets: [
          { id: 'nephilim_1', type: 'permanent' },
          { id: 'bear_1', type: 'permanent' },
          { id: 'opp_bear', type: 'permanent' },
        ],
      }],
      battlefield: [
        { id: 'nephilim_1', controller: 'p1', card: { type_line: 'Creature — Nephilim' } },
        { id: 'bear_1', controller: 'p1', card: { type_line: 'Creature — Bear' } },
        { id: 'opp_bear', controller: 'p2', card: { type_line: 'Creature — Bear' } },
      ],
    } as any;
    const step = {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'the spell' },
      copies: {
        kind: 'reference_amount',
        raw: 'for each other creature that spell could target',
      },
      raw: 'copy the spell for each other creature that spell could target',
    } as const;
    const ctx = { controllerId: 'p1', targetSpellId: 'spell_1' } as any;

    expect(resolveOtherCreaturesCopyCouldTargetCount(state, 'p1', step, ctx)).toBe(2);
    expect(resolveCopySpellCount(state, 'p1', step, ctx)).toBe(2);
  });

  it('counts replicate payments from the spell stack item when the source id is the card id', () => {
    const state = {
      stack: [
        {
          id: 'stack_spell',
          type: 'spell',
          controller: 'p1',
          replicateCount: 2,
          card: { id: 'spree_1', name: 'Shattering Spree' },
        },
        {
          id: 'trigger_1',
          type: 'triggered_ability',
          source: 'spree_1',
          replicateCount: 2,
          card: { id: 'spree_1' },
        },
      ],
    } as any;
    const step = {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'replicate_count' },
      allowNewTargets: true,
      raw: 'copy it for each time you paid its replicate cost',
    } as any;

    expect(resolveCopySpellCount(state, 'p1', step, { controllerId: 'p1', sourceId: 'spree_1' } as any)).toBe(2);
    expect(resolveCopySpellCount(state, 'p1', step, { controllerId: 'p1', sourceId: 'trigger_1' } as any)).toBe(2);
  });

  it('counts storm copies from server-style spellsCastThisTurn arrays', () => {
    const count = resolveCopySpellCount(
      {
        spellsCastThisTurn: [
          { id: 'a', casterId: 'p1' },
          { id: 'b', casterId: 'p1' },
          { id: 'c', casterId: 'p1' },
        ],
      } as any,
      'p1',
      {
        kind: 'copy_spell',
        subject: 'target_spell',
        copies: { kind: 'spells_cast_before_this_turn' },
        raw: 'copy it for each other instant and sorcery spell you have cast before it this turn',
      } as any,
    );
    expect(count).toBe(2);
  });

  it('selects stack abilities when copying that ability', () => {
    const resolution = resolveCopiedTargetSpellStackItem({
      state: {
        stack: [
          {
            id: 'stack-ability-1',
            type: 'ability',
            controller: 'p1',
            abilityText: 'Draw a card.',
          },
        ],
      } as any,
      step: {
        kind: 'copy_spell',
        subject: 'target_spell',
        target: { kind: 'raw', text: 'that ability' },
        raw: 'copy that ability',
      } as any,
      ctx: { controllerId: 'p1', targetSpellId: 'stack-ability-1' } as any,
    });
    expect(resolution.stackItem?.id).toBe('stack-ability-1');
  });

  it('resolves last_moved_card from selectorContext when the server bridge stripped carry-over', () => {
    const exiled = {
      id: 'gy_opt',
      name: 'Opt',
      type_line: 'Instant',
      oracle_text: 'Scry 1.',
    };
    const resolution = resolveCopiedSpellSourceCards({
      state: {
        players: [{ id: 'p1', exile: [], graveyard: [] }, { id: 'p2', exile: [exiled], graveyard: [] }],
        zones: { p2: { exile: [exiled], graveyard: [] } },
      } as any,
      step: { kind: 'copy_spell', subject: 'last_moved_card', optional: true, raw: 'copy it' } as any,
      ctx: { controllerId: 'p1', selectorContext: { chosenObjectIds: ['gy_opt'] } } as any,
      lastMovedCards: [],
    });
    expect(resolution.cards?.[0]?.id).toBe('gy_opt');
  });
});
