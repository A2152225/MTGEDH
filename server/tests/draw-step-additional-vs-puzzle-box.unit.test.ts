import { describe, expect, it } from 'vitest';

import { detectDrawStepTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { calculateAdditionalDraws } from '../src/state/modules/game-state-effects.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const permanent = {
  id: 'perm_1',
  controller: 'p1',
  tapped: false,
};

describe('draw-step additional draws vs Puzzle Box', () => {
  it('does not put Howling Mine / Font / Kami additional-draw effects on the stack', () => {
    expect(
      detectDrawStepTriggers(
        {
          name: 'Howling Mine',
          oracle_text:
            "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card.",
        },
        permanent,
      ),
    ).toHaveLength(0);

    expect(
      detectDrawStepTriggers(
        {
          name: 'Font of Mythos',
          oracle_text: "At the beginning of each player's draw step, that player draws two additional cards.",
        },
        permanent,
      ),
    ).toHaveLength(0);

    expect(
      detectDrawStepTriggers(
        {
          name: 'Kami of the Crescent Moon',
          oracle_text: "At the beginning of each player's draw step, that player draws an additional card.",
        },
        permanent,
      ),
    ).toHaveLength(0);
  });

  it('still detects Teferi’s Puzzle Box as a real draw-step trigger', () => {
    const triggers = detectDrawStepTriggers(
      {
        name: "Teferi's Puzzle Box",
        oracle_text:
          "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.",
      },
      permanent,
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.effect).toMatch(/puts the cards in their hand/i);
    expect(triggers[0]?.effect).toMatch(/draws that many cards/i);
  });

  it('applies Howling Mine via calculateAdditionalDraws when untapped', () => {
    const ctx = {
      state: {
        battlefield: [
          {
            id: 'hm',
            controller: 'p1',
            tapped: false,
            card: {
              name: 'Howling Mine',
              oracle_text:
                "At the beginning of each player's draw step, if Howling Mine is untapped, that player draws an additional card.",
            },
          },
        ],
        players: [{ id: 'p1' }, { id: 'p2' }],
      },
    } as any;

    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(1);
    expect(calculateAdditionalDraws(ctx, 'p2')).toBe(1);

    ctx.state.battlefield[0].tapped = true;
    expect(calculateAdditionalDraws(ctx, 'p1')).toBe(0);
  });

  it('parses Puzzle Box effect into hand→library bottom + draw that many', () => {
    const ir = parseOracleTextToIR(
      "that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards.",
      "Teferi's Puzzle Box",
    );
    const steps = (ir.abilities || []).flatMap((ability: any) => ability.steps || []);
    const kinds = steps.map((step: any) => step.kind);
    expect(kinds).toContain('move_zone');
    expect(kinds).toContain('draw');

    const move = steps.find((step: any) => step.kind === 'move_zone');
    expect(String(move?.to || '')).toBe('library');
    expect(String(move?.libraryPlacement || move?.toRaw || '')).toMatch(/bottom/i);
    expect(String(move?.what?.text || '')).toMatch(/that player's hand/i);

    const draw = steps.find((step: any) => step.kind === 'draw');
    expect(draw?.amount).toEqual({ kind: 'reference_amount', raw: 'that many' });
    expect(draw?.who?.kind).toBe('target_player');
  });
});
