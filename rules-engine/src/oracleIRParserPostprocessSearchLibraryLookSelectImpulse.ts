/**
 * oracleIRParserPostprocessSearchLibraryLookSelectImpulse.ts
 *
 * Early postprocess merge/upgrade cluster for:
 * - global impulse permission upgrades
 * - search_library follow-up merges (hand / top / shuffle)
 * - look_select_top follow-up merges (+ reveal follow-ups, repeat-this-process expansion)
 *
 * Extracted from oracleIRParserPostprocess.ts; re-exported from that barrel.
 */

import type {
  OracleEffectStep,
  OracleIRAbility,
} from './oracleIR';
import { cleanImpulseClause } from './oracleIRParserImpulseClauseUtils';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import {
  normalizeOracleText,
  parseQuantity,
  splitIntoClauses,
} from './oracleIRParserUtils';

type GlobalExiledWithSourceImpulsePermission = {
  readonly duration: 'as_long_as_control_source';
  readonly permission: 'play' | 'cast';
  readonly rawClause: string;
};

type GlobalLooseImpulsePermission = {
  readonly duration:
    | 'this_turn'
    | 'during_resolution'
    | 'during_next_turn'
    | 'until_end_of_next_turn'
    | 'until_next_turn'
    | 'until_next_upkeep'
    | 'until_next_end_step'
    | 'until_end_of_combat_on_next_turn';
  readonly permission: 'play' | 'cast';
  readonly rawClause: string;
};

