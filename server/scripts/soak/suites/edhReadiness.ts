/*
  EDH live-readiness smoke suite (Aug 2026 IR batches).
  Season {P}, votes, end_combat, Spree/Tiered, choose-mode, delirium/void/vivid,
  compound resume, spell-static.
*/

import type { PlayerID } from '../../../../shared/src/index.js';
import { GamePhase } from '../../../../shared/src/index.js';
import {
  isValidPBudgetSelection,
  sumSelectedPCost,
} from '../../../../shared/src/modeSelectionPBudget.js';
import { collectSpellResolutionEffectStepsWithOverlay } from '../../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { AbilityType } from '../../../../rules-engine/src/oracleTextParser.js';
import { extractAdditionalCostModesFromOracleText, getSelectedAdditionalCostOracleText } from '../../../src/state/modules/additionalCostModeOracleText.js';
import { extractModalModesForSpellCast } from '../../../src/utils/oraclePromptContext.js';
import { calculateCostReduction } from '../../../src/socket/game-actions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../../src/state/resolution/index.js';
import {
  applySteps,
  check,
  findStep,
  finishSoak,
  hasKind,
  hasVoteTail,
  kindsOf,
  makeGame,
  queueTypes,
  scopedOmitsOtherEffects,
  slug,
  soakCard,
  startEp,
  unknownRaws,
  type SoakSuite,
  type SmokeCardResult,
  type SmokeSoakResult,
} from '../oracleIrSmokeCore.js';

function runSeasonP(): SmokeSoakResult {
  const names = [
    'Season of Gathering',
    'Season of Weaving',
    'Season of Loss',
    'Season of the Burrow',
    'Season of the Bold',
  ];
  const cards = names.map((name) =>
    soakCard(name, (card, collected, result) => {
      const choose = findStep(collected.spellSteps, 'choose_mode');
      result.checks.push(check('spell_steps', ['choose_mode'], kindsOf(collected.spellSteps), kindsOf(collected.spellSteps).join() === 'choose_mode'));
      result.checks.push(check('pBudget', 5, choose?.pBudget, Number(choose?.pBudget) === 5));
      result.checks.push(check('canRepeatModes', true, Boolean(choose?.canRepeatModes), Boolean(choose?.canRepeatModes)));
      result.checks.push(check('mode_count', 3, choose?.modes?.length, choose?.modes?.length === 3));
      result.checks.push(check('pCost', [1, 2, 3], (choose?.modes || []).map((mode: any) => mode.pCost), JSON.stringify((choose?.modes || []).map((mode: any) => mode.pCost)) === JSON.stringify([1, 2, 3])));
      result.checks.push(check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));

      process.env.ORACLE_IR_SPELL_PRIMARY = '1';
      const modal = extractModalModesForSpellCast(card.oracle_text || '', name);
      result.checks.push(check('modal_pBudget', 5, modal?.pBudget, Number(modal?.pBudget) === 5));
      result.checks.push(check('modal_repeat', true, Boolean(modal?.canRepeatModes), Boolean(modal?.canRepeatModes)));
      result.checks.push(check('modal_minModes', 0, modal?.minModes, Number(modal?.minModes) === 0));

      const modes = (modal?.options || []).map((option) => ({ id: option.id, pCost: option.pCost }));
      const ids = modes.map((mode) => mode.id);
      const fills: Array<{ id: string; selected: string[]; ok: boolean }> = [
        { id: 'P+P+PP', selected: [ids[0], ids[0], ids[1]], ok: true },
        { id: 'PPP+PP', selected: [ids[2], ids[1]], ok: true },
        { id: 'three_P', selected: [ids[0], ids[0], ids[0]], ok: true },
        { id: 'empty_up_to', selected: [], ok: true },
        { id: 'over_budget_PPP_PPP', selected: [ids[2], ids[2]], ok: false },
      ];
      for (const fill of fills) {
        const valid = isValidPBudgetSelection(fill.selected, modes, 5, { minModes: 0, canRepeatModes: true });
        const spent = sumSelectedPCost(fill.selected, modes);
        result.checks.push(
          check(
            `budget_${fill.id}`,
            fill.ok ? `valid (spent ${spent})` : 'invalid over-budget',
            { valid, spent, selected: fill.selected },
            valid === fill.ok,
          ),
        );
      }

      const { game } = makeGame(`soak-season-${slug(name)}`, 2);
      const started = startEp(game, name, collected.spellSteps);
      const modeStep = ResolutionQueueManager.getStepsForPlayer(`soak-season-${slug(name)}`, 'p1' as PlayerID)
        .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
      result.checks.push(check('ep_handled', true, started.handled, started.handled === true));
      result.checks.push(check('queued_MODE_SELECTION', true, Boolean(modeStep), Boolean(modeStep)));
      result.checks.push(check('queued_pBudget', 5, (modeStep as any)?.pBudget, Number((modeStep as any)?.pBudget) === 5));
      result.checks.push(check('queued_canRepeat', true, Boolean((modeStep as any)?.canRepeatModes), Boolean((modeStep as any)?.canRepeatModes)));
    }),
  );
  return finishSoak('season_p', 'A — Modal night', 'Season {P} budget UX', cards);
}

