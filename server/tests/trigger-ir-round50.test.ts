import { describe, expect, it } from 'vitest';
import { applyClashStep } from '../../rules-engine/src/oracleIRExecutorPlayerScryVoteClashSteps.js';
import { bridgeGameStateOracleEffectsAfterOracleIR } from '../src/state/modules/triggerGameStateOracleBridgeUtils.js';
import { queueParsedKeywordAction } from '../src/state/modules/triggerEmissionFamilyUtils.js';
import { parseTriggerClause, triggerConditionMatches } from '../../rules-engine/src/triggerCondition/index.js';

const cond = (s: string, name?: string) => parseTriggerClause(s, name)?.condition as any;
const src = (extra: Record<string, unknown> = {}) => ({ id: 'w', controllerId: 'p1', ...extra } as any);

function emitCtx(oracle: string) {
  const permanent = { id: 'w1', controller: 'p1', owner: 'p1', card: { name: 'Marvo, Deep Operative', type_line: 'Creature', oracle_text: oracle } };
  const ctx: any = { gameId: 'r50', isReplaying: false, state: { battlefield: [permanent], stack: [], turnNumber: 1, players: [{ id: 'p1' }, { id: 'p2' }] } };
  return { ctx, permanent };
}

describe('round 50 clash win emit + uncovered families', () => {
  it('win a clash: applyClashStep pending + bridge queues win_clash once', () => {
    expect(cond('Whenever you win a clash, draw a card.')?.action).toBe('win_clash');

    const watcher = {
      id: 'w1', controller: 'p1', owner: 'p1',
      card: { name: 'Marvo, Deep Operative', type_line: 'Creature - Merfolk', oracle_text: 'Whenever you win a clash, draw a card.' },
    };
    const state: any = {
      battlefield: [watcher],
      stack: [],
      turnNumber: 1,
      players: [
        { id: 'p1', library: [{ id: 'c1', name: 'Cranial Plating', cmc: 2, mana_value: 2 }] },
        { id: 'p2', library: [{ id: 'c2', name: 'Island', cmc: 0, mana_value: 0 }] },
      ],
    };
    const irCtx: any = { controllerId: 'p1' };
    const step = { kind: 'clash', who: { kind: 'you' }, opponent: { kind: 'target_opponent' }, raw: 'Clash with an opponent.' } as any;
    const result = applyClashStep(state, step, irCtx);
    expect(result.applied).toBe(true);
    expect((result as any).lastClashWon).toBe(true);
    expect(state.pendingClashWins).toEqual(['p1']);

    const gameCtx: any = { gameId: 'r50', isReplaying: false, state };
    bridgeGameStateOracleEffectsAfterOracleIR(gameCtx, state, { appliedSteps: [], skippedSteps: [], log: [] } as any, {
      controller: 'p1',
      sourceName: 'Marvo, Deep Operative',
      sourceId: 'w1',
      triggerItem: { permanentId: 'w1' },
    });
    const drawHits = (state.stack || []).filter((q: any) => /draw a card/i.test(String(q?.effect || q?.description || '')));
    expect(drawHits.length).toBe(1);
    expect(state.pendingClashWins || []).toEqual([]);

    bridgeGameStateOracleEffectsAfterOracleIR(gameCtx, state, { appliedSteps: [], skippedSteps: [], log: [] } as any, {
      controller: 'p1', sourceName: 'Marvo', sourceId: 'w1', triggerItem: { permanentId: 'w1' },
    });
    expect((state.stack || []).filter((q: any) => /draw a card/i.test(String(q?.effect || q?.description || ''))).length).toBe(1);

    const loseState: any = {
      battlefield: [watcher], stack: [], turnNumber: 1,
      players: [
        { id: 'p1', library: [{ id: 'c1', name: 'Island', cmc: 0, mana_value: 0 }] },
        { id: 'p2', library: [{ id: 'c2', name: 'Cranial Plating', cmc: 2, mana_value: 2 }] },
      ],
    };
    const lose = applyClashStep(loseState, step, { controllerId: 'p1' });
    expect((lose as any).lastClashWon).toBe(false);
    expect(loseState.pendingClashWins || []).toEqual([]);
  });

  it('that player upkeep + loyalty counters + you put counters + backup', () => {
    expect(cond("At the beginning of that player's upkeep, put a -1/-1 counter on target creature that player controls.")).toMatchObject({
      event: 'beginning_of_upkeep', whoseTurn: 'that_player',
    });
    expect(triggerConditionMatches(
      cond("At the beginning of that player's upkeep, draw a card."),
      { id: 'x', typeLine: 'Creature', controllerId: 'p1' } as any,
      src(),
      { activePlayerId: 'p2', thatPlayerId: 'p2' } as any,
    )).toBe(true);
    expect(triggerConditionMatches(
      cond("At the beginning of that player's upkeep, draw a card."),
      { id: 'x', typeLine: 'Creature', controllerId: 'p1' } as any,
      src(),
      { activePlayerId: 'p1', thatPlayerId: 'p2' } as any,
    )).toBe(false);

    const loyalty = cond('Whenever one or more loyalty counters are put on planeswalkers you control, put that many +1/+1 counters on this creature.');
    expect(loyalty?.event).toBe('counter_placed');
    expect(loyalty?.placedCounter).toBe('loyalty');

    const put = cond('Whenever you put a +1/+1 counter on another creature, put a +1/+1 counter on Knight of Wundagore.');
    expect(put?.event).toBe('counter_placed');
    expect(put?.causedByYou).toBe(true);

    const backup = cond('Whenever a creature you control becomes the target of a backup ability, copy that ability.');
    expect(backup?.event).toBe('becomes_target');
    expect(backup?.abilityWord).toBe('backup');
    expect(triggerConditionMatches(backup, { id: 'c1', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      abilityWord: 'backup', targetingControllerId: 'p2', targetingKind: 'ability',
    } as any)).toBe(true);
    expect(triggerConditionMatches(backup, { id: 'c1', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      abilityWord: 'proliferate', targetingControllerId: 'p2', targetingKind: 'ability',
    } as any)).toBe(false);
  });

  it('cast target variants + activate creature + equipped block + combat damage to you', () => {
    expect(cond('Whenever an opponent casts a spell that targets you or a creature you control, draw a card.')?.targets).toBe('you_or_creature_you_control');
    expect(cond('Whenever you cast a spell that targets an opponent or a creature an opponent controls, draw a card.')?.targets).toBe('opponent_or_creature_opponent_controls');
    expect(cond('Whenever you cast a spell that targets only a single creature you control, create a token.')?.targets).toBe('single_creature_you_control');
    expect(cond('Whenever you cast an instant or sorcery spell that targets an artifact or land, draw a card.')?.targets).toBe('artifact_or_land');
    expect(cond('Whenever a player casts a spell that targets only a single creature other than Ivy, copy that spell.', 'Ivy')?.targets).toBe('single_creature_other');
    expect(cond('Whenever Agrus Kos becomes the target of an ability that targets only it, copy that ability.', 'Agrus Kos')?.targets).toBe('self_only');
    expect(cond('Whenever you activate an ability of a creature, scry 1.')?.action).toBe('activate_creature');
    const block = cond('Whenever this creature blocks or becomes blocked by an equipped creature, destroy all Equipment attached to that creature.');
    expect(block?.blockPartner?.equipped).toBe(true);
    expect(triggerConditionMatches(block, { id: 'w', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      blockPartner: { id: 'bp', typeLine: 'Creature', controllerId: 'p2', equipped: true },
    } as any)).toBe(true);
    expect(triggerConditionMatches(block, { id: 'w', typeLine: 'Creature', controllerId: 'p1' } as any, src(), {
      blockPartner: { id: 'bp', typeLine: 'Creature', controllerId: 'p2', equipped: false },
    } as any)).toBe(false);
    expect(cond('Whenever combat damage is dealt to you, put a +1/+1 counter on Risona.')?.damagedPlayer).toBe('you');
  });

  it('Bill Potts cast|activate OR + spend-this-mana + win_clash queue once', () => {
    const bill = cond('Whenever you cast an instant or sorcery spell that targets only Bill Potts or activate an ability that targets only Bill Potts, copy that spell or ability.', 'Bill Potts');
    expect(bill?.event).toBe('spell_cast');
    expect(bill?.pairedEvent).toBe('performs');
    expect(bill?.action).toBe('activate_targeting');
    expect(bill?.targets).toBe('self_only');

    const spend = cond('When you spend this mana to cast an instant or sorcery spell with mana value 3 or less, copy that spell.');
    expect(spend?.event).toBe('spell_cast');
    expect(spend?.requiresSourceMana).toBe(true);
    expect(spend?.legacyRuntimeOnly).not.toBe(true);

    const { ctx } = emitCtx('Whenever you win a clash, draw a card.');
    expect(queueParsedKeywordAction(ctx, 'p1', 'win_clash').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(1);
    expect(queueParsedKeywordAction(ctx, 'p1', 'win_clash').filter((q: any) => /draw a card/i.test(String(q.effect || ''))).length).toBe(0);
  });
});