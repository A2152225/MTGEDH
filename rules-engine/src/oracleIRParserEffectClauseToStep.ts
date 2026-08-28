// Extracted from rules-engine/src/oracleIRParser.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParser.ts: clause-to-step dispatch plus villainous-choice and self-enters-tapped replacement predicates.
//
// Public entry points:
//   parseEffectClauseToStep
//   tryParseVillainousChoiceStep
//   isSimpleSelfEntersTappedReplacementEffect

import type { OracleEffectStep } from './oracleIR';
import { buildAbilityClauses } from './oracleIRParserAbilityClauses';
import { tryParseChooseModeHeaderOnly } from './oracleIRParserChooseMode';
import { tryParseDelayedBattlefieldActionClause } from './oracleIRParserDelayedBattlefieldActions';
import { tryParseDelayedTriggerClause } from './oracleIRParserDelayedTriggeredClauses';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import {
  tryParseTemporaryModifyPtClause,
  tryParseTemporarySetBasePtClause,
} from './oracleIRParserModifyPtClauses';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import {
  tryParseRulesTextClause,
  tryParseStaticAbilityGrantClause,
} from './oracleIRParserStaticAbilityClauses';
import { tryParseTemporaryAbilityClause } from './oracleIRParserTemporaryAbilityClauses';
import { tryParseTemporaryGrantedDiesTriggerClause } from './oracleIRParserTemporaryTriggeredClauses';
import { tryParsePhase4ChoiceFamilyClause } from './oracleIRParserPhase4ChoiceFamilyClauses';
import { tryParseTemporaryEtbWindowClause } from './oracleIRParserTemporaryEtbWindowClauses';
import { tryParseAttackTaxThisTurnClause } from './oracleIRParserAttackTaxThisTurn';
import { tryParseAttackYouProhibitedExceptKeywordsClause } from './oracleIRParserAttackYouProhibitedExceptKeywords';
import { tryParseBlockTaxThisTurnClause } from './oracleIRParserBlockTaxThisTurn';
import { tryParsePreventLifeGainThisTurnClause } from './oracleIRParserPreventLifeGainThisTurn';
import { tryParseUntilEotProtectionOverrideClause } from './oracleIRParserUntilEotProtectionOverride';
import { tryParseWinIfCastSameNameThisGameStep } from './oracleIRParserWinIfCastSameNameThisGame';
import { tryParseWinIfControlDifferentNamesStep } from './oracleIRParserWinIfControlDifferentNames';
import { tryParseTokenCreationReplacementClause } from './oracleIRParserTokenReplacementClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import { normalizeClauseForParse, normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

