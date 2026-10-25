/**
 * Round 14 trigger wordings mapped onto existing events: "your commander enters or attacks",
 * "a creature with mana value N or greater enters", "a creature attacks you", "when it attacks",
 * "the end step of enchanted creature's controller", and legacy-runtime wordings with their own
 * detectors (explores/connives, "play a land or cast a spell", "each player's first main phase",
 * "combat on each opponent's turn", "a player attacks (you|enchanted player)", "that creature
 * leaves the battlefield this turn").
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound14TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const LEGACY = { legacyRuntimeOnly: true };

export function parseRound14TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const cmdr = /^(whenever|when) your commander (enters|attacks)(?: or (attacks|enters))?,\s*(.+)$/.exec(text);
  if (cmdr) {
    const base = reparse(cmdr[1] + ' a commander you control ' + cmdr[2] + ', ' + cmdr[4]);
    return cmdr[3] ? withFields(base, { pairedEvent: cmdr[3] }) : base;
  }

  const mv = /^(whenever|when) (.+?) with (?:mana value|converted mana cost) (\d+) or (greater|more|less) (enters(?: the battlefield)?(?: under your control)?|dies|attacks),\s*(.+)$/.exec(text);
  if (mv) {
    const base = reparse(mv[1] + ' ' + mv[2] + ' ' + mv[5] + ', ' + mv[6]);
    if (!base) return null;
    const n = Number(mv[3]);
    const stat = { stat: 'mana_value', op: mv[4] === 'less' ? 'lte' : 'gte', value: n };
    const alternatives = (base.condition.alternatives || []).map((alt: any) => ({
      ...alt,
      subject: { ...(alt.subject || {}), stats: [...((alt.subject && alt.subject.stats) || []), stat] },
    }));
    return withFields(base, { alternatives });
  }

  const attacksYou = /^whenever ((?:a|an|another) [^,]+?) attacks you,\s*(.+)$/.exec(text);
  if (attacksYou) {
    return withFields(reparse('whenever ' + attacksYou[1] + ' attacks you or a planeswalker you control, ' + attacksYou[2]), { attackedTargetType: 'player' });
  }

  const itAttacks = /^when(?:ever)? it attacks,\s*(.+)$/.exec(text);
  if (itAttacks) return reparse('whenever this creature attacks, ' + itAttacks[1]);

  const auraEnd = /^at the beginning of the end step of enchanted (?:creature|permanent)'s controller,\s*(.+)$/.exec(text);
  if (auraEnd) return withFields(reparse('at the beginning of your end step, ' + auraEnd[1]), { whoseTurn: 'enchanted_controller' });

  const performs = /^whenever (a|another) (creature|nontoken creature) you control (explores|connives),\s*(.+)$/.exec(text);
  if (performs) {
    return withFields(reparse('whenever ' + performs[1] + ' ' + performs[2] + ' you control enters, ' + performs[4]), {
      event: 'performs', action: performs[3] === 'explores' ? 'explore' : 'connive', ...LEGACY,
    });
  }

  const landOrSpell = /^whenever you play a land or cast a spell,\s*(.+)$/.exec(text);
  if (landOrSpell) return withFields(reparse('whenever you play a land, ' + landOrSpell[1]), { pairedEvent: 'spell_cast', ...LEGACY });

  const firstMain = /^at the beginning of each player's (?:first|precombat) main phase,\s*(.+)$/.exec(text);
  if (firstMain) return withFields(reparse('at the beginning of your precombat main phase, ' + firstMain[1]), { whoseTurn: 'each_player', ...LEGACY });

  const oppCombat = /^at the beginning of combat on each opponent's turn,\s*(.+)$/.exec(text);
  if (oppCombat) return withFields(reparse('at the beginning of combat on your turn, ' + oppCombat[1]), { whoseTurn: 'each_opponent', ...LEGACY });

  const playerAttacks = /^whenever (?:a player|an opponent) attacks (you|enchanted player)(?: with one or more creatures)?,\s*(.+)$/.exec(text);
  if (playerAttacks && playerAttacks[1] === 'you') return withFields(reparse('whenever a creature attacks you, ' + playerAttacks[2]), { quantity: 'one_or_more' });
  if (playerAttacks) {
    return withFields(reparse('whenever a creature attacks you or a planeswalker you control, ' + playerAttacks[2]), { attackedPlayer: undefined, ...LEGACY });
  }

  const oneOrMoreAttackYou = /^whenever one or more creatures attack you,\s*(.+)$/.exec(text);
  if (oneOrMoreAttackYou) return withFields(reparse('whenever a creature attacks you, ' + oneOrMoreAttackYou[1]), { quantity: 'one_or_more' });

  const leavesThisTurn = /^when that creature leaves the battlefield this turn,\s*(.+)$/.exec(text);
  if (leavesThisTurn) return withFields(reparse('when this creature leaves the battlefield, ' + leavesThisTurn[1]), LEGACY);
  return null;
}
