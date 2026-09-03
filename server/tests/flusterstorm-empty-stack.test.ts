import { describe, expect, it } from 'vitest';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { hasValidTargetsForSpell } from '../src/rules-engine/target-availability.js';
import { categorizeSpellWithoutPrimaryRetirement as categorizeSpell } from '../src/rules-engine/targeting.js';

const playerId = 'p1';

const flusterstorm = {
  id: 'fluster1',
  name: 'Flusterstorm',
  type_line: 'Instant',
  mana_cost: '{U}',
  oracle_text:
    'Counter target instant or sorcery spell, or counter target ability that targets a spell you control.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)',
};

function buildState(stack: any[] = []) {
  return {
    turnPlayer: playerId,
    priority: playerId,
    step: 'MAIN1',
    phase: 'precombatMain',
    stack,
    players: [{ id: playerId }, { id: 'p2' }],
    battlefield: [
      {
        id: 'canal',
        controller: playerId,
        tapped: false,
        card: {
          name: 'Spirebluff Canal',
          type_line: 'Land',
          oracle_text:
            '({T}: Add {U} or {R}.)\nThis land enters the battlefield tapped unless you control two or fewer other lands.',
        },
      },
    ],
    manaPool: {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    zones: {
      [playerId]: { hand: [flusterstorm] },
    },
  };
}

describe('Flusterstorm with empty stack', () => {
  it('categorizes as a counterspell that needs stack targets', () => {
    const spec = categorizeSpell(flusterstorm.name, flusterstorm.oracle_text);
    expect(spec?.op).toBe('COUNTER_TARGET_SPELL');
    expect(spec?.spellTypeFilter).toBe('INSTANT_SORCERY');
  });

  it('has no valid targets when the stack is empty', () => {
    const state = buildState([]);
    expect(hasValidTargetsForSpell(state, playerId, flusterstorm)).toBe(false);
  });

  it('is not a castable candidate in main or response mode with an empty stack', () => {
    const ctx = { state: buildState([]), libraries: new Map() } as any;

    const mainCandidates = getCastableSpellCandidates(ctx, playerId, {
      mode: 'main',
      allowUnknownCostFallback: false,
    });
    const responseCandidates = getCastableSpellCandidates(ctx, playerId, {
      mode: 'response',
      allowUnknownCostFallback: false,
    });

    expect(mainCandidates.some((c) => c.castCard?.name === 'Flusterstorm')).toBe(false);
    expect(responseCandidates.some((c) => c.castCard?.name === 'Flusterstorm')).toBe(false);
  });

  it('is castable when an opponent instant is on the stack', () => {
    const state = buildState([
      {
        id: 'opp_spell',
        type: 'spell',
        controller: 'p2',
        canBeCountered: true,
        card: { name: 'Counterspell', type_line: 'Instant' },
      },
    ]);
    expect(hasValidTargetsForSpell(state, playerId, flusterstorm)).toBe(true);

    const ctx = { state, libraries: new Map() } as any;
    const responseCandidates = getCastableSpellCandidates(ctx, playerId, {
      mode: 'response',
      allowUnknownCostFallback: false,
    });
    expect(responseCandidates.some((c) => c.castCard?.name === 'Flusterstorm')).toBe(true);
  });
});