export function parseEffectClauseToStep(rawClause: string): OracleEffectStep {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalized.clause;
  const sequence = normalized.sequence;
  const optional = normalized.optional;

  const withMeta = <T extends OracleEffectStep>(step: T): T => {
    const out: any = { ...step };
    if (sequence) out.sequence = sequence;
    // "You may [effect] unless … pays" normalizes as optional, but unless_pays is the
    // tax prompt itself — stamping optional caused a second Yes/No (and skip-on-deny).
    const kind = String(step?.kind || '');
    if (optional && kind !== 'unless_pays_mana' && kind !== 'unless_pays_life' && kind !== 'unless_sacrifices') {
      out.optional = optional;
    }
    return out;
  };

  if (/^if\s+you\s+gain\s+control\s+of\s+a\s+creature\s+this\s+way,\s+tap\s+it,\s+and\s+it(?:'|’)s\s+attacking\s+that\s+player$/i.test(clause)) {
    return withMeta({
      kind: 'grant_static_ability',
      target: parseObjectSelector('pass39 residual'),
      effectText: [clause],
      duration: 'static',
      raw: rawClause,
    } as OracleEffectStep);
  }

  if (/^if\s+it(?:'|’)?s\s+a\s+permanent\s+card,\s+they\s+put\s+it\s+onto\s+the\s+battlefield$/i.test(clause)) {
    return withMeta({
      kind: 'conditional',
      condition: { kind: 'if', raw: "it's a permanent card" },
      steps: [{
        kind: 'move_zone',
        what: parseObjectSelector('it'),
        to: 'battlefield',
        toRaw: 'the battlefield',
        raw: 'they put it onto the battlefield',
      } as OracleEffectStep],
      raw: rawClause,
    } as OracleEffectStep);
  }

  {
    const parsed = tryParseUntilEotProtectionOverrideClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParsePreventLifeGainThisTurnClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseAttackYouProhibitedExceptKeywordsClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseAttackTaxThisTurnClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseBlockTaxThisTurnClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseWinIfControlDifferentNamesStep(clause, sequence ? { sequence } : {});
    if (parsed) return withMeta(parsed);
  }

  {
    const parsed = tryParseWinIfCastSameNameThisGameStep(clause, sequence ? { sequence } : {});
    if (parsed) return withMeta(parsed);
  }

  {
    const parsed = tryParseChooseModeHeaderOnly(clause, withMeta);
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseDelayedBattlefieldActionClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseDelayedTriggerClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseTemporaryGrantedDiesTriggerClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseRulesTextClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseVillainousChoiceStep(clause, undefined);
    if (parsed) return withMeta(parsed);
  }

  {
    if (
      /^(?:equipped|enchanted)\s+.+?\bgets\s+[+-]?\d+\s*\/\s*[+-]?\d+/i.test(clause)
      || /^enchanted permanent is\b/i.test(clause)
      || /\bgets\s+[+-]?\d+\s*\/\s*[+-]?\d+,\s+has\s+"/i.test(clause)
    ) {
      const parsed = tryParseStaticAbilityGrantClause({ clause, rawClause, withMeta });
      if (parsed) return parsed;
    }
  }

  {
    const parsed = tryParseSimpleActionClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  // Create token(s). Keep this before broad temporary grants so clauses like
  // `Create ... with "This token can't block." Creatures you control gain...`
  // preserve the token creation as the primary action.
  {
    const candidateClauses = [clause];
    const triggeredCreateMatch = clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggeredCreateMatch) candidateClauses.push(String(triggeredCreateMatch[1] || '').trim());
    const conditionalCreateMatch = clause.match(/^if\b[^,]+,\s+(.+)$/i);
    if (conditionalCreateMatch) candidateClauses.push(String(conditionalCreateMatch[1] || '').trim());

    for (const candidate of candidateClauses) {
      const normalizedCandidate = normalizeClauseForParse(candidate).clause;
      const strippedMayCandidate = normalizedCandidate.replace(/^you\s+may\s+/i, '').trim();
      for (const createClause of [normalizedCandidate, strippedMayCandidate]) {
        const parsed = tryParseSimpleCreateTokenClause({ clause: createClause, rawClause, withMeta });
        if (parsed) return parsed;
      }
    }
  }

  {
    const parsed = tryParseTemporaryEtbWindowClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParsePhase4ChoiceFamilyClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseTemporaryGrantedDiesTriggerClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseTemporaryAbilityClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseStaticAbilityGrantClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  // Temporary P/T modification (composable: target + base delta + duration + optional scaler)
  {
    const parsed = tryParseTemporarySetBasePtClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseTemporaryModifyPtClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  // Gain/Lose life
  {
    const parsed = tryParseLifeAndCombatClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
    /* Legacy inline life/combat parsing removed from the active path.
       tryParseLifeAndCombatClause(...) is now the single maintained entry point. */
  }

  // Create token(s)
  {
    const triggeredCreateMatch = clause.match(/^(?:when|whenever)\s+this\s+creature\s+enters,\s+(.+)$/i);
    if (triggeredCreateMatch) {
      const triggeredCreateBody = String(triggeredCreateMatch[1] || '').trim();
      const parsed = tryParseSimpleCreateTokenClause({
        clause: /\btoken\s+copy\b/i.test(triggeredCreateBody) ? triggeredCreateBody : '',
        rawClause,
        withMeta,
      });
      if (parsed) return parsed;
    }

    const parsed = tryParseSimpleCreateTokenClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
    /* Legacy inline simple-token parsing removed from the active path.
       tryParseSimpleCreateTokenClause(...) is now the single maintained entry point. */
  }

  {
    const parsed = tryParseTokenCreationReplacementClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseZoneAndRemovalClause({ clause, rawClause, withMeta });
    if (parsed) return parsed;
  }

  {
    const parsed = tryParseVillainousChoiceStep(clause, undefined);
    if (parsed) return withMeta(parsed);
  }


  return withMeta({ kind: 'unknown', raw: rawClause });
}

export function tryParseVillainousChoiceStep(
  effectText: string,
  cardName: string | undefined
): (OracleEffectStep & { kind: 'choose_mode' }) | null {
  const normalized = normalizeOracleText(effectText).replace(/^then\s+/i, '').trim();
  const match = normalized.match(/^(.+?)\s+faces a villainous choice\s*(?:\u2014|-)\s*(.+)$/i);
  if (!match) return null;

  const chooserText = String(match[1] || '').trim();
  const optionsText = String(match[2] || '').trim().replace(/[.]+$/g, '');
  if (/[.;]/.test(chooserText)) return null;
  const separatorIndex = optionsText.toLowerCase().indexOf(', or ');
  if (!chooserText || !optionsText || separatorIndex < 0) return null;

  const optionAText = optionsText.slice(0, separatorIndex).trim();
  const optionBText = optionsText.slice(separatorIndex + ', or '.length).trim();
  if (!optionAText || !optionBText) return null;

  const parseModeEffectSteps = (modeEffectText: string): readonly OracleEffectStep[] => {
    const clauses = buildAbilityClauses({ effectText: modeEffectText, cardName, parseEffectClauseToStep });
    return clauses.map(parseEffectClauseToStep);
  };

  return {
    kind: 'choose_mode',
    minModes: 1,
    maxModes: 1,
    modes: [
      {
        label: optionAText,
        raw: optionAText,
        steps: [...parseModeEffectSteps(optionAText)],
      },
      {
        label: optionBText,
        raw: optionBText,
        steps: [...parseModeEffectSteps(optionBText)],
      },
    ],
    raw: `${chooserText} faces a villainous choice - ${optionAText}, or ${optionBText}`,
  };
}

export function isSimpleSelfEntersTappedReplacementEffect(effect: string): boolean {
  const normalized = normalizeOracleText(String(effect || ''))
    .replace(/[.)]+$/g, '')
    .trim();
  return /^tapped(?: unless .+)?$/i.test(normalized);
}

