import type { OracleEffectStep } from './oracleIR';
import { tryParseCreateTokenFollowupModifier } from './oracleIRParserTokenFollowup';
import { normalizeOracleText, splitIntoClauses } from './oracleIRParserUtils';
import {
  splitConservativeSacrificeLeadClause,
  tryParseLeadingConditionalStep,
} from './oracleIRParserSacrificeHelpers';
import { splitConservativeCreateTokenLeadClause } from './oracleIRParserTokenSimpleClauses';
import { splitConservativeExileFromLeadClause } from './oracleIRParserZoneAndRemovalActions';

function splitTrailingGrantedDiesTriggerFollowup(clause: string): string[] {
  const normalized = normalizeOracleText(clause).trim();
  if (!normalized) return [];

  const match = normalized.match(
    /^(.*?\bgains?\s+(?:(?:[^"]+?)\s+and\s+)?"when\s+(?:this creature|this permanent|it)\s+dies,\s+.+?"\s*(?:\([^)]*\))?)\s+([A-Z].+)$/i
  );
  if (!match) return [clause];

  return [String(match[1] || '').trim(), String(match[2] || '').trim()].filter(Boolean);
}

function splitConservativeGetEnergyThenPayAnyEnergyClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const normalized = normalizeOracleText(args.rawClause).trim();
  const match = normalized.match(
    /^(.*?get(?:s)?\s+(?:\{E\})+(?:\s*\([^)]*\))?),\s*then\s+(you may pay any amount of \{E\})$/i,
  );
  if (!match) return null;
  const first = String(match[1] || '').trim();
  const second = String(match[2] || '').trim();
  if (!first || !second) return null;
  const firstStep = args.parseEffectClauseToStep(first);
  const secondStep = args.parseEffectClauseToStep(second);
  if (firstStep.kind !== 'add_player_counter' || secondStep.kind !== 'pay_energy') return null;
  return [first, second];
}

function splitConservativeCantAttackOrBlockClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/can't\s+attack\s+or\s+block/i.test(normalized)) return null;

  const match = normalized.match(
    /^(.*?)\s+can't\s+attack\s+or\s+block(?:\s+(this\s+turn))?(?:,\s*and\s+(.+))?$/i
  );
  if (!match) return null;

  const targetText = String(match[1] || '').trim();
  const durationSuffix = String(match[2] || '').trim();
  const trailingClause = String(match[3] || '').trim();
  if (!targetText) return null;

  const suffix = durationSuffix ? ` ${durationSuffix}` : '';
  const first = `${targetText} can't attack${suffix}`;
  const second = `${targetText} can't block${suffix}`;
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return trailingClause ? [first, second, trailingClause] : [first, second];
}

function splitConservativeActionConjunctionClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\band\b/i.test(normalized)) return null;

  const splitMatch = normalized.match(
    /^(.*?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent|this permanent|this creature|that creature|it|they|suspects?|creates?|draws?|discards?|exiles?|returns?|puts?|destroys?|counters?|gains?|loses?|deals?|taps?|untaps?|mills?|surveils?|scrys?|investigates?|populates?|goads?)\b.+)$/i
  );
  if (!splitMatch) return null;

  const first = String(splitMatch[1] || '').trim();
  const second = String(splitMatch[2] || '').trim();
  if (!first || !second) return null;

  // "Search your library for a Plains card and put it onto the battlefield tapped"
  // is one search_library step, not a hand-search plus a later move_zone.
  const isLibrarySearchLead = /\bsearch\b[\s\S]*\blibrary\b/i.test(first);
  const isFoundCardPlacement =
    /^(?:then\s+)?(?:reveal\s+(?:it|them|that card|those cards)(?:,\s*)?)?(?:puts?|exiles?|reveals?)\s+(?:it|them|that card|those cards)\b/i.test(second);
  if (isLibrarySearchLead && isFoundCardPlacement) return null;
  if (isLibrarySearchLead && parseEffectClauseToStep(normalized).kind === 'search_library') {
    return null;
  }
  // Keep "Target player draws a card and loses 1 life" as one clause so the
  // life-loss inherits the same player subject (splitDrawAndLifeStep).
  if (/\bdraws?\b/i.test(first) && /^(?:loses?)\s+.+\blife\b/i.test(second)) {
    return null;
  }
  // Keep "If you do, draw a card and this creature gets +N/+N" intact so both
  // effects stay under the same If-you-do conditional.
  if (/^if\s+you\s+do,/i.test(first)) {
    return null;
  }

  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeKnownSentenceFollowups(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const normalized = normalizeOracleText(args.rawClause).trim();
  const tokenReminder = normalized.match(
    /^(create(?:s)?\s+.+?\btokens?)\.\s+((?:it has|they have)\s+.+)$/i,
  );
  if (tokenReminder) {
    return [
      String(tokenReminder[1] || '').trim(),
      String(tokenReminder[2] || '').trim(),
    ];
  }
  const match = normalized.match(/^(.+?)\.\s+(proliferate|draw\s+.+)$/i);
  if (!match) return null;
  const first = String(match[1] || '').trim();
  const second = String(match[2] || '').trim();
  if (!first || !second) return null;
  const secondStep = args.parseEffectClauseToStep(second);
  if (secondStep.kind === 'unknown') return null;
  if (!/^as an additional cost\b/i.test(first) && args.parseEffectClauseToStep(first).kind === 'unknown') return null;
  return [first, second];
}