function parseGlobalExiledWithSourceImpulsePermission(
  rawClause: string
): GlobalExiledWithSourceImpulsePermission | null {
  const normalized = normalizeOracleText(rawClause);
  if (!normalized) return null;

  let clause = normalized
    .trim()
    .replace(/^then\b\s*/i, '')
    .replace(/^once during each of your turns,?\s*/i, '')
    .replace(/,?\s+without paying (?:its|their|that spell(?:'|Ã¢â‚¬â„¢)s|those spells(?:'|Ã¢â‚¬â„¢)) mana costs?\b/gi, '')
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!clause) return null;
  const lower = clause.toLowerCase();

  const exiledWithSourceRef =
    "(?:the )?(?:cards?|spells?) exiled with (?:this (?:creature|artifact|enchantment|planeswalker|permanent|class|saga)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',Ã¢â‚¬â„¢]+)";

  {
    const m = lower.match(new RegExp(`^you may play a land or cast a spell from among ${exiledWithSourceRef}\\s*$`, 'i'));
    if (m) return { duration: 'as_long_as_control_source', permission: 'play', rawClause: normalized.trim() };
  }

  {
    const m = lower.match(
      new RegExp(
        `^(?:during your turn,?\\s*)?(?:(?:for as long as|as long as) (?![^,]*remain(?:s)? exiled)[^,]+,\\s*)?you may (play|cast) ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'as_long_as_control_source', permission: m[1] as any, rawClause: normalized.trim() };
  }

  {
    const m = lower.match(new RegExp(`^(?:during your turn,?\\s*)?you may play lands and cast spells from among ${exiledWithSourceRef}\\s*$`, 'i'));
    if (m) return { duration: 'as_long_as_control_source', permission: 'play', rawClause: normalized.trim() };
  }

  return null;
}

function parseGlobalLooseImpulsePermission(
  rawClause: string
): GlobalLooseImpulsePermission | null {
  const normalized = normalizeOracleText(rawClause);
  if (!normalized) return null;

  let clause = cleanImpulseClause(normalized)
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!clause) return null;

  clause = clause
    .replace(/^(they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['Ã¢â‚¬â„¢]s (?:controller|owner)) (?:may|can)\b/i, 'You may')
    .replace(/^((?:until|through)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['Ã¢â‚¬â„¢]s (?:controller|owner)) (?:may|can)\b/i, '$1 you may')
    .replace(/^(during your next turn,?)\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['Ã¢â‚¬â„¢]s (?:controller|owner)) (?:may|can)\b/i, '$1 you may');

  clause = clause.replace(/^((?:until|through)\b.*?)(?:,\s*|\s+)you (?:may|can)\s+(play|cast)\s+(.+)$/i, 'You may $2 $3 $1');

  clause = clause
    .replace(/,?\s+without paying (?:its|their|that spell(?:'|Ã¢â‚¬â„¢)s|those spells(?:'|Ã¢â‚¬â„¢)) mana costs?\b/gi, '')
    .replace(
      /,?\s+by paying\b.*\s+rather than paying (?:its|their|that spell(?:'|Ã¢â‚¬â„¢)s|those spells(?:'|Ã¢â‚¬â„¢)) mana costs?\.?\s*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();

  const lower = clause.toLowerCase();
  const permissionSubject =
    '(?:you|they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*[\'Ã¢â‚¬â„¢]s (?:controller|owner))';
  const objectRef =
    '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|(?:the )?card they exiled this way|(?:the )?cards they exiled this way|(?:the )?spell they exiled this way|(?:the )?spells they exiled this way)';
  const objectRefWithLimit = `(?:up to (?:a|an|\\d+|x|[a-z]+) of |one of )?${objectRef}`;

  {
    const m = lower.match(
      new RegExp(`^(?:until|through) (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) return { duration: 'until_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the )?end of (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_end_of_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the beginning of )?(?:your|their|the) next upkeep,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_upkeep', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the beginning of )?(?:your|their|the) next end step,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_end_step', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^until (?:the )?end of combat on (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_end_of_combat_on_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(`^during (?:your|their|the) next turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) return { duration: 'during_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^(?:until|through) (?:the )?end of (?:this |that )?turn,?\\s*${permissionSubject} (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'this_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} this turn\\s*$`, 'i'));
    if (m) return { duration: 'this_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the )?end of (?:this |that )?turn\\s*$`, 'i')
    );
    if (m) return { duration: 'this_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} during (?:your|their|the) next turn\\s*$`, 'i'));
    if (m) return { duration: 'during_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the )?end of (?:your|their|the) next turn\\s*$`, 'i')
    );
    if (m) return { duration: 'until_end_of_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^you (?:may|can) (play|cast) ${objectRefWithLimit} until (?:the )?end of combat on (?:your|their|the) next turn\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_end_of_combat_on_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:your|their|the) next turn\\s*$`, 'i')
    );
    if (m) return { duration: 'until_next_turn', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the beginning of )?(?:your|their|the) next upkeep\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_upkeep', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(
      new RegExp(
        `^you (?:may|can) (play|cast) ${objectRefWithLimit} (?:until|through) (?:the beginning of )?(?:your|their|the) next end step\\s*$`,
        'i'
      )
    );
    if (m) return { duration: 'until_next_end_step', permission: m[1] as any, rawClause: normalized.trim() };
  }
  {
    const m = lower.match(new RegExp(`^you (?:may|can) (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) return { duration: 'during_resolution', permission: m[1] as any, rawClause: normalized.trim() };
  }

  return null;
}

export function applyGlobalImpulseUpgrades(
  abilities: readonly OracleIRAbility[],
  normalizedOracleText: string
): OracleIRAbility[] {
  let nextAbilities = [...abilities];

  const globalPermission = (() => {
    const allClauses = splitIntoClauses(normalizedOracleText);
    for (const c of allClauses) {
      const parsed = parseGlobalExiledWithSourceImpulsePermission(c);
      if (parsed) return parsed;
    }
    return null;
  })();

  if (globalPermission) {
    nextAbilities = nextAbilities.map((ability) => {
      let changed = false;
      const upgradedSteps = ability.steps.map((step) => {
        if (step.kind !== 'exile_top') return step;
        if (step.who.kind !== 'you') return step;

        changed = true;
        const combinedRaw = `${String(step.raw || '').trim()} ${String(globalPermission.rawClause || '').trim()}`.trim();
        return {
          kind: 'impulse_exile_top',
          who: step.who,
          amount: step.amount,
          duration: globalPermission.duration,
          permission: globalPermission.permission,
          ...(step.optional ? { optional: step.optional } : {}),
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
        } as const;
      });

      return changed ? { ...ability, steps: upgradedSteps } : ability;
    });
  }

  const globalLoosePermission = (() => {
    const withoutParentheticalReminders = normalizedOracleText.replace(/\([^)]*\)/g, ' ');
    const allClauses = [
      ...splitIntoClauses(normalizedOracleText),
      ...splitIntoClauses(withoutParentheticalReminders),
    ];
    const permissionTail = withoutParentheticalReminders.match(
      /\b(?:you|they|that player|that opponent|its controller|its owner)\s+(?:may|can)\s+(?:play|cast)\s+(?:that card|those cards|them|it|the exiled card|the exiled cards)(?:\s+this turn)?(?:\s+without paying (?:its|their) mana cost)?/i,
    );
    if (permissionTail?.[0]) allClauses.push(permissionTail[0]);
    for (const c of allClauses) {
      const parsed = parseGlobalLooseImpulsePermission(c);
      if (parsed) return parsed;
    }
    return null;
  })();

  if (!globalLoosePermission) {
    return nextAbilities;
  }

  return nextAbilities.map((ability) => {
    let changed = false;
    const upgradedSteps = ability.steps.map((step) => {
      if (step.kind !== 'exile_top') return step;
      if (step.amount.kind === 'unknown' || step.amount.kind === 'reference_amount') {
        const raw = String((step.amount as any).raw || '').trim().toLowerCase();
        if (step.amount.kind === 'unknown' && !raw.startsWith('until ')) return step;
      } else if (step.amount.kind === 'number' && step.amount.value === 1) {
        const permissionRaw = String(globalLoosePermission.rawClause || '').toLowerCase();
        const singularPermissionRef =
          /\b(it|that card|the exiled card|that spell|the exiled spell|the card exiled this way|the spell exiled this way|the card they exiled this way|the spell they exiled this way)\b/i
            .test(permissionRaw);
        if (!singularPermissionRef) return step;
      } else if (step.amount.kind === 'number' && step.amount.value > 1) {
        const permissionRaw = String(globalLoosePermission.rawClause || '').toLowerCase();
        const pluralPermissionRef =
          /\b(them|those cards|those spells|the exiled cards|the exiled spells|cards exiled this way|spells exiled this way|cards they exiled this way|spells they exiled this way)\b/i
            .test(permissionRaw);
        if (!pluralPermissionRef) return step;
      } else {
        return step;
      }

      changed = true;
      const combinedRaw = `${String(step.raw || '').trim()} ${String(globalLoosePermission.rawClause || '').trim()}`.trim();
      return {
        kind: 'impulse_exile_top',
        who: step.who,
        amount: step.amount,
        duration: globalLoosePermission.duration,
        permission: globalLoosePermission.permission,
        ...(step.optional ? { optional: step.optional } : {}),
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
      } as const;
    });

    return changed ? { ...ability, steps: upgradedSteps } : ability;
  });
}

export function mergeRevealFollowupAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i++) {
    const current = abilities[i];
    const next = abilities[i + 1];

    const canMergeIntoTriggered =
      current?.type === 'triggered' &&
      Array.isArray(current.steps) &&
      current.steps.some((s) => s.kind === 'mill' && s.amount.kind === 'unknown' && /reveal a land card/i.test(String((s.amount as any).raw || '')));

    const nextLooksLikeRevealFollowup =
      (next?.type === 'static' || next?.type === 'spell') &&
      /revealed this way/i.test(String(next.effectText || next.text || ''));

    if (!canMergeIntoTriggered || !nextLooksLikeRevealFollowup) {
      merged.push(current);
      continue;
    }

    const followupSteps = (next.steps || []).filter((s) => s.kind !== 'unknown');
    merged.push({
      ...current,
      steps: [...current.steps, ...followupSteps],
    });
    i += 1;
  }

  return merged;
}

function parseSearchLibraryPutOnTopFollowupPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || next?.kind !== 'unknown') return null;

  const normalizedCurrent = normalizeOracleText(String(current.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const normalizedNext = normalizeOracleText(String(next.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const matchableCurrent = normalizedCurrent.replace(/^you\s+may\s+/i, '').trim();
  const matchableNext = normalizedNext.replace(/^then\s+/i, 'then ').trim();

  const searchMatch = matchableCurrent.match(
    /^search your library for (?:up to one |a |an )(?:(.+?)\s+)?card(?:,\s*reveal it)?$/i
  );
  if (!searchMatch) return null;

  if (!/^(?:then\s+)?shuffle(?: your library)? and put (?:it|that card) on top$/i.test(matchableNext)) {
    return null;
  }

  return {
    kind: 'search_library',
    who: { kind: 'you' },
    criteria: { kind: 'raw', text: String(searchMatch[1] || '').trim() },
    destination: 'top',
    ...(/reveal it/i.test(normalizedCurrent) ? { revealFound: true } : {}),
    shuffle: true,
    maxResults: 1,
    ...(current.optional ? { optional: true } : {}),
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedCurrent}, ${normalizedNext}`,
  };
}

function parseSearchLibraryToHandFollowupPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || next?.kind !== 'shuffle_library') return null;

  const normalizedCurrent = normalizeOracleText(String(current.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const normalizedNext = normalizeOracleText(String(next.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const matchableCurrent = normalizedCurrent.replace(/^you\s+may\s+/i, '').trim();

  const searchMatch = matchableCurrent.match(
    /^search your library for (?:up to one |a |an )(?:(.+?)\s+)?card(?:,\s*reveal it)?,\s*put (?:it|that card) into your hand$/i
  );
  if (!searchMatch) return null;

  return {
    kind: 'search_library',
    who: { kind: 'you' },
    criteria: { kind: 'raw', text: String(searchMatch[1] || '').trim() },
    destination: 'hand',
    ...(/reveal it/i.test(matchableCurrent) ? { revealFound: true } : {}),
    shuffle: true,
    maxResults: 1,
    ...(current.optional || next.optional ? { optional: true } : {}),
    ...(current.sequence ? { sequence: current.sequence } : next.sequence ? { sequence: next.sequence } : {}),
    raw: `${normalizedCurrent}, ${normalizedNext}`,
  };
}

export function mergeSearchLibraryPutOnTopFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const current = ability.steps[index];
      const next = ability.steps[index + 1];
      const combined = parseSearchLibraryPutOnTopFollowupPair(current, next);
      if (combined) {
        merged.push(combined);
        index += 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length &&
      merged.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps: merged };
  });
}

export function mergeSearchLibraryToHandFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const current = ability.steps[index];
      const next = ability.steps[index + 1];
      const combined = parseSearchLibraryToHandFollowupPair(current, next);
      if (combined) {
        merged.push(combined);
        index += 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

const SEARCH_LIBRARY_SHUFFLE_ORPHAN_PLAYER_KINDS = new Set([
  'you',
  'controller_of_referenced_object',
  'owner_of_referenced_object',
  'target_player',
  'that_player',
  'that_opponent',
]);

function isSearchLibraryShuffleOrphanFragmentStep(
  step: OracleEffectStep,
  searchStep?: Extract<OracleEffectStep, { kind: 'search_library' }>,
): boolean {
  const kind = String(step.kind || '');
  if (SEARCH_LIBRARY_SHUFFLE_ORPHAN_PLAYER_KINDS.has(kind)) return true;
  if (step.kind === 'raw' && searchStep) {
    const criteriaText = String((searchStep.criteria as { text?: string } | undefined)?.text || '')
      .trim()
      .toLowerCase();
    const fragmentText = String((step as { text?: string }).text || '').trim().toLowerCase();
    if (criteriaText && fragmentText === criteriaText) return true;
  }
  return false;
}

function parseSearchLibraryShuffleFollowupGroup(
  steps: readonly OracleEffectStep[],
  startIndex: number,
): { merged: OracleEffectStep; consumed: number } | null {
  const current = steps[startIndex];
  if (current.kind !== 'search_library' || current.shuffle === true) return null;

  let shuffleIndex = -1;
  for (let index = startIndex + 1; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.kind === 'shuffle_library') {
      shuffleIndex = index;
      break;
    }
    if (!isSearchLibraryShuffleOrphanFragmentStep(step, current)) {
      return null;
    }
  }
  if (shuffleIndex < 0) return null;

  const shuffleStep = steps[shuffleIndex] as Extract<OracleEffectStep, { kind: 'shuffle_library' }>;
  const normalizedCurrent = normalizeOracleText(String(current.raw || '')).replace(/[.]+$/g, '').trim();
  const normalizedShuffle = normalizeOracleText(String(shuffleStep.raw || '')).replace(/[.]+$/g, '').trim();

  return {
    merged: {
      ...current,
      shuffle: true,
      ...(current.optional || shuffleStep.optional ? { optional: true } : {}),
      ...(current.sequence ? { sequence: current.sequence } : shuffleStep.sequence ? { sequence: shuffleStep.sequence } : {}),
      raw: `${normalizedCurrent}, ${normalizedShuffle}`,
    },
    consumed: shuffleIndex - startIndex,
  };
}

export function mergeSearchLibraryShuffleFollowupAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const combined = parseSearchLibraryShuffleFollowupGroup(ability.steps, index);
      if (combined) {
        merged.push(combined.merged);
        index += combined.consumed;
        continue;
      }

      merged.push(ability.steps[index]);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

function cloneOracleEffectStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'conditional') {
    const nested = (step as Extract<OracleEffectStep, { kind: 'conditional' }>).steps || [];
    return {
      ...step,
      steps: nested.map(cloneOracleEffectStep),
    } as OracleEffectStep;
  }
  return { ...step };
}

function isShuffleIfSearchedThisWayStep(step: OracleEffectStep): boolean {
  if (step.kind === 'shuffle_library') return true;
  const conditionRaw = String((step as { condition?: { raw?: string } }).condition?.raw || '');
  const raw = `${String((step as { raw?: string }).raw || '')} ${conditionRaw}`;
  return /if you search(?:ed)? your library this way/i.test(raw);
}

function isRepeatThisProcessOncePlaceholder(step: OracleEffectStep): boolean {
  if (step.kind === 'conditional') {
    const nested = (step as Extract<OracleEffectStep, { kind: 'conditional' }>).steps || [];
    if (nested.length === 0) {
      return /repeat this process once/i.test(String((step as { raw?: string }).raw || ''));
    }
    return nested.every(isRepeatThisProcessOncePlaceholder);
  }
  const effectTextProp = (step as { effectText?: readonly string[] }).effectText;
  const effectText = Array.isArray(effectTextProp)
    ? effectTextProp.join(' ')
    : '';
  const raw = `${String((step as { raw?: string }).raw || '')} ${effectText}`;
  return /repeat this process once/i.test(raw);
}

function expandRepeatThisProcessOnceSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const recursed = steps.map((step) => {
    if (step.kind !== 'conditional') return step;
    const conditional = step as Extract<OracleEffectStep, { kind: 'conditional' }>;
    const nested = expandRepeatThisProcessOnceSteps(conditional.steps || []);
    const unchanged = nested.length === (conditional.steps || []).length
      && nested.every((inner, index) => inner === (conditional.steps || [])[index]);
    return unchanged ? step : { ...conditional, steps: nested } as OracleEffectStep;
  });

  const expanded: OracleEffectStep[] = [];
  for (const step of recursed) {
    if (!isRepeatThisProcessOncePlaceholder(step)) {
      expanded.push(step);
      continue;
    }

    const process = expanded.filter((prior) => !isShuffleIfSearchedThisWayStep(prior));
    if (process.length === 0) {
      expanded.push(step);
      continue;
    }

    const copies = process.map(cloneOracleEffectStep);
    if (step.kind === 'conditional') {
      expanded.push({
        ...(step as Extract<OracleEffectStep, { kind: 'conditional' }>),
        steps: copies,
      } as OracleEffectStep);
    } else {
      expanded.push(...copies);
    }
  }
  return expanded;
}

