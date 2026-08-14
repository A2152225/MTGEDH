import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { extractTriggeredEffectFromTimingMatch } from '../../rules-engine/src/triggerEffectTextExtraction.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

const FORUM_FILIBUSTER_ORACLE =
  'At the beginning of your upkeep, create a 2/1 white and black Inkling creature token with flying. When you do, return up to one target Aura or Equipment card from your graveyard to the battlefield attached to that token.';

function filibusterPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Forum Filibuster',
      type_line: 'Enchantment',
      oracle_text: FORUM_FILIBUSTER_ORACLE,
    },
  };
}

describe('Forum Filibuster upkeep reflexive return', () => {
  it('keeps the when-you-do return/attach clause on the upkeep trigger', () => {
    const triggers = detectUpkeepTriggers(
      {
        name: 'Forum Filibuster',
        type_line: 'Enchantment',
        oracle_text: FORUM_FILIBUSTER_ORACLE,
      },
      { id: 'filibuster_1', controller: 'p1' },
    );
    const upkeep = triggers.find((t) => t.triggerType === 'upkeep_effect');
    expect(upkeep).toBeDefined();
    expect(String(upkeep?.effect || '').toLowerCase()).toContain('create a 2/1');
    expect(String(upkeep?.effect || '').toLowerCase()).toContain('when you do');
    expect(String(upkeep?.effect || '').toLowerCase()).toContain('aura or equipment');
    expect(String(upkeep?.effect || '').toLowerCase()).toContain('attached to that token');
  });

  it('queues a reflexive GY return trigger after creating the Inkling', () => {
    const g = createInitialGameState('t_forum_filibuster_upkeep');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    player.graveyard = [
      {
        id: 'sword-1',
        name: 'Short Sword',
        type_line: 'Artifact — Equipment',
        oracle_text: 'Equipped creature gets +1/+1. Equip {1}',
      },
    ];
    (g.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [...player.graveyard], graveyardCount: 1, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    };
    (g.state.battlefield as any).push(filibusterPermanent('filibuster_1', p1));

    const match = FORUM_FILIBUSTER_ORACLE.match(/at the beginning of your upkeep,?\s*([^.]+)/i);
    const effect = extractTriggeredEffectFromTimingMatch(FORUM_FILIBUSTER_ORACLE, match!);
    const ir = parseOracleTextToIR(effect, 'Forum Filibuster');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'create_token')).toBe(true);
    expect(steps.some((step) => step.kind === 'schedule_delayed_trigger')).toBe(true);

    applyOracleIRStepsOnServer(
      g as any,
      g.state as any,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'filibuster_1',
        sourceName: 'Forum Filibuster',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
      { controller: p1, triggerItem: { source: 'filibuster_1', permanentId: 'filibuster_1', sourceName: 'Forum Filibuster' } },
    );

    const token = ((g.state.battlefield as any[]) || []).find((perm) => perm?.isToken === true);
    expect(token).toBeTruthy();
    expect(String(token?.card?.name || token?.name || '')).toMatch(/inkling/i);

    const followup = ((g.state.stack || []) as any[]).find(
      (item) => item?.triggerType === 'reflexive_when_you_do',
    );
    expect(followup).toBeTruthy();
    expect(String(followup?.effect || followup?.description || '').toLowerCase()).toContain('aura or equipment');
    expect(followup?.targetZone).toBe('graveyard');
    expect(followup?.targetDestination).toBe('battlefield');
    expect(followup?.minTargets).toBe(0);
    expect(followup?.maxTargets).toBe(1);
    expect(followup?.targetFilterTypes).toEqual(expect.arrayContaining(['aura', 'equipment']));
    expect(followup?.effectData?.createdTokenIds).toEqual([token.id]);
  });

  it('attaches a chosen GY equipment to the created token', () => {
    const g = createInitialGameState('t_forum_filibuster_attach');
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const player = (g.state as any).players.find((entry: any) => entry.id === p1);
    const sword = {
      id: 'sword-1',
      name: 'Short Sword',
      type_line: 'Artifact — Equipment',
      oracle_text: 'Equipped creature gets +1/+1. Equip {1}',
    };
    player.graveyard = [sword];
    (g.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [sword], graveyardCount: 1, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    };
    (g.state.battlefield as any).push(filibusterPermanent('filibuster_1', p1));

    const match = FORUM_FILIBUSTER_ORACLE.match(/at the beginning of your upkeep,?\s*([^.]+)/i);
    const effect = extractTriggeredEffectFromTimingMatch(FORUM_FILIBUSTER_ORACLE, match!);
    const ir = parseOracleTextToIR(effect, 'Forum Filibuster');
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);

    applyOracleIRStepsOnServer(
      g as any,
      g.state as any,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'filibuster_1',
        sourceName: 'Forum Filibuster',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
      { controller: p1, triggerItem: { source: 'filibuster_1', permanentId: 'filibuster_1', sourceName: 'Forum Filibuster' } },
    );

    const token = ((g.state.battlefield as any[]) || []).find((perm) => perm?.isToken === true);
    const followup = ((g.state.stack || []) as any[]).find(
      (item) => item?.triggerType === 'reflexive_when_you_do',
    );
    expect(token && followup).toBeTruthy();

    g.state.stack = [] as any;
    const delayed = steps.find((step) => step.kind === 'schedule_delayed_trigger') as any;
    const move = (delayed?.steps || []).find((step: any) => step.kind === 'move_zone');
    expect(move).toBeTruthy();

    applyOracleIRStepsOnServer(
      g as any,
      g.state as any,
      [move],
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'filibuster_1',
        sourceName: 'Forum Filibuster',
        lastCreatedTokenIds: [token.id],
        lastMovedBattlefieldPermanentIds: [token.id],
        selectorContext: { chosenObjectIds: [sword.id, token.id] },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: false },
      { controller: p1, triggerItem: followup },
    );

    const equipment = ((g.state.battlefield as any[]) || []).find(
      (perm) => perm?.card?.id === sword.id || perm?.card?.name === 'Short Sword',
    );
    expect(equipment).toBeDefined();
    expect(equipment.attachedTo).toBe(token.id);
    const playerAfter = (g.state as any).players.find((entry: any) => entry.id === p1);
    const gyAfter = playerAfter?.graveyard || (g.state as any).zones?.[p1]?.graveyard || [];
    expect(gyAfter.map((card: any) => card.id)).not.toContain(sword.id);
  });
});