function splitConservativeModifyPtGrantedDiesTriggerClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\bgets\b/i.test(normalized) || !/\band gains?\s+"/i.test(normalized)) return null;

  const match = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+gets\s+(.+?)\s+and\s+gains?\s+("when\s+(?:this creature|this permanent|it)\s+dies(?:\s+this\s+turn)?,\s+.+?")\s*(?:\([^)]*\))?$/i
  );
  if (!match) return null;

  const durationPrefix = String(match[1] || '');
  const targetText = String(match[2] || '').trim();
  const modifyText = String(match[3] || '').trim();
  const quotedTrigger = String(match[4] || '').trim();
  if (!targetText || !modifyText || !quotedTrigger) return null;
  const normalizedTargetText = targetText.replace(/^another\s+/i, '').trim();
  if (!normalizedTargetText) return null;

  const first = durationPrefix
    ? `${normalizedTargetText} gets ${modifyText} until end of turn`
    : `${normalizedTargetText} gets ${modifyText}`;
  const second = `${durationPrefix}${normalizedTargetText} gains ${quotedTrigger}`.trim();
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeModifyPtTemporaryAbilityClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\bget(?:s)?\b/i.test(normalized) || !/\band (?:gains?|have)\b/i.test(normalized)) return null;

  const match = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+(get(?:s)?)\s+([+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x))\s+and\s+(gain(?:s)?|have)\s+(.+?)(?:\s+until end of turn)?$/i
  );
  if (!match) return null;

  const durationPrefix = String(match[1] || '');
  const targetText = String(match[2] || '').trim();
  const getVerb = String(match[3] || 'gets').trim();
  const modifyText = String(match[4] || '').trim();
  const grantKind = String(match[5] || 'gains').trim().toLowerCase();
  const grantText = String(match[6] || '').trim().replace(/[.]+$/g, '');
  if (!targetText || !modifyText || !grantText) return null;
  if (!durationPrefix && !/\buntil\s+end\s+of\s+turn\b/i.test(normalized)) return null;

  const durationSuffix = ' until end of turn';
  const first = `${targetText} ${getVerb} ${modifyText}${durationSuffix}`.trim();
  const second = grantKind === 'have'
    ? `${targetText} have ${grantText}${durationSuffix}`.trim()
    : `${targetText} ${grantKind.startsWith('gain') ? grantKind : 'gains'} ${grantText}${durationSuffix}`.trim();
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeTemporaryAbilityThenModifyPtClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\bgains?\b/i.test(normalized) || !/\band\s+get(?:s)?\b/i.test(normalized)) return null;

  const match = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+and\s+get(?:s)?\s+([+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x))(?:\s+until end of turn)?(.*)$/i
  );
  if (!match) return null;

  const durationPrefix = String(match[1] || '');
  const targetText = String(match[2] || '').trim();
  const gainsText = String(match[3] || '').trim();
  const modifyText = String(match[4] || '').trim();
  const tail = String(match[5] || '').trim();
  if (!targetText || !gainsText || !modifyText) return null;
  if (!durationPrefix && !/\buntil\s+end\s+of\s+turn\b/i.test(normalized)) return null;

  const first = `${durationPrefix}${targetText} gains ${gainsText} until end of turn`.trim();
  const second = `${targetText} gets ${modifyText} until end of turn${tail ? ` ${tail.replace(/^,\s*/, '')}` : ''}`.trim();
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeTemporaryAbilityEvasionClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\bgains?\b/i.test(normalized) || !/\band\b/i.test(normalized) || !/\bcan't be blocked\b/i.test(normalized)) {
    return null;
  }

  const match = normalized.match(
    /^(?:until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+until end of turn\s+and\s+(can't be blocked(?: by .+?)?(?: this turn)?)$/i
  );
  if (!match) return null;

  const targetText = String(match[1] || '').trim();
  const gainsText = String(match[2] || '').trim();
  const evasionText = String(match[3] || '').trim();
  if (!targetText || !gainsText || !evasionText) return null;

  const first = `${targetText} gains ${gainsText} until end of turn`;
  const second = `${targetText} ${evasionText}`;
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeGrantedDiesTriggerSetBasePtClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized || !/\band\s+has\s+/i.test(normalized) || !/\bgains?\s+"/i.test(normalized)) return null;

  const chosenMatch = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+gains?\s+("when\s+(?:this creature|this permanent|it)\s+dies,\s+.+")\s+and\s+has\s+the\s+chosen\s+base\s+power\s+and\s+toughness$/i
  );
  if (chosenMatch) {
    const durationPrefix = String(chosenMatch[1] || '');
    const targetText = String(chosenMatch[2] || '').trim();
    const quotedTrigger = String(chosenMatch[3] || '').trim();
    if (!targetText || !quotedTrigger) return null;

    const first = `${durationPrefix}${targetText} gains ${quotedTrigger}`.trim();
    const firstStep = parseEffectClauseToStep(first);
    return firstStep.kind === 'unknown' ? null : [first];
  }

  const match = normalized.match(
    /^(until end of turn,\s+)?(.+?)\s+gains?\s+("when\s+(?:this creature|this permanent|it)\s+dies,\s+.+")\s+and\s+has\s+(?:the\s+)?base power and toughness\s+(\d+)\s*\/\s*(\d+)$/i
  );
  if (!match) return null;

  const durationPrefix = String(match[1] || '');
  const targetText = String(match[2] || '').trim();
  const quotedTrigger = String(match[3] || '').trim();
  const power = String(match[4] || '').trim();
  const toughness = String(match[5] || '').trim();
  if (!targetText || !quotedTrigger || !power || !toughness) return null;

  const first = `${durationPrefix}${targetText} gains ${quotedTrigger}`.trim();
  const second = `${durationPrefix}${targetText} has base power and toughness ${power}/${toughness}`.trim();
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeQuotedCreateTokenFollowupClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const clause = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  const delayedCleanupMatch = clause.match(
    /^(create(?:s)?\s+.+?\btokens?\s+(?:with\s+[\s\S]*?"[^"]+"\.?))\s+(exile|sacrifice)\s+(?:it|them|that token|those tokens|the token|the tokens)\s+at\s+the\s+beginning\s+of\s+(?:the\s+)?next\s+end\s+step\.?$/i
  );
  const legacyMatch = delayedCleanupMatch
    ? null
    : clause.match(/^(create(?:s)?\s+.+?\btoken(?:s)?\s+with\s+"[^"]+")\s+([A-Z][\s\S]+)$/i);
  const match = delayedCleanupMatch ?? legacyMatch;
  if (!match) return null;

  const first = String(match[1] || '').trim();
  const second = delayedCleanupMatch
    ? `${String(match[2] || '').trim()} them at the beginning of the next end step`
    : String(match[2] || '').trim();
  const firstStep = parseEffectClauseToStep(first);
  if (firstStep.kind !== 'create_token') return null;
  if (!delayedCleanupMatch && parseEffectClauseToStep(second).kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeDamageDrawGainLifeClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const clause = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  const match = clause.match(
    /^(it|this creature|this permanent|~)\s+deals?\s+x\s+damage\s+to\s+any\s+target,\s+target\s+player\s+draws?\s+x\s+cards,\s+and\s+you\s+gain\s+x\s+life,\s+where\s+x\s+is\s+(.+)$/i,
  );
  if (!match) return null;

  const subject = String(match[1] || 'it').trim();
  const whereTail = String(match[2] || '').trim();
  if (!whereTail) return null;

  const parts = [
    `${subject} deals x damage to any target, where x is ${whereTail}`,
    `target player draws x cards, where x is ${whereTail}`,
    `you gain x life, where x is ${whereTail}`,
  ];
  if (parts.some(part => parseEffectClauseToStep(part).kind === 'unknown')) return null;
  return parts;
}

function splitConservativeDrawGainControlClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const clause = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  const match = clause.match(
    /^(.+?)\s+draws?\s+((?:a card|a|an|\d+|two|three|four|five|six|seven|eight|nine|ten|x|[a-z]+)\s+cards?)\s+and\s+(gains?\s+control\s+of\s+.+)$/i,
  );
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const cards = String(match[2] || '').trim();
  const controlTail = String(match[3] || '').trim();
  if (!who || !cards || !controlTail) return null;

  const drawVerb = /^you$/i.test(who) ? 'draw' : 'draws';
  const gainVerb = /^you$/i.test(who) ? 'gain' : 'gains';
  const first = `${who} ${drawVerb} ${cards}`;
  const controlBody = controlTail.replace(/^gains?\s+/i, '').trim();
  const second = `${who} ${gainVerb} ${controlBody}`;
  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;
  return [first, second];
}

function splitConservativeCommaDrawGainClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const clause = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  const match = clause.match(
    /^(you draw .+?cards?),\s*((?:you )?gain .+)$/i,
  );
  if (!match) return null;

  const first = String(match[1] || '').trim();
  const second = String(match[2] || '').trim();
  if (!first || !second) return null;

  const firstStep = parseEffectClauseToStep(first);
  const secondStep = parseEffectClauseToStep(second);
  if (firstStep.kind === 'unknown' || secondStep.kind === 'unknown') return null;

  return [first, second];
}

function splitConservativeAndCreateTokenClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const { rawClause, parseEffectClauseToStep } = args;
  const clause = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  const match = clause.match(/^(.+?)\s+and\s+(create(?:s)?\b.+)$/i);
  if (!match) return null;

  const first = String(match[1] || '').trim();
  const second = String(match[2] || '').trim();
  const secondStep = parseEffectClauseToStep(second);
  if (!first || secondStep.kind !== 'create_token') return null;

  const commaSplit =
    splitConservativeCommaDrawGainClause({ rawClause: first, parseEffectClauseToStep }) ?? [first];
  return [...commaSplit, second];
}

