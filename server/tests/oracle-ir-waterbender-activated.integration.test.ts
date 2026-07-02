import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  tryApplyOracleIRToActivatedAbility,
} from '../src/state/modules/oracleIrAbilityExecution.js';

const WATERBEND_LINE = "Waterbend {4}: Target creature can't be blocked this turn.";
const FULL_ORACLE =
  "Whenever a creature you control deals combat damage to a player, put a quest counter on this enchantment. Then if it has four or more quest counters on it, draw a card.\n" +
  WATERBEND_LINE +
  ' (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)';

function makeCtx(targetId = 'bf-target') {
  return {
    state: {
      players: [{ id: 'p1', name: 'Player 1' }],
      battlefield: [
        {
          id: 'enchant-1',
          controller: 'p1',
          owner: 'p1',
          card: {
            name: 'Waterbender Ascension',
            type_line: 'Enchantment',
            oracle_text: FULL_ORACLE,
          },
        },
        {
          id: targetId,
          controller: 'p1',
          owner: 'p1',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        },
      ],
      life: { p1: 40 },
      turnNumber: 1,
      zones: { p1: { hand: [], library: [], graveyard: [], exile: [] } },
    },
    gameId: 'test_waterbender_activated_ir',
    bumpSeq: () => {},
    libraries: new Map(),
  } as any;
}

describe('oracle IR Waterbender Ascension activated ability (Layer 3)', () => {
  it('parses waterbend cost on activated ability', () => {
    const ir = parseOracleTextToIR(WATERBEND_LINE, 'Waterbender Ascension');
    expect(ir.abilities[0]?.cost?.toLowerCase()).toContain('waterbend');
    expect(ir.abilities[0]?.steps[0]?.kind).toBe('grant_temporary_ability');
  });

  it('applies unblockable grant through tryApplyOracleIRToActivatedAbility with target', () => {
    const ctx = makeCtx();
    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: 'Waterbender Ascension',
      oracleText: WATERBEND_LINE,
      sourcePermanentId: 'enchant-1',
      targets: ['bf-target'],
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    expect(result.applied).toBeGreaterThanOrEqual(1);

    const target = (ctx.state.battlefield || []).find((perm: any) => perm.id === 'bf-target');
    const granted = (target as any)?.grantedAbilities || (target as any)?.temporaryAbilities || [];
    const hasUnblockable = Array.isArray(granted)
      && granted.some((entry: any) =>
        String(entry?.ability || entry || '').toLowerCase().includes("can't be blocked"));
    const viaFlag = (target as any)?.cantBeBlockedThisTurn === true
      || (target as any)?.unblockableThisTurn === true;
    expect(hasUnblockable || viaFlag).toBe(true);
  });
});
