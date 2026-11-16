import { describe, expect, it } from 'vitest';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';
import { applyCommanderCreatureGrantPT, commanderCreatureGrantHasKeyword } from '../src/state/modules/commanderCreatureGrants.js';
import { grantedTriggerTextsForPermanent } from '../src/state/modules/triggers/grantedOracleTriggerScan.js';
import { queueUpkeepSacrificeCreatureOrSelfFromTrigger } from '../src/state/modules/triggerUpkeepSacrificeUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { offspringCostForSpell, maybeCreateOffspringToken } from '../src/state/modules/offspringCast.js';
import { parseDieRollNudge, queueDieRollNudgePrompt, applyDieRollNudgeToState } from '../src/state/modules/dieRollNudgePrompt.js';
import { applyRevealCreaturesDraw, collectRevealCreaturesDrawSpecsFromState, autoApplyOrQueueRevealCreaturesDraw } from '../src/state/modules/revealCreaturesDrawReplacement.js';

const CULTIST = 'Commander creatures you own get +3/+3 and have flying, deathtouch, "Ward—Pay 3 life," and "At the beginning of your upkeep, sacrifice a creature."';
const ZINNIA = 'Creature spells you cast gain offspring {2} as you cast them.';
const SQUIRREL = 'After you roll a die, you may remove a +1/+1 counter from this creature. If you do, increase or decrease the result by 1.';
const NIGHT = 'After you roll a die, you may pay 1 life. If you do, increase or decrease the result by 1. Do this only once each turn.';
const SAGES = 'If you would draw a card, instead reveal the top three cards of your library. Put all creature cards revealed this way into your hand and the rest on the bottom of your library in any order.';

