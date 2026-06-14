import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyAttachStep } from '../src/oracleIRExecutorAttachStepHandlers';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneCreatureCardExiledThisWay,
  parseMoveZoneThatSpell,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 329 — Hinder / Fumble / Anzrag\'s Rampage', () => {
  it('parses Hinder countered-spell library top-or-bottom selector', () => {
    expect(
      parseMoveZoneThatSpell({
        kind: 'raw',
        text: 'that spell',
      })
    ).toBe(true);
    const ir = parseOracleTextToIR(
      "Counter target spell. If that spell is countered this way, put that card on your choice of the top or bottom of its owner's library instead of into that player's graveyard.",
      'Hinder'
    );
    const conditional = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'conditional');
    const moveStep = (conditional as any)?.steps?.find((entry: any) => entry.kind === 'move_zone');
    expect(moveStep?.to).toBe('library');
    expect(String((moveStep as any)?.what?.text || '').trim()).toBe('that spell');
  });

  it('parses Anzrag creature card exiled this way selector', () => {
    expect(
      parseMoveZoneCreatureCardExiledThisWay({
        kind: 'raw',
        text: 'a creature card exiled this way',
      })
    ).toBe(true);
  });

  it('parses Fumble attach them to another creature step', () => {
    const ir = parseOracleTextToIR(
      "Return target creature to its owner's hand. If you do, choose an Equipment attached to that creature or an Aura attached to that creature. Attach them to another creature.",
      'Fumble'
    );
    const attachStep = ir.abilities[1]?.steps?.find((entry) => entry.kind === 'attach');
    expect(attachStep).toBeTruthy();
    expect(String((attachStep as any)?.attachment?.text || '').trim()).toBe('them');
    expect(String((attachStep as any)?.to?.text || '').trim()).toBe('another creature');
  });

  it('executes Hinder putting countered spell on bottom of owner library', () => {
    const ir = parseOracleTextToIR(
      "Counter target spell. If that spell is countered this way, put that card on your choice of the top or bottom of its owner's library instead of into that player's graveyard.",
      'Hinder'
    );
    const conditional = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'conditional');
    const step = (conditional as any)?.steps?.find((entry: any) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack-hinder-1',
          name: 'Countered Spell',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Instant',
          cmc: 3,
          card: { id: 'card-hinder-1', name: 'Countered Spell', type_line: 'Instant', cmc: 3 },
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetSpellId: 'stack-hinder-1',
      selectorContext: { targetSpellId: 'stack-hinder-1', libraryPlacement: 'bottom' },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(((result.state as any).stack || []).length).toBe(0);
    expect((result.state.players[1]?.library || []).length).toBe(1);
    expect((result.state.players[1]?.library || [])[0]?.name).toBe('Countered Spell');
  });

  it('executes Fumble reattaching aura from bounced creature to another creature', () => {
    const ir = parseOracleTextToIR(
      "Return target creature to its owner's hand. If you do, choose an Equipment attached to that creature or an Aura attached to that creature. Attach them to another creature.",
      'Fumble'
    );
    const attachStep = ir.abilities[1]?.steps?.find((entry) => entry.kind === 'attach');
    expect(attachStep).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-fumble-host',
          name: 'Fumble Host',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-fumble-target',
          name: 'Fumble Target',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-fumble-aura',
          name: 'Fumble Aura',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Enchantment — Aura',
          attachedTo: 'bf-fumble-host',
        },
      ],
    } as GameState;
    const result = applyAttachStep(state, attachStep as any, {
      controllerId,
      sourceId: 'test',
      targetCreatureId: 'bf-fumble-host',
      selectorContext: { chosenObjectIds: ['bf-fumble-aura', 'bf-fumble-target'] },
    });
    expect(result.applied).toBe(true);
    const aura = (result.state.battlefield || []).find((perm: any) => perm.id === 'bf-fumble-aura');
    expect(aura?.attachedTo).toBe('bf-fumble-target');
  });

  it('executes Anzrag optional creature exiled this way onto the battlefield', () => {
    const ir = parseOracleTextToIR(
      'Target player sacrifices a creature or planeswalker of their choice. Exile the top X cards of their library. You may put a creature card exiled this way onto the battlefield.',
      "Anzrag's Rampage"
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        /a creature card exiled this way/i.test(String((entry as any).what?.text || ''))
    );
    expect(step).toBeTruthy();
    const exiledCreature = {
      id: 'exile-ar-1',
      name: 'AR Creature',
      type_line: 'Creature — Beast',
      cmc: 4,
    };
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [exiledCreature],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(
      state,
      [step!],
      {
        controllerId,
        sourceId: 'test',
        targetPlayerId: opponentId,
        lastExiledCards: [exiledCreature],
        selectorContext: { chosenObjectIds: ['exile-ar-1'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    expect((result.state.battlefield || [])[0]?.card?.name).toBe('AR Creature');
    expect((result.state.players[1]?.exile || []).length).toBe(0);
  });
});
