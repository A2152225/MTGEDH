import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src/index.js';
import { createContext } from '../src/state/context.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { applySupplementalOracleIRForResolvedSpell } from '../src/state/modules/oracleIrSpellLegacySupplemental.js';
import { isSpellEffectOwnedByOracleIrPrimary } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { applyInstantSorcerySpecialCaseSpellEffects } from '../src/state/modules/stackResolveSpellSpecialCaseUtils.js';

const RITE_TEXT =
  'Whenever a creature or enchantment you control enters this turn, draw a card.\nFlashback {2}{G}{W} (You may cast this card from your graveyard for its flashback cost. Then exile it.)';

describe('temporary ETB window IR ownership', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('collects Rite of Harmony as grant_temporary_etb_trigger only', () => {
    const steps = collectSpellResolutionEffectSteps(RITE_TEXT, 'Rite of Harmony');
    expect(steps.map((step) => step.kind)).toEqual(['grant_temporary_etb_trigger']);
    expect(steps[0]).toMatchObject({
      watchTypes: ['creature', 'enchantment'],
      effect: 'draw a card',
    });
  });

  it('marks Rite of Harmony as IR-owned under spell primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(isSpellEffectOwnedByOracleIrPrimary(RITE_TEXT, 'Rite of Harmony')).toBe(true);
  });

  it('no-ops supplemental oracle under IR primary', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    const applied = applySupplementalOracleIRForResolvedSpell(
      { state: {}, rng: () => 0.5 } as any,
      'Choose 3, 4, or 5 at random. Target player mills that many cards.',
      'p1' as any,
      'Test Rider',
    );
    expect(applied).toBe(0);
  });

  it('PRIMARY=0 Rite special-case trampolines to IR grant_temporary_etb_trigger', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    const playerId = 'p1' as PlayerID;
    const ctx = createContext('rite_primary0_trampoline');
    (ctx as any).state = {
      players: [{ id: playerId, name: 'P1', hasLost: false }],
      battlefield: [],
      stack: [],
      temporaryEtbTriggers: [],
    };
    applyInstantSorcerySpecialCaseSpellEffects(ctx, {
      controller: playerId,
      card: { id: 'rite_spell_1', name: 'Custom Harmony', oracle_text: RITE_TEXT },
      effectiveCard: { name: 'Custom Harmony', oracle_text: RITE_TEXT },
      item: { id: 'rite_spell_1', card: { oracle_text: RITE_TEXT } },
      gameId: ctx.gameId,
      spellXValue: undefined,
      isRiteOfHarmonyStyleWindow: true,
      isDivineReckoningStyleChoice: false,
      isPrisonersDilemmaStyleChoice: false,
      isSummonsOfSarumanStyle: false,
    });

    expect((ctx.state as any).temporaryEtbTriggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        controller: playerId,
        sourceName: 'Custom Harmony',
        watchTypes: ['creature', 'enchantment'],
        effect: 'draw a card',
      }),
    ]));
  });
});
