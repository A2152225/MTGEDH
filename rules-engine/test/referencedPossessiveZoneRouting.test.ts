import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { applyExileStep } from '../src/oracleIRExecutorBattlefieldStepHandlers';
import { applyExileNamedCardsFromZonesStep } from '../src/oracleIRExecutorPlayerStepHandlers';
import {
  parseReferencedPossessiveZonePhrase,
  resolveReferencedPlayerZone,
} from '../src/oracleIRExecutorReferenceUtils';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  inferOracleIrTargetBinding,
  oracleIrTargetBindingToBaseContext,
  oracleIrTargetBindingToEventHint,
} from '../src/oracleIrTargetBinding';

const COUNTERBORE_TEXT =
  "Search its controller's graveyard, hand, and library for all cards with the same name as that spell and exile them.";

function makeReferencedCreatureState() {
  return {
    players: [
      { id: 'p_caster', seat: 0, hand: [], graveyard: [], library: [], exile: [] },
      {
        id: 'p_victim',
        seat: 1,
        hand: [{ id: 'h1', name: 'Shock', type_line: 'Instant' }],
        graveyard: [{ id: 'g1', name: 'Grizzly Bears', type_line: 'Creature — Bear' }],
        library: [{ id: 'l1', name: 'Island', type_line: 'Land' }],
        exile: [],
      },
      { id: 'p_other1', seat: 2, hand: [], graveyard: [], library: [], exile: [] },
      { id: 'p_other2', seat: 3, hand: [], graveyard: [], library: [], exile: [] },
    ],
    battlefield: [
      {
        id: 'perm_creature',
        controller: 'p_victim',
        owner: 'p_victim',
        card: { id: 'card1', name: 'Victim Creature', type_line: 'Creature' },
      },
    ],
    stack: [],
  } as any;
}

