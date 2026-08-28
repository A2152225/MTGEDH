/**
 * Origin parent: rules-engine/src/oracleIRParserParseOracleTextToIR.ts
 * Cluster: reveal-top then "if it's a creature card that shares a creature type
 *   with a creature you control, you may cast it" (Descendants' Path family).
 * Public: mergeRevealTopShareTypeMayCastAbilities
 * Leaf must not import oracleIRParser.ts or oracleIRParserParseOracleTextToIR.ts.
 */

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

const SHARE_TYPE_CONDITION =
  /^(?:it(?:'s| is) a creature card that shares a creature type with a creature you control|it shares a creature type with a creature you control)$/i;

const BOTTOM_CONDITION =
  /^(?:you don't(?: cast it)?|you do not(?: cast it)?)$/i;

const REVEAL_TOP_SHARE_TYPE_MAY_CAST =
  /^(?:at the beginning of your upkeep,\s*)?reveal the top card of your library\.\s*if it(?:'s| is) a creature card that shares a creature type with a creature you control,\s*you may cast it without paying its mana cost\.\s*(?:if you don't(?: cast it)?|otherwise),?\s*put (?:it|that card) on the bottom of your library\.?$/i;

function abilityEffectText(ability: OracleIRAbility): string {
  return normalizeOracleText(
    String((ability as { effectText?: string }).effectText || (ability as { text?: string }).text || ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function isShareTypeConditionRaw(raw: string): boolean {
  return SHARE_TYPE_CONDITION.test(normalizeLeadingConditionalCondition(String(raw || '').trim()));
}

function isDontCastConditionRaw(raw: string): boolean {
  const normalized = normalizeLeadingConditionalCondition(String(raw || '').trim());
  if (BOTTOM_CONDITION.test(normalized)) return true;
  return /^otherwise$/i.test(normalized);
}

function isLibraryBottomMove(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'move_zone') return false;
  if (step.to !== 'library') return false;
  const what = String((step.what as { text?: string } | undefined)?.text || '').trim().toLowerCase();
  if (what && !/^(?:it|that card|the top card of your library)$/i.test(what)) return false;
  const toRaw = String(step.toRaw || '').toLowerCase();
  const placement = String((step as { libraryPlacement?: string }).libraryPlacement || '').toLowerCase();
  return placement === 'bottom' || /\bbottom\b/.test(toRaw);
}

function isDuringResolutionMayCast(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'grant_exile_permission') return false;
  if (step.duration !== 'during_resolution') return false;
  if (step.permission !== 'cast') return false;
  const what = String((step.what as { text?: string } | undefined)?.text || '').trim().toLowerCase();
  return /^(?:it|that card)$/i.test(what);
}

function buildRevealTopStep(raw: string): OracleEffectStep {
  return {
    kind: 'reveal_top',
    who: { kind: 'you' },
    amount: { kind: 'number', value: 1 },
    raw,
  } as OracleEffectStep;
}

function buildMayCastStep(raw: string): OracleEffectStep {
  return {
    kind: 'grant_exile_permission',
    who: { kind: 'you' },
    what: parseObjectSelector('it'),
    duration: 'during_resolution',
    permission: 'cast',
    withoutPayingManaCost: true,
    optional: true,
    raw,
  } as OracleEffectStep;
}

function buildBottomStep(raw: string): OracleEffectStep {
  return {
    kind: 'move_zone',
    what: parseObjectSelector('it'),
    to: 'library',
    toRaw: 'the bottom of your library',
    libraryPlacement: 'bottom',
    raw,
  } as OracleEffectStep;
}

function tryParseRevealTopShareTypeMayCastTemplate(rawText: string): OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  if (!REVEAL_TOP_SHARE_TYPE_MAY_CAST.test(normalized)) return null;

  return [
    buildRevealTopStep('Reveal the top card of your library'),
    {
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: "it's a creature card that shares a creature type with a creature you control",
      },
      steps: [buildMayCastStep('you may cast it without paying its mana cost')],
      elseSteps: [buildBottomStep('put it on the bottom of your library')],
      raw: "If it's a creature card that shares a creature type with a creature you control, you may cast it without paying its mana cost. If you don't cast it, put it on the bottom of your library.",
    } as OracleEffectStep,
  ];
}

function tryMergeRevealTopShareTypeMayCastSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] | null {
  if (!Array.isArray(steps) || steps.length < 2) return null;

  const merged: OracleEffectStep[] = [];
  let changed = false;

  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    const third = steps[index + 2];

    const isRevealTop =
      current?.kind === 'reveal_top' &&
      current.who?.kind === 'you' &&
      current.amount?.kind === 'number' &&
      Number(current.amount.value) === 1;

    const shareConditional =
      next?.kind === 'conditional' && isShareTypeConditionRaw(String(next.condition?.raw || ''))
        ? next
        : null;

    if (!isRevealTop || !shareConditional) {
      merged.push(current);
      continue;
    }

    const thenSteps = [...(shareConditional.steps || [])];
    const mayCastAlready = thenSteps.some((step) => isDuringResolutionMayCast(step));
    if (!mayCastAlready) {
      const unknownMayCast = thenSteps.find(
        (step) =>
          step.kind === 'unknown' &&
          /you may cast it without paying its mana cost/i.test(String(step.raw || '')),
      );
      if (unknownMayCast) {
        thenSteps.splice(thenSteps.indexOf(unknownMayCast), 1, buildMayCastStep(String(unknownMayCast.raw || '')));
      } else if (thenSteps.length === 0) {
        thenSteps.push(buildMayCastStep('you may cast it without paying its mana cost'));
      }
    } else {
      for (let thenIndex = 0; thenIndex < thenSteps.length; thenIndex += 1) {
        const thenStep = thenSteps[thenIndex];
        if (isDuringResolutionMayCast(thenStep) && thenStep.optional !== true) {
          thenSteps[thenIndex] = { ...thenStep, optional: true, withoutPayingManaCost: true };
        }
      }
    }

    let elseSteps = Array.isArray(shareConditional.elseSteps) ? [...shareConditional.elseSteps] : [];
    let consumedFollowup = 0;

    if (elseSteps.length === 0) {
      if (third?.kind === 'conditional' && isDontCastConditionRaw(String(third.condition?.raw || ''))) {
        elseSteps = [...(third.steps || [])];
        consumedFollowup = 1;
      } else if (isLibraryBottomMove(third)) {
        elseSteps = [third];
        consumedFollowup = 1;
      } else if (
        third?.kind === 'unknown' &&
        /^(?:if you don't(?: cast it)?|otherwise),?\s*put (?:it|that card) on the bottom of your library/i.test(
          normalizeOracleText(String(third.raw || '')).trim(),
        )
      ) {
        elseSteps = [buildBottomStep(String(third.raw || ''))];
        consumedFollowup = 1;
      }
    }

    if (elseSteps.length === 0) {
      elseSteps = [buildBottomStep('put it on the bottom of your library')];
    }

    merged.push(current);
    merged.push({
      ...shareConditional,
      steps: thenSteps,
      elseSteps,
    });
    changed = true;
    index += 1 + consumedFollowup;
  }

  return changed ? merged : null;
}

export function mergeRevealTopShareTypeMayCastAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  if (!Array.isArray(abilities) || abilities.length === 0) return abilities as OracleIRAbility[];

  return abilities.map((ability) => {
    const fromText = tryParseRevealTopShareTypeMayCastTemplate(abilityEffectText(ability));
    if (fromText) {
      return { ...ability, steps: fromText };
    }

    const fromSteps = tryMergeRevealTopShareTypeMayCastSteps(ability.steps || []);
    if (fromSteps) {
      return { ...ability, steps: fromSteps };
    }

    return ability;
  });
}