describe('remaining cast, upkeep, die, and draw prompts', () => {
  it('classifies the five prompt lines as owned systems', () => {
    expect(classifyStaticCensusLine(CULTIST, 'Cultist of the Absolute')?.system).toMatch(/commander creatures/i);
    expect(classifyStaticCensusLine(ZINNIA, "Zinnia, Valley's Voice")?.system).toMatch(/offspring/i);
    expect(classifyStaticCensusLine(SQUIRREL, 'Xenosquirrels')?.system).toMatch(/remove a \+1\/\+1 counter/i);
    expect(classifyStaticCensusLine(NIGHT, 'Night Shift of the Living Dead')?.system).toMatch(/pay N life/i);
    expect(classifyStaticCensusLine(SAGES, 'Sages of the Anima')?.system).toMatch(/creature cards/i);
  });

  it('gives a commander creature the cultist buff and an upkeep sacrifice prompt', () => {
    const cultist = { id: 'cult', controller: 'p1', card: { name: 'Cultist of the Absolute', oracle_text: CULTIST, type_line: 'Enchantment — Background' } };
    const commander = {
      id: 'cmd',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: { name: 'Alesha', type_line: 'Legendary Creature — Human', power: '2', toughness: '2', owner: 'p1' },
    };
    const other = { id: 'bear', controller: 'p1', owner: 'p1', card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2', owner: 'p1' } };
    const state = { battlefield: [cultist, commander, other] };
    expect(applyCommanderCreatureGrantPT(commander, state, 2, 2)).toEqual({ power: 5, toughness: 5 });
    expect(applyCommanderCreatureGrantPT(other, state, 2, 2)).toEqual({ power: 2, toughness: 2 });
    expect(commanderCreatureGrantHasKeyword(commander, state, 'flying')).toBe(true);
    expect(commanderCreatureGrantHasKeyword(commander, state, 'deathtouch')).toBe(true);
    expect(grantedTriggerTextsForPermanent(commander, state).join(' ')).toMatch(/sacrifice a creature/i);
    expect(grantedTriggerTextsForPermanent(cultist, state).join(' ')).not.toMatch(/sacrifice a creature/i);

    const gameId = 'batch111-cultist-sac';
    const queued = queueUpkeepSacrificeCreatureOrSelfFromTrigger({
      ctx: { gameId, state } as any,
      controller: 'p1' as any,
      sourceName: 'Alesha',
      description: 'Sacrifice a creature',
      triggerItem: { permanentId: 'cmd' },
      state,
    });
    expect(queued).toBe(true);
    const step = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1' as any).find((entry: any) => entry.allowSourceSacrifice === false);
    expect(step?.description).toMatch(/Sacrifice a creature/i);
    expect(step?.creatures?.map((creature: any) => creature.id).sort()).toEqual(['bear', 'cmd']);
  });

  it('offers offspring {2} on a creature spell and creates one 1/1 copy when the cost was paid', () => {
    const zinnia = { id: 'zin', controller: 'p1', card: { name: "Zinnia, Valley's Voice", oracle_text: ZINNIA, type_line: 'Legendary Creature — Bird Bard' } };
    const spell = { id: 'spell', name: 'Bear', type_line: 'Creature — Bear', oracle_text: 'Plain.', power: '2', toughness: '2' };
    expect(offspringCostForSpell({ battlefield: [zinnia] }, 'p1', spell, 'Creature — Bear')).toBe('{2}');
    expect(offspringCostForSpell({ battlefield: [zinnia] }, 'p1', { oracle_text: '' }, 'Instant')).toBeNull();

    const creature = {
      id: 'bear1',
      controller: 'p1',
      offspringPaid: true,
      card: { ...spell, id: 'spell' },
    };
    const state: any = { battlefield: [creature], zones: {}, players: [{ id: 'p1', life: 40 }] };
    const created = maybeCreateOffspringToken({ state, bumpSeq: () => {}, gameId: 'batch111-offspring' } as any, creature, 'p1');
    expect(created).toHaveLength(1);
    const token = state.battlefield.find((permanent: any) => permanent.id === created[0]);
    expect(token?.offspringToken).toBe(true);
    expect(Number(token?.power ?? token?.basePower)).toBe(1);
    expect(Number(token?.toughness ?? token?.baseToughness)).toBe(1);
    expect(maybeCreateOffspringToken({ state, bumpSeq: () => {}, gameId: 'batch111-offspring' } as any, creature, 'p1')).toEqual([]);
  });

  it('nudges a die result after a counter or a once-per-turn life payment', () => {
    expect(parseDieRollNudge(SQUIRREL)?.kind).toBe('counter');
    expect(parseDieRollNudge(NIGHT)).toMatchObject({ kind: 'life', life: 1, oncePerTurn: true });

    const squirrel = {
      id: 'sq',
      controller: 'p1',
      counters: { '+1/+1': 2 },
      card: { name: 'Xenosquirrels', oracle_text: SQUIRREL, type_line: 'Creature — Squirrel' },
    };
    const state: any = {
      battlefield: [squirrel],
      life: { p1: 40 },
      turnNumber: 3,
      lastDieRoll: { playerId: 'p1', sides: 6, result: 4 },
    };
    expect(queueDieRollNudgePrompt({ ctx: { gameId: 'batch111-die', state }, playerId: 'p1' })).toBe(true);
    const step = ResolutionQueueManager.getStepsForPlayer('batch111-die', 'p1' as any).find((entry: any) => entry.dieRollNudge === true);
    expect(step?.options?.map((option: any) => option.id)).toEqual(['decline', 'increase', 'decrease']);
    applyDieRollNudgeToState(state, { playerId: 'p1', permanentId: 'sq', kind: 'counter', life: 0, delta: 1, oncePerTurn: false });
    expect(state.lastDieRoll.result).toBe(5);
    expect(state.battlefield[0].counters['+1/+1']).toBe(1);

    const night = { id: 'night', controller: 'p1', card: { name: 'Night Shift of the Living Dead', oracle_text: NIGHT, type_line: 'Enchantment' } };
    const nightState: any = {
      battlefield: [night],
      life: { p1: 40 },
      players: [{ id: 'p1', life: 40 }],
      turnNumber: 4,
      lastDieRoll: { playerId: 'p1', sides: 6, result: 3 },
    };
    applyDieRollNudgeToState(nightState, { playerId: 'p1', permanentId: 'night', kind: 'life', life: 1, delta: -1, oncePerTurn: true });
    expect(nightState.life.p1).toBe(39);
    expect(nightState.lastDieRoll.result).toBe(2);
    nightState.lastDieRoll = { playerId: 'p1', sides: 6, result: 6 };
    expect(queueDieRollNudgePrompt({ ctx: { gameId: 'batch111-die-night', state: nightState }, playerId: 'p1' })).toBe(false);
  });

  it('replaces a draw with creatures to hand and the rest on the bottom', () => {
    const sages = { id: 'sages', controller: 'p1', card: { name: 'Sages of the Anima', oracle_text: SAGES, type_line: 'Creature — Human Wizard' } };
    const specs = collectRevealCreaturesDrawSpecsFromState({ battlefield: [sages] });
    expect(specs[0]?.effectId).toBe('reveal-top-creatures-hand-rest-bottom');
    expect(specs[0]?.metadata).toMatchObject({ lookAtLibraryTop: 3 });

    const library = [
      { id: 'c1', name: 'Elf', type_line: 'Creature — Elf' },
      { id: 'l1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'i1', name: 'Shock', type_line: 'Instant' },
    ];
    const state: any = { zones: { p1: { library, hand: [], handCount: 0 } } };
    const libraries = new Map([['p1', library]]);
    const ctx = { state, libraries, gameId: 'batch111-sages' };
    const applied = applyRevealCreaturesDraw(ctx as any, 'p1', 3, ['i1', 'l1']);
    expect(applied.handIds).toEqual(['c1']);
    expect(applied.bottomIds).toEqual(['i1', 'l1']);
    expect(state.zones.p1.hand.map((card: any) => card.id)).toEqual(['c1']);
    expect(state.zones.p1.library.map((card: any) => card.id)).toEqual(['i1', 'l1']);

    const promptLib = [
      { id: 'c2', name: 'Elf', type_line: 'Creature — Elf' },
      { id: 'l2', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'i2', name: 'Shock', type_line: 'Instant' },
    ];
    const promptState: any = { zones: { p1: { library: promptLib, hand: [] } } };
    const queued = autoApplyOrQueueRevealCreaturesDraw(
      { state: promptState, libraries: new Map([['p1', promptLib]]), gameId: 'batch111-sages-prompt' } as any,
      'p1',
      { lookAtLibraryTop: 3, sourceName: 'Sages of the Anima', sourcePermanentId: 'sages' },
      0,
    );
    expect(queued).toBe('break');
    const search = ResolutionQueueManager.getStepsForPlayer('batch111-sages-prompt', 'p1' as any)
      .find((entry: any) => entry.revealCreaturesDrawReplacement === true);
    expect(search?.availableCards?.map((card: any) => card.id)).toEqual(['c2']);
    expect(search?.nonSelectableCards?.map((card: any) => card.id).sort()).toEqual(['i2', 'l2']);
    expect(search?.remainderPlayerChoosesOrder).toBe(true);
  });
});
