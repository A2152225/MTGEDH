import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { extractTriggeredEffectFromTimingMatch } from '../src/triggerEffectTextExtraction';
import type { GameState } from '../../shared/src';

const FORUM_FILIBUSTER_ORACLE =
  'At the beginning of your upkeep, create a 2/1 white and black Inkling creature token with flying. When you do, return up to one target Aura or Equipment card from your graveyard to the battlefield attached to that token.';

describe('Forum Filibuster reflexive when-you-do return/attach', () => {
  it('parses create-token plus when-you-do delayed GY return attached to that token', () => {
    const match = FORUM_FILIBUSTER_ORACLE.match(/at the beginning of your upkeep,?\s*([^.]+)/i);
    expect(match).not.toBeNull();
    const effect = extractTriggeredEffectFromTimingMatch(FORUM_FILIBUSTER_ORACLE, match!);
    const ir = parseOracleTextToIR(effect, 'Forum Filibuster');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);

    expect(steps.some((step) => step.kind === 'create_token')).toBe(true);
    const delayed = steps.find((step) => step.kind === 'schedule_delayed_trigger') as Extract<
      (typeof steps)[number],
      { kind: 'schedule_delayed_trigger' }
    > | undefined;
    expect(delayed).toBeDefined();
    expect(delayed?.timing).toBe('on_event');
    expect(String(delayed?.raw || delayed?.effect || '').toLowerCase()).toMatch(/when you do/);
    expect(String(delayed?.effect || '').toLowerCase()).toMatch(/aura or equipment/);
    expect(String(delayed?.effect || '').toLowerCase()).toMatch(/attached to that token/);

    const nested = Array.isArray(delayed?.steps) ? delayed.steps : [];
    const move = nested.find((step) => step.kind === 'move_zone') as Extract<
      (typeof nested)[number],
      { kind: 'move_zone' }
    > | undefined;
    expect(move).toBeDefined();
    expect(move?.to).toBe('battlefield');
    expect(String((move?.battlefieldAttachedTo as any)?.text || '').toLowerCase()).toMatch(/that token/);
  });

  it('returns a GY equipment attached to the created token', () => {
    const match = FORUM_FILIBUSTER_ORACLE.match(/at the beginning of your upkeep,?\s*([^.]+)/i);
    const effect = extractTriggeredEffectFromTimingMatch(FORUM_FILIBUSTER_ORACLE, match!);
    const ir = parseOracleTextToIR(effect, 'Forum Filibuster');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    const create = steps.find((step) => step.kind === 'create_token');
    const delayed = steps.find((step) => step.kind === 'schedule_delayed_trigger') as Extract<
      (typeof steps)[number],
      { kind: 'schedule_delayed_trigger' }
    >;
    const move = (delayed.steps || []).find((step) => step.kind === 'move_zone');
    expect(create && move).toBeTruthy();

    const state = {
      players: [
        {
          id: 'p1',
          life: 40,
          graveyard: [
            {
              id: 'sword-1',
              name: 'Short Sword',
              type_line: 'Artifact — Equipment',
              oracle_text: 'Equipped creature gets +1/+1. Equip {1}',
            },
          ],
          hand: [],
          exile: [],
          library: [],
        },
      ],
      battlefield: [
        {
          id: 'filibuster_1',
          controller: 'p1',
          owner: 'p1',
          isToken: false,
          card: { id: 'filibuster_card', name: 'Forum Filibuster', type_line: 'Enchantment' },
        },
      ],
      stack: [],
    } as unknown as GameState;

    const created = applyOracleIRStepsToGameState(
      state,
      [create!],
      buildOracleIRExecutionContext({
        controllerId: 'p1' as any,
        sourceId: 'filibuster_1',
        sourceName: 'Forum Filibuster',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
    );
    const tokenIds = (created.state.battlefield as any[])
      .filter((perm) => perm?.isToken === true)
      .map((perm) => String(perm.id));
    expect(tokenIds.length).toBe(1);

    const attached = applyOracleIRStepsToGameState(
      created.state,
      [move!],
      buildOracleIRExecutionContext({
        controllerId: 'p1' as any,
        sourceId: 'filibuster_1',
        sourceName: 'Forum Filibuster',
        lastCreatedTokenIds: tokenIds,
        lastMovedBattlefieldPermanentIds: tokenIds,
        chosenObjectIds: ['sword-1', ...tokenIds],
        selectorContext: { chosenObjectIds: ['sword-1', ...tokenIds] },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
    );

    const equipment = (attached.state.battlefield as any[]).find((perm) => perm?.card?.id === 'sword-1' || perm?.card?.name === 'Short Sword');
    expect(equipment).toBeDefined();
    expect(equipment.attachedTo).toBe(tokenIds[0]);
    expect((attached.state.players as any[])[0].graveyard || []).toHaveLength(0);
  });
});