function runChooseMode(): SmokeSoakResult {
  const specs: Array<{ name: string; min: number; max: number; modeCount: number; repeat?: boolean }> = [
    { name: "Urza's Command", min: 2, max: 2, modeCount: 4 },
    { name: 'Austere Command', min: 2, max: 2, modeCount: 4 },
    { name: 'Cryptic Command', min: 2, max: 2, modeCount: 4 },
    { name: 'Brokers Confluence', min: 3, max: 3, modeCount: 3, repeat: true },
  ];
  const cards = specs.map((spec) =>
    soakCard(spec.name, (card, collected, result) => {
      const choose = findStep(collected.spellSteps, 'choose_mode');
      result.checks.push(check('outer_choose_mode_only', ['choose_mode'], kindsOf(collected.spellSteps), kindsOf(collected.spellSteps).join() === 'choose_mode'));
      result.checks.push(check('minModes', spec.min, choose?.minModes, Number(choose?.minModes) === spec.min));
      result.checks.push(check('maxModes', spec.max, choose?.maxModes, Number(choose?.maxModes) === spec.max));
      result.checks.push(check('mode_count', spec.modeCount, choose?.modes?.length, choose?.modes?.length === spec.modeCount));
      result.checks.push(check('canRepeatModes', Boolean(spec.repeat), Boolean(choose?.canRepeatModes), Boolean(choose?.canRepeatModes) === Boolean(spec.repeat)));
      result.checks.push(check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));

      process.env.ORACLE_IR_SPELL_PRIMARY = '1';
      const modal = extractModalModesForSpellCast(card.oracle_text || '', spec.name);
      result.checks.push(check('modal_min', spec.min, modal?.minModes, Number(modal?.minModes) === spec.min));
      result.checks.push(check('modal_max', spec.max, modal?.maxModes, Number(modal?.maxModes) === spec.max));
      result.checks.push(check('modal_repeat', Boolean(spec.repeat), Boolean(modal?.canRepeatModes), Boolean(modal?.canRepeatModes) === Boolean(spec.repeat)));

      const { game } = makeGame(`soak-mode-${slug(spec.name)}`, 2);
      const started = startEp(game, spec.name, collected.spellSteps);
      const modeStep = ResolutionQueueManager.getQueue(`soak-mode-${slug(spec.name)}`).steps
        .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
      result.checks.push(check('ep_handled', true, started.handled, started.handled === true));
      result.checks.push(check('queued_MODE_SELECTION', true, Boolean(modeStep), Boolean(modeStep)));
    }),
  );
  return finishSoak('choose_mode', 'A — Modal night', 'Choose-mode (non-{P})', cards);
}

