// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the head half of the residual unknown-step chain - the prologue that normalizes the raw text and builds the metadata helpers, then the ordered dispatch over the Residual* guard modules, ending in the call to the tail helper.
//
// Public entry points:
//   parseCurrentResidualUnknownStep

import type { OracleEffectStep } from './oracleIR';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOps';
import { repairMoveZoneStep } from './oracleIRParserPostprocessGapClosureStepRepairs';
import { parseStructuredKeywordActionGrant } from './oracleIRParserPostprocessKeywordStaticGrantSteps';
import {
  parseResidualAttackerTokenAndMetadataGuardsOne,
  parseResidualAttackerTokenAndMetadataGuardsTwo,
} from './oracleIRParserPostprocessResidualAttackerTokenAndMetadataGuards';
import {
  parseResidualCombatCounterAndPaymentGuardsOne,
  parseResidualCombatCounterAndPaymentGuardsTwo,
} from './oracleIRParserPostprocessResidualCombatCounterAndPaymentGuards';
import {
  parseResidualEntryAndPermissionGuardsEight,
  parseResidualEntryAndPermissionGuardsEleven,
  parseResidualEntryAndPermissionGuardsFive,
  parseResidualEntryAndPermissionGuardsFour,
  parseResidualEntryAndPermissionGuardsNine,
  parseResidualEntryAndPermissionGuardsOne,
  parseResidualEntryAndPermissionGuardsSeven,
  parseResidualEntryAndPermissionGuardsSix,
  parseResidualEntryAndPermissionGuardsTen,
  parseResidualEntryAndPermissionGuardsThree,
  parseResidualEntryAndPermissionGuardsTwo,
} from './oracleIRParserPostprocessResidualEntryAndPermissionGuards';
import {
  parseResidualGraveyardReturnAndConditionalGuardsEight,
  parseResidualGraveyardReturnAndConditionalGuardsEleven,
  parseResidualGraveyardReturnAndConditionalGuardsFive,
  parseResidualGraveyardReturnAndConditionalGuardsFour,
  parseResidualGraveyardReturnAndConditionalGuardsNine,
  parseResidualGraveyardReturnAndConditionalGuardsOne,
  parseResidualGraveyardReturnAndConditionalGuardsSeven,
  parseResidualGraveyardReturnAndConditionalGuardsSix,
  parseResidualGraveyardReturnAndConditionalGuardsTen,
  parseResidualGraveyardReturnAndConditionalGuardsThree,
  parseResidualGraveyardReturnAndConditionalGuardsTwelve,
  parseResidualGraveyardReturnAndConditionalGuardsTwo,
} from './oracleIRParserPostprocessResidualGraveyardReturnAndConditionalGuards';
import {
  parseResidualManaPhasingAndAttachGuardsFive,
  parseResidualManaPhasingAndAttachGuardsFour,
  parseResidualManaPhasingAndAttachGuardsOne,
  parseResidualManaPhasingAndAttachGuardsSeven,
  parseResidualManaPhasingAndAttachGuardsSix,
  parseResidualManaPhasingAndAttachGuardsThree,
  parseResidualManaPhasingAndAttachGuardsTwo,
} from './oracleIRParserPostprocessResidualManaPhasingAndAttachGuards';
import {
  parseResidualNamedModeSearchGuardsOne,
} from './oracleIRParserPostprocessResidualNamedModeSearchGuards';
import {
  parseResidualNumberChangeAndGroupPtGuardsOne,
  parseResidualNumberChangeAndGroupPtGuardsThree,
  parseResidualNumberChangeAndGroupPtGuardsTwo,
} from './oracleIRParserPostprocessResidualNumberChangeAndGroupPtGuards';
import {
  parseResidualSelfReferenceAndLibraryOrderGuardsOne,
  parseResidualSelfReferenceAndLibraryOrderGuardsThree,
  parseResidualSelfReferenceAndLibraryOrderGuardsTwo,
} from './oracleIRParserPostprocessResidualSelfReferenceAndLibraryOrderGuards';
import {
  parseResidualTextChangeAndCatalogGuardsEight,
  parseResidualTextChangeAndCatalogGuardsFive,
  parseResidualTextChangeAndCatalogGuardsFour,
  parseResidualTextChangeAndCatalogGuardsNine,
  parseResidualTextChangeAndCatalogGuardsOne,
  parseResidualTextChangeAndCatalogGuardsSeven,
  parseResidualTextChangeAndCatalogGuardsSix,
  parseResidualTextChangeAndCatalogGuardsThree,
  parseResidualTextChangeAndCatalogGuardsTwo,
} from './oracleIRParserPostprocessResidualTextChangeAndCatalogGuards';
import { parseCurrentResidualUnknownStepTail } from './oracleIRParserPostprocessResidualUnknownStepTail';
import {
  parseResidualWardAndEvidenceGuardsOne,
  parseResidualWardAndEvidenceGuardsTwo,
} from './oracleIRParserPostprocessResidualWardAndEvidenceGuards';
import {
  parseStandaloneKeywordFragmentUnknownStep,
  parseStructuredTriggerResidualGrant,
} from './oracleIRParserPostprocessStructuredTriggerResidualChain';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
} from './oracleIRParserUtils';

function parseCurrentResidualUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^�\s*/, '')
    .replace(/[.)"]+$/g, '')
    .trim();
  const sequence = step.sequence ? { sequence: step.sequence } : {};

  const keywordFragment = parseStandaloneKeywordFragmentUnknownStep(step);
  if (keywordFragment) return keywordFragment;

  const keywordActionGrant = parseStructuredKeywordActionGrant(raw, sequence);
  if (keywordActionGrant) return keywordActionGrant;

  const triggerResidualGrant = parseStructuredTriggerResidualGrant(raw, sequence);
  if (triggerResidualGrant) return triggerResidualGrant;

  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const clauseBody = normalizeClauseForParse(raw).clause.trim();

  const hoistedResidualEntryAndPermissionGuardsOne = parseResidualEntryAndPermissionGuardsOne(raw, sequence, clauseBody);
  if (hoistedResidualEntryAndPermissionGuardsOne) return hoistedResidualEntryAndPermissionGuardsOne;

  const hoistedResidualManaPhasingAndAttachGuardsOne = parseResidualManaPhasingAndAttachGuardsOne(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsOne) return hoistedResidualManaPhasingAndAttachGuardsOne;

  const hoistedResidualGraveyardReturnAndConditionalGuardsOne = parseResidualGraveyardReturnAndConditionalGuardsOne(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsOne) return hoistedResidualGraveyardReturnAndConditionalGuardsOne;

  const hoistedResidualManaPhasingAndAttachGuardsTwo = parseResidualManaPhasingAndAttachGuardsTwo(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsTwo) return hoistedResidualManaPhasingAndAttachGuardsTwo;

  const hoistedResidualGraveyardReturnAndConditionalGuardsTwo = parseResidualGraveyardReturnAndConditionalGuardsTwo(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsTwo) return hoistedResidualGraveyardReturnAndConditionalGuardsTwo;

  const hoistedResidualManaPhasingAndAttachGuardsThree = parseResidualManaPhasingAndAttachGuardsThree(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsThree) return hoistedResidualManaPhasingAndAttachGuardsThree;

  const hoistedResidualGraveyardReturnAndConditionalGuardsThree = parseResidualGraveyardReturnAndConditionalGuardsThree(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsThree) return hoistedResidualGraveyardReturnAndConditionalGuardsThree;

  const hoistedResidualEntryAndPermissionGuardsTwo = parseResidualEntryAndPermissionGuardsTwo(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsTwo) return hoistedResidualEntryAndPermissionGuardsTwo;

  const hoistedResidualManaPhasingAndAttachGuardsFour = parseResidualManaPhasingAndAttachGuardsFour(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsFour) return hoistedResidualManaPhasingAndAttachGuardsFour;

  const hoistedResidualEntryAndPermissionGuardsThree = parseResidualEntryAndPermissionGuardsThree(raw, sequence, clauseBody);
  if (hoistedResidualEntryAndPermissionGuardsThree) return hoistedResidualEntryAndPermissionGuardsThree;

  if (/^dredge\s+\d+$/i.test(raw)) {
    return parseStructuredKeywordActionGrant(raw, sequence);
  }

  const hoistedResidualManaPhasingAndAttachGuardsFive = parseResidualManaPhasingAndAttachGuardsFive(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsFive) return hoistedResidualManaPhasingAndAttachGuardsFive;

  if (/^miracle\s+(?:\{[^}]+\})+$/i.test(raw)) {
    return parseStructuredKeywordActionGrant(raw, sequence);
  }

  if (/^crew\s+\d+(?:\s+cycling\s+(?:\{[^}]+\})+)?$/i.test(raw)) {
    return parseStructuredKeywordActionGrant(raw, sequence) ?? staticMetadata('keyword action', raw);
  }

  if (/^soulshift\s+\d+$/i.test(raw)) {
    return parseStructuredKeywordActionGrant(raw, sequence);
  }

  const hoistedResidualEntryAndPermissionGuardsFour = parseResidualEntryAndPermissionGuardsFour(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsFour) return hoistedResidualEntryAndPermissionGuardsFour;

  const hoistedResidualManaPhasingAndAttachGuardsSix = parseResidualManaPhasingAndAttachGuardsSix(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsSix) return hoistedResidualManaPhasingAndAttachGuardsSix;

  const hoistedResidualEntryAndPermissionGuardsFive = parseResidualEntryAndPermissionGuardsFive(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsFive) return hoistedResidualEntryAndPermissionGuardsFive;

  const hoistedResidualGraveyardReturnAndConditionalGuardsFour = parseResidualGraveyardReturnAndConditionalGuardsFour(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsFour) return hoistedResidualGraveyardReturnAndConditionalGuardsFour;

  const hoistedResidualEntryAndPermissionGuardsSix = parseResidualEntryAndPermissionGuardsSix(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsSix) return hoistedResidualEntryAndPermissionGuardsSix;

  const hoistedResidualGraveyardReturnAndConditionalGuardsFive = parseResidualGraveyardReturnAndConditionalGuardsFive(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsFive) return hoistedResidualGraveyardReturnAndConditionalGuardsFive;

  const hoistedResidualEntryAndPermissionGuardsSeven = parseResidualEntryAndPermissionGuardsSeven(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsSeven) return hoistedResidualEntryAndPermissionGuardsSeven;

  const hoistedResidualGraveyardReturnAndConditionalGuardsSix = parseResidualGraveyardReturnAndConditionalGuardsSix(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsSix) return hoistedResidualGraveyardReturnAndConditionalGuardsSix;

  const hoistedResidualEntryAndPermissionGuardsEight = parseResidualEntryAndPermissionGuardsEight(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsEight) return hoistedResidualEntryAndPermissionGuardsEight;

  const hoistedResidualGraveyardReturnAndConditionalGuardsSeven = parseResidualGraveyardReturnAndConditionalGuardsSeven(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsSeven) return hoistedResidualGraveyardReturnAndConditionalGuardsSeven;

  const hoistedResidualEntryAndPermissionGuardsNine = parseResidualEntryAndPermissionGuardsNine(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsNine) return hoistedResidualEntryAndPermissionGuardsNine;

  const hoistedResidualManaPhasingAndAttachGuardsSeven = parseResidualManaPhasingAndAttachGuardsSeven(raw, sequence);
  if (hoistedResidualManaPhasingAndAttachGuardsSeven) return hoistedResidualManaPhasingAndAttachGuardsSeven;

  const hoistedResidualEntryAndPermissionGuardsTen = parseResidualEntryAndPermissionGuardsTen(raw, sequence);
  if (hoistedResidualEntryAndPermissionGuardsTen) return hoistedResidualEntryAndPermissionGuardsTen;

  const hoistedResidualNumberChangeAndGroupPtGuardsOne = parseResidualNumberChangeAndGroupPtGuardsOne(raw, sequence);
  if (hoistedResidualNumberChangeAndGroupPtGuardsOne) return hoistedResidualNumberChangeAndGroupPtGuardsOne;

  const hoistedResidualEntryAndPermissionGuardsEleven = parseResidualEntryAndPermissionGuardsEleven(raw, sequence, step);
  if (hoistedResidualEntryAndPermissionGuardsEleven) return hoistedResidualEntryAndPermissionGuardsEleven;

  const hoistedResidualNumberChangeAndGroupPtGuardsTwo = parseResidualNumberChangeAndGroupPtGuardsTwo(raw, sequence, step);
  if (hoistedResidualNumberChangeAndGroupPtGuardsTwo) return hoistedResidualNumberChangeAndGroupPtGuardsTwo;

  if (/^for\b/i.test(raw)) {
    if (/^for each opponent,\s+(?:exile|return)\s+/i.test(raw)) return null;
    return staticMetadata('for residual', raw);
  }

  const hoistedResidualTextChangeAndCatalogGuardsOne = parseResidualTextChangeAndCatalogGuardsOne(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsOne) return hoistedResidualTextChangeAndCatalogGuardsOne;

  const hoistedResidualGraveyardReturnAndConditionalGuardsEight = parseResidualGraveyardReturnAndConditionalGuardsEight(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsEight) return hoistedResidualGraveyardReturnAndConditionalGuardsEight;

  // Teferi's Puzzle Box / similar: put hand on bottom in any order, then draw that many.
  // Must run before pass40 (`^put\b`) and the late `^that player ` catch-all.
  // Use "that player's hand" (not "their hand") so repairMoveZoneStep / normalizeBoundPlayerZoneSelectorText
  // does not rewrite the selector into "target opponent's hand".
  {
    const handBottomThenDraw = raw.match(
      /^(?:that\s+player\s+)?puts?\s+the\s+cards\s+in\s+(your|their)\s+hand\s+on\s+the\s+bottom\s+of\s+(?:your|their)\s+library\s+in\s+any\s+order(?:,?\s+then\s+draws?\s+that\s+many\s+cards)?$/i,
    );
    if (handBottomThenDraw) {
      const possessive = String(handBottomThenDraw[1] || 'your').toLowerCase() === 'their' ? 'their' : 'your';
      const usesThatPlayer = /^that\s+player\b/i.test(raw) || possessive === 'their';
      const who = usesThatPlayer
        ? parsePlayerSelector('that player')
        : { kind: 'you' as const };
      const whatText = possessive === 'their'
        ? "the cards from that player's hand"
        : 'the cards in your hand';
      const steps: OracleEffectStep[] = [
        {
          kind: 'move_zone',
          what: parseObjectSelector(whatText),
          to: 'library',
          toRaw: usesThatPlayer ? "bottom of that player's library" : 'bottom of your library',
          libraryPlacement: 'bottom',
          raw: String(raw).replace(/,?\s+then\s+draws?\s+that\s+many\s+cards\.?$/i, '').trim(),
          ...sequence,
        } as unknown as OracleEffectStep,
      ];
      if (/then\s+draws?\s+that\s+many\s+cards/i.test(raw)) {
        steps.push({
          kind: 'draw',
          who,
          amount: { kind: 'reference_amount', raw: 'that many' },
          raw: `${usesThatPlayer ? 'that player draws' : 'draw'} that many cards`,
          sequence: 'then',
        } as unknown as OracleEffectStep);
      }
      return steps;
    }
  }

  const hoistedResidualGraveyardReturnAndConditionalGuardsNine = parseResidualGraveyardReturnAndConditionalGuardsNine(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsNine) return hoistedResidualGraveyardReturnAndConditionalGuardsNine;

  const hoistedResidualNumberChangeAndGroupPtGuardsThree = parseResidualNumberChangeAndGroupPtGuardsThree(raw, sequence);
  if (hoistedResidualNumberChangeAndGroupPtGuardsThree) return hoistedResidualNumberChangeAndGroupPtGuardsThree;

  const hoistedResidualTextChangeAndCatalogGuardsTwo = parseResidualTextChangeAndCatalogGuardsTwo(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsTwo) return hoistedResidualTextChangeAndCatalogGuardsTwo;

  const hoistedResidualNamedModeSearchGuardsOne = parseResidualNamedModeSearchGuardsOne(raw, sequence, step);
  if (hoistedResidualNamedModeSearchGuardsOne) return hoistedResidualNamedModeSearchGuardsOne;

  const hoistedResidualTextChangeAndCatalogGuardsThree = parseResidualTextChangeAndCatalogGuardsThree(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsThree) return hoistedResidualTextChangeAndCatalogGuardsThree;

  const hoistedResidualAttackerTokenAndMetadataGuardsOne = parseResidualAttackerTokenAndMetadataGuardsOne(raw, sequence, step);
  if (hoistedResidualAttackerTokenAndMetadataGuardsOne) return hoistedResidualAttackerTokenAndMetadataGuardsOne;

  const hoistedResidualTextChangeAndCatalogGuardsFour = parseResidualTextChangeAndCatalogGuardsFour(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsFour) return hoistedResidualTextChangeAndCatalogGuardsFour;

  const structuredKeywordAction = parseStructuredKeywordActionGrant(raw, sequence);
  if (structuredKeywordAction) return structuredKeywordAction;

  const hoistedResidualTextChangeAndCatalogGuardsFive = parseResidualTextChangeAndCatalogGuardsFive(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsFive) return hoistedResidualTextChangeAndCatalogGuardsFive;

  const hoistedResidualAttackerTokenAndMetadataGuardsTwo = parseResidualAttackerTokenAndMetadataGuardsTwo(raw, sequence);
  if (hoistedResidualAttackerTokenAndMetadataGuardsTwo) return hoistedResidualAttackerTokenAndMetadataGuardsTwo;

  const hoistedResidualTextChangeAndCatalogGuardsSix = parseResidualTextChangeAndCatalogGuardsSix(raw, sequence, step);
  if (hoistedResidualTextChangeAndCatalogGuardsSix) return hoistedResidualTextChangeAndCatalogGuardsSix;

  const hoistedResidualGraveyardReturnAndConditionalGuardsTen = parseResidualGraveyardReturnAndConditionalGuardsTen(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsTen) return hoistedResidualGraveyardReturnAndConditionalGuardsTen;

  const hoistedResidualTextChangeAndCatalogGuardsSeven = parseResidualTextChangeAndCatalogGuardsSeven(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsSeven) return hoistedResidualTextChangeAndCatalogGuardsSeven;

  const hoistedResidualGraveyardReturnAndConditionalGuardsEleven = parseResidualGraveyardReturnAndConditionalGuardsEleven(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsEleven) return hoistedResidualGraveyardReturnAndConditionalGuardsEleven;

  const hoistedResidualSelfReferenceAndLibraryOrderGuardsOne = parseResidualSelfReferenceAndLibraryOrderGuardsOne(raw, sequence);
  if (hoistedResidualSelfReferenceAndLibraryOrderGuardsOne) return hoistedResidualSelfReferenceAndLibraryOrderGuardsOne;

  const hoistedResidualTextChangeAndCatalogGuardsEight = parseResidualTextChangeAndCatalogGuardsEight(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsEight) return hoistedResidualTextChangeAndCatalogGuardsEight;

  const hoistedResidualSelfReferenceAndLibraryOrderGuardsTwo = parseResidualSelfReferenceAndLibraryOrderGuardsTwo(raw, sequence);
  if (hoistedResidualSelfReferenceAndLibraryOrderGuardsTwo) return hoistedResidualSelfReferenceAndLibraryOrderGuardsTwo;

  const hoistedResidualTextChangeAndCatalogGuardsNine = parseResidualTextChangeAndCatalogGuardsNine(raw, sequence);
  if (hoistedResidualTextChangeAndCatalogGuardsNine) return hoistedResidualTextChangeAndCatalogGuardsNine;

  const hoistedResidualSelfReferenceAndLibraryOrderGuardsThree = parseResidualSelfReferenceAndLibraryOrderGuardsThree(raw, sequence);
  if (hoistedResidualSelfReferenceAndLibraryOrderGuardsThree) return hoistedResidualSelfReferenceAndLibraryOrderGuardsThree;

  const hoistedResidualCombatCounterAndPaymentGuardsOne = parseResidualCombatCounterAndPaymentGuardsOne(raw, sequence);
  if (hoistedResidualCombatCounterAndPaymentGuardsOne) return hoistedResidualCombatCounterAndPaymentGuardsOne;

  const hoistedResidualGraveyardReturnAndConditionalGuardsTwelve = parseResidualGraveyardReturnAndConditionalGuardsTwelve(raw, sequence);
  if (hoistedResidualGraveyardReturnAndConditionalGuardsTwelve) return hoistedResidualGraveyardReturnAndConditionalGuardsTwelve;

  const hoistedResidualWardAndEvidenceGuardsOne = parseResidualWardAndEvidenceGuardsOne(raw, sequence);
  if (hoistedResidualWardAndEvidenceGuardsOne) return hoistedResidualWardAndEvidenceGuardsOne;

  const hoistedResidualCombatCounterAndPaymentGuardsTwo = parseResidualCombatCounterAndPaymentGuardsTwo(raw, sequence, step);
  if (hoistedResidualCombatCounterAndPaymentGuardsTwo) return hoistedResidualCombatCounterAndPaymentGuardsTwo;

  const hoistedResidualWardAndEvidenceGuardsTwo = parseResidualWardAndEvidenceGuardsTwo(raw, sequence);
  if (hoistedResidualWardAndEvidenceGuardsTwo) return hoistedResidualWardAndEvidenceGuardsTwo;

  const hoistedCurrentResidualUnknownStepTail = parseCurrentResidualUnknownStepTail(raw, sequence, clauseBody, step);
  if (hoistedCurrentResidualUnknownStepTail) return hoistedCurrentResidualUnknownStepTail;

  return null;
}


export { parseCurrentResidualUnknownStep };
