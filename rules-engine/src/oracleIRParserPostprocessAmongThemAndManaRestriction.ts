/**
 * oracleIRParserPostprocessAmongThemAndManaRestriction.ts
 *
 * Early postprocess cluster for:
 * - "among them" hand-rest enrichment / player-choice lowering / revealed-chosen splits
 * - compound chosen-cards move_zone splits
 * - choose-creature-type prefix merges
 * - X-at-least alternate move destination upgrades
 * - add-mana spend-restriction follow-up merges
 *
 * Extracted from oracleIRParserPostprocess.ts; re-exported from that barrel.
 */

import type {
  OracleEffectStep,
  OracleIRAbility,
} from './oracleIR';
import {
  normalizeOracleText,
  parseObjectSelector,
} from './oracleIRParserUtils';

function appendFollowupSentence(base: string | undefined, followup: string | null): string {
  const trimmedBase = String(base || '')
    .trim()
    .replace(/[.\s]+$/g, '');
  const trimmedFollowup = String(followup || '')
    .trim()
    .replace(/^[.\s]+/g, '');

  if (!trimmedBase) return trimmedFollowup;
  if (!trimmedFollowup) return trimmedBase;
  return `${trimmedBase}. ${trimmedFollowup}`;
}

function enrichConditionalAmongThemHandRestStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'conditional' || !Array.isArray(step.steps) || step.steps.length === 0) {
    return step;
  }

  const parentRaw = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const restMatch = parentRaw.match(
    /\.\s*(put the rest on the bottom of your library in (?:a random|any) order)$/i
  );
  if (!restMatch) return step;

  let changed = false;
  const enrichedSteps = step.steps.map((inner) => {
    if (inner.kind !== 'move_zone' || inner.to !== 'hand') return inner;
    const whatText = String((inner.what as any)?.text || '').trim().toLowerCase();
    if (!/\bfrom among them\b/.test(whatText)) return inner;
    const innerRaw = normalizeOracleText(String(inner.raw || '')).trim();
    if (/\bthe rest\b/i.test(innerRaw)) return inner;
    changed = true;
    return {
      ...inner,
      raw: `${innerRaw}. ${String(restMatch[1] || '').trim()}`.trim(),
    };
  });

  if (!changed) return step;
  return { ...step, steps: enrichedSteps };
}

export function enrichConditionalAmongThemHandRestAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const enrichedSteps = ability.steps.map((step) => {
      const expanded = enrichConditionalAmongThemHandRestStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });
    return changed ? { ...ability, steps: enrichedSteps } : ability;
  });
}

function lowerAmongThemChoosePlayerChoiceStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'player_choice') return step;

  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const restMatch = raw.match(/\.\s*(put the rest on the bottom of your library in (?:a random|any) order)\.?$/i);
  const primary = restMatch ? raw.slice(0, restMatch.index).trim() : raw;
  const match = primary.match(
    /^choose any number of (.+?) cards from among them and put them onto the battlefield(?: tapped)?$/i
  );
  if (!match) return step;

  const typeText = String(match[1] || '').trim();
  const moveRaw = restMatch ? `${primary}. ${String(restMatch[1] || '').trim()}` : primary;
  return {
    kind: 'move_zone',
    what: { kind: 'raw', text: `any number of ${typeText} cards from among them` },
    to: 'battlefield',
    toRaw: /\btapped\b/i.test(primary) ? 'the battlefield tapped' : 'the battlefield',
    ...( /\btapped\b/i.test(primary) ? { entersTapped: true } : {}),
    raw: moveRaw,
  } as unknown as OracleEffectStep;
}

function trySplitAmongThemRevealedChosenThisWayStep(step: OracleEffectStep): OracleEffectStep[] | null {
  if (step.kind !== 'player_choice' && step.kind !== 'unknown') return null;

  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const chooseOnly = /^choose any number of .+? cards revealed this way$/i.test(raw);
  const splitMatch =
    chooseOnly ||
    /^choose any number of .+? cards revealed this way\.\s*put all nonland cards chosen this way onto the battlefield,\s*then put all land cards chosen this way onto the battlefield tapped,\s*then put the rest on the bottom of your library in a random order$/i.test(
      raw
    );
  if (!splitMatch) return null;

  return [
    {
      kind: 'move_zone',
      what: { kind: 'raw', text: 'all nonland cards chosen this way' },
      to: 'battlefield',
      toRaw: 'the battlefield',
      raw: 'Put all nonland cards chosen this way onto the battlefield',
    } as unknown as OracleEffectStep,
    {
      kind: 'move_zone',
      what: { kind: 'raw', text: 'all land cards chosen this way' },
      to: 'battlefield',
      toRaw: 'the battlefield tapped',
      entersTapped: true,
      raw: 'Put all land cards chosen this way onto the battlefield tapped',
    } as unknown as OracleEffectStep,
    {
      kind: 'move_zone',
      what: { kind: 'raw', text: 'the rest' },
      to: 'library',
      toRaw: 'the bottom of your library in a random order',
      raw: 'Put the rest on the bottom of your library in a random order',
    } as unknown as OracleEffectStep,
  ];
}

function pruneChoosePlaneswalkerBeforeLoyaltyAddSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const pruned: OracleEffectStep[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];
    if (
      current.kind === 'player_choice' &&
      /^choose a planeswalker you control$/i.test(String(current.raw || '').trim()) &&
      next?.kind === 'add_counter' &&
      /loyalty counters on it for each planeswalker destroyed this way/i.test(String(next.raw || ''))
    ) {
      continue;
    }
    pruned.push(current);
  }
  return pruned;
}

