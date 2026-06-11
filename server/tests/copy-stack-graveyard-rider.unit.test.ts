import { describe, expect, it } from 'vitest';
import { applyInstantSorceryCopyStackSpellRiders } from '../src/state/modules/stackResolveSpellPostCategorizeRidersUtils.js';
import { wasSpellCastFromGraveyard } from '../src/state/modules/stackResolveSpellCopyChoiceUtils.js';

describe('copy stack graveyard rider', () => {
  it('copies targeted instant twice when cast from graveyard via flashback', () => {
    const playerId = 'p1';
    const oracleText =
      'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose new targets for the copies.\nFlashback {3}{R}{R}';

    const item = {
      id: 'stack_vengeance_1',
      controller: playerId,
      castFromGraveyard: true,
      card: {
        id: 'vengeance_1',
        name: 'Increasing Vengeance',
        type_line: 'Instant',
        castWithAbility: 'flashback',
      },
      targets: ['stack_target_1'],
    };

    const ctx: any = {
      state: {
        stack: [
          {
            id: 'stack_target_1',
            type: 'spell',
            controller: playerId,
            card: { id: 'opt_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Draw a card.' },
          },
        ],
      },
      bumpSeq: () => {},
      io: { to: () => ({ emit: () => {} }) },
      gameId: 'test',
    };

    expect(wasSpellCastFromGraveyard(item)).toBe(true);

    applyInstantSorceryCopyStackSpellRiders(ctx, {
      controller: playerId,
      card: item.card,
      effectiveCard: item.card,
      item,
      oracleText,
      oracleTextLower: oracleText.toLowerCase(),
      targets: item.targets,
      spellXValue: undefined,
      uncategorizedSpellFallbackApplied: 0,
    });

    const copies = ctx.state.stack.filter((s: any) => s?.copiedFromStackItemId === 'stack_target_1');
    expect(copies).toHaveLength(2);
  });
});