function runVotes(): SmokeSoakResult {
  const specs: Array<{
    name: string;
    secret?: boolean;
    ballot?: string;
    etb?: boolean;
  }> = [
    { name: 'Plea for Power', ballot: 'labels' },
    { name: 'Bite of the Black Rose', ballot: 'labels' },
    { name: 'Sail into the West', ballot: 'labels' },
    { name: 'Split Decision', ballot: 'labels' },
    { name: "Council's Judgment", ballot: 'permanents' },
    { name: 'Expropriate', ballot: 'labels' },
    { name: 'Capital Punishment', ballot: 'labels' },
    { name: 'Mob Verdict', secret: true, ballot: 'players' },
    { name: 'Círdan the Shipwright', secret: true, ballot: 'players', etb: true },
    { name: 'Messenger Jays', etb: true },
    { name: 'Custodi Squire', etb: true },
    { name: 'Tivit, Seller of Secrets', etb: true },
  ];
  const cards = specs.map((spec) =>
    soakCard(spec.name, (_card, collected, result) => {
      const steps = spec.etb ? collected.allSteps : collected.spellSteps;
      const vote = findStep(steps, 'vote');
      result.checks.push(check('has_vote', true, Boolean(vote), Boolean(vote)));
      result.checks.push(check('no_unknown', [], unknownRaws(steps), unknownRaws(steps).length === 0));
      if (spec.secret) {
        result.checks.push(check('secret', true, Boolean(vote?.secret), Boolean(vote?.secret)));
      }
      if (spec.ballot) {
        const ballot = String(vote?.ballot || (Array.isArray(vote?.choices) && vote.choices.length > 0 ? 'labels' : ''));
        result.checks.push(check('ballot', spec.ballot, ballot || vote?.ballot, ballot === spec.ballot || String(vote?.ballot) === spec.ballot));
      }
      if (spec.etb) {
        result.checks.push(check('triggered', true, collected.abilityTypes.includes(AbilityType.TRIGGERED) || collected.abilityTypes.includes('triggered'), collected.abilityTypes.some((type) => /trigger/i.test(type))));
      }
      result.checks.push(check('votes_received_or_tail', true, kindsOf(steps), hasVoteTail(steps), 'non-vote follow-on after the ballot (draw/damage/exile/copy/sacrifice/investigate/…)'));

      const gameId = `soak-vote-${slug(spec.name)}`;
      const { game, players } = makeGame(gameId, 4);
      (game.state as any).battlefield = players.slice(1).flatMap((pid, index) => ([
        {
          id: `${pid}-bear`,
          controller: pid,
          owner: pid,
          card: { name: `Bear ${index}`, type_line: 'Creature — Bear' },
        },
        {
          id: `${pid}-rock`,
          controller: pid,
          owner: pid,
          card: { name: `Sol Ring ${index}`, type_line: 'Artifact' },
        },
      ]));
      applySteps(game, spec.name, steps);
      const voteQueued = queueTypes(gameId).includes(ResolutionStepType.VOTE);
      const firstVote = ResolutionQueueManager.getQueue(gameId).steps.find((step) => step.type === ResolutionStepType.VOTE);
      result.checks.push(check('queued_VOTE', true, queueTypes(gameId), voteQueued));
      if (voteQueued) {
        result.checks.push(check('apnap_first_voter', 'p1', firstVote?.playerId, firstVote?.playerId === 'p1'));
      }
    }),
  );
  return finishSoak('vote', 'B — Votes', 'Vote / council queue', cards);
}