function mergeWhereXContinuationClauses(clauses: readonly string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < clauses.length; index += 1) {
    const current = String(clauses[index] || '').trim();
    const next = String(clauses[index + 1] || '').trim();
    if (current && next && /,\s*where\s+x\s+is\s*$/i.test(current)) {
      merged.push(`${current}, ${next}`);
      index += 1;
      continue;
    }
    if (current) merged.push(current);
  }
  return merged;
}

export function buildAbilityClauses(args: {
  effectText: string;
  cardName?: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] {
  const { effectText, cardName, parseEffectClauseToStep } = args;
  const combinedClauses: string[] = [];
  const rawClauses = mergeWhereXContinuationClauses(
    splitIntoClauses(effectText).flatMap(splitTrailingGrantedDiesTriggerFollowup)
  );

  for (let clauseIndex = 0; clauseIndex < rawClauses.length; clauseIndex += 1) {
    const clause = rawClauses[clauseIndex];
    const nextClause = rawClauses[clauseIndex + 1];
    // Ability-word labels ("Delirium —", "Threshold —") hide a leading If from ^if recombination.
    const clauseForIfLead = String(clause || '')
      .replace(/^[A-Z][A-Za-z' -]{1,40}\s*[-—–]\s+/u, '')
      .trim();
    if (/^if\b/i.test(clauseForIfLead) && /^then\b/i.test(String(nextClause || ''))) {
      const combined = `${clause}, ${nextClause}`;
      if (tryParseLeadingConditionalStep({ rawClause: combined, cardName, parseEffectClauseToStep })) {
        combinedClauses.push(combined);
        clauseIndex += 1;
        continue;
      }
    }

    combinedClauses.push(clause);
  }

  const expandedClauses = combinedClauses.flatMap(clause =>
    splitConservativeGetEnergyThenPayAnyEnergyClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeSacrificeLeadClause({ rawClause: clause, cardName, parseEffectClauseToStep }) ??
    splitConservativeTemporaryAbilityEvasionClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeGrantedDiesTriggerSetBasePtClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeModifyPtGrantedDiesTriggerClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeModifyPtTemporaryAbilityClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeTemporaryAbilityThenModifyPtClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeCantAttackOrBlockClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeQuotedCreateTokenFollowupClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeAndCreateTokenClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeDamageDrawGainLifeClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeDrawGainControlClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeCommaDrawGainClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeActionConjunctionClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeKnownSentenceFollowups({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeCreateTokenLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    splitConservativeExileFromLeadClause({ rawClause: clause, parseEffectClauseToStep }) ??
    [clause]
  );

  // Keep entry modifiers as separate clauses. The ability parser tracks the
  // preceding create_token step(s) and folds these clauses into those steps.
  // Recombining them here lets the broad create-token matcher consume the
  // whole sentence and silently drops both multi-token segments and metadata.
  return expandedClauses;
}

function acceptsCreateTokenFollowupModifierLead(clause: string): boolean {
  const normalized = normalizeOracleText(clause).trim().toLowerCase();
  if (!normalized) return false;

  // Reanimation and non-token battlefield puts keep haste/exile riders as separate steps.
  if (
    (/\breturn\b/.test(normalized) || /\bput\b.+\bonto the battlefield\b/.test(normalized)) &&
    !/\bcreate\b.+\btoken/.test(normalized)
  ) {
    return false;
  }

  return /\bcreate\b/.test(normalized) && /\btoken/.test(normalized);
}

function mergeTrailingCreateTokenFollowupClauses(clauses: readonly string[]): string[] {
  if (clauses.length <= 1) return [...clauses];
  const out: string[] = [];
  for (const clause of clauses) {
    if (
      tryParseCreateTokenFollowupModifier(clause) &&
      out.length > 0 &&
      acceptsCreateTokenFollowupModifierLead(out[out.length - 1] || '')
    ) {
      out[out.length - 1] = `${out[out.length - 1]}. ${clause}`;
      continue;
    }
    out.push(clause);
  }
  return out;
}