/** Copy the preceding process into "repeat this process once" conditionals (Claim Jumper / Balance-style). */
export function expandRepeatThisProcessOnceAbilities(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const expanded = expandRepeatThisProcessOnceSteps(ability.steps || []);
    const unchanged = expanded.length === (ability.steps || []).length
      && expanded.every((step, index) => step === (ability.steps || [])[index]);
    return unchanged ? ability : { ...ability, steps: expanded };
  });
}

function parseLookSelectTopPrimaryStep(params: {
  lookRaw: string;
  moveRaw: string;
  sequence?: 'then';
  optional?: boolean;
}): OracleEffectStep | null {
  const normalizedLook = normalizeOracleText(String(params.lookRaw || '')).replace(/[.]+$/g, '').trim();
  const normalizedMove = normalizeOracleText(String(params.moveRaw || '')).replace(/[.]+$/g, '').trim();
  if (!normalizedLook || !normalizedMove) return null;

  const lookMatch = normalizedLook.match(
    /^look at the top (a|an|\d+|x|[a-z]+) cards? of your library(?:\s*,\s*where\s+x\s+is\s+(.+))?$/i
  );
  if (!lookMatch) return null;

  const moveMatch = normalizedMove.match(
    /^(?:then\s+)?put (a|an|\d+|x|[a-z]+)(?: of (?:those cards|them))? into your hand and the rest (?:into your graveyard|on the bottom of your library(?: in (a random|any) order)?)$/i
  );
  if (!moveMatch) return null;

  const whereXRaw = String(lookMatch[2] || '').trim();
  const restIsLibraryBottom = /on the bottom of your library/i.test(normalizedMove);

  return {
    kind: 'look_select_top',
    who: { kind: 'you' },
    amount: parseQuantity(String(lookMatch[1] || '').trim()),
    ...(whereXRaw ? { whereX: { kind: 'where' as const, raw: whereXRaw } } : {}),
    choose: parseQuantity(String(moveMatch[1] || '').trim()),
    destination: 'hand',
    restDestination: restIsLibraryBottom ? 'library' : 'graveyard',
    ...(restIsLibraryBottom && /in a random order/i.test(normalizedMove) ? { restRandomOrder: true } : {}),
    ...(params.optional ? { optional: true } : {}),
    ...(params.sequence ? { sequence: params.sequence } : {}),
    raw: `${normalizedLook}. ${normalizedMove}`.trim(),
  };
}

function parseLookSelectTopFollowupPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || next?.kind !== 'move_zone') return null;

  const conditionalMatch = normalizeOracleText(String(current.raw || '')).match(/^if\s+([^,]+),\s*(look at the top .+)$/i);
  if (conditionalMatch) {
    const nested = parseLookSelectTopPrimaryStep({
      lookRaw: String(conditionalMatch[2] || '').trim(),
      moveRaw: String(next.raw || '').trim(),
      sequence: current.sequence,
      optional: current.optional,
    });
    if (!nested) return null;

    return {
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: normalizeLeadingConditionalCondition(String(conditionalMatch[1] || '').trim()),
      },
      steps: [nested],
      raw: `${normalizeOracleText(String(current.raw || '')).trim()}. ${normalizeOracleText(String(next.raw || '')).trim()}`.trim(),
    };
  }

  return parseLookSelectTopPrimaryStep({
    lookRaw: String(current.raw || '').trim(),
    moveRaw: String(next.raw || '').trim(),
    sequence: current.sequence,
    optional: current.optional,
  });
}

function parseLookTopMoveZoneSelectPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
): OracleEffectStep | null {
  if (current.kind !== 'look_top' || next?.kind !== 'move_zone') return null;

  const parsed = parseLookSelectTopPrimaryStep({
    lookRaw: String(current.raw || '').trim(),
    moveRaw: String(next.raw || '').trim(),
    sequence: current.sequence ?? next.sequence,
    optional: current.optional === true || next.optional === true,
  });
  if (!parsed || parsed.kind !== 'look_select_top') return null;

  const lookWho = (current as { who?: typeof parsed.who }).who;
  const lookAmount = (current as { amount?: typeof parsed.amount }).amount;
  const lookWhereX = (current as { whereX?: typeof parsed.whereX }).whereX;
  return {
    ...parsed,
    ...(lookWho ? { who: lookWho } : {}),
    ...(lookAmount ? { amount: lookAmount } : {}),
    ...(lookWhereX ? { whereX: lookWhereX } : {}),
  };
}

export function mergeLookSelectTopFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      let current = ability.steps[i];
      if (current.kind === 'conditional') {
        const nestedAbility = mergeLookSelectTopFollowupAbilities([{
          ...ability,
          steps: current.steps,
        }])[0];
        if (nestedAbility && nestedAbility.steps !== current.steps) {
          current = { ...current, steps: nestedAbility.steps };
        }
      }
      const next = ability.steps[i + 1];
      const combined = parseLookTopMoveZoneSelectPair(current, next)
        ?? parseLookSelectTopFollowupPair(current, next);
      if (combined) {
        merged.push(combined);
        i += 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length &&
      merged.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps: merged };
  });
}