function runEndCombat(): SmokeSoakResult {
  const extraCombat = ['Relentless Assault', 'World at War', 'Seize the Day'];
  const cards: SmokeCardResult[] = [];

  cards.push(
    soakCard('Mandate of Peace', (_card, collected, result) => {
      result.checks.push(check('has_end_combat_phase', true, kindsOf(collected.spellSteps), hasKind(collected.spellSteps, 'end_combat_phase')));
      result.checks.push(check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));

      const gameId = 'soak-end-combat-mandate';
      const { game, p1, players } = makeGame(gameId, 2);
      const p2 = players[1];
      Object.assign(game.state as any, {
        phase: 'combat',
        step: 'declareBlockers',
        combat: { attackers: ['a1'] },
        combatNumber: 1,
        battlefield: [
          { id: 'a1', controller: p1, attacking: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
          { id: 'b1', controller: p2, blocking: 'a1', card: { name: 'Wall', type_line: 'Creature — Wall' } },
        ],
        stack: [
          { id: 's1', controller: p1, card: { id: 'c1', name: 'Mandate of Peace', type_line: 'Instant' } },
          { id: 's2', controller: p2, card: { id: 'c2', name: 'Lightning Bolt', type_line: 'Instant' } },
        ],
      });
      const endStep = collected.spellSteps.filter((step) => step.kind === 'end_combat_phase');
      applySteps(game, 'Mandate of Peace', endStep.length > 0 ? endStep : collected.spellSteps);
      result.checks.push(check('phase', GamePhase.POSTCOMBAT_MAIN, (game.state as any).phase, (game.state as any).phase === GamePhase.POSTCOMBAT_MAIN));
      result.checks.push(check('combat_cleared', undefined, (game.state as any).combat, (game.state as any).combat === undefined));
      result.checks.push(check('attacking_cleared', undefined, (game.state as any).battlefield?.[0]?.attacking, (game.state as any).battlefield?.[0]?.attacking === undefined));
      result.checks.push(check('stack_exiled', 0, (game.state as any).stack?.length, Array.isArray((game.state as any).stack) && (game.state as any).stack.length === 0));
    }),
  );

  for (const name of extraCombat) {
    cards.push(
      soakCard(name, (_card, collected, result) => {
        result.checks.push(check('add_extra_combat', true, kindsOf(collected.spellSteps), hasKind(collected.spellSteps, 'add_extra_combat')));
        result.checks.push(check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));
      }),
    );
  }

  return finishSoak('end_combat_phase', 'D — Combat end', 'end_combat_phase + extra combat setup', cards);
}

function runSpreeTiered(): SmokeSoakResult {
  const spreeNames = [
    'Final Showdown',
    'Return the Favor',
    "Smuggler's Surprise",
    'Rush of Dread',
    'Shifting Grift',
    'Metamorphic Blast',
    'Rustler Rampage',
    'One Last Job',
  ];
  const tieredNames = ["Tifa's Limit Break", 'Ice Magic'];
  const cards: SmokeCardResult[] = [];

  for (const name of spreeNames) {
    cards.push(
      soakCard(name, (card, collected, result) => {
        const info = extractAdditionalCostModesFromOracleText(card.oracle_text || '');
        result.checks.push(check('purpose', 'spree', info?.purpose, info?.purpose === 'spree'));
        result.checks.push(check('mode_count_gte_2', '>=2', info?.options.length, Number(info?.options.length) >= 2));
        result.checks.push(check('no_unknown_full', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));

        const first = info?.options[0];
        const second = info?.options[1];
        if (first && second) {
          const one = getSelectedAdditionalCostOracleText(card.oracle_text || '', [first.id]);
          const two = getSelectedAdditionalCostOracleText(card.oracle_text || '', [first.id, second.id]);
          const others = (info?.options || []).filter((option) => option.id !== first.id).map((option) => option.effect);
          result.checks.push(check('scope_1_includes_first', true, first.effect, one.toLowerCase().includes(first.effect.trim().toLowerCase())));
          result.checks.push(check('scope_1_excludes_second', true, second.effect, scopedOmitsOtherEffects(one, first.effect, others)));
          result.checks.push(check('scope_1_drops_spree_header', true, !/^spree\b/im.test(one), !/^spree\b/im.test(one)));
          result.checks.push(check('scope_2_includes_both', true, [first.effect, second.effect], two.toLowerCase().includes(first.effect.trim().toLowerCase()) && two.toLowerCase().includes(second.effect.trim().toLowerCase())));

          const scopedOneSteps = collectSpellResolutionEffectStepsWithOverlay(one, name);
          const selectedOnlySteps = collectSpellResolutionEffectStepsWithOverlay(first.effect, name);
          result.checks.push(
            check(
              'ir_1_mode_no_overexecute',
              kindsOf(selectedOnlySteps),
              kindsOf(scopedOneSteps),
              JSON.stringify(kindsOf(scopedOneSteps)) === JSON.stringify(kindsOf(selectedOnlySteps)),
            ),
          );
        }
      }),
    );
  }

  for (const name of tieredNames) {
    cards.push(
      soakCard(name, (card, collected, result) => {
        const info = extractAdditionalCostModesFromOracleText(card.oracle_text || '');
        result.checks.push(check('purpose', 'tiered', info?.purpose, info?.purpose === 'tiered'));
        result.checks.push(check('maxModes', 1, info?.maxModes, info?.maxModes === 1));
        result.checks.push(check('no_unknown_full', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));
        for (const option of info?.options || []) {
          const scoped = getSelectedAdditionalCostOracleText(card.oracle_text || '', [option.id]);
          const other = (info?.options || []).filter((entry) => entry.id !== option.id);
          const leaked = other.filter((entry) => !scopedOmitsOtherEffects(scoped, option.effect, [entry.effect]));
          result.checks.push(check(`tier_${option.id}_isolated`, [], leaked.map((entry) => entry.id), leaked.length === 0));
        }
      }),
    );
  }

  return finishSoak('spree_tiered', 'C — Modes-at-cast', 'Spree / Tiered resolve scoping', cards);
}