describe('referenced possessive zone routing', () => {
  it('parses its controller zone phrases', () => {
    expect(parseReferencedPossessiveZonePhrase("its controller's graveyard")).toEqual({
      role: 'controller',
      zone: 'graveyard',
    });
    expect(parseReferencedPossessiveZonePhrase("its owner's hand")).toEqual({
      role: 'owner',
      zone: 'hand',
    });
  });

  it('parses Counterbore into exile_named_cards_from_zones with referenced controller', () => {
    const steps = parseOracleTextToIR(COUNTERBORE_TEXT, 'Counterbore').abilities[0]?.steps ?? [];
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'exile_named_cards_from_zones',
        who: { kind: 'controller_of_referenced_object' },
        zones: ['graveyard', 'hand', 'library'],
        nameSource: 'target_spell_name',
      }),
    ]);
  });

  it('exiles same-named cards from the targeted spell controller zones in four-player games', () => {
    const state = {
      players: [
        { id: 'p_caster', seat: 0, hand: [], graveyard: [], library: [], exile: [] },
        {
          id: 'p_victim',
          seat: 1,
          hand: [{ id: 'h1', name: 'Cultivate', type_line: 'Sorcery' }],
          graveyard: [{ id: 'g1', name: 'Cultivate', type_line: 'Sorcery' }],
          library: [{ id: 'l1', name: 'Island', type_line: 'Land' }, { id: 'l2', name: 'Cultivate', type_line: 'Sorcery' }],
          exile: [],
        },
        { id: 'p_other1', seat: 2, hand: [], graveyard: [], library: [], exile: [] },
        { id: 'p_other2', seat: 3, hand: [], graveyard: [], library: [], exile: [] },
      ],
      stack: [
        {
          id: 'spell-victim',
          type: 'spell',
          controller: 'p_victim',
          owner: 'p_victim',
          card: { id: 'cultivate-card', name: 'Cultivate', type_line: 'Sorcery' },
        },
      ],
      battlefield: [],
    } as any;

    const steps = parseOracleTextToIR(COUNTERBORE_TEXT, 'Counterbore').abilities[0]?.steps ?? [];
    const binding = inferOracleIrTargetBinding(state, ['spell-victim'], 'p_caster');
    const baseCtx = oracleIrTargetBindingToBaseContext(binding);
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        sourceName: 'Counterbore',
        sourceObjectType: 'spell',
        ...baseCtx,
        selectorContext: baseCtx.selectorContext,
      },
      {
        ...oracleIrTargetBindingToEventHint(binding),
        sourceObjectType: 'spell',
      },
    );

    const zone = resolveReferencedPlayerZone(state, irCtx, "its controller's graveyard");
    expect(zone).toEqual({ playerId: 'p_victim', zone: 'graveyard' });

    const result = applyExileNamedCardsFromZonesStep(state, steps[0] as any, irCtx);
    expect(result.applied).toBe(true);

    const victim = (result.state as any).players.find((p: any) => p.id === 'p_victim');
    expect(victim.hand).toHaveLength(0);
    expect(victim.graveyard).toHaveLength(0);
    expect(victim.library.map((c: any) => c.id)).toEqual(['l1']);
    expect(victim.exile.map((c: any) => c.name)).toEqual(['Cultivate', 'Cultivate', 'Cultivate']);
  });

  it('exiles the top card of its controller library via move_zone', () => {
    const state = makeReferencedCreatureState();
    const step = {
      kind: 'move_zone' as const,
      what: { kind: 'raw' as const, text: "the top card of its controller's library" },
      to: 'exile' as const,
      raw: "Exile the top card of its controller's library.",
    };
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        lastReferencedPermanentId: 'perm_creature',
        selectorContext: { lastReferencedPermanentId: 'perm_creature' },
      },
      { lastReferencedPermanentId: 'perm_creature' },
    );

    const result = applyOracleIRStepsToGameState(state, [step], ctx, { allowOptional: true });
    expect(result.appliedSteps?.[0]?.kind).toBe('move_zone');
    const victim = result.state.players.find((p: any) => p.id === 'p_victim');
    expect(victim.library).toHaveLength(0);
    expect(victim.exile).toHaveLength(1);
    expect(victim.exile[0]?.id).toBe('l1');
  });

  it('parses exile the top card of its controller library as move_zone', () => {
    const steps = parseOracleTextToIR(
      "Exile target creature. Exile the top card of its controller's library.",
      'Test Pilfer',
    ).abilities[0]?.steps ?? [];
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'exile',
        target: { kind: 'raw', text: 'target creature' },
      }),
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: "the top card of its controller's library" },
        to: 'exile',
      }),
    ]);
  });

  it('parses search its controller library with controller_of_referenced_object', () => {
    const steps = parseOracleTextToIR(
      "Search its controller's library for a basic land card, reveal it, and put it into its controller's hand.",
      'Test Spell',
    ).abilities[0]?.steps ?? [];
    expect(steps.some((step) => step.kind === 'search_library' && step.who?.kind === 'controller_of_referenced_object')).toBe(
      true,
    );
  });

  it('returns a graveyard card to the battlefield from its controller graveyard', () => {
    const state = makeReferencedCreatureState();
    const step = {
      kind: 'move_zone' as const,
      what: { kind: 'raw' as const, text: "target creature card from its controller's graveyard" },
      to: 'battlefield' as const,
      raw: "Return target creature card from its controller's graveyard to the battlefield.",
    };
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        lastReferencedPermanentId: 'perm_creature',
        selectorContext: {
          chosenObjectIds: ['g1'],
          lastReferencedPermanentId: 'perm_creature',
        },
      },
      { chosenObjectIds: ['g1'], lastReferencedPermanentId: 'perm_creature' },
    );

    const result = applyOracleIRStepsToGameState(state, [step], ctx, { allowOptional: true });
    expect(result.appliedSteps?.[0]?.kind).toBe('move_zone');
    const victim = result.state.players.find((p: any) => p.id === 'p_victim');
    expect(victim.graveyard).toHaveLength(0);
    expect(result.state.battlefield?.some((perm: any) => perm.card?.id === 'g1')).toBe(true);
  });

  it('exiles a random card from its controller hand via move_zone', () => {
    const state = makeReferencedCreatureState();
    const step = {
      kind: 'move_zone' as const,
      what: { kind: 'raw' as const, text: "a card from its controller's hand at random" },
      to: 'exile' as const,
      raw: "Exile a card from its controller's hand at random.",
    };
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        lastReferencedPermanentId: 'perm_creature',
        selectorContext: { lastReferencedPermanentId: 'perm_creature' },
      },
      { lastReferencedPermanentId: 'perm_creature' },
    );

    const result = applyOracleIRStepsToGameState(state, [step], ctx, { allowOptional: true });
    expect(result.appliedSteps?.[0]?.kind).toBe('move_zone');
    const victim = result.state.players.find((p: any) => p.id === 'p_victim');
    expect(victim.hand).toHaveLength(0);
    expect(victim.exile).toHaveLength(1);
  });

  it('exiles all cards from its controller hand via battlefield exile step', () => {
    const state = makeReferencedCreatureState();
    const step = {
      kind: 'exile' as const,
      target: { kind: 'raw' as const, text: "its controller's hand" },
      raw: "Exile its controller's hand.",
    };
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        lastReferencedPermanentId: 'perm_creature',
        selectorContext: { lastReferencedPermanentId: 'perm_creature' },
      },
      { lastReferencedPermanentId: 'perm_creature' },
    );

    const result = applyExileStep(state, step, ctx);
    expect(result.applied).toBe(true);
    const victim = (result.state as any).players.find((p: any) => p.id === 'p_victim');
    expect(victim.hand).toHaveLength(0);
    expect(victim.exile).toHaveLength(1);
  });
});
