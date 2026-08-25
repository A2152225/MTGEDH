import { describe, expect, it } from 'vitest';

import { maybeQueueWardPaymentPromptsForTargetSelection } from '../src/socket/resolution-handlers/targetSelectionWardPromptHandlers.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const NOWHERE_TO_RUN_ORACLE =
  "Flash\nWhen this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn.\nCreatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger.";
const GLARING_SPOTLIGHT_ORACLE =
  "Creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.\n{3}, Sacrifice this artifact: Creatures you control gain hexproof until end of turn and can't be blocked this turn.";
const DETECTION_TOWER_ORACLE =
  "{T}: Add {C}.\n{1}, {T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";

function makeGame(staticPermanent: {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
} | null) {
  return {
    state: {
      startingLife: 40,
      life: { p1: 40, p2: 40 },
      stack: [{
        id: 'stack_spell_1',
        type: 'spell',
        controller: 'p1',
        card: { name: 'Lightning Bolt', type_line: 'Instant' },
      }],
      battlefield: [
        {
          id: 'ward_1',
          controller: 'p2',
          card: {
            name: 'Shielded Bear',
            type_line: 'Creature — Bear',
            oracle_text: 'Ward {2}',
          },
        },
        ...(staticPermanent
          ? [{
              id: staticPermanent.id,
              controller: 'p1',
              card: {
                name: staticPermanent.name,
                type_line: staticPermanent.type_line,
                oracle_text: staticPermanent.oracle_text,
              },
            }]
          : []),
      ],
    },
    bumpSeq: () => {},
  };
}

function queuedWardPayments(game: ReturnType<typeof makeGame>, gameId: string): boolean {
  ResolutionQueueManager.removeQueue(gameId);
  const io = { to: () => ({ emit: () => {} }) } as any;
  const step = { sourceId: 'stack_spell_1' } as any;
  maybeQueueWardPaymentPromptsForTargetSelection(io, game, gameId, step, {
    pid: 'p1',
    selections: ['ward_1'],
    spellCastContext: {},
  });
  const steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any);
  const queued = steps.some((entry: any) => (
    entry?.wardPayment === true
    && entry?.type === ResolutionStepType.MANA_PAYMENT_CHOICE
  ));
  ResolutionQueueManager.removeQueue(gameId);
  return queued;
}

describe('ward as-though skip from leftover static specs', () => {
  it('skips ward prompts when leftover oracle suppresses ward as-though', () => {
    const game = makeGame({
      id: 'nowhere_1',
      name: 'Nowhere to Run',
      type_line: 'Enchantment',
      oracle_text: NOWHERE_TO_RUN_ORACLE,
    });
    expect(queuedWardPayments(game, 'test_ward_as_though_skip_nowhere')).toBe(false);
  });

  it('still queues ward for controller-only as-though leftover oracle without a ward rider', () => {
    const game = makeGame({
      id: 'spotlight_1',
      name: 'Glaring Spotlight',
      type_line: 'Artifact',
      oracle_text: GLARING_SPOTLIGHT_ORACLE,
    });
    expect(queuedWardPayments(game, 'test_ward_as_though_skip_spotlight')).toBe(true);
  });

  it('still queues ward when until-EOT as-though leftover oracle is not a continuous static', () => {
    const game = makeGame({
      id: 'tower_1',
      name: 'Detection Tower',
      type_line: 'Land',
      oracle_text: DETECTION_TOWER_ORACLE,
    });
    expect(queuedWardPayments(game, 'test_ward_as_though_skip_tower')).toBe(true);
  });
});