function runCastCostRiders(): SmokeSoakResult {
  const names = ['Drag to the Roots', 'Temporal Intervention', 'Rime Chill'];
  const cards = names.map((name) =>
    soakCard(name, (card, collected, result) => {
      result.checks.push(check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));
      const payload = {
        name: card.name,
        mana_cost: card.mana_cost,
        type_line: card.type_line,
        colors: card.colors,
        oracle_text: card.oracle_text,
      };

      if (name === 'Drag to the Roots') {
        const off = calculateCostReduction(
          { state: { battlefield: [], zones: { p1: { graveyard: [{ type_line: 'Creature' }, { type_line: 'Instant' }, { type_line: 'Land' }] } } } } as any,
          'p1',
          payload,
        );
        const on = calculateCostReduction(
          { state: { battlefield: [], zones: { p1: { graveyard: [{ type_line: 'Creature' }, { type_line: 'Instant' }, { type_line: 'Land' }, { type_line: 'Artifact' }] } } } } as any,
          'p1',
          payload,
        );
        result.checks.push(check('delirium_off', 0, off.generic, off.generic === 0));
        result.checks.push(check('delirium_on', 2, on.generic, on.generic === 2));
        result.checks.push(check('delirium_message', true, on.messages, on.messages.some((message) => /as-long-as cost rider/i.test(message))));
      }

      if (name === 'Temporal Intervention') {
        const off = calculateCostReduction(
          { state: { battlefield: [], permanentLeftBattlefieldThisTurn: { p1: false }, spellWasWarpedThisTurn: { p1: false }, zones: { p1: { graveyard: [] } } } } as any,
          'p1',
          payload,
        );
        const on = calculateCostReduction(
          { state: { battlefield: [], permanentLeftBattlefieldThisTurn: { p2: true }, spellWasWarpedThisTurn: { p1: false }, zones: { p1: { graveyard: [] } } } } as any,
          'p1',
          payload,
        );
        result.checks.push(check('void_off', 0, off.generic, off.generic === 0));
        result.checks.push(check('void_on', 2, on.generic, on.generic === 2));
      }

      if (name === 'Rime Chill') {
        const off = calculateCostReduction(
          { state: { battlefield: [], zones: { p1: { graveyard: [] } } } } as any,
          'p1',
          payload,
        );
        const on = calculateCostReduction(
          {
            state: {
              battlefield: [
                { id: 'a', controller: 'p1', card: { name: 'Birds of Paradise', colors: ['G'], mana_cost: '{G}', type_line: 'Creature' } },
                { id: 'b', controller: 'p1', card: { name: 'Sol Ring', colors: [], mana_cost: '{1}', type_line: 'Artifact' } },
                { id: 'c', controller: 'p1', card: { name: 'Lightning Bolt', colors: ['R'], mana_cost: '{R}', type_line: 'Instant' } },
              ],
              zones: { p1: { graveyard: [] } },
            },
          } as any,
          'p1',
          payload,
        );
        result.checks.push(check('vivid_off', 0, off.generic, off.generic === 0));
        result.checks.push(check('vivid_on', 2, on.generic, on.generic === 2));
      }
    }),
  );
  return finishSoak('cast_cost_riders', 'E — Choices/costs', 'Cast-cost riders (Delirium / Void / Vivid)', cards);
}

