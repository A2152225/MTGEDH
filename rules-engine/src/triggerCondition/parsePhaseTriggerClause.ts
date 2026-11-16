/**
 * "At the beginning of ..." phase trigger clause parser. Split from parseFamilies.ts with no
 * behavior change; parseFamilies.ts re-exports parsePhaseTriggerClause.
 */

import { normalizeTriggerClause } from './parseSubjectPhrase.js';
import type { TriggerConditionEvent, TriggerConditionIR, TriggerWhoseTurn } from './types.js';

const PHASE_EVENT: Readonly<Record<string, TriggerConditionEvent>> = {
  upkeep: 'beginning_of_upkeep',
  'draw step': 'beginning_of_draw_step',
  combat: 'beginning_of_combat',
  'end step': 'beginning_of_end_step',
};

export function parsePhaseTriggerClause(clause: string): TriggerConditionIR | null {
  const text = normalizeTriggerClause(clause);
  const exact: Record<string, { event: TriggerConditionEvent; whoseTurn: TriggerWhoseTurn }> = {
    'at the beginning of combat on your turn': { event: 'beginning_of_combat', whoseTurn: 'you' },
    'the beginning of combat on your turn': { event: 'beginning_of_combat', whoseTurn: 'you' },
    'at the beginning of your precombat main phase': { event: 'beginning_of_precombat_main', whoseTurn: 'you' },
    'at the beginning of your first main phase': { event: 'beginning_of_precombat_main', whoseTurn: 'you' },
    'at the beginning of your postcombat main phase': { event: 'beginning_of_postcombat_main', whoseTurn: 'you' },
    'at the beginning of your second main phase': { event: 'beginning_of_postcombat_main', whoseTurn: 'you' },
    'at the beginning of each of your main phases': { event: 'each_of_your_main_phases', whoseTurn: 'you' },
    'at the beginning of each of your postcombat main phases': { event: 'beginning_of_postcombat_main', whoseTurn: 'you' },
    'at the beginning of each of enchanted player\'s postcombat main phases': { event: 'beginning_of_postcombat_main', whoseTurn: 'enchanted_player' },
    'at the beginning of each of enchanted player\'s upkeeps': { event: 'beginning_of_upkeep', whoseTurn: 'enchanted_player' },
    'at the beginning of each of your upkeeps': { event: 'beginning_of_upkeep', whoseTurn: 'you' },
    'at the beginning of each of your end steps': { event: 'beginning_of_end_step', whoseTurn: 'you' },
    'at end of combat': { event: 'end_of_combat', whoseTurn: 'each_player' },
    'at the end of combat': { event: 'end_of_combat', whoseTurn: 'each_player' },
    'at end of combat on your turn': { event: 'end_of_combat', whoseTurn: 'you' },
    'at the end of combat on your turn': { event: 'end_of_combat', whoseTurn: 'you' },
    'at the end of the first combat phase on your turn': { event: 'end_of_combat', whoseTurn: 'you', firstCombat: true } as { event: 'end_of_combat'; whoseTurn: 'you'; firstCombat: true },
    // Ball Lightning family: "At the beginning of the end step" is every end step.
    'at the beginning of the end step': { event: 'beginning_of_end_step', whoseTurn: 'each_player' },
  };
  const known = exact[text];
  if (known) {
    return { event: known.event, quantity: 'one', whoseTurn: known.whoseTurn, alternatives: [], ...((known as any).firstCombat ? { firstCombat: true } : {}) };
  }
  if (/^at the beginning of the upkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller$/.test(text)) {
    return { event: 'beginning_of_upkeep', quantity: 'one', whoseTurn: 'enchanted_controller', alternatives: [] };
  }
  if (/^at the beginning of the draw step of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller$/.test(text)) {
    return { event: 'beginning_of_draw_step', quantity: 'one', whoseTurn: 'enchanted_controller', alternatives: [] };
  }
  if (/^at the beginning of (?:each of )?that player's (upkeeps?|draw steps?|end steps?)$/.test(text)) {
    const phase = /^at the beginning of (?:each of )?that player's (upkeeps?|draw steps?|end steps?)$/.exec(text)![1];
    const phaseRaw = phase.replace(/s$/, '');
    const event = phaseRaw === 'upkeep' ? 'beginning_of_upkeep' : phaseRaw === 'draw step' ? 'beginning_of_draw_step' : 'beginning_of_end_step';
    return { event, quantity: 'one', whoseTurn: 'that_player', alternatives: [] };
  }
  if (/^at the beginning of the upkeep of the exiled card's owner$/.test(text)) {
    return { event: 'beginning_of_upkeep', quantity: 'one', whoseTurn: 'exiled_card_owner', alternatives: [] };
  }
  const match = /^(?:at the beginning of )?(your|each player's|each opponent's|each other player's|each|enchanted player's|the monarch's|the chosen player's) (upkeep|draw step|combat|end step)$/.exec(text);
  if (!match) return null;
  const event = PHASE_EVENT[match[2]];
  if (!event) return null;
  const whoseTurn: TriggerWhoseTurn = match[1] === 'your'
    ? 'you'
    : match[1] === "each opponent's"
      ? 'each_opponent'
      : match[1] === "each other player's"
        ? 'each_other_player'
      : match[1] === "enchanted player's"
        ? 'enchanted_player'
        : match[1] === "the monarch's"
          ? 'monarch'
          : match[1] === "the chosen player's"
            ? 'chosen_player'
            : 'each_player';
  return {
    event,
    quantity: 'one',
    whoseTurn,
    alternatives: [],
  };
}