function isAmongThemRevealedChosenFollowupPutStep(step: OracleEffectStep): boolean {
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  return (
    /^put all nonland cards chosen this way onto the battlefield/i.test(raw) ||
    /^put all land cards chosen this way onto the battlefield(?: tapped)?/i.test(raw) ||
    /^put the rest on the bottom of your library in a random order/i.test(raw)
  );
}

export function upgradeXAtLeastAlternateMoveDestinations(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const nextSteps = ability.steps.map((step) => {
      if (step.kind !== 'move_zone') return step;
      const whatText = String((step.what as any)?.text || '').trim().toLowerCase();
      if (whatText !== 'those cards') return step;
      if (step.to !== 'hand') return step;
      const placementRaw = String(step.toRaw || step.raw || '');
      if (!/\band the rest on the bottom of your library in a random order\b/i.test(placementRaw)) {
        return step;
      }
      changed = true;
      return {
        ...step,
        xAtLeastAlternate: {
          threshold: 5,
          destinations: ['battlefield', 'hand'],
        },
      } as unknown as OracleEffectStep;
    });
    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

export function splitCompoundChosenCardsMoveZoneAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const nextSteps: OracleEffectStep[] = [];
    for (const step of ability.steps) {
      const raw = String(step.raw || (step as any).what?.text || '').trim();
      if (
        step.kind === 'move_zone' &&
        /^put one of the chosen cards onto the battlefield, the other chosen cards into your hand, and the rest into your graveyard\.?$/i.test(
          raw
        )
      ) {
        changed = true;
        nextSteps.push(
          {
            kind: 'move_zone',
            what: parseObjectSelector('one of the chosen cards'),
            to: 'battlefield',
            toRaw: 'the battlefield',
            battlefieldController: { kind: 'you' },
            raw: 'Put one of the chosen cards onto the battlefield',
            ...(step.sequence ? { sequence: step.sequence } : {}),
          } as unknown as OracleEffectStep,
          {
            kind: 'move_zone',
            what: parseObjectSelector('the other chosen cards'),
            to: 'hand',
            toRaw: 'your hand',
            raw: 'Put the other chosen cards into your hand',
            sequence: 'then',
          } as unknown as OracleEffectStep,
          {
            kind: 'move_zone',
            what: parseObjectSelector('the rest'),
            to: 'graveyard',
            toRaw: 'your graveyard',
            raw: 'Put the rest into your graveyard',
            sequence: 'then',
          } as unknown as OracleEffectStep
        );
        continue;
      }
      nextSteps.push(step);
    }
    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

export function mergeChooseCreatureTypePrefixAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  if (abilities.length < 2) return [...abilities];

  const merged: OracleIRAbility[] = [];
  for (let index = 0; index < abilities.length; index += 1) {
    const current = abilities[index];
    const next = abilities[index + 1];
    if (
      current &&
      next &&
      current.steps.length === 1 &&
      current.steps[0]?.kind === 'choose_creature_type' &&
      next.steps.some((step) => step.kind !== 'unknown')
    ) {
      merged.push({
        ...next,
        steps: [...current.steps, ...next.steps],
      });
      index += 1;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

export function lowerAmongThemChoosePlayerChoiceAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const loweredSteps: OracleEffectStep[] = [];
    for (let i = 0; i < ability.steps.length; i += 1) {
      const step = ability.steps[i];
      const split = trySplitAmongThemRevealedChosenThisWayStep(step);
      if (split) {
        changed = true;
        loweredSteps.push(...split);
        while (i + 1 < ability.steps.length && isAmongThemRevealedChosenFollowupPutStep(ability.steps[i + 1])) {
          i += 1;
        }
        continue;
      }
      const lowered = lowerAmongThemChoosePlayerChoiceStep(step);
      if (lowered !== step) changed = true;
      loweredSteps.push(lowered);
    }
    const prunedSteps = pruneChoosePlaneswalkerBeforeLoyaltyAddSteps(loweredSteps);
    return prunedSteps.length !== ability.steps.length || changed
      ? { ...ability, steps: prunedSteps }
      : ability;
  });
}

function parseManaSpendRestriction(step: OracleEffectStep | undefined): Extract<OracleEffectStep, { kind: 'add_mana' }>['spendRestriction'] | null {
  if (!step) return null;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();

  if (/^spend this mana only to cast (?:an? )?creature spells?$/i.test(normalized)) return 'creature_spell';
  if (/^spend this mana only to cast an? instant or sorcery spell$/i.test(normalized)) return 'instant_or_sorcery_spell';
  if (/^spend this mana only to cast artifact spells or activate abilities of artifacts$/i.test(normalized)) return 'artifact_spell_or_ability';
  if (/^spend this mana only to activate abilities$/i.test(normalized)) return 'activated_ability';
  return null;
}

export function mergeAddManaRestrictionFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      if (current.kind !== 'add_mana') {
        merged.push(current);
        continue;
      }

      const spendRestriction = parseManaSpendRestriction(next);
      if (spendRestriction) {
        merged.push({
          ...current,
          spendRestriction,
          raw: appendFollowupSentence(current.raw, String(next?.raw || '').trim()),
        });
        i += 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}