function runCompoundResume(): SmokeSoakResult {
  const specs: Array<{ name: string; kinds: string[]; queue?: string; continuation?: string }> = [
    { name: 'Opt', kinds: ['scry', 'draw'], queue: ResolutionStepType.SCRY, continuation: 'draw' },
    { name: 'Consider', kinds: ['surveil', 'draw'], queue: ResolutionStepType.SURVEIL, continuation: 'draw' },
    { name: 'Preordain', kinds: ['scry', 'draw'], queue: ResolutionStepType.SCRY, continuation: 'draw' },
    { name: 'Force Spike', kinds: ['unless_pays_mana'] },
    { name: 'Chart a Course', kinds: ['draw'] },
    { name: 'Fact or Fiction', kinds: ['choose_pile', 'separate_into_piles', 'look_choose_from_top'] },
    { name: 'Windfall', kinds: ['discard', 'draw'] },
  ];
  const cards = specs.map((spec) =>
    soakCard(spec.name, (_card, collected, result) => {
      const present = spec.kinds.filter((kind) => hasKind(collected.spellSteps, kind));
      const needAll = spec.kinds.length <= 2 || spec.name === 'Windfall';
      result.checks.push(
        check(
          'expected_kinds',
          spec.kinds,
          kindsOf(collected.spellSteps),
          needAll ? spec.kinds.every((kind) => present.includes(kind)) : present.length > 0,
        ),
      );
      result.checks.push(check('no_unknown', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));

      const gameId = `soak-compound-${slug(spec.name)}`;
      const { game } = makeGame(gameId, 2);
      if (spec.name === 'Chart a Course' || spec.name === 'Windfall') {
        (game.state as any).zones.p1.hand = [
          { id: 'h1', name: 'Bolt', zone: 'hand' },
          { id: 'h2', name: 'Island', zone: 'hand' },
        ];
        (game.state as any).players[0].hand = (game.state as any).zones.p1.hand;
      }
      const applied = applySteps(game, spec.name, collected.spellSteps);
      const queued = queueTypes(gameId);
      result.checks.push(check('queue_or_applied', 'choice queued or steps applied', { queued, applied: kindsOf(applied.appliedSteps), pending: kindsOf(applied.pendingContinuationSteps) }, queued.length > 0 || applied.appliedSteps.length > 0 || (applied.pendingOptionalSteps || []).length > 0));
      if (spec.queue) {
        result.checks.push(check('queued_choice', spec.queue, queued, queued.includes(spec.queue)));
      }
      if (spec.continuation) {
        const resumeJson = ResolutionQueueManager.getQueue(gameId).steps
          .map((step) => String((step as any).oracleIrResumeStepsJson || ''))
          .join(' ');
        const pendingKinds = kindsOf(applied.pendingContinuationSteps);
        result.checks.push(
          check(
            'continuation_draw',
            spec.continuation,
            { pendingKinds, resumeJson: resumeJson.slice(0, 80) },
            pendingKinds.includes(spec.continuation) || resumeJson.includes(spec.continuation),
          ),
        );
      }
    }),
  );
  return finishSoak('compound_resume', 'E — Choices/costs', 'Compound IR resume (scry / surveil / unless / discard)', cards);
}

