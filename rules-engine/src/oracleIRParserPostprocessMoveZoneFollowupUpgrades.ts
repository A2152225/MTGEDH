/**
 * Move-zone follow-up splitting and upgrade passes for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 14822-15497 of the
 * pre-split file).
 * Cluster moved: multi-type graveyard return splitting, conjoined move-zone follow-up
 * splitting, the exiled-this-way return upgrade, ephemeral reanimation haste grants, the
 * countered-spell library-top replacement, the Spry and Mighty compound repair, the
 * battlefield-instead-of-hand rewrite, move-zone selector gap filling, and the misparse
 * prune that used to be named after batch 382.
 * Public entry symbols: mergeConditionalMoveZoneCounterFollowupAbilities,
 * mergeBattlefieldEntryCharacteristicFollowupAbilities,
 * mergeBattlefieldEntryAuraRewriteFollowupAbilities, upgradeExiledThisWayReturnMoveZoneSteps,
 * upgradeReanimationHasteGrantSteps, upgradeCounteredSpellLibraryTopReplacementSteps,
 * upgradeSpryAndMightyCompoundSteps, upgradeThoseCardsBattlefieldInsteadOfHandSteps,
 * upgradeMoveZoneSelectorGapSteps, pruneBatch382MisparseExecutableSteps,
 * expandDeterministicMoveZoneFollowupAbilities.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  mergeBattlefieldEntryAuraRewriteFollowups,
  mergeBattlefieldEntryCharacteristicFollowups,
  mergeStepCounterFollowups,
} from './oracleIRParserPostprocessBattlefieldEntryAndTopLibraryFollowups';
import { parseBattlefieldEntryCounterFollowupStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
} from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';

function parseReturnFromYourGraveyardToHandClause(
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  const normalized = normalizeOracleText(rawClause).replace(/^[,.;\s]+/g, '').trim();
  if (!normalized) return null;

  const match = normalized.match(/^(?:you\s+)?(may\s+)?return\s+(.+?\s+from\s+your\s+graveyard)\s+to\s+your\s+hand$/i);
  if (!match) return null;

  return {
    kind: 'move_zone',
    what: { kind: 'raw', text: String(match[2] || '').trim() },
    to: 'hand',
    toRaw: 'your hand',
    ...(match[1] ? { optional: true } : {}),
    raw: normalized,
  };
}

function splitMultiTypeReturnFromYourGraveyardToHand(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): readonly OracleEffectStep[] | null {
  if (step.to !== 'hand' || step.what.kind !== 'raw') return null;

  const normalizedWhat = normalizeOracleText(String(step.what.text || '')).trim();
  if (!/\bfrom your graveyard$/i.test(normalizedWhat)) return null;

  const withoutZone = normalizedWhat.replace(/\s+from your graveyard$/i, '').trim();
  const normalizedList = withoutZone
    .replace(/\s*,\s*and\s+/gi, ', ')
    .replace(/\s+and\s+/gi, ', ')
    .trim();
  const parts = normalizedList.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;

  const typedClauses: string[] = [];
  for (const part of parts) {
    const match = part.match(/^up to one target (.+?) card$/i);
    if (!match) return null;
    typedClauses.push(String(match[1] || '').trim());
  }

  return typedClauses.map(typeText => ({
    kind: 'move_zone',
    what: { kind: 'raw', text: `up to one target ${typeText} card from your graveyard` },
    to: 'hand',
    toRaw: step.toRaw,
    raw: `Return up to one target ${typeText} card from your graveyard to ${step.toRaw}`,
  }));
}

function parseExileAllGraveyardsAsMoveZone(
  step: Extract<OracleEffectStep, { kind: 'exile' }>
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.target.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String(step.target.text || '')).toLowerCase();
  if (targetText !== 'all graveyards') return null;

  return {
    kind: 'move_zone',
    what: { kind: 'raw', text: 'all cards from all graveyards' },
    to: 'exile',
    toRaw: 'exile',
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: step.raw,
  };
}

function splitConjoinedMoveZoneFollowup(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>
): readonly OracleEffectStep[] | null {
  const normalizedRaw = normalizeOracleText(String(step.raw || '')).replace(/[.]+$/g, '').trim();
  if (!normalizedRaw || !/\sand\s/i.test(normalizedRaw)) return null;

  const withMeta = <T extends OracleEffectStep>(candidate: T): T => candidate;
  const boundary = /\s+and\s+/gi;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(normalizedRaw)) !== null) {
    const firstRaw = normalizedRaw.slice(0, match.index).trim();
    const secondRaw = normalizedRaw.slice(match.index + match[0].length).trim();
    if (!firstRaw || !secondRaw) continue;

    const firstClause = String(normalizeClauseForParse(firstRaw).clause || '').trim();
    const secondClause = String(normalizeClauseForParse(secondRaw).clause || '').trim();
    if (!firstClause || !secondClause) continue;

    const parsedFirst = tryParseZoneAndRemovalClause({ clause: firstClause, rawClause: firstRaw, withMeta });
    if (!parsedFirst || parsedFirst.kind !== 'move_zone') continue;

    const parsedSecond =
      tryParseSimpleActionClause({ clause: secondClause, rawClause: secondRaw, withMeta }) ??
      tryParseSimpleCreateTokenClause({ clause: secondClause, rawClause: secondRaw, withMeta }) ??
      tryParseZoneAndRemovalClause({ clause: secondClause, rawClause: secondRaw, withMeta });
    if (!parsedSecond || parsedSecond.kind === 'unknown') continue;

    return [parsedFirst, parsedSecond];
  }

  return null;
}

function splitSimpleReturnFollowupClauses(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind === 'move_zone') {
      const conjoined = splitConjoinedMoveZoneFollowup(step);
      if (conjoined) {
        expanded.push(...conjoined);
        continue;
      }

      const split = splitMultiTypeReturnFromYourGraveyardToHand(step);
      if (split) {
        expanded.push(...split);
        continue;
      }
    }

    if (step.kind === 'exile') {
      const transformed = parseExileAllGraveyardsAsMoveZone(step);
      expanded.push(transformed ?? step);
      continue;
    }

    if (step.kind === 'gain_life') {
      const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim();
      const match = normalizedRaw.match(/^(you gain .+?\blife)\s+and\s+(you\s+(?:may\s+)?return .+? from your graveyard to your hand)$/i);
      if (match) {
        const returnStep = parseReturnFromYourGraveyardToHandClause(String(match[2] || '').trim());
        if (returnStep) {
          expanded.push({
            ...step,
            raw: String(match[1] || '').trim(),
          });
          expanded.push(returnStep);
          continue;
        }
      }
    }

    if (step.kind === 'sacrifice' && step.who.kind === 'each_opponent' && step.what.kind === 'raw') {
      const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim();
      const match = normalizedRaw.match(
        /^(each opponent sacrifices .+?)\s+and\s+(you\s+(?:may\s+)?return .+? from your graveyard to your hand)$/i
      );
      if (match) {
        const returnStep = parseReturnFromYourGraveyardToHandClause(String(match[2] || '').trim());
        const sacrificeWhatMatch = String(match[1] || '').trim().match(/^each opponent sacrifices\s+(.+)$/i);
        if (returnStep && sacrificeWhatMatch) {
          expanded.push({
            ...step,
            what: { kind: 'raw', text: String(sacrificeWhatMatch[1] || '').trim() },
            raw: String(match[1] || '').trim(),
          });
          expanded.push(returnStep);
          continue;
        }
      }
    }

    expanded.push(step);
  }

  return expanded;
}

export function mergeConditionalMoveZoneCounterFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const abilityMerged = abilities.map(ability => ({
    ...ability,
    steps: mergeStepCounterFollowups(ability.steps),
  }));

  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilityMerged.length; i += 1) {
    const current = abilityMerged[i];
    const next = abilityMerged[i + 1];

    if (
      current &&
      next &&
      current.steps.length > 0 &&
      next.steps.length === 1
    ) {
      const lastStep = current.steps[current.steps.length - 1];
      if (lastStep?.kind === 'move_zone' && lastStep.to === 'battlefield') {
          const parsed = parseBattlefieldEntryCounterFollowupStep(next.steps[0]);
        if (parsed) {
          const existingCounters = lastStep.withCounters || {};
          const combinedCounters: Record<string, number> = { ...existingCounters };
          for (const [counter, amount] of Object.entries(parsed.withCounters)) {
            combinedCounters[counter] = Math.max(0, Number(combinedCounters[counter] || 0) + amount);
          }

          const mergedSteps = [...current.steps];
          mergedSteps[mergedSteps.length - 1] = {
            ...lastStep,
            withCounters: combinedCounters,
            ...(parsed.condition ? { withCountersCondition: parsed.condition } : {}),
            raw: `${String(lastStep.raw || '').trim()}. ${parsed.raw}`.trim(),
          };

          merged.push({
            ...current,
            text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
            effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
            steps: mergedSteps,
          });
          i += 1;
          continue;
        }
      }
    }

    merged.push(current);
  }

  return merged;
}

export function mergeBattlefieldEntryCharacteristicFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => ({
    ...ability,
    steps: mergeBattlefieldEntryCharacteristicFollowups(ability.steps),
  }));
}

export function mergeBattlefieldEntryAuraRewriteFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => ({
    ...ability,
    steps: mergeBattlefieldEntryAuraRewriteFollowups(ability.steps),
  }));
}

export function upgradeExiledThisWayReturnMoveZoneSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: ability.steps.map((step) => {
      if (step.kind !== 'move_zone' || step.to !== 'battlefield' || step.what.kind !== 'raw') {
        return step;
      }
      const what = String(step.what.text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
      if (
        what !== 'all cards they exiled this way' &&
        what !== 'all cards exiled this way' &&
        what !== 'cards they exiled this way' &&
        what !== 'cards exiled this way'
      ) {
        return step;
      }
      return {
        ...step,
        battlefieldController: step.battlefieldController ?? { kind: 'owner_of_moved_cards' },
      };
    }),
  }));
}

function isEphemeralReanimationHasteGrant(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;
  const abilities = Array.isArray(step.abilities) ? step.abilities.map((a) => String(a).toLowerCase()) : [];
  if (abilities.length !== 1 || abilities[0] !== 'haste') return false;
  if (step.target?.kind !== 'raw') return false;
  const targetText = String(step.target.text || '').trim().toLowerCase();
  return /^(?:it|that creature|that permanent|that card|they)$/.test(targetText);
}

function isBattlefieldReturnMoveZone(step: OracleEffectStep): boolean {
  return step.kind === 'move_zone' && step.to === 'battlefield';
}

function upgradeReanimationHasteGrantStepsInList(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const upgraded = steps.map((step, index) => {
    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      return { ...step, steps: upgradeReanimationHasteGrantStepsInList(step.steps) };
    }
    if (step.kind === 'choose_mode') {
      return {
        ...step,
        modes: step.modes.map((mode) => ({
          ...mode,
          steps: upgradeReanimationHasteGrantStepsInList(mode.steps),
        })),
      };
    }
    if (step.kind === 'die_roll_results') {
      return {
        ...step,
        results: step.results.map((result) => ({
          ...result,
          steps: upgradeReanimationHasteGrantStepsInList(result.steps),
        })),
      };
    }
    if (index > 0 && isEphemeralReanimationHasteGrant(step) && isBattlefieldReturnMoveZone(steps[index - 1]!)) {
      const grant = step as Extract<OracleEffectStep, { kind: 'grant_temporary_ability' | 'grant_static_ability' }>;
      return {
        kind: 'grant_temporary_ability',
        target: grant.target,
        abilities: grant.abilities,
        duration: 'end_of_turn',
        raw: grant.raw,
        ...(grant.sequence ? { sequence: grant.sequence } : {}),
      } as unknown as OracleEffectStep;
    }
    return step;
  });
  return upgraded;
}

export function upgradeReanimationHasteGrantSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = upgradeReanimationHasteGrantStepsInList(ability.steps);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function mapCounteredSpellLibraryTopReplacementSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind === 'conditional') {
      return { ...step, steps: mapCounteredSpellLibraryTopReplacementSteps(step.steps) };
    }
    if (step.kind !== 'move_zone') return step;
    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();
    if (
      !/^put it on top of its owner(?:'s)? library instead of into that player(?:'s)? graveyard$/i.test(normalized) &&
      !/^put that card on its owner(?:'s)? choice of the top or bottom of its library instead of into that player(?:'s)? graveyard$/i.test(
        normalized
      ) &&
      !/^put that card on your choice of the top or bottom of its owner(?:'s)? library instead of into that player(?:'s)? graveyard$/i.test(
        normalized
      ) &&
      !/^put it on the bottom of its owner(?:'s)? library instead of into that player(?:'s)? graveyard$/i.test(
        normalized
      )
    ) {
      return step;
    }
    return {
      ...step,
      what: { kind: 'raw', text: 'that spell' },
      to: 'library',
      toRaw: /choice of the top or bottom/i.test(normalized)
        ? "its owner's library"
        : /^put it on top of its owner/i.test(normalized)
          ? "the top of its owner's library"
          : "the bottom of its owner's library",
    };
  });
}

export function upgradeCounteredSpellLibraryTopReplacementSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: mapCounteredSpellLibraryTopReplacementSteps(ability.steps),
  }));
}

function repairSpryAndMightySplitSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const hasExactTwoChoice = steps.some(
    (step) => step.kind === 'player_choice' && /choose exactly two creatures you control/i.test(String(step.raw || ''))
  );
  const brokenTrampleDraw = steps.find(
    (step) =>
      step.kind === 'draw' &&
      (step as any).amount?.kind === 'unknown' &&
      /chosen creatures gain trample/i.test(String(step.raw || ''))
  );
  if (!hasExactTwoChoice || !brokenTrampleDraw) return [...steps];

  const filtered = steps.filter((step) => step !== brokenTrampleDraw);
  const hasTrampleGrant = filtered.some(
    (step) => step.kind === 'grant_temporary_ability' && /trample/i.test(String(step.raw || ''))
  );
  if (hasTrampleGrant) return filtered;

  return [
    ...filtered,
    {
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('the chosen creatures'),
      abilities: ['trample'],
      duration: 'end_of_turn',
      raw: 'the chosen creatures gain trample until end of turn',
    } as unknown as OracleEffectStep,
  ];
}

export function upgradeSpryAndMightyCompoundSteps(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: repairSpryAndMightySplitSteps(ability.steps),
  }));
}

function mapThoseCardsBattlefieldInsteadOfHandSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind === 'conditional') {
      return { ...step, steps: mapThoseCardsBattlefieldInsteadOfHandSteps(step.steps) };
    }
    if (step.kind !== 'move_zone') return step;
    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();
    if (!/^put those cards onto the battlefield instead of putting them into your hand$/i.test(normalized)) {
      const oneInsteadMatch = normalized.match(
        /^you may put one of those cards with mana value (\d+) or less onto the battlefield instead of putting it into your hand$/i
      );
      if (!oneInsteadMatch) {
        return step;
      }
      const manaValueLte = String(oneInsteadMatch[1] || '').trim();
      return {
        ...step,
        what: { kind: 'raw', text: `one of those cards with mana value ${manaValueLte} or less` },
        to: 'battlefield',
        toRaw: 'the battlefield',
        battlefieldController: { kind: 'you' },
      };
    }
    return {
      ...step,
      what: { kind: 'raw', text: 'those cards' },
      to: 'battlefield',
      toRaw: 'the battlefield',
      battlefieldController: { kind: 'you' },
    };
  });
}

export function upgradeThoseCardsBattlefieldInsteadOfHandSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: mapThoseCardsBattlefieldInsteadOfHandSteps(ability.steps),
  }));
}

function mapMoveZoneSelectorGapSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      expanded.push({ ...step, steps: mapMoveZoneSelectorGapSteps(step.steps) } as unknown as OracleEffectStep);
      continue;
    }

    if (step.kind === 'move_zone') {
      const normalized = normalizeOracleText(String(step.raw || ''))
        .replace(/^[()\s]+/, '')
        .replace(/[.)\s]+$/g, '')
        .trim();

      if (/^return this creature to its owner's hand and manifest dread$/i.test(normalized)) {
        expanded.push({
          ...step,
          what: { kind: 'raw', text: 'this creature' },
          to: 'hand',
          toRaw: "its owner's hand",
          raw: "return this creature to its owner's hand",
        });
        expanded.push({
          kind: 'manifest_dread',
          who: { kind: 'you' },
          raw: 'manifest dread',
        });
        continue;
      }

      if (/^exile it from your graveyard$/i.test(normalized)) {
        expanded.push({ ...step, what: { kind: 'raw', text: 'it' } });
        continue;
      }
      if (/^put each of those cards into your hand instead$/i.test(normalized)) {
        expanded.push({ ...step, what: { kind: 'raw', text: 'those cards' } });
        continue;
      }
      if (
        /^put that card onto the battlefield under your control instead of into its owner(?:'s)? graveyard$/i.test(
          normalized
        )
      ) {
        expanded.push({
          ...step,
          what: { kind: 'raw', text: 'that card' },
          to: 'battlefield',
          toRaw: 'the battlefield under your control',
          battlefieldController: { kind: 'you' },
        });
        continue;
      }
      if (/^exile that many cards from your graveyard instead$/i.test(normalized)) {
        expanded.push({ ...step, what: { kind: 'raw', text: 'that many cards from your graveyard' } });
        continue;
      }
    }

    expanded.push(step);
  }

  return expanded;
}

export function upgradeMoveZoneSelectorGapSteps(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: mapMoveZoneSelectorGapSteps(ability.steps),
  }));
}

function normalizeBatch382StepText(raw: string): string {
  return normalizeOracleText(String(raw || ''))
    .replace(/\u2019/g, "'")
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
}

function isBatch382MisparseExecutableStep(step: OracleEffectStep): boolean {
  const rawOriginal = String(step.raw || '').replace(/\u2019/g, "'").trim();
  const whatOriginal = String((step as any).what?.text || (step as any).what?.raw || '').replace(/\u2019/g, "'").trim();
  const targetOriginal = String((step as any).target?.text || (step as any).target?.raw || '')
    .replace(/\u2019/g, "'")
    .trim();
  const raw = normalizeBatch382StepText(rawOriginal);
  const whatText = normalizeBatch382StepText(whatOriginal);
  const targetText = normalizeBatch382StepText(targetOriginal);

  if (step.kind === 'sacrifice') {
    if (/^sacrifice after [ivxlcdm]+\.?$/i.test(raw) || /^sacrifice after [ivxlcdm]+\.?$/i.test(rawOriginal)) {
      return true;
    }
    if (/^after [ivxlcdm]+\.?$/i.test(whatText) || /^after [ivxlcdm]+\.?$/i.test(whatOriginal)) return true;
    if (/^sacrifice (?:it|them) at the beginning of the next end step\.?$/i.test(raw)) return true;
    if (/^(?:it|them) at the beginning of the next end step\.?$/i.test(whatText)) return true;
    if (/rather than pay this spell'?s mana cost/i.test(rawOriginal)) return true;
    if (
      /^you may sacrifice (?:a |an |two |three |four )?(?:\w+\s+)*(?:mountains?|islands?|forests?|plains?|swamps?|cards?) rather than pay/i.test(
        rawOriginal
      )
    ) {
      return true;
    }
  }

  if (step.kind === 'cant_block' || step.kind === 'cant_attack' || step.kind === 'cant_activate_abilities') {
    const t = targetText || raw;
    const tOriginal = targetOriginal || rawOriginal;
    if (/^\(.*(?:can't block|cannot block|can't attack|cannot attack)/i.test(tOriginal)) return true;
    if (/^\((?:it|a creature with)/i.test(tOriginal) && /can'?t (?:block|attack)/i.test(rawOriginal)) return true;
    if (/^threshold\b/i.test(t) || /^threshold\b/i.test(tOriginal)) return true;
    if (/^as long as there are \d+ or more cards in your graveyard,.+can't block/i.test(tOriginal)) return true;
    if (
      /^enchanted creature can't block, and its activated abilities can't be activated/i.test(rawOriginal) ||
      /^enchanted creature can't block, and its activated abilities can't be activated/i.test(tOriginal) ||
      /^enchanted creature can't block, and its\b/i.test(tOriginal)
    ) {
      return true;
    }
    if (/^until your next turn,\s*those permanents can't attack or block and their activated abilities can't be activated/i.test(rawOriginal)) {
      return true;
    }
    if (/^\(?those creatures can't attack/i.test(tOriginal) && /can't attack/i.test(rawOriginal)) return true;
  }

  if (step.kind === 'sacrifice') {
    if (/^you may sacrifice a swamp\b/i.test(rawOriginal)) return true;
  }

  if (step.kind === 'cant_activate_abilities') {
    if (/^enchanted creature gets -1\/-1, and its activated abilities can't be activated/i.test(rawOriginal)) {
      return true;
    }
  }

  if (step.kind === 'grant_temporary_ability') {
    if (/^a creature dealt damage this way can't be regenerated this turn/i.test(rawOriginal)) return true;
  }

  if (step.kind === 'exile') {
    if (/^then exile (?:it|the spell)\.?$/i.test(raw) || /^then exile (?:it|the spell)\.?$/i.test(targetText)) {
      return true;
    }
    if (/^exile it instead\.\)$/i.test(rawOriginal) || /^exile it instead\.\)$/i.test(targetOriginal)) {
      return true;
    }
    if (/^exile the tokens at end of combat\.\)$/i.test(rawOriginal) || /^exile the tokens at end of combat\.\)$/i.test(targetOriginal)) {
      return true;
    }
  }

  if (step.kind === 'move_counters') {
    if (/^you may move a \+1\/\+1 counter from this land onto it\.\)$/i.test(rawOriginal)) {
      return true;
    }
  }

  if (step.kind === 'deal_damage') {
    if (/^\(each deals damage equal to its power to the other\.\)$/i.test(rawOriginal)) {
      return true;
    }
  }

  if (step.kind === 'animate_permanent') {
    if (/^awaken \d/i.test(rawOriginal) && /\(if you cast this spell for/i.test(rawOriginal)) return true;
    if (/^awaken \d/i.test(targetOriginal) && /\(if you cast this spell for/i.test(targetOriginal)) return true;
  }

  return false;
}

function mapBatch382PruneSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    if (isBatch382MisparseExecutableStep(step)) continue;

    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      expanded.push({ ...step, steps: mapBatch382PruneSteps(step.steps) } as unknown as OracleEffectStep);
      continue;
    }

    if (step.kind === 'choose_mode') {
      expanded.push({
        ...step,
        modes: step.modes.map((mode) => ({
          ...mode,
          steps: mapBatch382PruneSteps(mode.steps || []),
        })),
      } as unknown as OracleEffectStep);
      continue;
    }

    expanded.push(step);
  }

  return expanded;
}

export function pruneBatch382MisparseExecutableSteps(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = mapBatch382PruneSteps(ability.steps || []);
    if (steps.length === ability.steps.length && steps.every((step, index) => step === ability.steps[index])) {
      return ability;
    }
    return { ...ability, steps };
  });
}

export function expandDeterministicMoveZoneFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => ({
    ...ability,
    steps: splitSimpleReturnFollowupClauses(ability.steps),
  }));
}

export { parseReturnFromYourGraveyardToHandClause, splitConjoinedMoveZoneFollowup };
