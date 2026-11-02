// server/src/state/modules/spellSelfTrekCountCostReduction.ts
// "This spell costs {X} less to cast, where X is the number of differently named lands you control" (Strange new worlds)
// and the Federation mirror (creature types among non-Borg creatures you control).
// Also exports the activated-ability mirror "This ability costs {X} less to activate, where X is ...".
// Public entry symbols: applySpellSelfTrekCountCostReduction, getSelfAbilityTrekCountReduction, evaluateTrekCountPhrase.

import { countDifferentlyNamedLands, countFederationCreatureTypes, countOpponentsAttackedThisTurn } from '../../../../rules-engine/src/trekCountBases.js';

/** Evaluates a "the number of ..." phrase backed by a Trek count base; undefined when unsupported. */
export function evaluateTrekCountPhrase(phrase: string, battlefield: readonly any[], playerId: string): number | undefined {
  const p = String(phrase || '').toLowerCase().replace(/\u2019/g, "'").trim();
  if (p === 'differently named lands you control') return countDifferentlyNamedLands(battlefield as any, playerId);
  if (p === 'creature types among non-borg creatures you control') return countFederationCreatureTypes(battlefield as any, playerId);
  return undefined;
}

function selfReduction(text: string, noun: 'spell' | 'ability', verb: 'cast' | 'activate', battlefield: readonly any[], playerId: string): number {
  const re = new RegExp('this ' + noun + ' costs \\{x\\} less to ' + verb + ', where x is the number of ([^.\\n]+)', 'i');
  const m = String(text || '').replace(/\u2019/g, "'").match(re);
  if (!m) return 0;
  return Math.max(0, evaluateTrekCountPhrase(m[1], battlefield, playerId) ?? 0);
}

export function applySpellSelfTrekCountCostReduction(args: {
  oracleText: string;
  cardName: string;
  battlefield: readonly any[];
  playerId: string;
  state?: any;
}): { generic: number; messages: string[] } {
  let generic = selfReduction(args.oracleText, 'spell', 'cast', args.battlefield || [], args.playerId);
  // Battlefront (Own the Day): "This spell costs {1} less to cast for each opponent you attacked this turn."
  const bf = String(args.oracleText || '').replace(/\u2019/g, "'").match(/this spell costs \{(\d+)\} less to cast for each opponent you attacked this turn/i);
  if (bf && args.state) generic += Number(bf[1]) * countOpponentsAttackedThisTurn(args.state, args.playerId);
  return generic > 0 ? { generic, messages: [`${args.cardName}: -{${generic}} (count base)`] } : { generic: 0, messages: [] };
}

/** Generic reduction for an activated ability whose own text says "This ability costs {X} less to activate, where X is ...". */
export function getSelfAbilityTrekCountReduction(abilityText: string, battlefield: readonly any[], playerId: string): number {
  return selfReduction(abilityText, 'ability', 'activate', battlefield || [], playerId);
}