function runSpellStatic(): SmokeSoakResult {
  const specs: Array<{ name: string; kinds: string[] }> = [
    { name: 'Brave the Elements', kinds: ['choose_color', 'grant_temporary_ability'] },
    { name: 'Gather Specimens', kinds: ['grant_static_ability', 'gain_control', 'replacement'] },
    { name: 'Path to Exile', kinds: ['exile', 'search_library', 'move_zone'] },
    { name: 'Swords to Plowshares', kinds: ['exile', 'gain_life', 'move_zone'] },
    { name: 'Chaos Warp', kinds: ['move_zone', 'shuffle', 'reveal_top'] },
    { name: 'Beast Within', kinds: ['destroy', 'create_token'] },
  ];
  const cards = specs.map((spec) =>
    soakCard(spec.name, (_card, collected, result) => {
      const spellAbilities = (collected.ir.abilities || []).filter((ability) => String(ability.type) === AbilityType.SPELL || String(ability.type) === 'spell');
      result.checks.push(check('has_spell_ability', true, collected.abilityTypes, spellAbilities.length > 0));
      const present = spec.kinds.filter((kind) => hasKind(collected.spellSteps, kind) || hasKind(collected.allSteps, kind));
      result.checks.push(check('expected_kinds_any', spec.kinds, { spell: kindsOf(collected.spellSteps), all: kindsOf(collected.allSteps) }, present.length > 0));
      result.checks.push(check('no_unknown_spell', [], unknownRaws(collected.spellSteps), unknownRaws(collected.spellSteps).length === 0));
      if (spec.name === 'Brave the Elements') {
        result.checks.push(check('choose_color', true, kindsOf(collected.spellSteps), hasKind(collected.spellSteps, 'choose_color')));
        result.checks.push(check('grant_protection', true, kindsOf(collected.spellSteps), hasKind(collected.spellSteps, 'grant_temporary_ability')));
      }
      if (spec.name === 'Path to Exile' || spec.name === 'Swords to Plowshares') {
        result.checks.push(check('exile_plus_followup', 'exile plus search/life', kindsOf(collected.spellSteps), (hasKind(collected.spellSteps, 'exile') || hasKind(collected.spellSteps, 'move_zone')) && collected.spellSteps.length >= 2));
      }
    }),
  );
  return finishSoak('spell_static', 'F — Static smoke', 'Spell-static / instead typing', cards);
}

export const edhReadinessSuite: SoakSuite = {
  id: 'edh-readiness',
  title: 'EDH IR readiness soak',
  description: 'Season {P}, votes, end_combat, Spree/Tiered, choose-mode, cost riders, compound resume, spell-static',
  live: {
    season_p: { playerCount: 2, setup: 'main', expectAnyQueue: ['mode_selection'], expectPBudget: 5 },
    choose_mode: { playerCount: 2, setup: 'main', expectAnyQueue: ['mode_selection'] },
    vote: { playerCount: 4, setup: 'vote_board', expectAnyQueue: ['vote'] },
    spree_tiered: { playerCount: 2, setup: 'main', expectAnyQueue: ['additional_cost_payment', 'mode_selection'] },
    end_combat_phase: { playerCount: 2, setup: 'combat' },
    cast_cost_riders: { playerCount: 2, setup: 'main' },
    compound_resume: {
      playerCount: 2,
      setup: 'main',
      perCard: {
        Opt: { expectAnyQueue: ['scry'] },
        Consider: { expectAnyQueue: ['surveil'] },
        Preordain: { expectAnyQueue: ['scry'] },
      },
    },
    spell_static: {
      playerCount: 2,
      setup: 'vote_board',
      expectAnyQueue: ['target_selection', 'color_choice', 'mode_selection'],
    },
  },
  run: () => [
    runSeasonP(),
    runChooseMode(),
    runVotes(),
    runEndCombat(),
    runSpreeTiered(),
    runCastCostRiders(),
    runCompoundResume(),
    runSpellStatic(),
  ],
};
