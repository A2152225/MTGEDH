import type {
  OracleClauseCondition,
  OracleEffectStep,
  OracleGraveyardAdditionalCost,
  OracleIRAbility,
  OraclePlayerSelector,
  OracleQuantity,
} from './oracleIR';
import { AbilityType } from './oracleTextParser';
import { parseKeywordActionAbility } from './oracleTextParserKeywordActionAbilities';
import { parseKeywordsFromOracleText } from './oracleTextParserSupport';
import { parseEffectLevelImpulsePermissionClause } from './oracleIRParserEffectImpulsePermission';
import { tryParseExileTopOnly } from './oracleIRParserExileTopOnly';
import { cleanImpulseClause, isIgnorableImpulseReminderClause } from './oracleIRParserImpulseClauseUtils';
import {
  inferZoneFromDestination,
  normalizeCounterName,
  normalizeLeadingConditionalCondition,
} from './oracleIRParserSacrificeHelpers';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { tryParseTemporaryModifyPtClause } from './oracleIRParserModifyPtClauses';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import { tryParseTokenCreationReplacementClause } from './oracleIRParserTokenReplacementClauses';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
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
    const allClauses = splitIntoClauses(normalizedOracleText);
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
      if (step.amount.kind === 'unknown') {
        const raw = String((step.amount as any).raw || '').trim().toLowerCase();
        if (!raw.startsWith('until ')) return step;
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
      next?.type === 'static' &&
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

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
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

function parseLookSelectTopPrimaryStep(params: {
  lookRaw: string;
  moveRaw: string;
  sequence?: 'then';
  optional?: boolean;
}): OracleEffectStep | null {
  const normalizedLook = normalizeOracleText(String(params.lookRaw || '')).replace(/[.]+$/g, '').trim();
  const normalizedMove = normalizeOracleText(String(params.moveRaw || '')).replace(/[.]+$/g, '').trim();
  if (!normalizedLook || !normalizedMove) return null;

  const lookMatch = normalizedLook.match(/^look at the top (a|an|\d+|x|[a-z]+) cards? of your library$/i);
  if (!lookMatch) return null;

  const moveMatch = normalizedMove.match(
    /^(?:then\s+)?put (a|an|\d+|x|[a-z]+)(?: of (?:those cards|them))? into your hand and the rest into your graveyard$/i
  );
  if (!moveMatch) return null;

  return {
    kind: 'look_select_top',
    who: { kind: 'you' },
    amount: parseQuantity(String(lookMatch[1] || '').trim()),
    choose: parseQuantity(String(moveMatch[1] || '').trim()),
    destination: 'hand',
    restDestination: 'graveyard',
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

export function mergeLookSelectTopFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const combined = parseLookSelectTopFollowupPair(current, next);
      if (combined) {
        merged.push(combined);
        i += 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

function parseLookChooseFromTopTriple(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined,
  after: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || after?.kind !== 'unknown') return null;

  const normalizedLook = normalizeOracleText(String(current.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  const normalizedRest = normalizeOracleText(String(after.raw || '')).replace(/[.]+$/g, '').trim();
  const restOrder = getBottomLibraryRestOrder(after);
  if (!restOrder) {
    return null;
  }

  const lookMatch = normalizedLook.match(/^look at the top (a|an|\d+|x|[a-z]+) cards? of your library$/i);
  if (!lookMatch) return null;

  const amount = parseQuantity(String(lookMatch[1] || '').trim());
  if (amount.kind !== 'number') return null;

  if (next?.kind === 'unknown') {
    const normalizedChoose = normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim();
    const revealToHandMatch = normalizedChoose.match(
      /^you may reveal (.+?) card from among them and put it into your hand$/i
    );
    if (!revealToHandMatch) return null;

    return {
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount,
      selectorText: String(revealToHandMatch[1] || '').trim().replace(/^an?\s+/i, ''),
      destination: 'hand',
      reveal: true,
      ...(restOrder === 'any' ? { restOrder: 'any' as const } : {}),
      optional: true,
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: `${normalizedLook}. ${normalizedChoose}. ${normalizedRest}`.trim(),
    };
  }

  if (next?.kind === 'move_zone' && next.optional === true && (next.to === 'hand' || next.to === 'exile')) {
    const selectorText = String((next.what as any)?.text || '').trim();
    const cleanedSelectorText = selectorText
      .replace(/\s+from\s+among\s+them$/i, '')
      .replace(/^an?\s+/i, '')
      .replace(/\s+card(?=\s+with\b|$)/i, '')
      .trim();
    if (!cleanedSelectorText) return null;

    return {
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount,
      selectorText: cleanedSelectorText,
      destination: next.to,
      ...(restOrder === 'any' ? { restOrder: 'any' as const } : {}),
      optional: true,
      ...(current.sequence ? { sequence: current.sequence } : {}),
      raw: `${normalizedLook}. ${normalizeOracleText(String(next.raw || '')).trim()}. ${normalizedRest}`.trim(),
    };
  }

  return null;
}

export function mergeLookChooseFromTopAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const after = ability.steps[i + 2];
      const combined = parseLookChooseFromTopTriple(current, next, after);
      if (combined) {
        merged.push(combined);
        i += 2;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

function getBottomLibraryRestOrder(step: OracleEffectStep | undefined): 'random' | 'any' | null {
  if (!step || (step.kind !== 'unknown' && step.kind !== 'move_zone')) return null;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (/^put the rest on the bottom of your library in a random order$/i.test(normalized)) {
    return 'random';
  }
  if (/^put the rest on the bottom of your library in any order$/i.test(normalized)) {
    return 'any';
  }
  return null;
}

function isTopLibrarySelectionLeadUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind === 'look_top' || step.kind === 'reveal_top') return true;
  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  return /^(?:if you do,\s+)?(?:look at|reveal) the top (?:a|an|\d+|x|[a-z]+) cards? of your library(?:, where .+)?$/i.test(normalized)
    || /^(?:if you do,\s+)?look at that many cards from the top of your library$/i.test(normalized)
    || /^reveal cards from the top of your library until you reveal an? .+ card$/i.test(normalized);
}

function isTopLibrarySelectionFollowupStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;
  if (step.kind !== 'unknown' && step.kind !== 'move_zone' && step.kind !== 'exile') return false;

  if (step.kind === 'move_zone' && step.what.kind === 'raw') {
    const normalizedWhat = normalizeOracleText(String(step.what.text || ''))
      .replace(/[.]+$/g, '')
      .trim();
    if (normalizedWhat === 'that card' && (step.to === 'battlefield' || step.to === 'hand' || step.to === 'exile')) {
      return true;
    }
  }

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  return /\bfrom among them\b/i.test(normalized)
    || /\bamong them\b/i.test(normalized)
    || /\bfrom among cards revealed this way\b/i.test(normalized)
    || /\bfrom among those cards\b/i.test(normalized)
    || /\bone of those cards\b/i.test(normalized);
}

function hasRecentTopLibrarySelectionContext(steps: readonly OracleEffectStep[], bottomTailIndex: number): boolean {
  const start = Math.max(0, bottomTailIndex - 5);
  for (let index = bottomTailIndex - 1; index >= start; index -= 1) {
    const step = steps[index];
    if (!step) continue;
    if (step.kind === 'look_top' || step.kind === 'reveal_top' || isTopLibrarySelectionFollowupStep(step)) {
      return true;
    }

    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .replace(/^[^-—]+[-—]\s*/i, '')
      .replace(/[.]+$/g, '')
      .trim();
    if (/^(?:if you do,\s+)?(?:look at|reveal) the top\b/i.test(normalized)
      || /^(?:if you do,\s+)?look at that many cards from the top of your library$/i.test(normalized)
      || /\bfrom among them\b/i.test(normalized)
      || /\bamong them\b/i.test(normalized)) {
      return true;
    }
  }
  return false;
}

function isTopLibrarySelectionFallbackStep(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();

  return /^if you don(?:'|’)?t, put it into your hand$/i.test(normalized);
}

export function mergeTopLibraryBottomRandomTailAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const after = ability.steps[i + 2];

      if (getBottomLibraryRestOrder(current) && hasRecentTopLibrarySelectionContext(ability.steps, i)) {
        const previous = merged.pop();
        if (previous) {
          merged.push({
            ...previous,
            raw: appendFollowupSentence(previous.raw, String(current.raw || '').trim()),
          });
        }
        continue;
      }

      if (current.kind === 'impulse_exile_top' && getBottomLibraryRestOrder(next)) {
        merged.push({
          ...current,
          raw: appendFollowupSentence(current.raw, String(next?.raw || '').trim()),
        });
        i += 1;
        continue;
      }

      if (current.kind === 'impulse_exile_top' && next?.kind === 'conditional' && getBottomLibraryRestOrder(after)) {
        merged.push(current);
        merged.push({
          ...next,
          raw: appendFollowupSentence(next.raw, String(after?.raw || '').trim()),
        });
        i += 2;
        continue;
      }

      if (
        isTopLibrarySelectionLeadUnknownStep(current)
        && isTopLibrarySelectionFollowupStep(next)
        && getBottomLibraryRestOrder(after)
      ) {
        merged.push(current);
        merged.push({
          ...next,
          raw: appendFollowupSentence(next.raw, String(after?.raw || '').trim()),
        });
        i += 2;
        continue;
      }

      if (
        isTopLibrarySelectionLeadUnknownStep(current)
        && isTopLibrarySelectionFollowupStep(next)
        && after?.kind === 'conditional'
        && getBottomLibraryRestOrder(ability.steps[i + 3])
      ) {
        merged.push(current);
        merged.push(next);
        merged.push({
          ...after,
          raw: appendFollowupSentence(after.raw, String(ability.steps[i + 3]?.raw || '').trim()),
        });
        i += 3;
        continue;
      }

      if (
        isTopLibrarySelectionLeadUnknownStep(current)
        && isTopLibrarySelectionFollowupStep(next)
        && isTopLibrarySelectionFallbackStep(after)
        && getBottomLibraryRestOrder(ability.steps[i + 3])
      ) {
        merged.push(current);
        merged.push(next);
        merged.push({
          ...after,
          raw: appendFollowupSentence(after.raw, String(ability.steps[i + 3]?.raw || '').trim()),
        });
        i += 3;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

function parseManaSpendRestriction(step: OracleEffectStep | undefined): Extract<OracleEffectStep, { kind: 'add_mana' }>['spendRestriction'] | null {
  if (!step || step.kind !== 'unknown') return null;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();

  if (/^spend this mana only to cast an? creature spell$/i.test(normalized)) return 'creature_spell';
  if (/^spend this mana only to cast an? instant or sorcery spell$/i.test(normalized)) return 'instant_or_sorcery_spell';
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

function parseConditionalBattlefieldEntryCounters(rawClause: string): {
  readonly condition: OracleClauseCondition;
  readonly withCounters: Record<string, number>;
} | null {
  const normalized = normalizeOracleText(rawClause)
    .replace(/^spell mastery\s*[^a-z0-9]+\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^if\s+(.+?),\s+that creature enters with\s+(a|an|\d+|x|[a-z]+)\s+additional\s+(.+?)\s+counters?\s+on\s+it$/i
  );
  if (!match) return null;
  const amount = parseQuantity(String(match[2] || '').trim());
  if (amount.kind !== 'number' || amount.value <= 0) return null;

  const counter = normalizeCounterName(String(match[3] || '').trim());
  if (!counter) return null;

  return {
    condition: { kind: 'if', raw: String(match[1] || '').trim() },
    withCounters: { [counter]: Math.max(0, amount.value | 0) },
  };
}

function parseTopLibraryInfoOwner(ownerRaw: string): OraclePlayerSelector | null {
  const normalized = normalizeOracleText(ownerRaw)
    .replace(/[.]+$/g, '')
    .trim();

  if (normalized === 'your') return { kind: 'you' };
  if (normalized === "target player's" || normalized === "that player's") return { kind: 'target_player' };
  if (normalized === "target opponent's" || normalized === "that opponent's") return { kind: 'target_opponent' };
  return null;
}

function parseStandaloneTopLibraryInfoUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const groupMatch = normalized.match(
    /^(each player|each opponent|each other player) reveals the top (?:(a|an|\d+|x|[a-z]+) cards?|card) of their library$/i
  );
  if (groupMatch) {
    return {
      kind: 'reveal_top',
      who: parsePlayerSelector(String(groupMatch[1] || '').trim()),
      amount: groupMatch[2] ? parseQuantity(String(groupMatch[2] || '').trim()) : { kind: 'number', value: 1 },
      ...(step.optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: String(step.raw || '').trim(),
    } as OracleEffectStep;
  }

  const match = normalized.match(
    /^(?:you may\s+)?(look at|reveal) the top (?:(a|an|\d+|x|[a-z]+) cards?|card) of (your|target player's|target opponent's|that player's|that opponent's) library$/i
  );
  if (!match) return null;

  const who = parseTopLibraryInfoOwner(String(match[3] || '').trim());
  if (!who) return null;

  return {
    kind: /^reveal/i.test(String(match[1] || '').trim()) ? 'reveal_top' : 'look_top',
    who,
    amount: match[2] ? parseQuantity(String(match[2] || '').trim()) : { kind: 'number', value: 1 },
    ...(step.optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  } as OracleEffectStep;
}

export function expandStandaloneTopLibraryInfoAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      return parseStandaloneTopLibraryInfoUnknownStep(step) || step;
    });

    return nextSteps.every((step, index) => step === ability.steps[index]) ? ability : { ...ability, steps: nextSteps };
  });
}

export function mergeKinshipRevealConditionalAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const mergedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      const next = ability.steps[index + 1];
      const third = ability.steps[index + 2];

      const normalizedRevealGate =
        next?.kind === 'unknown'
          ? normalizeOracleText(String(next.raw || ''))
              .replace(/^then\b\s*/i, '')
              .replace(/[.]+$/g, '')
              .trim()
          : '';
      const kinshipRevealMatch = normalizedRevealGate.match(
        /^if\s+(it|that card)\s+shares a creature type with\s+(this creature|this permanent),\s+you may reveal it$/i
      );
      const isIfYouDoConditional =
        third?.kind === 'conditional' &&
        normalizeLeadingConditionalCondition(String(third.condition?.raw || '').trim()) === 'you do';

      if (
        step?.kind === 'look_top' &&
        step.who.kind === 'you' &&
        step.amount.kind === 'number' &&
        step.amount.value === 1 &&
        kinshipRevealMatch &&
        isIfYouDoConditional
      ) {
        const conditionSubject = String(kinshipRevealMatch[1] || 'it').trim().toLowerCase();
        const conditionObject = String(kinshipRevealMatch[2] || 'this creature').trim().toLowerCase();
        const combinedRaw = `${String(next?.raw || '').trim()} ${String(third?.raw || '').trim()}`.trim();

        mergedSteps.push(step);
        mergedSteps.push({
          kind: 'conditional',
          condition: { kind: 'if', raw: `${conditionSubject} shares a creature type with ${conditionObject}` },
          steps: [
            {
              kind: 'reveal_top',
              who: step.who,
              amount: step.amount,
              optional: true,
              raw: 'You may reveal the top card of your library.',
            },
            third,
          ],
          ...(next?.sequence ? { sequence: next.sequence } : third?.sequence ? { sequence: third.sequence } : {}),
          raw: combinedRaw,
        });
        changed = true;
        index += 2;
        continue;
      }

      mergedSteps.push(step);
    }

    return changed ? { ...ability, steps: mergedSteps } : ability;
  });
}

function getSingleCardTopLibraryReferenceText(step: OracleEffectStep): string | null {
  if ((step.kind !== 'look_top' && step.kind !== 'reveal_top') || step.amount.kind !== 'number' || step.amount.value !== 1) {
    return null;
  }

  if (step.who.kind === 'you') return 'the top card of your library';
  if (step.who.kind === 'target_player') return "the top card of target player's library";
  if (step.who.kind === 'target_opponent') return "the top card of target opponent's library";
  return null;
}

function rewriteTopLibraryMoveZoneReference(step: OracleEffectStep, replacementText: string): OracleEffectStep {
  if (step.kind !== 'move_zone' || (step.what as any)?.kind !== 'raw') return step;

  const currentText = normalizeOracleText(String((step.what as any)?.text || ''));
  if (currentText !== 'it' && currentText !== 'that card') return step;

  return {
    ...step,
    what: { kind: 'raw', text: replacementText },
  };
}

function rewriteTopLibraryReferenceInsideConditional(step: OracleEffectStep, replacementText: string): OracleEffectStep {
  if (step.kind !== 'conditional') return step;

  const nextNestedSteps = step.steps.map(nested => rewriteTopLibraryMoveZoneReference(nested, replacementText));
  return nextNestedSteps.every((nested, index) => nested === step.steps[index])
    ? step
    : { ...step, steps: nextNestedSteps };
}

export function bindImmediateTopLibraryReferenceFollowups(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!Array.isArray(ability.steps) || ability.steps.length < 2) return ability;

    const rewritten = [...ability.steps];
    let changed = false;

    for (let i = 0; i < rewritten.length - 1; i += 1) {
      const replacementText = getSingleCardTopLibraryReferenceText(rewritten[i]);
      if (!replacementText) continue;

      const next = rewritten[i + 1];
      const rewrittenNext =
        next.kind === 'conditional'
          ? rewriteTopLibraryReferenceInsideConditional(next, replacementText)
          : rewriteTopLibraryMoveZoneReference(next, replacementText);

      if (rewrittenNext !== next) {
        rewritten[i + 1] = rewrittenNext;
        changed = true;
      }
    }

    return changed ? { ...ability, steps: rewritten } : ability;
  });
}

function mergeStepCounterFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (
      current?.kind === 'move_zone' &&
      current.to === 'battlefield' &&
      next?.kind === 'unknown'
    ) {
      const parsed = parseConditionalBattlefieldEntryCounters(next.raw);
      if (parsed) {
        const existingCounters = current.withCounters || {};
        const combinedCounters: Record<string, number> = { ...existingCounters };
        for (const [counter, amount] of Object.entries(parsed.withCounters)) {
          combinedCounters[counter] = Math.max(0, Number(combinedCounters[counter] || 0) + amount);
        }

        merged.push({
          ...current,
          withCounters: combinedCounters,
          withCountersCondition: parsed.condition,
          raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
        });
        i += 1;
        continue;
      }
    }

    merged.push(current);
  }

  return merged;
}

const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function titleCaseTypeTerm(value: string): string {
  return String(value || '')
    .split('-')
    .map(part =>
      part
        .split(/\s+/g)
        .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word)
        .join(' ')
    )
    .join('-');
}

function parseBattlefieldEntryCharacteristicWords(value: string): {
  readonly addColors?: readonly string[];
  readonly addTypes?: readonly string[];
} {
  const normalized = String(value || '')
    .replace(/\band\b/gi, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return {};

  const addColors: string[] = [];
  const addTypes: string[] = [];
  for (const word of normalized.split(/\s+/g)) {
    const lower = String(word || '').trim().toLowerCase();
    if (!lower || lower === 'a' || lower === 'an') continue;

    const color = COLOR_WORD_TO_SYMBOL[lower];
    if (color) {
      if (!addColors.includes(color)) addColors.push(color);
      continue;
    }

    const typeName = titleCaseTypeTerm(lower);
    if (typeName && !addTypes.includes(typeName)) addTypes.push(typeName);
  }

  return {
    ...(addColors.length > 0 ? { addColors } : {}),
    ...(addTypes.length > 0 ? { addTypes } : {}),
  };
}

function parseBattlefieldEntryCharacteristicsFollowup(rawClause: string): {
  readonly condition?: OracleClauseCondition;
  readonly addColors?: readonly string[];
  readonly addTypes?: readonly string[];
} | null {
  let normalized = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  let condition: OracleClauseCondition | undefined;
  const leadingIfMatch = normalized.match(/^if\s+(.+?),\s+(.+)$/i);
  if (leadingIfMatch) {
    condition = { kind: 'if', raw: String(leadingIfMatch[1] || '').trim() };
    normalized = String(leadingIfMatch[2] || '').trim();
  }

  normalized = normalized.replace(/^it(?:'s| is)\b/i, 'it is');
  const match = normalized.match(
    /^(?:it|that card|that creature|that permanent)\s+is\s+(?:a|an)\s+(.+?)\s+in addition to its other (colors and types|types|creature types)$/i
  );
  if (!match) return null;

  const parsedWords = parseBattlefieldEntryCharacteristicWords(String(match[1] || '').trim());
  if (!parsedWords.addColors && !parsedWords.addTypes) return null;

  return {
    ...(condition ? { condition } : {}),
    ...(parsedWords.addColors ? { addColors: parsedWords.addColors } : {}),
    ...(parsedWords.addTypes ? { addTypes: parsedWords.addTypes } : {}),
  };
}

function mergeUniqueStrings(existing: readonly string[] | undefined, added: readonly string[] | undefined): readonly string[] | undefined {
  const merged: string[] = [];
  for (const list of [existing || [], added || []]) {
    for (const entry of list) {
      const normalized = String(entry || '').trim();
      if (normalized && !merged.includes(normalized)) merged.push(normalized);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

function mergeBattlefieldEntryCharacteristicsIntoMoveZone(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  parsed: {
    readonly condition?: OracleClauseCondition;
    readonly addColors?: readonly string[];
    readonly addTypes?: readonly string[];
  },
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.to !== 'battlefield') return null;
  if (!parsed.addColors && !parsed.addTypes) return null;
  if (
    step.battlefieldCharacteristicsCondition &&
    parsed.condition &&
    step.battlefieldCharacteristicsCondition.raw !== parsed.condition.raw
  ) {
    return null;
  }

  const mergedColors = mergeUniqueStrings(step.battlefieldAddColors, parsed.addColors);
  const mergedTypes = mergeUniqueStrings(step.battlefieldAddTypes, parsed.addTypes);

  return {
    ...step,
    ...(mergedColors ? { battlefieldAddColors: mergedColors } : {}),
    ...(mergedTypes ? { battlefieldAddTypes: mergedTypes } : {}),
    ...(step.battlefieldCharacteristicsCondition || parsed.condition
      ? { battlefieldCharacteristicsCondition: step.battlefieldCharacteristicsCondition || parsed.condition }
      : {}),
    raw: `${String(step.raw || '').trim()}. ${String(rawClause || '').trim()}`.trim(),
  };
}

function mergeBattlefieldEntryCharacteristicFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (next?.kind === 'unknown') {
      const parsed = parseBattlefieldEntryCharacteristicsFollowup(next.raw);
      if (parsed) {
        if (current?.kind === 'move_zone') {
          const mergedMove = mergeBattlefieldEntryCharacteristicsIntoMoveZone(current, parsed, next.raw);
          if (mergedMove) {
            merged.push(mergedMove);
            i += 1;
            continue;
          }
        }

        if (current?.kind === 'conditional') {
          const innerSteps = [...current.steps];
          const lastStep = innerSteps[innerSteps.length - 1];
          if (lastStep?.kind === 'move_zone') {
            const mergedMove = mergeBattlefieldEntryCharacteristicsIntoMoveZone(lastStep, parsed, next.raw);
            if (mergedMove) {
              innerSteps[innerSteps.length - 1] = mergedMove;
              merged.push({
                ...current,
                steps: innerSteps,
                raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
              });
              i += 1;
              continue;
            }
          }
        }

        if (current?.kind === 'schedule_delayed_trigger') {
          merged.push({
            ...current,
            effect: `${String(current.effect || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
            raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
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

function parseBattlefieldEntryAuraRewriteFollowup(rawClause: string): {
  readonly attachedTo: Extract<OracleEffectStep, { kind: 'move_zone' }>['battlefieldAttachedTo'];
  readonly setTypeLine: string;
  readonly setOracleText: string;
  readonly loseAllAbilities: true;
} | null {
  const normalized = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^it(?:'s| is)\s+an?\s+aura enchantment with enchant ([^"]+?) and "([^"]+)" and it loses all other abilities$/i
  );
  if (!match) return null;

  const enchantTarget = String(match[1] || '').trim();
  const grantedAbility = String(match[2] || '').trim();
  if (!enchantTarget || !grantedAbility) return null;

  return {
    attachedTo: parseObjectSelector(`a ${enchantTarget}`),
    setTypeLine: 'Enchantment - Aura',
    setOracleText: `Enchant ${enchantTarget}\n${grantedAbility}`,
    loseAllAbilities: true,
  };
}

function mergeBattlefieldEntryAuraRewriteIntoMoveZone(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  parsed: ReturnType<typeof parseBattlefieldEntryAuraRewriteFollowup>,
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.to !== 'battlefield' || !parsed) return null;
  if (step.battlefieldSetTypeLine || step.battlefieldSetOracleText) return null;

  return {
    ...step,
    battlefieldAttachedTo: step.battlefieldAttachedTo || parsed.attachedTo,
    battlefieldSetTypeLine: parsed.setTypeLine,
    battlefieldSetOracleText: parsed.setOracleText,
    battlefieldLoseAllAbilities: true,
    raw: `${String(step.raw || '').trim()}. ${String(rawClause || '').trim()}`.trim(),
  };
}

function parseBattlefieldEntryTreasureArtifactRewriteFollowup(rawClause: string): {
  readonly setTypeLine: string;
  readonly setOracleText: string;
} | null {
  const normalized = normalizeOracleText(rawClause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^it(?:'s| is)\s+a\s+treasure\s+artifact\s+with\s+"([^"]+)"\s*,?\s+and\s+it\s+loses\s+all\s+other\s+card\s+types$/i
  );
  if (!match) return null;

  const grantedAbility = String(match[1] || '').trim();
  if (!grantedAbility) return null;

  return {
    setTypeLine: 'Artifact - Treasure',
    setOracleText: grantedAbility,
  };
}

function mergeBattlefieldEntryTreasureArtifactRewriteIntoMoveZone(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  parsed: ReturnType<typeof parseBattlefieldEntryTreasureArtifactRewriteFollowup>,
  rawClause: string
): Extract<OracleEffectStep, { kind: 'move_zone' }> | null {
  if (step.to !== 'battlefield' || !parsed) return null;
  if (step.battlefieldSetTypeLine || step.battlefieldSetOracleText) return null;

  return {
    ...step,
    battlefieldSetTypeLine: parsed.setTypeLine,
    battlefieldSetOracleText: parsed.setOracleText,
    raw: `${String(step.raw || '').trim()}. ${String(rawClause || '').trim()}`.trim(),
  };
}

function mergeBattlefieldEntryAuraRewriteFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (next?.kind === 'unknown') {
      const parsed = parseBattlefieldEntryAuraRewriteFollowup(next.raw);
      const parsedTreasureArtifact = parseBattlefieldEntryTreasureArtifactRewriteFollowup(next.raw);
      if (parsed) {
        if (current?.kind === 'move_zone') {
          const mergedMove = mergeBattlefieldEntryAuraRewriteIntoMoveZone(current, parsed, next.raw);
          if (mergedMove) {
            merged.push(mergedMove);
            i += 1;
            continue;
          }
        }

        if (current?.kind === 'conditional') {
          const innerSteps = [...current.steps];
          const lastStep = innerSteps[innerSteps.length - 1];
          if (lastStep?.kind === 'move_zone') {
            const mergedMove = mergeBattlefieldEntryAuraRewriteIntoMoveZone(lastStep, parsed, next.raw);
            if (mergedMove) {
              innerSteps[innerSteps.length - 1] = mergedMove;
              merged.push({
                ...current,
                steps: innerSteps,
                raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
              });
              i += 1;
              continue;
            }
          }
        }

        if (current?.kind === 'schedule_delayed_trigger') {
          merged.push({
            ...current,
            effect: `${String(current.effect || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
            raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
          });
          i += 1;
          continue;
        }
      }

      if (parsedTreasureArtifact) {
        if (current?.kind === 'move_zone') {
          const mergedMove = mergeBattlefieldEntryTreasureArtifactRewriteIntoMoveZone(current, parsedTreasureArtifact, next.raw);
          if (mergedMove) {
            merged.push(mergedMove);
            i += 1;
            continue;
          }
        }

        if (current?.kind === 'conditional') {
          const innerSteps = [...current.steps];
          const lastStep = innerSteps[innerSteps.length - 1];
          if (lastStep?.kind === 'move_zone') {
            const mergedMove = mergeBattlefieldEntryTreasureArtifactRewriteIntoMoveZone(
              lastStep,
              parsedTreasureArtifact,
              next.raw
            );
            if (mergedMove) {
              innerSteps[innerSteps.length - 1] = mergedMove;
              merged.push({
                ...current,
                steps: innerSteps,
                raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
              });
              i += 1;
              continue;
            }
          }
        }
      }
    }

    merged.push(current);
  }

  return merged;
}

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
      next.steps.length === 1 &&
      next.steps[0]?.kind === 'unknown'
    ) {
      const lastStep = current.steps[current.steps.length - 1];
      if (lastStep?.kind === 'move_zone' && lastStep.to === 'battlefield') {
        const parsed = parseConditionalBattlefieldEntryCounters(next.steps[0].raw);
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
            withCountersCondition: parsed.condition,
            raw: `${String(lastStep.raw || '').trim()}. ${String(next.steps[0].raw || '').trim()}`.trim(),
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

export function expandDeterministicMoveZoneFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => ({
    ...ability,
    steps: splitSimpleReturnFollowupClauses(ability.steps),
  }));
}

function stripCopyItSuffix(step: Extract<OracleEffectStep, { kind: 'move_zone' }>): OracleEffectStep {
  const raw = String(step.raw || '').replace(/\s+and copy it\.?$/i, '').trim();
  const what =
    step.what.kind === 'raw'
      ? {
          ...step.what,
          text: String(step.what.text || '').replace(/\s+and copy it$/i, '').trim(),
        }
      : step.what;

  return {
    ...step,
    what,
    raw,
  };
}

export function expandMoveZoneCopiedSpellAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const expandedAbilities = abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const castTail = parseCopySpellCastTail(ability.steps[i + 2]);
      const retargetTail = castTail ? parseCopySpellRetargetTail(ability.steps[i + 3]) : null;

      if (
        current?.kind === 'move_zone' &&
        /\band copy it\.?$/i.test(String(current.raw || '')) &&
        next?.kind === 'unknown' &&
        /^you may cast the copy without paying its mana cost$/i.test(normalizeOracleText(String(next.raw || '')).replace(/[.]+$/g, '').trim())
      ) {
        expandedSteps.push(stripCopyItSuffix(current));
        expandedSteps.push({
          kind: 'copy_spell',
          subject: 'last_moved_card',
          withoutPayingManaCost: true,
          optional: true,
          raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
        });
        changed = true;
        i += 1;
        continue;
      }

      if (current?.kind === 'move_zone' && /\band copy it\.?$/i.test(String(current.raw || ''))) {
        expandedSteps.push(stripCopyItSuffix(current));
        expandedSteps.push({
          kind: 'copy_spell',
          subject: 'last_moved_card',
          raw: 'copy it',
        });
        changed = true;
        continue;
      }

      if (
        current?.kind === 'move_zone' &&
        next?.kind === 'unknown' &&
        /^copy that card$/i.test(normalizeUnknownStepText(next) || '') &&
        castTail !== null
      ) {
        expandedSteps.push(current);
        expandedSteps.push({
          kind: 'copy_spell',
          subject: 'last_moved_card',
          ...(castTail.castCost ? { castCost: castTail.castCost } : {}),
          ...(castTail.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
          ...(retargetTail ? { allowNewTargets: true } : {}),
          optional: true,
          raw: appendFollowupSentence(appendFollowupSentence(String(next.raw || '').trim(), castTail.raw), retargetTail),
        });
        changed = true;
        i += 2 + (retargetTail ? 1 : 0);
        continue;
      }

      expandedSteps.push(current);
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });

  const mergedAbilities: OracleIRAbility[] = [];
  let mergedChanged = false;

  for (let i = 0; i < expandedAbilities.length; i += 1) {
    const current = expandedAbilities[i];
    const next = expandedAbilities[i + 1];
    const currentSteps = current?.steps || [];
    const nextSteps = next?.steps || [];
    const currentLastStep = currentSteps[currentSteps.length - 1];
    const copyThatCardStep = nextSteps[0];
    const castTail = parseCopySpellCastTail(nextSteps[1]);
    const retargetTail = castTail ? parseCopySpellRetargetTail(nextSteps[2]) : parseCopySpellRetargetTail(nextSteps[1]);
    const consumedStepCount = 1 + (castTail ? 1 : 0) + (retargetTail ? 1 : 0);

    if (
      currentLastStep?.kind === 'move_zone' &&
      copyThatCardStep?.kind === 'unknown' &&
      /^copy that card$/i.test(normalizeUnknownStepText(copyThatCardStep) || '') &&
      nextSteps.length === consumedStepCount &&
      current?.type === next?.type
    ) {
      let mergedCopyStep: Extract<OracleEffectStep, { kind: 'copy_spell' }> = {
        kind: 'copy_spell',
        subject: 'last_moved_card',
        optional: true,
        raw: String(copyThatCardStep.raw || '').trim(),
      };

      if (castTail) {
        mergedCopyStep = applyCopySpellCastTail(mergedCopyStep, castTail);
      }

      if (retargetTail) {
        mergedCopyStep = {
          ...mergedCopyStep,
          allowNewTargets: true,
          raw: copySpellRawMentionsRetarget(mergedCopyStep.raw)
            ? mergedCopyStep.raw
            : appendFollowupSentence(mergedCopyStep.raw, retargetTail),
        };
      }

      mergedAbilities.push({
        ...current,
        text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
        effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
        steps: [...currentSteps, mergedCopyStep],
      });
      mergedChanged = true;
      i += 1;
      continue;
    }

    mergedAbilities.push(current);
  }

  return mergedChanged ? mergedAbilities : expandedAbilities;
}

function stepProvidesLastMovedCardContext(step: OracleEffectStep | undefined): boolean {
  if (!step) return false;

  if (step.kind === 'move_zone') {
    return true;
  }

  if (step.kind === 'unknown') {
    const normalized = normalizeUnknownStepText(step);
    return normalized
      ? /^(?:that player|target player|each player|you|an opponent|a player|its controller|their controller) exiles? .+ card(?:s)?\b/i.test(normalized) ||
          /^exile .+ card(?:s)?\b/i.test(normalized)
      : false;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const nestedSteps = step.steps || [];
    return stepProvidesLastMovedCardContext(nestedSteps[nestedSteps.length - 1]);
  }

  return false;
}

function appendDanglingCopySpellToTrailingContext(
  steps: readonly OracleEffectStep[],
  copyStep: Extract<OracleEffectStep, { kind: 'copy_spell' }>
): { steps: readonly OracleEffectStep[]; applied: boolean } {
  if (steps.length === 0) {
    return { steps, applied: false };
  }

  const lastStep = steps[steps.length - 1];

  if (lastStep.kind === 'conditional' || lastStep.kind === 'unless_pays_life' || lastStep.kind === 'unless_pays_mana') {
    const nestedSteps = lastStep.steps || [];
    const nestedResult = appendDanglingCopySpellToTrailingContext(nestedSteps, copyStep);
    if (nestedResult.applied) {
      return {
        steps: [
          ...steps.slice(0, -1),
          {
            ...lastStep,
            steps: nestedResult.steps,
          },
        ],
        applied: true,
      };
    }
  }

  if (!stepProvidesLastMovedCardContext(lastStep)) {
    return { steps, applied: false };
  }

  return {
    steps: [...steps, copyStep],
    applied: true,
  };
}

export function mergeDanglingCopySpellAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const mergedAbilities: OracleIRAbility[] = [];
  let changed = false;

  for (let index = 0; index < abilities.length; index += 1) {
    const current = abilities[index];
    const next = abilities[index + 1];
    const nextCopyStep =
      next?.type === 'static' &&
      next.steps.length === 1 &&
      next.steps[0]?.kind === 'copy_spell' &&
      next.steps[0]?.subject === 'last_moved_card'
        ? (next.steps[0] as Extract<OracleEffectStep, { kind: 'copy_spell' }>)
        : null;

    if (!nextCopyStep || current?.type === 'static') {
      mergedAbilities.push(current);
      continue;
    }

    const appended = appendDanglingCopySpellToTrailingContext(current.steps, nextCopyStep);
    if (!appended.applied) {
      mergedAbilities.push(current);
      continue;
    }

    mergedAbilities.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: appended.steps,
    });
    changed = true;
    index += 1;
  }

  return changed ? mergedAbilities : [...abilities];
}

function parseBattlefieldMoveHasteFollowupStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }> | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^(it|that card|that creature|that permanent) gains haste$/i);
  if (!match) return null;

  return {
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(String(match[1] || '').trim()),
    duration: 'end_of_turn',
    abilities: ['haste'],
    ...(step.optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  };
}

export function expandMoveZoneHasteFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const current = ability.steps[index];
      const next = ability.steps[index + 1];

      if (
        current?.kind === 'move_zone' &&
        current.to === 'battlefield' &&
        next?.kind === 'unknown'
      ) {
        const expanded = parseBattlefieldMoveHasteFollowupStep(next);
        if (expanded) {
          expandedSteps.push(current, expanded);
          changed = true;
          index += 1;
          continue;
        }
      }

      if (
        next?.kind === 'unknown' &&
        current?.kind === 'conditional' &&
        current.steps.length > 0 &&
        current.steps[current.steps.length - 1]?.kind === 'schedule_delayed_trigger'
      ) {
        const expanded = parseBattlefieldMoveHasteFollowupStep(next);
        if (expanded) {
          const nestedSteps = [...current.steps];
          const delayed = nestedSteps[nestedSteps.length - 1] as Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>;
          nestedSteps[nestedSteps.length - 1] = {
            ...delayed,
            effect: `${delayed.effect}. ${String(next.raw || '').trim()}`,
            raw: `${delayed.raw}. ${String(next.raw || '').trim()}`,
          };
          expandedSteps.push({ ...current, steps: nestedSteps });
          changed = true;
          index += 1;
          continue;
        }
      }

      expandedSteps.push(current);
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseLookTopChooseOneToHandRestToGraveyardBody(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  bodyClause: string
): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(bodyClause || ''))
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^look at the top (a|an|\d+|x|[a-z]+) cards? of your library,\s*then put one of those cards into your hand and the rest into your graveyard$/i
  );
  if (!match) return null;

  const amount = parseQuantity(String(match[1] || '').trim());
  if (amount.kind !== 'number') return null;

  const lookedAtCount = Math.max(0, amount.value | 0);
  const milledCount = Math.max(0, lookedAtCount - 1);

  const drawStep: OracleEffectStep = {
    kind: 'draw',
    who: { kind: 'you' },
    amount: { kind: 'number', value: lookedAtCount > 0 ? 1 : 0 },
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };

  const millStep: OracleEffectStep = {
    kind: 'mill',
    who: { kind: 'you' },
    amount: { kind: 'number', value: milledCount },
    raw: normalized,
  };

  return milledCount > 0 ? [drawStep, millStep] : [drawStep];
}

function expandConditionalLookTopChooseOneToHandRestToGraveyardStep(
  step: OracleEffectStep
): OracleEffectStep {
  if (step.kind !== 'conditional') return step;

  let changed = false;
  const expandedSteps: OracleEffectStep[] = [];

  for (let i = 0; i < step.steps.length; i += 1) {
    const current = step.steps[i];
    const next = step.steps[i + 1];

    if (current?.kind === 'unknown' && next?.kind === 'move_zone') {
      const deterministic = parseLookTopChooseOneToHandRestToGraveyardBody(
        current,
        `${String(current.raw || '').trim()}, ${String(next.raw || '').trim()}`.trim()
      );
      if (deterministic && deterministic.length > 0) {
        expandedSteps.push(...deterministic);
        changed = true;
        i += 1;
        continue;
      }
    }

    const nested = current.kind === 'conditional'
      ? expandConditionalLookTopChooseOneToHandRestToGraveyardStep(current)
      : current;
    if (nested !== current) changed = true;
    expandedSteps.push(nested);
  }

  return changed ? { ...step, steps: expandedSteps } : step;
}

export function expandConditionalLookTopChooseOneToHandRestToGraveyardAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'conditional') return step;
      const expanded = expandConditionalLookTopChooseOneToHandRestToGraveyardStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseDeterministicUnknownBodySteps(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  body: string
): readonly OracleEffectStep[] | null {
  const normalizedBody = normalizeClauseForParse(body.replace(/[.]+$/g, '').trim());
  const withMeta = <T extends OracleEffectStep>(candidate: T): T => {
    const out: any = { ...candidate };
    if (normalizedBody.sequence) out.sequence = normalizedBody.sequence;
    if (normalizedBody.optional) out.optional = normalizedBody.optional;
    return out;
  };

  const parseImpulseExileBody = (bodyClause: string): readonly OracleEffectStep[] | null => {
    const clauses = splitIntoClauses(
      bodyClause.replace(/,\s*then\s+(choose one of them)\b/gi, '. Then $1')
    )
      .map(clause => String(clause || '').trim())
      .filter(Boolean);
    if (clauses.length === 0) return null;

    const exileTop = tryParseExileTopOnly({ clauses, idx: 0 });
    if (!exileTop || exileTop.step.kind !== 'exile_top') return null;

    let bestPermission: ReturnType<typeof parseEffectLevelImpulsePermissionClause> | null = null;
    let bestClauseIndex: number | null = null;

    for (let index = exileTop.consumed; index < clauses.length; index += 1) {
      const cleanedClause = cleanImpulseClause(clauses[index]);
      const parsedPermission = parseEffectLevelImpulsePermissionClause(cleanedClause);
      if (parsedPermission) {
        if (!bestPermission || (bestPermission.duration === 'during_resolution' && parsedPermission.duration !== 'during_resolution')) {
          bestPermission = parsedPermission;
          bestClauseIndex = index;
        }
        if (parsedPermission.duration !== 'during_resolution') break;
        continue;
      }

      if (!isIgnorableImpulseReminderClause(cleanedClause)) break;
    }

    if (!bestPermission || bestClauseIndex === null) return null;

    const impulseStep = exileTop.step as Extract<OracleEffectStep, { kind: 'exile_top' }>;
    const combinedRaw = `${String(impulseStep.raw || '').trim()} ${String(clauses[bestClauseIndex] || '').trim()}`.trim();

    return [
      {
        kind: 'impulse_exile_top',
        who: impulseStep.who,
        amount: impulseStep.amount,
        duration: bestPermission.duration,
        permission: bestPermission.permission,
        ...(bestPermission.condition ? { condition: bestPermission.condition } : {}),
        ...(impulseStep.optional || step.optional ? { optional: true } : {}),
        ...(impulseStep.sequence ? { sequence: impulseStep.sequence } : {}),
        raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
      },
    ];
  };

  const parseSingleClause = (rawClause: string): readonly OracleEffectStep[] | null => {
    const rawText = String(rawClause || '').trim();
    const normalizedClause = normalizeClauseForParse(rawText.replace(/[.]+$/g, '').trim());
    const clause = String(normalizedClause.clause || '').trim();
    if (!clause) return null;

    const applyClauseMeta = <T extends OracleEffectStep>(candidate: T): T => {
      const out: any = { ...candidate };
      if (normalizedClause.sequence) out.sequence = normalizedClause.sequence;
      if (normalizedClause.optional) out.optional = true;
      return out;
    };

    const clauseStep = {
      ...step,
      raw: clause,
      ...(normalizedClause.sequence ? { sequence: normalizedClause.sequence } : {}),
      ...(normalizedClause.optional || normalizedBody.optional || step.optional ? { optional: true } : {}),
    } as Extract<OracleEffectStep, { kind: 'unknown' }>;

    const moveWithAttach = parseMoveZoneWithAttachFollowup(clause);
    if (moveWithAttach && moveWithAttach.length > 0) return moveWithAttach.map(applyClauseMeta);

    const singleStep =
      parseExilePermissionModifierUnknownStep(clauseStep) ??
      parseCopySpellUnknownStep(clauseStep) ??
      parseReturnFromYourGraveyardToHandClause(clause) ??
      tryParseZoneAndRemovalClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseSimpleCreateTokenClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseLifeAndCombatClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseTemporaryModifyPtClause({ clause, rawClause: clause, withMeta: applyClauseMeta }) ??
      tryParseSimpleActionClause({ clause, rawClause: clause, withMeta: applyClauseMeta });
    if (!singleStep || singleStep.kind === 'unknown') return null;
    return [applyClauseMeta(singleStep)];
  };

  const bodyClause = String(normalizedBody.clause || '').trim();
  const impulseBody = parseImpulseExileBody(bodyClause);
  if (impulseBody && impulseBody.length > 0) return impulseBody;

  const lookTopDistribution = parseLookTopChooseOneToHandRestToGraveyardBody(step, bodyClause);
  if (lookTopDistribution && lookTopDistribution.length > 0) return lookTopDistribution;

  const andParts = bodyClause.split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean);
  if (andParts.length > 1) {
    const parsed = andParts.flatMap(part => parseSingleClause(part) || []);
    if (parsed.length === andParts.length) return parsed;
  }

  const direct = parseSingleClause(bodyClause);
  if (direct && direct.length > 0) return direct;

  const sentenceClauses = splitIntoClauses(bodyClause);
  if (sentenceClauses.length > 1) {
    const parsed = sentenceClauses.flatMap(clause => parseSingleClause(clause) || []);
    if (parsed.length === sentenceClauses.length) return parsed;
  }

  return null;
}

function parseSimpleConditionalUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;

  const match =
    normalized.match(/^if\s+(.+?\bcard),\s*(.+)$/i) ||
    normalized.match(/^if\s+([^,]+),\s*(.+)$/i) ||
    normalized.match(/^when\s+(you do),\s*(.+)$/i);
  if (!match) return null;

  const conditionRaw = normalizeLeadingConditionalCondition(String(match[1] || '').trim());
  const body = String(match[2] || '').trim();
  if (!conditionRaw || !body) return null;

  const parsedBodySteps = parseDeterministicUnknownBodySteps(step, body);

  if (!parsedBodySteps || parsedBodySteps.length === 0) return null;

  if (conditionRaw === 'you do' && parsedBodySteps.length === 1 && parsedBodySteps[0]?.kind === 'impulse_exile_top') {
    return {
      ...parsedBodySteps[0],
      raw: normalized,
    };
  }

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: parsedBodySteps,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseTapMatchingPermanentsUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): Extract<OracleEffectStep, { kind: 'tap_matching_permanents' }> | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;

  const match = normalized.match(/^you may tap\s+(x|a|an|\d+|[a-z]+)\s+untapped\s+(.+?)\s+you control$/i);
  if (!match) return null;

  return {
    kind: 'tap_matching_permanents',
    who: { kind: 'you' },
    amount: parseQuantity(String(match[1] || '').trim()),
    filter: String(match[2] || '').trim(),
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseTapCountBuffDamageFollowupStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  tappedFilter: string
): Extract<OracleEffectStep, { kind: 'conditional' }> | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^if you do,\s*(this creature|this permanent|it)\s+gets\s+\+x\/\+0\s+until end of turn and deals x damage to (defending player|the defending player)$/i
  );
  if (!match) return null;

  const targetText = String(match[1] || '').trim().toLowerCase();
  const filterText = normalizeOracleText(String(tappedFilter || ''))
    .replace(/^an?\s+/i, '')
    .trim()
    .toLowerCase();

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: 'you do' },
    steps: [
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: targetText },
        power: 1,
        toughness: 0,
        powerUsesX: true,
        duration: 'end_of_turn',
        condition: { kind: 'where', raw: `x is the number of ${filterText} tapped this way` },
        raw: `${targetText} gets +X/+0 until end of turn where X is the number of ${filterText} tapped this way`,
      },
      {
        kind: 'deal_damage',
        amount: { kind: 'unknown', raw: `the number of ${filterText} tapped this way` },
        target: { kind: 'raw', text: String(match[2] || '').trim().toLowerCase() },
        raw: `deals X damage to ${String(match[2] || '').trim()}`,
      },
    ],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandTapMatchingPermanentCountAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      if (step.kind !== 'unknown') {
        expandedSteps.push(step);
        continue;
      }

      const tapStep = parseTapMatchingPermanentsUnknownStep(step);
      if (!tapStep) {
        expandedSteps.push(step);
        continue;
      }

      const nextStep = ability.steps[index + 1];
      if (nextStep?.kind === 'unknown') {
        const followup = parseTapCountBuffDamageFollowupStep(nextStep, tapStep.filter);
        if (followup) {
          expandedSteps.push(tapStep, followup);
          changed = true;
          index += 1;
          continue;
        }
      }

      expandedSteps.push(tapStep);
      changed = true;
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function invertOtherwiseCondition(previous: Extract<OracleEffectStep, { kind: 'conditional' }>): string | null {
  if (previous.condition.kind !== 'if') return null;
  const text = normalizeLeadingConditionalCondition(String(previous.condition.raw || '').trim());
  const movedCardTypeMatch = text.match(/^it was (?:a|an)\s+(.+?)(?:\s+card)?$/i);
  if (!movedCardTypeMatch) return null;
  return `it was not a ${String(movedCardTypeMatch[1] || '').trim()}`.trim();
}

function parseOtherwiseConditionalUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  previous: OracleEffectStep | undefined
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^otherwise,?\s*(.+)$/i);
  if (!match || previous?.kind !== 'conditional') return null;

  const conditionRaw = invertOtherwiseCondition(previous);
  if (!conditionRaw) return null;

  const body = String(match[1] || '').trim();
  if (!body) return null;

  const parsedBodySteps = parseDeterministicUnknownBodySteps(step, body);
  if (!parsedBodySteps || parsedBodySteps.length === 0) return null;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: conditionRaw },
    steps: parsedBodySteps,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandSimpleConditionalUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseSimpleConditionalUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandOtherwiseConditionalUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step, index, steps) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseOtherwiseConditionalUnknownStep(step, steps[index - 1]);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function expandUnlessSacrificeStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'sacrifice') return step;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const match = normalized.match(/^sacrifice\s+(.+?)\s+unless\s+(.+)$/i);
  if (!match) return step;

  const conditionRaw = String(match[2] || '').trim();
  const normalizedCondition = normalizeOracleText(conditionRaw);
  const negatedCondition =
    normalizedCondition === 'it escaped'
      ? "it didn't escape"
      : normalizedCondition === 'this permanent escaped'
        ? "this permanent didn't escape"
        : `not (${conditionRaw})`;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: negatedCondition },
    steps: [
      {
        ...step,
        what: parseObjectSelector(String(match[1] || '').trim()),
        raw: `sacrifice ${String(match[1] || '').trim()}`,
      },
    ],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseConditionalIfYouDoImpulseStep(
  step: Extract<OracleEffectStep, { kind: 'conditional' }>,
  nextStep: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (step.condition.kind !== 'if') return null;
  if (normalizeLeadingConditionalCondition(String(step.condition.raw || '').trim()) !== 'you do') return null;
  if (nextStep?.kind !== 'unknown') return null;

  const permission = parseEffectLevelImpulsePermissionClause(cleanImpulseClause(String(nextStep.raw || '')));
  if (!permission) return null;

  const clauses = splitIntoClauses(
    normalizeOracleText(String(step.raw || ''))
      .replace(/^if you do,\s*/i, '')
      .replace(/,\s*then\s+(choose one of them)\b/gi, '. Then $1')
  )
    .map(clause => String(clause || '').trim())
    .filter(Boolean);
  if (clauses.length === 0) return null;

  const exileTop = tryParseExileTopOnly({ clauses, idx: 0 });
  if (!exileTop || exileTop.step.kind !== 'exile_top') return null;

  for (let index = exileTop.consumed; index < clauses.length; index += 1) {
    if (!isIgnorableImpulseReminderClause(cleanImpulseClause(clauses[index]))) return null;
  }

  const impulseStep = exileTop.step as Extract<OracleEffectStep, { kind: 'exile_top' }>;
  const combinedRaw = `${String(step.raw || '').trim()} ${String(nextStep.raw || '').trim()}`.trim();

  return {
    kind: 'impulse_exile_top',
    who: impulseStep.who,
    amount: impulseStep.amount,
    duration: permission.duration,
    permission: permission.permission,
    ...(permission.condition ? { condition: permission.condition } : {}),
    ...(impulseStep.optional ? { optional: true } : {}),
    ...(impulseStep.sequence ? { sequence: impulseStep.sequence } : {}),
    raw: combinedRaw.endsWith('.') ? combinedRaw : `${combinedRaw}.`,
  };
}

export function upgradeConditionalIfYouDoImpulseAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const upgradedSteps: OracleEffectStep[] = [];

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      if (step.kind !== 'conditional') {
        upgradedSteps.push(step);
        continue;
      }

      const upgraded = parseConditionalIfYouDoImpulseStep(step, ability.steps[index + 1]);
      if (!upgraded) {
        upgradedSteps.push(step);
        continue;
      }

      changed = true;
      upgradedSteps.push(upgraded);
      index += 1;
    }

    return changed ? { ...ability, steps: upgradedSteps } : ability;
  });
}

export function expandUnlessSacrificeAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      const expanded = expandUnlessSacrificeStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseExilePermissionUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  abilityType: OracleIRAbility['type']
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  {
    const conditionalModifierMatch = normalized.match(/^if\s+([^,]+),\s*(.+)$/i);
    if (conditionalModifierMatch) {
      const conditionRaw = normalizeLeadingConditionalCondition(String(conditionalModifierMatch[1] || '').trim());
      const modifierStep = parseExilePermissionModifierUnknownStep({
        ...step,
        raw: String(conditionalModifierMatch[2] || '').trim(),
      });
      if (conditionRaw && modifierStep) {
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: conditionRaw },
          steps: [modifierStep],
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: normalized,
        };
      }
    }
  }

  if (/^(?:at the beginning of your next upkeep,?\s*)?you may cast this card from exile without paying its mana cost\.?$/i.test(normalized)) {
    return {
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      permission: 'cast',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const match = normalized.match(
    /^(.+?)\s+may\s+(cast|play)\s+(.+?)\s+from\s+among\s+cards?\s+(?:(you)\s+own\s+)?exiled\s+with\s+this\s+(?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i
  );
  if (!match) return null;

  return {
    kind: 'grant_exile_permission',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    permission: String(match[2] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
    what: parseObjectSelector(String(match[3] || '').trim()),
    duration: abilityType === 'static' ? 'as_long_as_control_source' : 'during_resolution',
    linkedToSource: true,
    ...(match[4] ? { ownedByWho: 'granted_player' as const } : {}),
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseExilePermissionModifierUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (
    /^you may (?:cast|play) (?:(?:cards?|spells?) this way|(?:cards?|spells?) exiled this way|(?:those|the exiled) (?:cards?|spells?)|that card|that spell|it|them) without paying (?:its|their|that spell(?:'s)?|those spells(?:')?) mana costs?$/i.test(
      normalized
    )
  ) {
    return {
      kind: 'modify_exile_permissions',
      scope: 'last_exiled_cards',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^you may cast this card from exile without paying its mana cost\.?$/i.test(normalized)) {
    return {
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      permission: 'cast',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return null;
}

export function expandExilePermissionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseExilePermissionUnknownStep(step, ability.type);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseGraveyardPermissionModifierUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (
    /^(?:the )?(?:flashback|escape|retrace|jump-start|harmonize) cost is equal to (?:its|their|that card's|that spell's|those cards'|those spells') mana cost$/i.test(
      normalized
    )
  ) {
    return {
      kind: 'modify_graveyard_permissions',
      scope: 'last_granted_graveyard_cards',
      castCost: 'mana_cost',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  {
    const match = normalized.match(
      /^(?:the )?(?:flashback|escape|retrace|jump-start|harmonize) cost is equal to (?:its|their|that card's|that spell's|those cards'|those spells'|the card's) mana cost plus (.+)$/i
    );
    if (match) {
      const additionalCost = parseGraveyardAdditionalCostFromText(String(match[1] || '').trim());
      if (additionalCost) {
        return {
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          castCost: 'mana_cost',
          additionalCost,
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: normalized,
        };
      }
    }
  }

  {
    const match = normalized.match(
      /^(?:this creature|this permanent|it)\s+escapes with\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i
    );
    if (match) {
      const amount = parseQuantity(String(match[1] || '').trim());
      if (amount.kind !== 'number' || amount.value <= 0) return null;

      const counter = normalizeCounterName(String(match[2] || '').trim());
      if (!counter) return null;

      return {
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        castedPermanentEntersWithCounters: { [counter]: Math.max(0, amount.value | 0) },
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  return null;
}

function isGraveyardExileReplacementText(rawText: string): boolean {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^if\s+(?:that spell|that card|this card|it|the spell|the card)\s+would be put into (?:your|its|their)\s+graveyard,?\s*exile it instead\.?$/i.test(
    normalized
  );
}

function attachGraveyardExileReplacementModifier(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] {
  const nextSteps: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind === 'conditional') {
      const nestedSteps = attachGraveyardExileReplacementModifier(step.steps);
      const updatedConditional =
        nestedSteps === step.steps ? step : { ...step, steps: nestedSteps };

      if (
        step.steps.length === 1 &&
        step.steps[0]?.kind === 'exile' &&
        isGraveyardExileReplacementText(step.raw)
      ) {
        const previous = nextSteps[nextSteps.length - 1];
        if (previous?.kind === 'modify_graveyard_permissions') {
          nextSteps[nextSteps.length - 1] = {
            ...previous,
            exileInsteadOfGraveyard: true,
            raw: `${String(previous.raw || '').trim()} ${String(step.raw || '').trim()}`.trim(),
          };
          continue;
        }
      }

      nextSteps.push(updatedConditional);
      continue;
    }

    if (step.kind === 'unknown' && isGraveyardExileReplacementText(step.raw)) {
      const previous = nextSteps[nextSteps.length - 1];
      if (previous?.kind === 'modify_graveyard_permissions') {
        nextSteps[nextSteps.length - 1] = {
          ...previous,
          exileInsteadOfGraveyard: true,
          raw: `${String(previous.raw || '').trim()} ${String(step.raw || '').trim()}`.trim(),
        };
        continue;
      }
    }

    nextSteps.push(step);
  }

  return nextSteps;
}

function parsePayManaUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalizedParse = normalizeClauseForParse(String(step.raw || ''));
  const normalized = normalizeOracleText(String(normalizedParse.clause || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  let whoRaw = 'you';
  let manaRaw = '';
  let optional = Boolean(step.optional);

  {
    const match = normalized.match(/^pay\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      manaRaw = String(match[1] || '').trim();
    }
  }

  if (!manaRaw) {
    const match = normalized.match(/^(.+?)\s+may\s+pay\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      whoRaw = String(match[1] || '').trim();
      manaRaw = String(match[2] || '').trim();
      optional = true;
    }
  }

  if (!manaRaw) {
    const match = normalized.match(/^(.+?)\s+pays?\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      whoRaw = String(match[1] || '').trim();
      manaRaw = String(match[2] || '').trim();
    }
  }

  if (!manaRaw) return null;

  const normalizedMana = manaRaw.replace(/\s+/g, '');
  if (!normalizedMana) return null;

  return {
    kind: 'pay_mana',
    who: parsePlayerSelector(whoRaw),
    mana: normalizedMana,
    ...(optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandPayManaUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parsePayManaUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandGraveyardPermissionModifierUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseGraveyardPermissionModifierUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function normalizeInlineManaCost(rawCost: string | undefined): string | null {
  const match = String(rawCost || '')
    .replace(/[.]+$/g, '')
    .match(/^\s*((?:\{[^}]+\})+)/);
  const normalized = String(match?.[1] || '')
    .replace(/\s+/g, '')
    .trim();
  if (!normalized) return null;
  return /^(?:\{[^}]+\})+$/.test(normalized) ? normalized : null;
}

function parseGraveyardPermissionCastCostFromText(rawText: string): string | null {
  const normalized = normalizeOracleText(String(rawText || '')).trim();
  if (!normalized) return null;

  const keywordCostMatch = normalized.match(
    /\b(?:flashback|jump-start|escape|harmonize)\b\s*(?:-|:)?\s*((?:\{[^}]+\}\s*)+)/i
  );
  if (keywordCostMatch) {
    const cost = String(keywordCostMatch[1] || '').replace(/\s+/g, '').trim();
    return /^(?:\{[^}]+\})+$/.test(cost) ? cost : null;
  }

  return normalizeInlineManaCost(normalized);
}

function parseGraveyardAdditionalCostFromText(rawText: string): OracleGraveyardAdditionalCost | null {
  let normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const embeddedKeywordCostMatch = normalized.match(
    /\b(?:flashback|jump-start|retrace|escape|harmonize)\b\s*(?:-|:)?\s*(?:\{[^}]+\})+\s*,\s*([^".]+)(?:[".]|$)/i
  );
  if (embeddedKeywordCostMatch) {
    normalized = String(embeddedKeywordCostMatch[1] || '').trim();
  } else {
    normalized = normalized.replace(/^(?:flashback|jump-start|retrace|escape|harmonize)\b[:â€”-]?\s*/i, '').trim();
    normalized = normalized.replace(/^(?:\{[^}]+\})+(?:,\s*|\s+)/, '').trim();
  }

  const byMatch = normalized.match(
    /\bby\s+(.+?)\s+in addition to paying (?:its|their|that card's|that spell's|those cards'|those spells') other costs\b/i
  );
  if (byMatch) {
    normalized = String(byMatch[1] || '').trim();
  }

  const discardMatch = normalized.match(/^(?:discard|discarding)\s+(a|an|\d+|x|[a-z]+)\s+(.+?)$/i);
  if (discardMatch) {
    const amount = parseQuantity(String(discardMatch[1] || '').trim());
    if (amount.kind !== 'number' || amount.value <= 0) return null;

    const rawFilter = String(discardMatch[2] || '')
      .trim()
      .replace(/\s+cards?$/i, '')
      .trim();

    return {
      kind: 'discard',
      count: Math.max(0, amount.value | 0),
      ...(rawFilter && rawFilter !== 'card' ? { filterText: rawFilter } : {}),
      raw: normalized,
    };
  }

  const exileMatch = normalized.match(/^exile\s+(a|an|\d+|x|[a-z]+)\s+other\s+cards?\s+from\s+your\s+graveyard$/i);
  if (exileMatch) {
    const amount = parseQuantity(String(exileMatch[1] || '').trim());
    if (amount.kind !== 'number' || amount.value <= 0) return null;

    return {
      kind: 'exile_from_graveyard',
      count: Math.max(0, amount.value | 0),
      raw: normalized,
    };
  }

  const removeCounterWithTypeMatch = normalized.match(
    /^(?:remove|removing)\s+(any number of|a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+from\s+among\s+(.+)$/i
  );
  if (removeCounterWithTypeMatch) {
    const amountText = String(removeCounterWithTypeMatch[1] || '').trim();
    const amount =
      /^any number of$/i.test(amountText)
        ? 'any'
        : parseQuantity(amountText);
    if (amount !== 'any' && (amount.kind !== 'number' || amount.value < 0)) return null;

    const counter = normalizeCounterName(String(removeCounterWithTypeMatch[2] || '').trim());
    const filterText = String(removeCounterWithTypeMatch[3] || '').trim();
    if (!filterText) return null;

    return {
      kind: 'remove_counter',
      count: amount === 'any' ? 'any' : Math.max(0, amount.value | 0),
      counter: counter || undefined,
      filterText,
      raw: normalized,
    };
  }

  const removeCounterMatch = normalized.match(
    /^(?:remove|removing)\s+(any number of|a|an|\d+|x|[a-z]+)\s+counters?\s+from\s+among\s+(.+)$/i
  );
  if (removeCounterMatch) {
    const amountText = String(removeCounterMatch[1] || '').trim();
    const amount =
      /^any number of$/i.test(amountText)
        ? 'any'
        : parseQuantity(amountText);
    if (amount !== 'any' && (amount.kind !== 'number' || amount.value < 0)) return null;

    const filterText = String(removeCounterMatch[2] || '').trim();
    if (!filterText) return null;

    return {
      kind: 'remove_counter',
      count: amount === 'any' ? 'any' : Math.max(0, amount.value | 0),
      filterText,
      raw: normalized,
    };
  }

  const sacrificeMatch = normalized.match(/^(?:sacrifice|sacrificing)\s+(a|an|\d+|x|[a-z]+)\s+(.+?)$/i);
  if (sacrificeMatch) {
    const amount = parseQuantity(String(sacrificeMatch[1] || '').trim());
    if (amount.kind !== 'number' || amount.value <= 0) return null;

    const rawFilter = String(sacrificeMatch[2] || '')
      .trim()
      .replace(/\s+permanents?$/i, '')
      .trim();

    return {
      kind: 'sacrifice',
      count: Math.max(0, amount.value | 0),
      ...(rawFilter && rawFilter !== 'permanent' ? { filterText: rawFilter } : {}),
      raw: normalized,
    };
  }

  return null;
}

function appendGrantedGraveyardAdditionalCostModifiers(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'conditional') {
      const nested = appendGrantedGraveyardAdditionalCostModifiers(step.steps);
      expanded.push(nested === step.steps ? step : { ...step, steps: nested });
      continue;
    }

    expanded.push(step);
    if (step.kind !== 'grant_graveyard_permission') continue;

    const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim();
    if (/^[^.:]+:\s*/.test(normalizedRaw)) continue;

    const castCostRaw = parseGraveyardPermissionCastCostFromText(step.raw);
    const additionalCost = parseGraveyardAdditionalCostFromText(step.raw);
    if (!castCostRaw && !additionalCost) continue;

    const next = steps[i + 1];
    const nextModifier = next?.kind === 'modify_graveyard_permissions'
      ? (next as Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>)
      : null;
    if (
      nextModifier &&
      (!castCostRaw || nextModifier.castCostRaw === castCostRaw || nextModifier.castCost === 'mana_cost') &&
      (!additionalCost || Boolean(nextModifier.additionalCost))
    ) {
      continue;
    }

    expanded.push({
      kind: 'modify_graveyard_permissions',
      scope: 'last_granted_graveyard_cards',
      ...(castCostRaw ? { castCostRaw } : {}),
      ...(additionalCost ? { additionalCost } : {}),
      raw: additionalCost?.raw || `Cast cost ${castCostRaw}`,
    });
  }

  return expanded;
}

export function expandGraveyardAdditionalCostPermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: appendGrantedGraveyardAdditionalCostModifiers(ability.steps),
  }));
}

export function expandKeywordManaCostGraveyardPermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const manaCost = normalizeInlineManaCost(ability.cost);
    if (!manaCost) return ability;

    const hasGrant = ability.steps.some((step) => step.kind === 'grant_graveyard_permission');
    const alreadyHasCostModifier = ability.steps.some((step) => {
      if (step.kind !== 'modify_graveyard_permissions') return false;
      const modifierStep = step as Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>;
      return modifierStep.castCost === 'mana_cost' || typeof modifierStep.castCostRaw === 'string';
    });
    if (!hasGrant || alreadyHasCostModifier) return ability;

    return {
      ...ability,
      steps: [
        ...ability.steps,
        {
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          castCostRaw: manaCost,
          raw: `cast from your graveyard for ${manaCost}`,
        },
      ],
    };
  });
}

export function expandDisturbKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    if (!normalizedText.startsWith('disturb ')) return ability;

    const hasGrant = ability.steps.some((step) => step.kind === 'grant_graveyard_permission');
    const alreadyMarked = ability.steps.some(
      (step) => step.kind === 'modify_graveyard_permissions' && Boolean((step as any).entersBattlefieldTransformed)
    );
    if (!hasGrant || alreadyMarked) return ability;

    return {
      ...ability,
      steps: [
        ...ability.steps,
        {
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          entersBattlefieldTransformed: true,
          raw: 'cast this card transformed from your graveyard',
        },
      ],
    };
  });
}

export function expandKeywordAdditionalCostGraveyardPermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== 'keyword') return ability;

    const additionalCost = parseGraveyardAdditionalCostFromText(String(ability.cost || '').trim());
    if (!additionalCost) return ability;

    const hasGrant = ability.steps.some((step) => step.kind === 'grant_graveyard_permission');
    const alreadyHasAdditionalCost = ability.steps.some(
      (step) => step.kind === 'modify_graveyard_permissions' && Boolean(step.additionalCost)
    );
    if (!hasGrant || alreadyHasAdditionalCost) return ability;

    return {
      ...ability,
      steps: [
        ...ability.steps,
        {
          kind: 'modify_graveyard_permissions',
          scope: 'last_granted_graveyard_cards',
          additionalCost,
          raw: additionalCost.raw,
        },
      ],
    };
  });
}

function extractLeadingInlineManaCost(text: string | undefined): string | null {
  const normalized = normalizeInlineManaCost(text);
  if (normalized) return normalized;

  const raw = normalizeOracleText(String(text || '')).trim();
  const match = raw.match(/^((?:\{[^}]+\})+)/);
  return match ? match[1] : null;
}

function parseUnearthCostFromText(text: string | undefined): string | null {
  const raw = normalizeOracleText(String(text || '')).trim();
  const match = raw.match(/^unearth\s*(?:-|:)\s*(.+)$/i) || raw.match(/^unearth\s+(.+)$/i);
  const cost = String(match?.[1] || '').trim().replace(/[.)]+$/g, '').trim();
  return cost || null;
}

export function expandUnearthKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    if (/^unearth only as a sorcery[.)]*$/i.test(normalizedText)) {
      return [];
    }
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'schedule_delayed_battlefield_action') &&
      ability.steps.some((step) => step.kind === 'grant_leave_battlefield_replacement');
    if (alreadyExpanded) {
      return [ability];
    }
    if (normalizedEffect !== 'unearth' && !/^unearth(?:\s+|[-:])/.test(normalizedText)) {
      return [ability];
    }

    const manaCost =
      extractLeadingInlineManaCost(ability.cost) ||
      parseUnearthCostFromText(ability.text) ||
      parseUnearthCostFromText(ability.effectText) ||
      String(ability.cost || '').trim();
    const existingSteps = ability.steps.filter(
      (step) => !(step.kind === 'unknown' && /^unearth(?:$|\s|[-:])/i.test(normalizeOracleText(String(step.raw || '')).trim()))
    );

    return [{
      ...ability,
      ...(manaCost ? { cost: manaCost } : {}),
      effectText:
        'Return this card from your graveyard to the battlefield. Exile it at the beginning of the next end step. If it would leave the battlefield, exile it instead of putting it anywhere else.',
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'battlefield',
          toRaw: 'battlefield',
          battlefieldController: { kind: 'you' },
          raw: 'Return this card from your graveyard to the battlefield.',
        },
        {
          kind: 'schedule_delayed_battlefield_action',
          timing: 'next_end_step',
          action: 'exile',
          object: { kind: 'raw', text: 'that permanent' },
          raw: 'Exile it at the beginning of the next end step.',
        },
        {
          kind: 'grant_leave_battlefield_replacement',
          target: { kind: 'raw', text: 'it' },
          destination: 'exile',
          raw: 'If it would leave the battlefield, exile it instead of putting it anywhere else.',
        },
        ...existingSteps,
      ],
    }];
  });
}

export function pruneMorphReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    return !/^turn it face up any time for (?:its mana cost if it's a creature card|its disguise cost)[.)]*$/i.test(normalizedText);
  });
}

export function pruneForetellReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    return !/^cast it on a later turn for its foretell cost[.)]*$/i.test(normalizedText);
  });
}

function normalizeReminderStepRaw(step: OracleEffectStep): string {
  return normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
}

function isRedundantManifestOrCloakReminderStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  return (
    /^to (?:manifest|cloak) a card, put it onto the battlefield face down as a 2\/2 creature(?: with ward \{2\})?$/i.test(normalized) ||
    /^turn it face up any time for its mana cost if it(?:'|â€™)s a creature card$/i.test(normalized)
  );
}

function isRedundantManifestDreadReminderStep(step: OracleEffectStep): boolean {
  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (
    /^put one onto the battlefield face down as a 2\/2 creature and the other into your graveyard$/i.test(normalized) ||
    /^turn it face up any time for its mana cost if it(?:'|â€™)s a creature card$/i.test(normalized)
  ) {
    return true;
  }

  if (step.kind === 'unknown') {
    return /^look at the top two cards of your library$/i.test(normalized) || /^manifest one of them$/i.test(normalized);
  }

  return step.kind === 'move_zone' && /^then put the rest into your graveyard$/i.test(normalized);
}

export function pruneRedundantFaceDownReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const hasFaceDownMove = ability.steps.some(
      (step) => step.kind === 'move_zone' && step.to === 'battlefield' && step.entersFaceDown === true
    );
    const hasManifestDread = ability.steps.some((step) => step.kind === 'manifest_dread');
    const hasManifestReminderText = /\(to manifest a card, put it onto the battlefield face down as a 2\/2 creature\.?/i.test(normalizedText);
    const hasCloakReminderText = /\(to cloak a card, put it onto the battlefield face down as a 2\/2 creature with ward \{2\}\.?/i.test(normalizedText);
    const hasManifestDreadReminderText = /\bmanifest dread\.?\s*\(look at the top two cards of your library\./i.test(normalizedText);
    if (!hasFaceDownMove && !hasManifestDread && !hasManifestReminderText && !hasCloakReminderText && !hasManifestDreadReminderText) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => {
      if ((hasManifestDread || hasManifestDreadReminderText) && isRedundantManifestDreadReminderStep(step)) {
        return false;
      }
      if ((hasFaceDownMove || hasManifestReminderText || hasCloakReminderText) && isRedundantManifestOrCloakReminderStep(step)) {
        return false;
      }
      return true;
    });

    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneConvokeReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    if (ability.type !== 'static' || ability.steps.length === 0 || !ability.steps.every((step) => step.kind === 'unknown')) {
      return true;
    }

    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return !/^convoke(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText);
  });
}

export function pruneCascadeReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return !/^cascade\s*\([^)]*\)[.)]*$/i.test(normalizedText);
  });
}

export function pruneKickerReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return !/^(?:multi)?kicker\s+.+?\(you may pay an additional .+?(?: any number of times)? as you cast this spell\.?\)[.)]*$/i.test(
      normalizedText
    );
  });
}

function isRedundantCascadeReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^you may cast it without paying its mana cost$/i.test(normalized) ||
    /^put the exiled cards on the bottom(?: of your library)? in a random order$/i.test(normalized)
  );
}

export function pruneRedundantCascadeReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('cascade')) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantCascadeReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantPrototypeReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  return /^it keeps its abilities and types[.)]*$/i.test(normalizeReminderStepRaw(step));
}

export function pruneRedundantPrototypeReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('prototype')) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantPrototypeReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantBackupReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  return /^if that(?:'|â€™)?s another creature, it gains the following ability until end of turn[.)]*$/i.test(
    normalizeReminderStepRaw(step)
  );
}

function isRedundantBackupReminderLeadUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  return /^backup\s+\d+\s*\(when this creature enters, put a \+1\/\+1 counter on target creature[.)]*$/i.test(
    normalizeReminderStepRaw(step)
  );
}

export function pruneRedundantBackupReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('backup')) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantBackupReminderUnknownStep(step));
    if (
      /^backup\s+\d+(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText) &&
      nextSteps.every((step) => isRedundantBackupReminderLeadUnknownStep(step))
    ) {
      return [];
    }

    return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
  });
}

export function pruneCumulativeUpkeepReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return !/^cumulative upkeep\b/i.test(normalizedText);
  });
}

export function pruneSoulbondReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return !/^soulbond(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText);
  });
}

export function pruneExtortReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return !/^extort(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText);
  });
}

export function pruneFirebendingReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (/^firebending\s+(?:\d+|x(?:,\s*where x is [^.]+)?)(?:\.?\s*)?(?:\([^)]*\))?[.)]*$/i.test(normalizedText)) {
      return [];
    }

    if (!normalizedText.includes('firebending')) {
      return [ability];
    }

    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') {
        return true;
      }

      return !/^this mana lasts until end of combat$/i.test(normalizeReminderStepRaw(step));
    });

    return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
  });
}

function isRedundantReadAheadReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step) return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (step.kind === 'sacrifice') {
    return /^sacrifice after [ivx]+[.)]*$/i.test(normalized);
  }

  if (step.kind !== 'unknown') return false;

  return (
    /^read ahead \(choose a chapter and start with that many lore counters$/i.test(normalized) ||
    /^as a saga enters, choose a chapter and start with that many lore counters$/i.test(normalized) ||
    /^add one after your draw step$/i.test(normalized) ||
    /^skipped chapters do(?:n't| not) trigger[.)]*$/i.test(normalized) ||
    /^sacrifice after [ivx]+[.)]*$/i.test(normalized)
  );
}

export function pruneReadAheadReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('read ahead')) {
      return [ability];
    }

    const nextSteps = ability.steps.filter((step) => !isRedundantReadAheadReminderUnknownStep(step));
    if (nextSteps.length === ability.steps.length) {
      return [ability];
    }

    if (nextSteps.length === 0 && /^read ahead\b/.test(normalizedText)) {
      return [];
    }

    return [{ ...ability, steps: nextSteps }];
  });
}

function isRedundantWaterbendReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  return (
    /^while paying a waterbend cost, you can tap your artifacts and creatures to help$/i.test(normalized) ||
    /^each one pays for \{1\}$/i.test(normalized)
  );
}

export function pruneRedundantWaterbendReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('waterbend')) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantWaterbendReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantEarthbendReminderStep(step: OracleEffectStep): boolean {
  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (step.kind === 'unknown') {
    return (
      /^target land you control becomes a 0\/0 (?:land )?creature with haste that(?:'|â€™)?s still a land$/i.test(normalized) ||
      /^when it dies or is exiled, return it to the battlefield tapped$/i.test(normalized)
    );
  }

  return (
    step.kind === 'add_counter' &&
    /^put (?:an?|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+) \+1\/\+1 counters? on it$/i.test(normalized)
  );
}

export function pruneRedundantEarthbendReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const hasEarthbendLead = ability.steps.some(
      (step) =>
        step.kind === 'earthbend' ||
        (step.kind === 'unknown' && /^earthbend\s+\d+$/i.test(normalizeReminderStepRaw(step)))
    );
    if (!normalizedText.includes('earthbend') || !hasEarthbendLead) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantEarthbendReminderStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneMadnessReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    if (ability.type !== 'static' || ability.steps.length === 0 || !ability.steps.every((step) => step.kind === 'unknown')) {
      return true;
    }

    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return !/^madness\b/i.test(normalizedText);
  });
}

export function pruneCleaveReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    if (ability.type !== 'static' || ability.steps.length === 0 || !ability.steps.every((step) => step.kind === 'unknown')) {
      return true;
    }

    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return !(normalizedText.startsWith('cleave ') && normalizedText.includes('remove the words in square brackets'));
  });
}

export function pruneCipherReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!normalizedText) return true;

    if (ability.type === 'static' && normalizedText.startsWith('cipher (')) {
      return false;
    }

    if (
      ability.type === 'triggered' &&
      /^whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost[.)]*$/i.test(normalizedText)
    ) {
      return false;
    }

    return true;
  });
}

export function pruneRedundantAttackRequirementAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    if (ability.type !== 'static' || ability.steps.length !== 1 || ability.steps[0]?.kind !== 'unknown') {
      return true;
    }

    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    return !(
      /^this creature attacks each combat if able[.)]*$/i.test(normalizedText)
      || /^this creature can(?:not|'t) attack unless defending player controls an? (plains|island|swamp|mountain|forest)[.)]*$/i.test(normalizedText)
      || /^this creature can(?:not|'t) be blocked by more than one creature[.)]*$/i.test(normalizedText)
    );
  });
}

export function pruneRedundantSpellCantBeCounteredAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const normalizeUnknownStepText = (step: OracleEffectStep | undefined): string => {
    if (!step || step.kind !== 'unknown') return '';
    return normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .trim()
      .toLowerCase();
  };

  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .trim()
      .toLowerCase();
    const mentionsSpellCantBeCountered = /^this spell can(?:not|'t) be countered(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText)
      || ability.steps.some((step) => /^this spell can(?:not|'t) be countered[.)]*$/i.test(normalizeUnknownStepText(step)));

    if (!mentionsSpellCantBeCountered) {
      return [ability];
    }

    const nextSteps = ability.steps.filter((step) => {
      const normalizedStep = normalizeUnknownStepText(step);
      if (!normalizedStep) return true;
      if (/^this spell can(?:not|'t) be countered[.)]*$/i.test(normalizedStep)) return false;
      if (/^\(?this includes by the ward ability\)?[.)]*$/i.test(normalizedStep)) return false;
      return true;
    });

    if (nextSteps.length === ability.steps.length) {
      return [ability];
    }

    return nextSteps.length > 0 ? [{ ...ability, steps: nextSteps }] : [];
  });
}

function normalizeFutureSpellUnknownStepText(step: OracleEffectStep | undefined): string {
  if (!step || step.kind !== 'unknown') return '';
  return normalizeOracleText(String(step.raw || ''))
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/g, '')
    .trim();
}

export function expandFutureSpellEffectUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps: OracleEffectStep[] = [];
    let changed = false;

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      const normalizedStep = normalizeFutureSpellUnknownStepText(step);

      if (
        normalizedStep &&
        /^spells you control can(?:not|'t) be countered by blue or black spells this turn, and creatures you control can(?:not|'t) be the targets? of blue or black spells this turn$/i.test(normalizedStep)
      ) {
        changed = true;
        nextSteps.push({
          kind: 'grant_future_spell_effect',
          who: { kind: 'you' },
          duration: 'this_turn',
          scope: 'all_qualifying_spells',
          counterImmunity: { counterSourceColors: ['U', 'B'] },
          raw: "Spells you control can't be countered by blue or black spells this turn",
        });
        nextSteps.push({
          kind: 'grant_temporary_ability',
          target: { kind: 'raw', text: 'creatures you control' },
          duration: 'this_turn',
          effectText: ["can't be the targets of blue or black spells this turn"],
          raw: "Creatures you control can't be the targets of blue or black spells this turn",
        });
        continue;
      }

      const firstSavageClause = normalizedStep;
      const secondSavageClause = normalizeFutureSpellUnknownStepText(ability.steps[index + 1] as OracleEffectStep);
      const thirdSavageClause = normalizeFutureSpellUnknownStepText(ability.steps[index + 2] as OracleEffectStep);
      if (
        firstSavageClause &&
        secondSavageClause &&
        thirdSavageClause &&
        /^the next creature spell you cast this turn can be cast as though it had flash$/i.test(firstSavageClause) &&
        /^that spell can(?:not|'t) be countered$/i.test(secondSavageClause) &&
        /^that creature enters with an additional \+1\/\+1 counter on it$/i.test(thirdSavageClause)
      ) {
        changed = true;
        nextSteps.push({
          kind: 'grant_future_spell_effect',
          who: { kind: 'you' },
          duration: 'this_turn',
          scope: 'next_qualifying_spell',
          spellFilter: { cardTypes: ['creature'] },
          timingPermission: 'as_though_flash',
          counterImmunity: { unconditional: true },
          castedPermanentEntersWithCounters: { '+1/+1': 1 },
          raw: `${String((ability.steps[index] as any)?.raw || '').trim()}. ${String((ability.steps[index + 1] as any)?.raw || '').trim()}. ${String((ability.steps[index + 2] as any)?.raw || '').trim()}`,
        });
        index += 2;
        continue;
      }

      nextSteps.push(step);
    }

    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

function isRedundantArtifactTokenReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^(?:(?:it(?:'|â€™)s|it is)|(?:an?\s+[a-z0-9 ,.'â€™-]+?\s+token\s+is))\s+an artifact with\s+"[^"]+"$/i.test(normalized) ||
    /^(?:they(?:'|â€™)re|they are)\s+artifacts with\s+"[^"]+"$/i.test(normalized)
  );
}

function isArtifactTokenReminderContextUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return (
    /\binvestigate(?:s)?\b/i.test(normalized) ||
    /\bcreate(?:s)?\b.*\b(?:clue|food|blood|treasure|gold|powerstone|junk|map|mutagen|lander)\s+tokens?\b/i.test(normalized)
  );
}

export function pruneRedundantArtifactTokenReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');

    if (
      isUnknownOnlyAbility && (
        /^(?:(?:it(?:'|â€™)s|it is)|(?:an?\s+[a-z0-9 ,.'â€™-]+?\s+token\s+is))\s+an artifact with\s+"[^"]+"[.)]*$/i.test(normalizedAbilityText) ||
        /^(?:they(?:'|â€™)re|they are)\s+artifacts with\s+"[^"]+"[.)]*$/i.test(normalizedAbilityText)
      )
    ) {
      return [];
    }

    if (!ability.steps.some(
      (step) =>
        step.kind === 'create_token' ||
        step.kind === 'investigate' ||
        isArtifactTokenReminderContextUnknownStep(step)
    )) {
      return [ability];
    }

    const hasSplitReminderLead = ability.steps.some(isArtifactTokenReminderLeadUnknownStep);
    const mentionsJunkToken = /\bjunk tokens?\b/i.test(normalizedAbilityText);
    const nextSteps = ability.steps.filter(step => {
      if (isRedundantArtifactTokenReminderUnknownStep(step)) return false;
      if (hasSplitReminderLead && isArtifactTokenReminderLeadUnknownStep(step)) return false;
      if (hasSplitReminderLead && isArtifactTokenReminderTailUnknownStep(step)) return false;
      if (mentionsJunkToken && step.kind === 'unknown' && /^you may play that card this turn$/i.test(normalizeUnknownStepText(step))) return false;
      return true;
    });
    return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
  });
}

function isRedundantEldraziTokenManaReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^(?:it has|they have) "sacrifice this (?:token|creature): add \{c\}\."$/i.test(normalized);
}

function isEldraziManaTokenCreateStep(step: OracleEffectStep): boolean {
  return step.kind === 'create_token' && /\beldrazi (?:scion|spawn)\b/i.test(String(step.token || ''));
}

export function pruneRedundantEldraziTokenManaReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some(isEldraziManaTokenCreateStep)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantEldraziTokenManaReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantDecayedAttackSacrificeReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^when it attacks, sacrifice it at end of combat[.)]*$/i.test(normalized);
}

function isDecayedTokenCreateStep(step: OracleEffectStep): boolean {
  return step.kind === 'create_token' && /\bwith decayed\b/i.test(String(step.raw || ''));
}

export function pruneRedundantDecayedReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some(isDecayedTokenCreateStep)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantDecayedAttackSacrificeReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantEnchantAttachmentReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^this card enters attached to that creature[.)]*$/i.test(normalized);
}

export function pruneRedundantEnchantAttachmentReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^enchant\b/i.test(normalizedText)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantEnchantAttachmentReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantProtectionAuraReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^this effect does(?:n't| not) remove this aura[.)]*$/i.test(normalized);
}

export function pruneRedundantProtectionAuraReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/\bprotection from\b/i.test(normalizedText) || !/\baura\b/i.test(normalizedText)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantProtectionAuraReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantTimingRulesReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^timing rules still apply[.)]*$/i.test(normalized);
}

function isRedundantHiddenAgendaRevealUnknownStep(step: OracleEffectStep): boolean {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return false;

  return /^you may turn this conspiracy face up any time and reveal that name[.)]*$/i.test(normalized);
}

export function pruneRedundantHiddenAgendaRevealUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^hidden agenda\b/i.test(normalizedText)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantHiddenAgendaRevealUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantTimingRulesReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter((step) => !isRedundantTimingRulesReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantCrewReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const normalizedAbilityText = (ability: OracleIRAbility): string => normalizeOracleText(
    String(ability.text || ability.effectText || '')
  )
    .replace(/\s+/g, ' ')
    .trim();

  const isUnknownOnlyAbility = (ability: OracleIRAbility): boolean => (
    ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown')
  );

  const isCrewReminderLeadAbility = (ability: OracleIRAbility): boolean => (
    isUnknownOnlyAbility(ability) && /^crew\s+\d+\s*\(/i.test(normalizedAbilityText(ability))
  );

  const isCrewReminderTailAbility = (ability: OracleIRAbility): boolean => {
    if (!isUnknownOnlyAbility(ability)) return false;

    const normalizedText = normalizedAbilityText(ability).toLowerCase();
    return (
      /^this (?:vehicle|token) becomes an artifact creature until end of turn[.)]*$/i.test(normalizedText) ||
      /^creatures can't be attached to other permanents[.)]*$/i.test(normalizedText)
    );
  };

  const nextAbilities: OracleIRAbility[] = [];
  let pruningCrewReminderTail = false;

  for (const ability of abilities) {
    const normalizedText = normalizedAbilityText(ability);

    if (isCrewReminderLeadAbility(ability)) {
      pruningCrewReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    if (pruningCrewReminderTail && isCrewReminderTailAbility(ability)) {
      pruningCrewReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    pruningCrewReminderTail = false;
    nextAbilities.push(ability);
  }

  return nextAbilities;
}

export function pruneRedundantChampionReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const normalizedAbilityText = (ability: OracleIRAbility): string => normalizeOracleText(
    String(ability.text || ability.effectText || '')
  )
    .replace(/\s+/g, ' ')
    .trim();

  const isUnknownOnlyAbility = (ability: OracleIRAbility): boolean => (
    ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown')
  );

  const isChampionReminderLeadAbility = (ability: OracleIRAbility): boolean => (
    isUnknownOnlyAbility(ability) && /^champion\s+.+?\s*\(/i.test(normalizedAbilityText(ability))
  );

  const isChampionReminderTailAbility = (ability: OracleIRAbility): boolean => {
    if (!isUnknownOnlyAbility(ability)) return false;

    const normalizedText = normalizedAbilityText(ability).toLowerCase();
    return (
      /^when this (?:creature|permanent) leaves the battlefield, that card returns to the battlefield[.)]*$/i.test(normalizedText) ||
      /^when this leaves the battlefield, that card returns to the battlefield[.)]*$/i.test(normalizedText)
    );
  };

  const nextAbilities: OracleIRAbility[] = [];
  let pruningChampionReminderTail = false;

  for (const ability of abilities) {
    const normalizedText = normalizedAbilityText(ability);

    if (isChampionReminderLeadAbility(ability)) {
      pruningChampionReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    if (pruningChampionReminderTail && isChampionReminderTailAbility(ability)) {
      pruningChampionReminderTail = !/\)\s*$/i.test(normalizedText);
      continue;
    }

    pruningChampionReminderTail = false;
    nextAbilities.push(ability);
  }

  return nextAbilities;
}

export function pruneLateKeywordReminderOnlyAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities
    .flatMap((ability) => {
      const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
        .replace(/\s+/g, ' ')
        .trim();

      if (/\bdredge\s+\d+\s*\(if you would draw a card\b/i.test(normalizedText)) {
        const dredgeStartIndex = ability.steps.findIndex((step) => {
          if (step.kind !== 'unknown') return false;
          return /^dredge\s+\d+\s*\(if you would draw a card\b/i.test(
            normalizeReminderStepRaw(step)
          );
        });

        if (dredgeStartIndex >= 0) {
          const nextSteps = ability.steps.filter((step, index) => {
            if (index < dredgeStartIndex) return true;
            if (step.kind === 'unknown') {
              return !/^dredge\s+\d+\s*\(if you would draw a card\b/i.test(normalizeReminderStepRaw(step));
            }
            const normalizedRaw = normalizeReminderStepRaw(step as any);
            return !/^(?:if you do,\s*)?return this card from your graveyard to your hand$/i.test(normalizedRaw);
          });
          return nextSteps.length > 0 ? [{ ...ability, steps: nextSteps }] : [];
        }
      }

      if (/^warp\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (/^squad\b.*$/i.test(normalizedText)) {
        return [];
      }

      if (/^when this creature enters, if x is 5 or more, draw a card[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (/^ravenous(?:\s*\(.*)?[.)]*$/i.test(normalizedText)) {
        return [];
      }

      if (/^this permanent \(this creature enters with x \+1\/\+1 counters on it\. if x is 5 or more, draw a card when it enters\.?(?:\))?[.)]*$/i.test(normalizedText)) {
        return [];
      }

      const isUnknownOnlyAbility = ability.steps.length === 0 || ability.steps.every((step) => step.kind === 'unknown');

      if (
        isUnknownOnlyAbility && (
          /^choose a background(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^.+\s+can be your commander[.)]*$/i.test(normalizedText) ||
          /^ascend(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^banding(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^bargain(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^bloodthirst\s+\d+(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^bushido\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^conspire(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^crew\s+\d+[.)]*$/i.test(normalizedText) ||
          /^delve(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^doctor(?:'|â€™)s companion(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^dash\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^this permanent\s+\d+\s*\(if an opponent was dealt damage this turn, this creature enters with a \+1\/\+1 counter on it\.?(?:\))?[.)]*$/i.test(normalizedText) ||
          /^enlist(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^evoke\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^flanking(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^graft\s+\d+\s*\(this creature enters with .+? \+1\/\+1 counters? on it[.)]*$/i.test(normalizedText) ||
          /^hideaway\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^improvise(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^modular\s+\d+(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^offspring\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^overload\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^plot\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^mutate\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^whenever another creature enters, you may move a \+1\/\+1 counter from this creature onto it[.)]*$/i.test(normalizedText) ||
          /^phasing(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^saddle\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^ravenous(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^shadow(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^split second(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^spree(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^station(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^squad\b.*$/i.test(normalizedText) ||
          /^umbra armor(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^toxic\s+\d+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^unleash(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^riot(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^vanishing\s+\d+(?:\s*\(.*)?[.)]*$/i.test(normalizedText) ||
          /^wither(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          /^splice(?:\s+onto\s+.+?)?\s+(?:\{[^}]+\})+(?:\s*\(.*\))?[.)]*$/i.test(normalizedText)
        )
      ) {
        return [];
      }

      const hasFaceDownMove = ability.steps.some(
        (step) => step.kind === 'move_zone' && step.to === 'battlefield' && step.entersFaceDown === true
      );
      if (!hasFaceDownMove) return [ability];

      const nextSteps = ability.steps.filter((step) => {
        if (step.kind !== 'unknown') return true;
        const normalizedStep = normalizeReminderStepRaw(step);
        return !/^turn it face up any time for its mana cost if it(?:'|â€™)s a creature card$/i.test(normalizedStep);
      });

      return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
    });
}

function isCurrentBatchReminderOrPlatformOnlyText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return (
    /^as this saga enters and after your draw step, add a lore counter$/i.test(normalizedText) ||
    /^devoid \(this card has no color\)?$/i.test(normalizedText) ||
    /^gain the next level as a sorcery to add its ability$/i.test(normalizedText) ||
    /^offspring\s+(?:\{[^}]+\})+\s*\(you may pay an additional (?:\{[^}]+\})+ as you cast this spell$/i.test(normalizedText) ||
    /^enchant (?:creature(?: you control)?|land|player)$/i.test(normalizedText) ||
    /^ward\s*(?:\{[^}]+\}|\d+)$/i.test(normalizedText) ||
    /^a creature with hexproof can(?:not|'t) be the target of spells or abilities your opponents control$/i.test(normalizedText) ||
    /^a suspected creature has menace and can(?:not|'t) block$/i.test(normalizedText) ||
    /^artifacts, legendaries, and sagas are historic$/i.test(normalizedText) ||
    /^assassins, mercenaries, pirates, rogues, and warlocks are outlaws$/i.test(normalizedText) ||
    /^each \{[wubrgc]\} in the mana costs of permanents you control counts toward your devotion to [a-z]+$/i.test(normalizedText) ||
    /^equipment, auras you control, and counters are modifications$/i.test(normalizedText) ||
    /^it(?:'|â€™)?s every creature type$/i.test(normalizedText) ||
    /^changeling \(this card is every creature type\)$/i.test(normalizedText) ||
    /^to mill (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, put the top (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library into your graveyard$/i.test(normalizedText) ||
    /^you descended if a permanent card was put into your graveyard from anywhere$/i.test(normalizedText) ||
    /^you may put the top (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library into your graveyard$/i.test(normalizedText) ||
    /^a deck can have only one card named .+$/i.test(normalizedText) ||
    /^you can(?:'|â€™)?t include this card in your deck if .+$/i.test(normalizedText) ||
    /^choose one$/i.test(normalizedText) ||
    /^for mirrodin!?$/i.test(normalizedText) ||
    /^when this equipment enters, create a 2\/2 red rebel creature token, then attach this to it$/i.test(normalizedText) ||
    /^to investigate, create a clue token$/i.test(normalizedText) ||
    /^it(?:'|â€™)?s an artifact with "?\{2\}, sacrifice this (?:artifact|token): draw a card"?$/i.test(normalizedText) ||
    /^players can(?:'|â€™)?t gain life this turn$/i.test(normalizedText) ||
    /^copy a random spell you cast from exile or in a graveyard this game(?:\s+you may cast the copy without paying its mana cost)?$/i.test(normalizedText) ||
    /^create a copy of one of the following, chosen at random:.+$/i.test(normalizedText) ||
    /^you may cast the copy without paying its mana cost$/i.test(normalizedText) ||
    /^flash$/i.test(normalizedText) ||
    /^harmonize\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^its harmonize cost is equal to its mana cost$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce the cost to harmonize this card by \{\d+\}$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce that cost by \{x\}, where x is its power$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce that cost by an amount of generic mana equal to its power$/i.test(normalizedText) ||
    /^you may tap a creature you control to r$/i.test(normalizedText) ||
    /^you may cast a legendary sorcery only if you control a legendary creature or planeswalker$/i.test(normalizedText) ||
    /^and has the chosen base power and toughness$/i.test(normalizedText) ||
    /^formidable\s*-\s*activate only if creatures you control have total power \d+ or greater$/i.test(normalizedText) ||
    /^activate only if creatures you control have total power \d+ or greater$/i.test(normalizedText) ||
    /^bestow\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^if this card was bestowed, this permanent becomes an aura again if it(?:'|â€™)?s attached to a creature$/i.test(normalizedText) ||
    /^you may cast this spell as though it had flash$/i.test(normalizedText) ||
    /^if you cast it any time a sorcery couldn(?:'|â€™)?t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step$/i.test(normalizedText) ||
    /^flash\s*\(you may cast this spell any time you could cast an instant\)$/i.test(normalizedText) ||
    /^enchant creature$/i.test(normalizedText) ||
    /^enchanted creature gets [+-]\d+\/[+-]\d+ and has (?:flying|trample|lifelink|deathtouch|vigilance|haste|first strike|double strike|hexproof|indestructible|menace|reach)$/i.test(normalizedText) ||
    /^it can block creatures with flying$/i.test(normalizedText) ||
    /^level\s+\d+\s*-\s*\d+$/i.test(normalizedText) ||
    /^level\s+\d+\+$/i.test(normalizedText) ||
    /^\d+\/\d+$/i.test(normalizedText) ||
    /^ward\s*-\s*discard a card$/i.test(normalizedText) ||
    /^sneak\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^sneak\s+(?:\{[^}]+\})+\s*\(you may cast this spell .+$/i.test(normalizedText) ||
    /^he enters tapped and attacking$/i.test(normalizedText) ||
    /^demonstrate\s*\(.*$/i.test(normalizedText) ||
    /^if you do, choose an opponent to also copy it$/i.test(normalizedText) ||
    /^players may choose new targets for their copies$/i.test(normalizedText) ||
    /^assist\s*\(.*$/i.test(normalizedText) ||
    /^that many plus one \+1\/\+1 counters are put on it$/i.test(normalizedText) ||
    /^it(?:'|â€™)?s an artifact creature at \d+\+$/i.test(normalizedText) ||
    /^\d+\+\s*\|.*$/i.test(normalizedText) ||
    /^then you may put that card on the bottom$/i.test(normalizedText) ||
    /^then you choose a nonland card from it for each card discarded this way$/i.test(normalizedText) ||
    /^damage and effects that say destroy don(?:'|â€™)?t destroy (?:this|it).+toughness is 0 or less.+$/i.test(normalizedText) ||
    /^damage and effects that say "?destroy"? don(?:'|â€™)?t destroy (?:this|it)$/i.test(normalizedText) ||
    /^if its toughness is 0 or less, it still dies$/i.test(normalizedText)
  );
}

function isClueArtifactReminderTailText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return /^it(?:'|â€™)?s an artifact with "?\{2\}, sacrifice this (?:artifact|token): draw a card"?$/i.test(normalizedText);
}

function isRoleTokenReminderText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return (
    /^if you control another role on it, put that one into the graveyard$/i.test(normalizedText) ||
    /^enchanted creature gets [+-]\d+\/[+-]\d+(?: and has [a-z, ]+)?$/i.test(normalizedText) ||
    /^when this token is put into a graveyard, each opponent loses \d+ life$/i.test(normalizedText)
  );
}

function isStaticMyriadReminderText(raw: string): boolean {
  const normalizedText = normalizeOracleText(String(raw || ''))
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;

  return /^(?:[a-z]+(?:,|\s)+)*myriad\s*\(whenever this creature attacks, for each opponent other than defending player, you may create a token cop(?:y|ies) that(?:'|â€™)?s tapped and attacking that player or a planeswalker they control(?:\.\s*exile the tokens at end of combat)?$/i.test(normalizedText);
}

export function pruneCurrentBatchReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');
    const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const mentionsRoleToken = /\brole token\b/i.test(normalizedAbilityText);

    if (isUnknownOnlyAbility && /^flash(?:\s*\([^)]*\))?$/i.test(normalizedAbilityText)) {
      return [{ ...ability, steps: [] }];
    }

    if (
      /^you may reveal this card from your opening hand(?:[.)]*\s*if you do, at the beginning of the first upkeep, .+)?$/i.test(normalizedAbilityText) ||
      /^if you do, at the beginning of the first upkeep,\s+create\b.+$/i.test(normalizedAbilityText)
    ) {
      return [];
    }

    if (isUnknownOnlyAbility && isCurrentBatchReminderOrPlatformOnlyText(normalizedAbilityText)) {
      return [];
    }

    const nextSteps: OracleEffectStep[] = [];
    let changed = false;
    for (const step of ability.steps) {
      if (isClueArtifactReminderTailText(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      if (step.kind !== 'unknown') {
        nextSteps.push(step);
        continue;
      }

      if (mentionsRoleToken && isRoleTokenReminderText(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      if (isStaticMyriadReminderText(String(step.raw || ''))) {
        const metadataSteps = Array.isArray((step as any).steps) ? ((step as any).steps as readonly OracleEffectStep[]) : [];
        const parsedMyriad = metadataSteps.length > 0 ? [...metadataSteps] : [parseMyriadTokenCreationMetadataStep(String(step.raw || ''))].filter(Boolean) as OracleEffectStep[];
        if (parsedMyriad.length > 0) {
          nextSteps.push({
            kind: 'grant_static_ability',
            target: parseObjectSelector('this creature'),
            abilities: ['myriad'],
            duration: 'static',
            raw: String(step.raw || 'myriad'),
            steps: parsedMyriad,
          });
        }
        changed = true;
        continue;
      }

      if (isCurrentBatchReminderOrPlatformOnlyText(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      nextSteps.push(step);
    }
    if (!changed) return [ability];
    if (nextSteps.length === 0) return [];
    return [{ ...ability, steps: nextSteps }];
  });
}

export function repairSubjectlessDrawAfterZoneShuffleAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const steps = ability.steps.map((step, index) => {
      const previous = ability.steps[index - 1];
      if (
        step.kind === 'draw' &&
        previous?.kind === 'shuffle_zones_into_library' &&
        (step.who as any)?.kind === 'you' &&
        /^draws\b/i.test(String(step.raw || '').trim())
      ) {
        changed = true;
        return { ...step, who: previous.who } as OracleEffectStep;
      }
      return step;
    });
    return changed ? { ...ability, steps } : ability;
  });
}

function isRedundantVanishingReminderTriggeredAbility(ability: OracleIRAbility): boolean {
  if (ability.type !== 'triggered') return false;

  const normalizedEffectText = normalizeOracleText(String(ability.effectText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^remove a time counter from it\. when the last is removed, sacrifice it[.)]*$/i.test(normalizedEffectText)) {
    return false;
  }

  const hasExpectedRemoveCounter = ability.steps.some(
    (step) =>
      step.kind === 'remove_counter' &&
      step.counter === 'time' &&
      step.target.kind === 'raw' &&
      /^it$/i.test(String(step.target.text || '').trim())
  );
  const hasExpectedReminderTail = ability.steps.some(
    (step) =>
      step.kind === 'unknown' &&
      /^when the last is removed, sacrifice it[.)]*$/i.test(
        normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim()
      )
  );

  return hasExpectedRemoveCounter && hasExpectedReminderTail;
}

export function pruneRedundantVanishingReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => !isRedundantVanishingReminderTriggeredAbility(ability));
}

function isRedundantModularReminderTriggeredAbility(ability: OracleIRAbility): boolean {
  if (ability.type !== 'triggered') return false;

  const normalizedEffectText = normalizeOracleText(String(ability.effectText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^you may put its \+1\/\+1 counters on target artifact creature[.)]*$/i.test(normalizedEffectText)) {
    return false;
  }

  return ability.steps.length > 0 && ability.steps.every(
    (step) =>
      step.kind === 'unknown' &&
      /^you may put its \+1\/\+1 counters on target artifact creature[.)]*$/i.test(
        normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim()
      )
  );
}

export function pruneRedundantModularReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => !isRedundantModularReminderTriggeredAbility(ability));
}

function isRedundantBandingReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  return (
    /^banding \(any creatures with banding, and up to one without, can attack in a band$/i.test(normalized) ||
    /^any creatures with banding, and up to one without, can attack in a band$/i.test(normalized) ||
    /^bands are blocked as a group$/i.test(normalized) ||
    /^if any creatures with banding (?:you control|a player controls) are blocking or being blocked by a creature, (?:you|that player) divide that creature(?:'|â€™)s combat damage, not its controller, among any of the creatures it(?:'|â€™)s being blocked by or is blocking$/i.test(normalized) ||
    /^if any creatures with banding you control are blocking a creature, you divide that creature(?:'|â€™)s combat damage, not its controller, among any of the creatures it(?:'|â€™)s being blocked by$/i.test(normalized)
  );
}

export function pruneRedundantBandingReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const referencesBanding = normalizedAbilityText.includes('banding');
    if (!referencesBanding) return [ability];

    const nextSteps = ability.steps.filter((step) => !isRedundantBandingReminderUnknownStep(step));
    if (nextSteps.length === ability.steps.length) return [ability];

    const onlyKeywordStepsRemain = nextSteps.length > 0 && nextSteps.every((step) => {
      if (step.kind !== 'unknown') return false;
      const normalized = normalizeUnknownStepText(step);
      if (!normalized) return false;
      const parsedKeywords = parseKeywordsFromOracleText(normalized);
      return parsedKeywords.length === 1 && parsedKeywords[0] === normalized.toLowerCase();
    });

    if (nextSteps.length === 0 || onlyKeywordStepsRemain) {
      return [];
    }

    return [{ ...ability, steps: nextSteps }];
  });
}

export function pruneExternallyHandledStaticUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const EXTERNALLY_HANDLED_STANDALONE_KEYWORDS = new Set([
    'deathtouch',
    'defender',
    'double strike',
    'first strike',
    'flying',
    'haste',
    'hexproof',
    'indestructible',
    'lifelink',
    'menace',
    'reach',
    'shadow',
    'trample',
    'vigilance',
  ]);

  const isPureKeywordGrantList = (text: string): boolean => {
    const parts = String(text || '')
      .replace(/\s*\([^()]*\)\s*$/g, '')
      .toLowerCase()
      .split(/\s+and\s+|\s*,\s*/)
      .map(part => part.replace(/[.)\s]+$/g, '').trim())
      .filter(Boolean);

    return parts.length > 0 && parts.every((part) => {
      const parsedKeywords = parseKeywordsFromOracleText(part);
      return parsedKeywords.length === 1 && parsedKeywords[0] === part;
    });
  };

  const isStandaloneHandledKeywordList = (text: string): boolean => {
    const parts = String(text || '')
      .replace(/\s*\([^()]*\)\s*$/g, '')
      .toLowerCase()
      .split(/\s+and\s+|\s*,\s*/)
      .map(part => part.replace(/[.)\s]+$/g, '').trim())
      .filter(Boolean);

    return parts.length > 0 && parts.every((part) => {
      if (/^protection from .+$/i.test(part)) {
        return true;
      }

      const parsedKeywords = parseKeywordsFromOracleText(part);
      return (
        parsedKeywords.length === 1 &&
        parsedKeywords[0] === part &&
        EXTERNALLY_HANDLED_STANDALONE_KEYWORDS.has(parsedKeywords[0])
      );
    });
  };

  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');

    if (!isUnknownOnlyAbility) {
      return [ability];
    }

    if (/^(?:enchanted|equipped) creature has protection from .+$/i.test(normalizedText)) {
      return [ability];
    }

    if (isStandaloneHandledKeywordList(normalizedText)) {
      return [];
    }

    if (
      /^draft this card face up[.)]*$/i.test(normalizedText) ||
      /^a deck can have any number of cards named (?:this permanent|this card)[.)]*$/i.test(normalizedText) ||
      /^remove this card from your deck before playing if you're not playing for ante[.)]*$/i.test(normalizedText) ||
      /^ready to run(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText) ||
      /^banding(?:\b|\s*\().*$/i.test(normalizedText) ||
      /^devour\s+\d+(?:\s+[^()]+)?\s*\(as this (?:creature|permanent) enters, you may sacrifice any number of creatures\.?[^)]*\)[.)]*$/i.test(normalizedText) ||
      /^entwine \{[^}]+\} \(choose both if you pay the entwine cost\.?\)[.)]*$/i.test(normalizedText) ||
      /^sunburst \(this (?:creature|permanent|artifact) enters with (?:a \+1\/\+1 counter|that many charge counters?|a charge counter) on it for each color of mana spent to cast it\.?\)[.)]*$/i.test(normalizedText) ||
      /^if it's neither day nor night, it becomes day as this (?:creature|permanent) enters[.)]*$/i.test(normalizedText) ||
      /^you may reveal this card from your opening hand(?:[.)]*\s*if you do, at the beginning of the first upkeep, .+)?$/i.test(normalizedText) ||
      /^if you do, at the beginning of the first upkeep,\s+create\b.+$/i.test(normalizedText) ||
      /^play with the top card of your library revealed[.)]*$/i.test(normalizedText) ||
      /^creatures you control get [+-]\d+\/[+-]\d+[.)]*$/i.test(normalizedText) ||
      /^other creatures you control get [+-]\d+\/[+-]\d+[.)]*$/i.test(normalizedText) ||
      /^(?:equipped|enchanted) creature gets [+-]\d+\/[+-]\d+[.)]*$/i.test(normalizedText) ||
      /^you control enchanted (?:creature|permanent)[.)]*$/i.test(normalizedText) ||
      /^creatures you control have haste[.)]*$/i.test(normalizedText) ||
      /^(?:instant and sorcery|instant or sorcery) spells you cast cost \{\d+\} less to cast[.)]*$/i.test(normalizedText) ||
      /^all creatures able to block (?:this creature|this permanent|~) do so[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may reveal (?:a|an) .+? card from your hand\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may pay \d+ life\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^you have hexproof(?:\.?\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
      /^players can't gain life[.)]*$/i.test(normalizedText) ||
      /^players can't gain life this turn[.)]*$/i.test(normalizedText) ||
      /^each creature you control with a \+1\/\+1 counter on it has trample[.)]*$/i.test(normalizedText) ||
      /^creatures with power less than (?:this creature|~|[a-z0-9', -]+)'?s power can(?:'|â€™)?t block (?:it|this creature|~)[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power and toughness are each equal to (?:the )?number of lands you control[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power and toughness are each equal to (?:the )?number of cards in your hand[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power and toughness are each equal to (?:the )?number of creatures you control[.)]*$/i.test(normalizedText) ||
      /^(?:this (?:creature|permanent)'?s|~'?s) power is equal to (?:the )?number of creatures you control[.)]*$/i.test(normalizedText) ||
      /^(?:enchanted creature|this creature|this permanent) does(?:n't| not) untap during (?:its controller(?:'|â€™)s|your) untap step[.)]*$/i.test(normalizedText) ||
      /^(?:this creature|~|[a-z0-9', -]+) can block an additional(?: (?:\d+|[a-z]+(?:[ -][a-z]+)*))? creature(?:s)? each combat[.)]*$/i.test(normalizedText) ||
      /^this creature can block only creatures with flying[.)]*$/i.test(normalizedText) ||
      /^if this card is in your opening hand, you may begin the game with it on the battlefield[.)]*$/i.test(normalizedText) ||
      /^you have no maximum hand size[.)]*$/i.test(normalizedText) ||
      /^you may play an additional land on each of your turns[.)]*$/i.test(normalizedText)
    ) {
      return [];
    }

    const keywordGrantMatch = normalizedText.match(/^(?:equipped|enchanted) creature (?:has|gains?) (.+?)[.)]*$/i);
    if (keywordGrantMatch && isPureKeywordGrantList(String(keywordGrantMatch[1] || '').trim())) {
      return [];
    }

    const compoundKeywordGrantMatch = normalizedText.match(
      /^(?:equipped|enchanted) creature gets [+-]\d+\/[+-]\d+ and (?:has|gains?) (.+?)[.)]*$/i
    );
    if (
      compoundKeywordGrantMatch &&
      isPureKeywordGrantList(String(compoundKeywordGrantMatch[1] || '').trim())
    ) {
      return [];
    }

    return [ability];
  });
}

function isExternallyHandledTemporaryLandBonusUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  return /^you may play (?:(?:up to )?(?:a|an|one|two|three|four|five|\d+)) additional lands? this turn$/i.test(normalized);
}

export function pruneExternallyHandledTemporaryLandBonusUnknownSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const nextSteps = ability.steps.filter((step) => !isExternallyHandledTemporaryLandBonusUnknownStep(step));
    if (nextSteps.length === ability.steps.length) return [ability];
    if (nextSteps.length === 0) return [];
    return [{ ...ability, steps: nextSteps }];
  });
}

function isRedundantTriggerRestrictionUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^this ability triggers only once each turn[.)]*$/i.test(normalized) ||
    /^do this only once each turn[.)]*$/i.test(normalized)
  );
}

export function pruneRedundantTriggerRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantTriggerRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantPhasingReminderUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step)
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^while (?:it(?:'|â€™)?s|they(?:'|â€™)?re) phased out, (?:it(?:'|â€™)?s|they(?:'|â€™)?re) treated as though (?:it|they) (?:(?:does|do)n(?:'|â€™)?t|do(?:es)? not) exist[.)]*$/i.test(normalized) ||
    /^each one phases in before its controller untaps during their next untap step[.)]*$/i.test(normalized)
  );
}

export function pruneRedundantPhasingReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter((step) => !isRedundantPhasingReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantStillLandUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^it(?:'|â€™)s still a land[.)]*$/i.test(normalized);
}

export function pruneRedundantStillLandUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantStillLandUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantProliferateReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^choose any number of permanents and\/or players$/i.test(normalized) ||
    /^choose any number of permanents and\/or players, then give each another counter of each kind already there(?:\. then do it again)?$/i.test(normalized) ||
    /^to proliferate, choose any number of permanents and\/or players$/i.test(normalized) ||
    /^to proliferate, choose any number of permanents and\/or players, then give each another counter of each kind already there(?:\. then do it again)?$/i.test(normalized) ||
    /^(?:then\s+)?give each another counter of each kind already there(?:\. then do it again)?$/i.test(normalized)
  );
}

export function pruneRedundantProliferateReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!ability.steps.some((step) => step.kind === 'proliferate') && !normalizedText.includes('proliferate')) {
      return ability;
    }

    const nextSteps = ability.steps.filter(step => !isRedundantProliferateReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantClashReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^each clashing player reveals the top card of their library$/i.test(normalized) ||
    /^then puts that card on their choice of the top or bottom$/i.test(normalized) ||
    /^a player wins if their card had a greater mana value$/i.test(normalized)
  );
}

function isRedundantClashReminderUnknownAbility(ability: OracleIRAbility): boolean {
  if (!isUnknownOnlyAbility(ability)) return false;

  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (normalizedText && isRedundantClashReminderUnknownStep({ kind: 'unknown', raw: normalizedText })) {
    return true;
  }

  const normalizedStepRaws = ability.steps
    .map((step) => normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim())
    .filter(Boolean);

  return normalizedStepRaws.length > 0 && normalizedStepRaws.every((raw) =>
    isRedundantClashReminderUnknownStep({ kind: 'unknown', raw })
  );
}

export function pruneRedundantClashReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const hasClashStep = abilities.some((ability) => ability.steps.some((step) => step.kind === 'clash'));
  if (!hasClashStep) return [...abilities];

  return abilities
    .map((ability) => {
      const nextSteps = ability.steps.filter(step => !isRedundantClashReminderUnknownStep(step));
      return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
    })
    .filter((ability) => !isRedundantClashReminderUnknownAbility(ability));
}

function isRedundantScryReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^look at the top (?:card|[a-z0-9-]+ cards?) of your library$/i.test(normalized) ||
    /^to scry\s+[^,]+, look at the top (?:card|[a-z0-9-]+ cards?) of your library$/i.test(normalized) ||
    /^to scry\s+[^,]+, look at the top (?:card|[a-z0-9-]+ cards?) of your library, (?:you may put that card on the bottom|then put any number of them on the bottom(?: of your library)? and the rest on top in any order)$/i.test(normalized) ||
    /^you may put that card on the bottom$/i.test(normalized) ||
    /^(?:then\s+)?put any number of them on the bottom(?: of your library)? and the rest on top in any order$/i.test(normalized)
  );
}

function isUnknownOnlyAbility(ability: OracleIRAbility): boolean {
  return ability.steps.length === 0 || ability.steps.every((step) => step.kind === 'unknown');
}

function isRedundantScryReminderUnknownAbility(ability: OracleIRAbility): boolean {
  if (!isUnknownOnlyAbility(ability)) return false;

  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (normalizedText && isRedundantScryReminderUnknownStep({ kind: 'unknown', raw: normalizedText })) {
    return true;
  }

  const normalizedStepRaws = ability.steps
    .map((step) => normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim())
    .filter(Boolean);

  return normalizedStepRaws.length > 0 && normalizedStepRaws.every((raw) =>
    isRedundantScryReminderUnknownStep({ kind: 'unknown', raw })
  );
}

export function pruneRedundantScryReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const hasScryStep = abilities.some((ability) => ability.steps.some((step) => step.kind === 'scry'));
  if (!hasScryStep) return [...abilities];

  return abilities
    .map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantScryReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
    })
    .filter((ability) => !isRedundantScryReminderUnknownAbility(ability));
}

function isRedundantLookTopReorderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  return /^(?:then\s+)?put (?:them|those cards|it|that card) back in any order$/i.test(normalized);
}

export function pruneRedundantLookTopReorderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const hasTopLibraryInfo = ability.steps.some((step) => step.kind === 'look_top' || step.kind === 'reveal_top');
    if (!hasTopLibraryInfo) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantLookTopReorderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantExploreReminderStep(step: OracleEffectStep): boolean {
  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (step.kind === 'unknown') {
    return (
      /^reveal the top card of your library$/i.test(normalized) ||
      /^to have (?:this creature|that creature|it) explore, reveal the top card of your library$/i.test(normalized) ||
      /^otherwise, put a \+1\/\+1 counter on this creature$/i.test(normalized) ||
      /^then repeat this process$/i.test(normalized)
    );
  }

  if (step.kind === 'conditional') {
    const normalizedCondition = normalizeOracleText(String(step.condition.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();

    return (
      /^put that card into your hand if it(?:'|â€™)s a land$/i.test(normalized) &&
      /^it(?:'|â€™)s a land$/i.test(normalizedCondition)
    );
  }

  if (step.kind === 'add_counter') {
    return /^(?:otherwise,\s*)?put a \+1\/\+1 counter on this creature$/i.test(normalized);
  }

  if (step.kind === 'move_zone') {
    return /^(?:then\s+)?put the card back or put it into your graveyard$/i.test(normalized);
  }

  return false;
}

function isRedundantExploreReminderOnlyAbility(ability: OracleIRAbility): boolean {
  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();

  if (ability.steps.length === 0) {
    return (
      /reveal the top card of your library/i.test(normalizedText) &&
      /put that card into your hand if it(?:'|â€™)s a land/i.test(normalizedText)
    );
  }

  return ability.steps.every((step) => isRedundantExploreReminderStep(step));
}

export function pruneRedundantExploreReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const hasExploreStep = abilities.some((ability) => ability.steps.some((step) => step.kind === 'explore'));
  if (!hasExploreStep) return [...abilities];

  return abilities
    .map((ability) => {
      const nextSteps = ability.steps.filter((step) => !isRedundantExploreReminderStep(step));
      return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
    })
    .filter((ability) => !isRedundantExploreReminderOnlyAbility(ability));
}

function isRedundantBestowReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return /^it becomes a creature again if it(?:'|â€™)s not attached$/i.test(normalized);
}

export function pruneRedundantBestowReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter((step) => !isRedundantBestowReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function parseSelfEntryCounterReplacement(rawText: string): {
  readonly counter: string;
  readonly amount: ReturnType<typeof parseQuantity>;
  readonly raw: string;
} | null {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return null;

  const shortMatch = normalized.match(/^with\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i);
  const fullMatch = normalized.match(
    /^(?:this\s+[^.;]+?|it)\s+enters(?: the battlefield)?\s+with\s+(a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i
  );
  const match = shortMatch || fullMatch;
  if (!match) return null;

  const amount = parseQuantity(String(match[1] || '').trim());
  if (amount.kind !== 'number' && amount.kind !== 'x') return null;

  const counter = normalizeCounterName(String(match[2] || '').trim());
  if (!counter) return null;

  return {
    counter,
    amount,
    raw: String(rawText || '').trim() || normalized,
  };
}

export function lowerSelfEntryCounterReplacementAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.REPLACEMENT) return ability;

    const parsed = parseSelfEntryCounterReplacement(String(ability.effectText || ability.text || ''));
    if (!parsed) return ability;

    const hasAddCounterStep = ability.steps.some((step) => step.kind === 'add_counter');
    let removedMatchingUnknown = false;
    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') return true;
      if (!parseSelfEntryCounterReplacement(String(step.raw || ''))) return true;
      removedMatchingUnknown = true;
      return false;
    });

    if (hasAddCounterStep) {
      return removedMatchingUnknown ? { ...ability, steps: nextSteps } : ability;
    }

    return {
      ...ability,
      steps: [
        ...nextSteps,
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'this permanent' },
          counter: parsed.counter,
          amount: parsed.amount,
          raw: parsed.raw,
        },
      ],
    };
  });
}

function isRedundantEntersTappedReplacementUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  return (
    /^tapped$/i.test(normalized) ||
    /^tapped unless you control two or fewer other lands$/i.test(normalized) ||
    /^tapped unless you control two or more other lands$/i.test(normalized) ||
    /^tapped unless a player has 13 or less life$/i.test(normalized) ||
    /^tapped unless you control two or more basic lands$/i.test(normalized) ||
    /^tapped unless you have two or more opponents$/i.test(normalized)
  );
}

export function pruneRedundantEntersTappedReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type !== AbilityType.REPLACEMENT) return ability;

    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/[.)\s]+$/g, '')
      .trim();
    if (!/\benters(?: the battlefield)? tapped(?: unless you control two or fewer other lands| unless you control two or more other lands| unless a player has 13 or less life| unless you control two or more basic lands| unless you have two or more opponents)?$/i.test(normalizedText)) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => !isRedundantEntersTappedReplacementUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantInfectKeywordUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/[.)\s]+$/g, '')
      .trim();
    if (!/^infect(?:\s*\(this creature deals damage to creatures in the form of -1\/-1 counters and to players in the form of poison counters)?$/i.test(normalizedText)) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') return true;
      const normalized = normalizeOracleText(String(step.raw || ''))
        .replace(/[.)\s]+$/g, '')
        .trim();
      return !/^infect(?:\s*\(this creature deals damage to creatures in the form of -1\/-1 counters and to players in the form of poison counters)?$/i.test(normalized);
    });
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantCoinFlipLeadUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  return /^flip a coin$/i.test(normalized);
}

function isCoinFlipConditionalStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'conditional') return false;

  const normalized = normalizeOracleText(String(step.condition?.raw || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  return normalized === 'you win the flip' || normalized === 'you lose the flip';
}

export function pruneRedundantCoinFlipLeadUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!isRedundantCoinFlipLeadUnknownStep(ability.steps[0])) return ability;
    if (!ability.steps.slice(1).some((step) => isCoinFlipConditionalStep(step))) return ability;
    return {
      ...ability,
      steps: ability.steps.slice(1),
    };
  });
}

function isRedundantLandwalkKeywordText(text: string | undefined): boolean {
  const normalized = normalizeOracleText(String(text || ''))
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (
    /^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)\s*\(this creature can't be blocked as long as defending player controls an? (?:plains|island|swamp|mountain|forest)$/i.test(
      normalized
    )
  ) {
    return true;
  }

  return /^(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)(?:,\s*(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk))*$/i.test(
    normalized
  );
}

export function pruneRedundantLandwalkKeywordUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!isRedundantLandwalkKeywordText(String(ability.text || ability.effectText || ''))) {
      return ability;
    }

    const nextSteps = ability.steps.filter((step) => {
      if (step.kind !== 'unknown') return true;
      return !isRedundantLandwalkKeywordText(step.raw);
    });
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function expandScavengeKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'add_counter');
    if (alreadyExpanded || !normalizedText.startsWith('scavenge ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText: "Put X +1/+1 counters on target creature, where X is this card's power. Activate only as a sorcery.",
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'exile',
          toRaw: 'exile',
          raw: 'Exile this card from your graveyard.',
        },
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'target creature' },
          counter: '+1/+1',
          amount: { kind: 'x' },
          raw: "Put X +1/+1 counters on target creature, where X is this card's power.",
        },
      ],
    };
  });
}

export function expandEmbalmKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'create_token');
    if (alreadyExpanded || !normalizedText.startsWith('embalm ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText:
        "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery.",
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'exile',
          toRaw: 'exile',
          raw: 'Exile this card from your graveyard.',
        },
        {
          kind: 'create_token',
          who: { kind: 'you' },
          token:
            "copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types",
          amount: { kind: 'number', value: 1 },
          raw: "Create a token that's a copy of it, except it's white, it has no mana cost, and it's a Zombie in addition to its other types.",
        },
      ],
    };
  });
}

export function expandEternalizeKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'create_token');
    if (alreadyExpanded || !normalizedText.startsWith('eternalize ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText:
        "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types. Activate only as a sorcery.",
      steps: [
        {
          kind: 'move_zone',
          what: { kind: 'raw', text: 'this card' },
          to: 'exile',
          toRaw: 'exile',
          raw: 'Exile this card from your graveyard.',
        },
        {
          kind: 'create_token',
          who: { kind: 'you' },
          token:
            "copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types",
          amount: { kind: 'number', value: 1 },
          raw: "Create a token that's a copy of it, except it's black, it's 4/4, it has no mana cost, and it's a Zombie in addition to its other types.",
        },
      ],
    };
  });
}

export function expandTransmuteKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const matchesCanonicalEffect =
      normalizedEffect.includes('search your library for a card with the same mana value as this card') ||
      normalizedText.includes('search your library for a card with the same mana value as this card') ||
      normalizedEffect.includes('same mana value as this card') ||
      normalizedText.includes('same mana value as this card');
    if (!normalizedText.startsWith('transmute ') && !matchesCanonicalEffect) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(manaCost ? { cost: `${manaCost}, Discard this card` } : {}),
      effectText:
        'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Activate only as a sorcery.',
      steps: [
        {
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'same_mana_value_as_source' },
          destination: 'hand',
          revealFound: true,
          shuffle: true,
          maxResults: 1,
          raw: 'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle.',
        },
      ],
    };
  });
}

function parseTypecyclingSearchSelector(ability: OracleIRAbility): string | null {
  const normalizedText = normalizeOracleText(String(ability.text || '')).trim();
  if (/^basic landcycling\b/i.test(normalizedText)) return 'basic land';

  const keywordMatch = normalizedText.match(/^([a-z]+)cycling\b/i);
  if (keywordMatch) {
    return String(keywordMatch[1] || '').trim();
  }

  const effectMatch = normalizeOracleText(String(ability.effectText || ''))
    .trim()
    .match(/^search your library for (?:a|an) (.+?) card, reveal it, put it into your hand, then shuffle/i);
  if (!effectMatch) return null;
  return String(effectMatch[1] || '').trim();
}

function formatTypecyclingSelectorForEffect(selector: string): string {
  if (/^basic land$/i.test(selector)) return 'basic land';
  return String(selector || '')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function indefiniteArticleForSelector(selector: string): 'a' | 'an' {
  return /^[aeiou]/i.test(String(selector || '').trim()) ? 'an' : 'a';
}

export function expandTypecyclingKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const alreadyExpanded = ability.steps.some((step) => step.kind === 'search_library');
    const matchesKeywordLine =
      /^basic landcycling\b/i.test(normalizedText) ||
      (/^[a-z]+cycling\b/i.test(normalizedText) && !/^cycling\b/i.test(normalizedText));
    const matchesCanonicalEffect =
      normalizedEffect.startsWith('search your library for a ') ||
      normalizedEffect.startsWith('search your library for an ');
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const selector = parseTypecyclingSearchSelector(ability);
    if (!selector) return ability;

    const formattedSelector = formatTypecyclingSelectorForEffect(selector);
    const article = indefiniteArticleForSelector(formattedSelector);
    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(matchesKeywordLine && manaCost ? { cost: `${manaCost}, Discard this card` } : {}),
      effectText: `Search your library for ${article} ${formattedSelector} card, reveal it, put it into your hand, then shuffle.`,
      steps: [
        {
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'raw', text: selector },
          destination: 'hand',
          revealFound: true,
          shuffle: true,
          maxResults: 1,
          raw: `Search your library for ${article} ${formattedSelector} card, reveal it, put it into your hand, then shuffle.`,
        },
      ],
    };
  });
}

export function expandTransfigureKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded = ability.steps.some((step) => step.kind === 'search_library');
    const canonicalEffectPrefix = 'search your library for a creature card with the same mana value as this permanent';
    const matchesKeywordLine = normalizedText.startsWith('transfigure ');
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix);
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    return {
      ...ability,
      ...(matchesKeywordLine && manaCost ? { cost: `${manaCost}, Sacrifice this permanent` } : {}),
      effectText:
        'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle. Activate only as a sorcery.',
      steps: [
        {
          kind: 'search_library',
          who: { kind: 'you' },
          criteria: { kind: 'same_mana_value_as_source', requiredCardType: 'creature' },
          destination: 'battlefield',
          shuffle: true,
          maxResults: 1,
          raw: 'Search your library for a creature card with the same mana value as this permanent, put it onto the battlefield, then shuffle.',
        },
      ],
    };
  });
}

export function expandEncoreKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'create_token' && (step as any).attacking === 'each_opponent');
    const canonicalEffectPrefix = "for each opponent, create a token that's a copy of it";
    const matchesKeywordLine = normalizedText.startsWith('encore ');
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix);
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    const createTokenStep: OracleEffectStep = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      token: "copy of it",
      entersTapped: true,
      attacking: 'each_opponent',
      grantsHaste: 'permanent',
      atNextEndStep: 'sacrifice',
      raw: "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step.",
    };

    return {
      ...ability,
      ...(matchesKeywordLine && manaCost ? { cost: `${manaCost}, Exile this card from your graveyard` } : {}),
      effectText:
        "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.",
      steps: matchesKeywordLine
        ? [
            {
              kind: 'move_zone',
              what: { kind: 'raw', text: 'this card' },
              to: 'exile',
              toRaw: 'exile',
              raw: 'Exile this card from your graveyard.',
            },
            createTokenStep,
          ]
        : [createTokenStep],
    };
  });
}

export function expandMyriadKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.triggerCondition === 'this creature attacks' &&
      ability.steps.some((step) => step.kind === 'create_token' && (step as any).attacking === 'each_other_opponent');
    const canonicalEffectPrefix =
      "for each opponent other than defending player, create a token that's a copy of it";
    const canonicalTokenCopyEffectPrefix =
      'for each opponent other than defending player, create a token copy';
    const canonicalOptionalTokenCopyEffectPrefix =
      'for each opponent other than defending player, you may create a token copy';
    const normalizedTextWithoutTrigger = normalizedText.replace(/^whenever it attacks,\s*/i, '');
    const matchesKeywordLine = normalizedText === 'myriad';
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix) ||
      normalizedEffect.startsWith(canonicalTokenCopyEffectPrefix) ||
      normalizedEffect.startsWith(canonicalOptionalTokenCopyEffectPrefix) ||
      normalizedTextWithoutTrigger.startsWith(canonicalTokenCopyEffectPrefix) ||
      normalizedTextWithoutTrigger.startsWith(canonicalOptionalTokenCopyEffectPrefix);
    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    const createTokenStep: OracleEffectStep = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      token: "copy of it",
      entersTapped: true,
      attacking: 'each_other_opponent',
      atEndOfCombat: 'exile',
      raw: "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
    };

    return {
      ...ability,
      type: AbilityType.TRIGGERED,
      triggerCondition: 'this creature attacks',
      effectText:
        "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
      steps: [createTokenStep],
    };
  });
}

export function expandMobilizeKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.triggerCondition === 'this creature attacks' &&
      ability.steps.some((step) => step.kind === 'create_token' && (step as any).attacking === 'defending_player');
    const mobilizeMatch = normalizedText.match(/^mobilize\s+(\d+)(?:\s*\(.*)?$/i);
    const canonicalEffectPrefix = 'create ';
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) &&
      normalizedEffect.includes('red warrior creature token') &&
      normalizedEffect.includes('enter tapped and attacking') &&
      normalizedEffect.includes('next end step');
    if (alreadyExpanded || (!mobilizeMatch && !matchesCanonicalEffect)) {
      return ability;
    }

    const canonicalAmountMatch = normalizedEffect.match(/^create\s+(a|an|\d+)\s+1\/1 red warrior creature token/);
    const inferredAmountText = String(mobilizeMatch?.[1] || canonicalAmountMatch?.[1] || '1').trim().toLowerCase();
    const amount =
      inferredAmountText === 'a' || inferredAmountText === 'an'
        ? 1
        : Number.parseInt(inferredAmountText, 10);
    const createTokenStep: OracleEffectStep = {
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'number', value: Number.isFinite(amount) && amount > 0 ? amount : 1 },
      token: '1/1 red Warrior creature',
      entersTapped: true,
      attacking: 'defending_player',
      atNextEndStep: 'sacrifice',
      raw: `Create ${Number.isFinite(amount) && amount > 1 ? amount : 'a'} 1/1 red Warrior creature token${Number.isFinite(amount) && amount > 1 ? 's' : ''}. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.`,
    };

    return {
      ...ability,
      type: AbilityType.TRIGGERED,
      triggerCondition: 'this creature attacks',
      effectText: createTokenStep.raw,
      steps: [createTokenStep],
    };
  });
}

export function expandTokenCreationReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some((step) => step.kind === 'unknown')) return ability;

    const rawText = String(ability.text || ability.effectText || '').trim();
    if (!rawText) return ability;

    const parsed = tryParseTokenCreationReplacementClause({
      clause: rawText,
      rawClause: rawText,
      withMeta: <T extends OracleEffectStep>(step: T): T => step,
    });
    if (!parsed) return ability;

    return {
      ...ability,
      effectText: rawText,
      steps: [parsed],
    };
  });
}

function uniqueTokenCreationCandidates(rawText: string): string[] {
  const normalized = normalizeOracleText(rawText)
    .replace(/^[\s(]+/, '')
    .replace(/[\s.)]+$/g, '')
    .replace(/^[\u2022•]\s*/, '')
    .trim();
  if (!normalized) return [];

  const candidates: string[] = [];
  const addCandidate = (candidate: string, includeDerived = true) => {
    const value = normalizeOracleText(candidate)
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const activatedBody = value.match(/:\s*(create(?:s)?\b.+)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);

    const pipeBody = value.match(/^\s*[^|]+\|\s*(.+)$/);
    if (pipeBody) addCandidate(String(pipeBody[1] || '').trim(), false);
  };

  addCandidate(normalized);

  const squadReminderCreate = normalized.match(/\bsquad\b[\s\S]*?\bwhen this (?:creature|permanent) enters,\s*(create(?:s)?\b[\s\S]*?)(?=\)|$)/i);
  if (squadReminderCreate) addCandidate(String(squadReminderCreate[1] || '').trim());

  const dieBandPattern = /(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*([\s\S]*?)(?=\s+\d+(?:\s*[-\u2013\u2014]\s*\d+)?\s*\||$)/g;
  let dieBandMatch: RegExpExecArray | null;
  while ((dieBandMatch = dieBandPattern.exec(normalized)) !== null) {
    addCandidate(String(dieBandMatch[3] || '').trim());
  }

  const triggerMatch = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerMatch) addCandidate(String(triggerMatch[1] || '').trim());

  const conditionalMatch = normalized.match(/^if\b[^,]+,\s+(.+)$/i);
  if (conditionalMatch) addCandidate(String(conditionalMatch[1] || '').trim());

  const andCreateMatch = normalized.match(/\band\s+(create(?:s)?\b.+)$/i);
  if (andCreateMatch) addCandidate(String(andCreateMatch[1] || '').trim());

  const thenCreateMatch = normalized.match(/\bthen\s+(create(?:s)?\b.+)$/i);
  if (thenCreateMatch) addCandidate(String(thenCreateMatch[1] || '').trim());

  const createAnywhereMatch = normalized.match(/\b(create(?:s)?\b[\s\S]+)$/i);
  if (createAnywhereMatch) addCandidate(String(createAnywhereMatch[1] || '').trim());

  for (const line of normalized.split(/\n+/)) {
    const createLineMatch = line.match(/\b(create(?:s)?\b.+)$/i);
    if (createLineMatch) addCandidate(String(createLineMatch[1] || '').trim());
  }

  const quoted = /"([^"]+)"/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quoted.exec(normalized)) !== null) {
    const quotedText = String(quotedMatch[1] || '').trim();
    addCandidate(quotedText);
    const activatedBody = quotedText.match(/:\s*(create(?:s)?\b.+)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim());
  }

  return candidates;
}

function parseTokenCreationMetadataStep(rawText: string): OracleEffectStep | null {
  for (const candidate of uniqueTokenCreationCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const strippedMayCandidate = normalized.clause.replace(/^you\s+may\s+/i, '').trim();
    for (const createClause of [normalized.clause, strippedMayCandidate]) {
      const parsed = tryParseSimpleCreateTokenClause({
        clause: createClause,
        rawClause: rawText,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed) return parsed;
    }
  }

  return null;
}

function parseMyriadTokenCreationMetadataStep(rawText: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawText);
  const hasMyriadKeyword = /\bmyriad\b/i.test(normalized);
  if (!hasMyriadKeyword) {
    if (!/for each opponent other than defending player/i.test(normalized)) return null;
    if (!/\bcreate\s+a\s+token\s+cop(?:y|ies)\b/i.test(normalized)) return null;
  }

  return {
    kind: 'create_token',
    who: { kind: 'you' },
    amount: { kind: 'x' },
    token: 'copy of it',
    entersTapped: true,
    attacking: 'each_other_opponent',
    atEndOfCombat: 'exile',
    raw: rawText,
  };
}

function annotateTokenCreationMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateTokenCreationMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateTokenCreationMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateTokenCreationMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'populate') {
    const nestedStep: OracleEffectStep = {
      kind: 'create_token',
      who: step.who,
      amount: step.amount,
      token: 'copy of a creature token you control',
      raw: step.raw,
      ...(step.optional ? { optional: step.optional } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
    };
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (existingSteps.some((existingStep) => existingStep.kind === 'create_token')) return step;
    return { ...step, steps: [...existingSteps, nestedStep] };
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseTokenCreationMetadataStep(effectText) ?? parseMyriadTokenCreationMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    const rawParsed = parseTokenCreationMetadataStep(step.raw) ?? parseMyriadTokenCreationMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (Array.isArray((step as any).abilities) && ((step as any).abilities as readonly string[]).includes('myriad')) {
      const parsed = parseMyriadTokenCreationMetadataStep(step.raw || 'myriad');
      if (parsed) metadataSteps.push(parsed);
    }
    if (metadataSteps.length === 0) return step;
    return { ...step, steps: [...existingSteps, ...metadataSteps] };
  }

  if (step.kind === 'unknown' && /(?:\bcreate(?:s)?\b[\s\S]*\btoken|\bmyriad\b)/i.test(normalizeOracleText(String(step.raw || '')))) {
    const parsed = parseTokenCreationMetadataStep(step.raw) ?? parseMyriadTokenCreationMetadataStep(step.raw);
    if (!parsed) return step;
    return { ...(step as any), steps: [parsed] } as OracleEffectStep;
  }

  return step;
}

function hasCreateTokenStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'create_token') return true;
    if (hasCreateTokenStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasCreateTokenStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasCreateTokenStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function parseTokenCreationMetadataFromAbilityText(ability: OracleIRAbility): OracleEffectStep | null {
  const candidates = [ability.effectText, ability.text];
  for (const candidate of candidates) {
    if (/\bto investigate,\s*create a clue token\b/i.test(normalizeOracleText(String(candidate || '')))) continue;
    const parsed = parseTokenCreationMetadataStep(candidate) ?? parseMyriadTokenCreationMetadataStep(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function isSquadReminderAbilityText(ability: OracleIRAbility): boolean {
  return /^squad\b/i.test(
    normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function hasSquadTokenReminderText(rawText: string | undefined): boolean {
  return /\bsquad\b[\s\S]*?\bwhen this (?:creature|permanent) enters,\s*create(?:s)?\s+that many tokens? that (?:are|is) copies of it/i.test(
    normalizeOracleText(String(rawText || ''))
  );
}

const TOKEN_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS = new Set<string>([
  'grant_static_ability',
  'grant_temporary_ability',
  'grant_temporary_dies_trigger',
  'modify_token_creation',
]);

function canAppendTokenMetadataDespiteBlockedKinds(ability: OracleIRAbility): boolean {
  const blockedSteps = ability.steps.filter((step) => TOKEN_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS.has(step.kind));
  if (blockedSteps.length === 0) return true;
  const allBlockedStepsAreTemporaryGrant = blockedSteps.every((step) => step.kind === 'grant_temporary_ability');
  if (!allBlockedStepsAreTemporaryGrant) return false;

  const text = normalizeOracleText(`${String(ability.text || '')} ${String(ability.effectText || '')}`);
  return /\b\d+\+\s*\|[\s\S]*\bcreate(?:s)?\b[\s\S]*\btoken/i.test(text);
}

function appendSquadTokenMetadataFallback(
  abilities: readonly OracleIRAbility[],
  parsed: OracleEffectStep,
  rawText: string
): OracleIRAbility[] {
  const metadataWrapper = { kind: 'unknown', raw: 'Token creation metadata', steps: [parsed] } as any as OracleEffectStep;
  const targetIndex = abilities.findIndex(
    (ability) =>
      !isSquadReminderAbilityText(ability) &&
      !hasCreateTokenStepInTree(ability.steps) &&
      ability.steps.some((step) => step.kind !== 'unknown')
  );

  if (targetIndex >= 0) {
    return abilities.map((ability, index) =>
      index === targetIndex ? { ...ability, steps: [...ability.steps, metadataWrapper] } : ability
    );
  }

  return [
    ...abilities,
    {
      type: AbilityType.STATIC,
      text: 'Token creation metadata',
      effectText: rawText,
      steps: [metadataWrapper],
    },
  ];
}

export function annotateTokenCreationMetadataAbilities(
  abilities: readonly OracleIRAbility[],
  oracleText?: string
): OracleIRAbility[] {
  const annotated = abilities.map((ability) => {
    const steps = ability.steps.map(annotateTokenCreationMetadataOnStep);
    const withAnnotatedSteps = steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
    if (hasCreateTokenStepInTree(withAnnotatedSteps.steps)) return withAnnotatedSteps;

    const parsed = parseTokenCreationMetadataFromAbilityText(withAnnotatedSteps);
    if (!parsed) return withAnnotatedSteps;
    if (!canAppendTokenMetadataDespiteBlockedKinds(withAnnotatedSteps)) return withAnnotatedSteps;
    return { ...withAnnotatedSteps, steps: [...withAnnotatedSteps.steps, parsed] };
  });

  const nonSquadAbilities = annotated.filter((ability) => !isSquadReminderAbilityText(ability));
  if (hasCreateTokenStepInTree(nonSquadAbilities.flatMap((ability) => ability.steps))) return annotated;

  if (oracleText && hasSquadTokenReminderText(oracleText)) {
    const squadAbility = annotated.find((ability) => isSquadReminderAbilityText(ability));
    const parsed = squadAbility ? parseTokenCreationMetadataFromAbilityText(squadAbility) : parseTokenCreationMetadataStep(oracleText);
    if (parsed && nonSquadAbilities.length > 0) {
      return appendSquadTokenMetadataFallback(annotated, parsed, squadAbility?.text || oracleText);
    }
  }

  if (hasCreateTokenStepInTree(annotated.flatMap((ability) => ability.steps))) return annotated;
  if (annotated.length === 0 || !oracleText || !hasSquadTokenReminderText(oracleText)) return annotated;

  const parsed = parseTokenCreationMetadataStep(oracleText);
  if (!parsed) return annotated;
  return appendSquadTokenMetadataFallback(annotated, parsed, oracleText);
}

function uniqueDamageCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/(?:\bdeals?\b[\s\S]*\bdamage\b|\bdamage\b[\s\S]*\binstead\b|\bfights?\b)/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const activatedBody = value.match(/:\s*([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);

    const pipeBody = value.match(/^\s*[^|]+\|\s*(.+)$/);
    if (pipeBody) addCandidate(String(pipeBody[1] || '').trim(), false);
  };

  addCandidate(normalized);

  const triggerMatch = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (triggerMatch) addCandidate(String(triggerMatch[1] || '').trim());

  const conditionalMatch = normalized.match(/^if\b.+?(?:\bwould\s+deal\b|,),\s+(.+)$/i);
  if (conditionalMatch) addCandidate(String(conditionalMatch[1] || '').trim());

  const commaEmbeddedDamage = normalized.match(/,\s*([^,;]*\bdeals?\b[\s\S]*)$/i);
  if (commaEmbeddedDamage) addCandidate(String(commaEmbeddedDamage[1] || '').trim());

  const andDamageMatch = normalized.match(/\band\s+([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
  if (andDamageMatch) addCandidate(String(andDamageMatch[1] || '').trim());

  const thenDamageMatch = normalized.match(/\bthen\s+([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
  if (thenDamageMatch) addCandidate(String(thenDamageMatch[1] || '').trim());

  const damageAnywhereMatch = normalized.match(/((?:if\b[\s\S]*?would\s+deal\s+[\s\S]*?instead|[\s\S]*?\bdeals?\s+[\s\S]*?\bdamage\b[\s\S]*|[\s\S]*?\bfights?\b[\s\S]*))$/i);
  if (damageAnywhereMatch) addCandidate(String(damageAnywhereMatch[1] || '').trim());

  for (const line of normalized.split(/\n+/)) addCandidate(line);
  for (const sentence of normalized.split(/\.\s+/)) addCandidate(sentence);

  const haveDealMatch = normalized.match(/(?:^|\.\s*)([^.]*\bmay\s+have\b[^.]*\bdeal\b[^.]*)/i);
  if (haveDealMatch) addCandidate(String(haveDealMatch[1] || '').trim());

  const quoted = /"([^"]+)"/g;
  let quotedMatch: RegExpExecArray | null;
  while ((quotedMatch = quoted.exec(normalized)) !== null) {
    const quotedText = String(quotedMatch[1] || '').trim();
    addCandidate(quotedText);
    const activatedBody = quotedText.match(/:\s*([\s\S]*?(?:\bdeals?\b[\s\S]*\bdamage\b|\bfights?\b)[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim());
  }

  return candidates;
}

function parseDamageMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueDamageCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const strippedMayCandidate = normalized.clause.replace(/^you\s+may\s+/i, '').trim();
    for (const damageClause of [normalized.clause, strippedMayCandidate]) {
      const parsed = tryParseLifeAndCombatClause({
        clause: damageClause,
        rawClause: candidate,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed && (parsed.kind === 'deal_damage' || parsed.kind === 'modify_damage')) return parsed;
    }
  }

  return null;
}

function uniqueDrawCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\bdraws?\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const activatedBody = value.match(/:\s*([\s\S]*?\bdraws?\b[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }
  };

  addCandidate(normalized);
  return candidates;
}

function parseDrawMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueDrawCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const strippedMayCandidate = normalized.clause.replace(/^you\s+may\s+/i, '').trim();
    for (const drawClause of [normalized.clause, strippedMayCandidate]) {
      const parsed = tryParseSimpleActionClause({
        clause: drawClause,
        rawClause: candidate,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed?.kind === 'draw') return parsed;
    }
  }

  return null;
}

function hasDrawStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'draw') return true;
    if (hasDrawStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasDrawStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasDrawStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function annotateDrawMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateDrawMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateDrawMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateDrawMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasDrawStepInTree(existingSteps)) return step;
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    const metadataSteps = effectTexts
      .map((effectText) => parseDrawMetadataStep(effectText))
      .filter((parsed): parsed is OracleEffectStep => Boolean(parsed));
    const rawParsed = parseDrawMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    return { ...step, steps: [...existingSteps, ...metadataSteps] };
  }

  if (step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasDrawStepInTree(existingSteps)) return step;
    const metadataSteps = step.abilities
      .map((emblemAbility) => parseDrawMetadataStep(emblemAbility))
      .filter((parsed): parsed is OracleEffectStep => Boolean(parsed));
    const rawParsed = parseDrawMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    return { ...step, steps: [...existingSteps, ...metadataSteps] };
  }

  return step;
}

export function annotateDrawMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateDrawMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function hasDamageStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'deal_damage' || step.kind === 'modify_damage') return true;
    if (hasDamageStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasDamageStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasDamageStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function appendUniqueDamageMetadataSteps(
  existingSteps: readonly OracleEffectStep[],
  metadataSteps: readonly OracleEffectStep[]
): OracleEffectStep[] {
  const nextSteps = [...existingSteps];
  const seen = new Set(nextSteps.map((step) => `${step.kind}:${normalizeOracleText(String(step.raw || ''))}`));
  for (const parsed of metadataSteps) {
    const key = `${parsed.kind}:${normalizeOracleText(String(parsed.raw || ''))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextSteps.push(parsed);
  }
  return nextSteps;
}

function annotateDamageMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateDamageMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateDamageMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateDamageMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'schedule_delayed_trigger') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    const parsed = parseDamageMetadataStep(step.effect);
    if (!parsed) return step;
    const steps = appendUniqueDamageMetadataSteps(existingSteps, [parsed]);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseDamageMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    const rawParsed = parseDamageMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueDamageMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    const metadataSteps: OracleEffectStep[] = [];
    for (const emblemAbility of step.abilities) {
      const parsed = parseDamageMetadataStep(emblemAbility);
      if (parsed) metadataSteps.push(parsed);
    }
    const rawParsed = parseDamageMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueDamageMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'unknown' && /(?:\bdeals?\b[\s\S]*\bdamage\b|\bdamage\b[\s\S]*\binstead\b|\bfights?\b)/i.test(normalizeOracleText(String(step.raw || '')))) {
    const parsed = parseDamageMetadataStep(step.raw);
    if (!parsed) return step;
    const existingSteps = Array.isArray((step as any).steps) ? ((step as any).steps as readonly OracleEffectStep[]) : [];
    const steps = appendUniqueDamageMetadataSteps(existingSteps, [parsed]);
    return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as OracleEffectStep);
  }

  return step;
}

function parseDamageMetadataFromAbilityText(ability: OracleIRAbility): OracleEffectStep | null {
  const candidates = [ability.effectText, ability.text];
  for (const candidate of candidates) {
    const parsed = parseDamageMetadataStep(candidate);
    if (parsed) return parsed;
  }
  return null;
}

const DAMAGE_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS = new Set<string>([
  'grant_static_ability',
  'grant_temporary_ability',
  'deal_damage',
  'modify_damage',
  'prevent_damage',
]);

function canAppendDamageMetadataDespiteBlockedKinds(ability: OracleIRAbility): boolean {
  return !ability.steps.some((step) => DAMAGE_METADATA_ABILITY_FALLBACK_BLOCKED_KINDS.has(step.kind));
}

export function annotateDamageMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateDamageMetadataOnStep);
    const withAnnotatedSteps = steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
    if (hasDamageStepInTree(withAnnotatedSteps.steps)) return withAnnotatedSteps;

    const parsed = parseDamageMetadataFromAbilityText(withAnnotatedSteps);
    if (!parsed) return withAnnotatedSteps;
    if (!canAppendDamageMetadataDespiteBlockedKinds(withAnnotatedSteps)) return withAnnotatedSteps;

    const metadataWrapper = { kind: 'unknown', raw: 'Damage metadata', steps: [parsed] } as any as OracleEffectStep;
    return { ...withAnnotatedSteps, steps: [...withAnnotatedSteps.steps, metadataWrapper] };
  });
}

export function pruneStaticMyriadReminderTailAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const hasStaticMyriadGrant = ability.steps.some((step) => {
      if (step.kind !== 'grant_static_ability' && step.kind !== 'grant_temporary_ability') return false;
      return Array.isArray((step as any).abilities) && (step as any).abilities.includes('myriad');
    });
    if (!hasStaticMyriadGrant) return ability;

    const nextSteps = ability.steps.filter((step) => {
      const raw = normalizeOracleText(String(step.raw || ''))
        .replace(/^[()\s]+/, '')
        .replace(/[.)\s]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        step.kind === 'unknown' &&
        /^whenever it attacks, for each opponent other than defending player, you may create a token copy (?:that(?:'|â€™)?s|that is) tapped and attacking that player/i.test(raw)
      ) {
        return false;
      }
      if (step.kind === 'exile' && /^exile the tokens at end of combat$/i.test(raw)) {
        return false;
      }
      return true;
    });

    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function expandParadigmKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const canonicalEffectText =
    'Exile this spell. After you first resolve a spell with this name, you may cast a copy of it from exile without paying its mana cost at the beginning of each of your first main phases.';
  const normalizedCanonicalEffectText = canonicalEffectText.toLowerCase();

  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const alreadyExpanded = ability.steps.some((step) => step.kind === 'paradigm');
    const matchesKeywordLine = normalizedText.startsWith('paradigm');
    const matchesCanonicalEffect =
      normalizedEffect === normalizedCanonicalEffectText ||
      normalizedEffect === `then ${normalizedCanonicalEffectText}`;

    if (alreadyExpanded || (!matchesKeywordLine && !matchesCanonicalEffect)) {
      return ability;
    }

    return {
      ...ability,
      effectText: canonicalEffectText,
      steps: [
        {
          kind: 'paradigm',
          raw: canonicalEffectText,
        },
      ],
    };
  });
}

function isReminderSelfGraveyardGrant(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_graveyard_permission') return false;
  if (step.what.kind !== 'raw' || normalizeOracleText(step.what.text) !== 'this card') return false;

  const normalizedRaw = normalizeOracleText(String(step.raw || '')).replace(/^\(\s*/, '').replace(/\s*\)$/, '').trim();
  return /^you may cast this card from your graveyard for its (?:flashback|escape|retrace|jump-start|harmonize) cost(?: this turn)?$/i.test(
    normalizedRaw
  );
}

function isReminderSelfExileStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'exile') return false;
  const normalizedRaw = normalizeOracleText(String(step.raw || ''))
    .replace(/[)\.]+$/g, '')
    .trim();
  return /^(?:then )?exile it$/i.test(normalizedRaw);
}

export function pruneDuplicateGraveyardReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const selfGrantCount = ability.steps.filter(
      (step) =>
        step.kind === 'grant_graveyard_permission' &&
        step.what.kind === 'raw' &&
        normalizeOracleText(step.what.text) === 'this card'
    ).length;
    if (selfGrantCount < 2) return ability;

    const filteredSteps = ability.steps.filter((step) => !isReminderSelfGraveyardGrant(step) && !isReminderSelfExileStep(step));
    return filteredSteps.length === ability.steps.length ? ability : { ...ability, steps: filteredSteps };
  });
}

function isReminderGenericGraveyardGrant(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_graveyard_permission') return false;
  const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim();
  return /^you may (?:cast|play) .+ from your graveyard\b/i.test(normalizedRaw);
}

export function mergeConditionalGraveyardReminderFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const nextNext = ability.steps[i + 2];

      if (
        current?.kind === 'conditional' &&
        current.steps.some((step) => step.kind === 'grant_graveyard_permission') &&
        next?.kind === 'grant_graveyard_permission' &&
        isReminderGenericGraveyardGrant(next)
      ) {
        const extraSteps: OracleEffectStep[] = [];
        if (nextNext?.kind === 'modify_graveyard_permissions') {
          extraSteps.push(nextNext);
        }

        merged.push({
          ...current,
          steps: [...current.steps, ...extraSteps],
        });
        i += extraSteps.length + 1;
        continue;
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

export function mergeExilePermissionCastCounterFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];

      if (
        current?.kind === 'grant_exile_permission' &&
        next?.kind === 'unknown'
      ) {
        const normalizedNext = normalizeOracleText(String(next.raw || '')).trim();
        const castThisWayMatch = normalizedNext.match(
          /^if you cast a spell this way, that creature enters with (?:a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i
        );
        if (castThisWayMatch) {
          merged.push({
            ...current,
            castedPermanentEntersWithCounters: {
              [normalizeCounterName(String(castThisWayMatch[1] || '').trim())]: 1,
            },
            raw: `${String(current.raw || '').trim()}. ${String(next.raw || '').trim()}`.trim(),
          });
          i += 1;
          continue;
        }
      }

      merged.push(current);
    }

    return merged.length === ability.steps.length ? ability : { ...ability, steps: merged };
  });
}

function splitMixedBattlefieldAndGraveyardExileClauses(
  steps: readonly OracleEffectStep[]
): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind !== 'move_zone' || step.to !== 'exile' || step.what.kind !== 'raw') {
      expanded.push(step);
      continue;
    }

    const whatText = String(step.what.text || '').trim();
    const match = whatText.match(/^(up to one target .+?)\s+and\s+(up to one target .+? from a graveyard)$/i);
    if (!match || /\bfrom\b/i.test(String(match[1] || '').trim())) {
      expanded.push(step);
      continue;
    }

    expanded.push({
      kind: 'exile',
      target: parseObjectSelector(String(match[1] || '').trim()),
      ...(step.optional ? { optional: step.optional } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: `Exile ${String(match[1] || '').trim()}`,
    });
    expanded.push({
      kind: 'move_zone',
      what: parseObjectSelector(String(match[2] || '').trim()),
      to: 'exile',
      toRaw: 'exile',
      raw: `Exile ${String(match[2] || '').trim()}`,
    });
  }

  return expanded;
}

export function expandMixedBattlefieldAndGraveyardExileAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => ({
    ...ability,
    steps: splitMixedBattlefieldAndGraveyardExileClauses(ability.steps),
  }));
}

function parseChoiceUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (/^gift\s+.+?\s*\(you may promise an opponent a gift as you cast this spell$/i.test(normalized)) {
    return {
      kind: 'choose_opponent',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (
    /^(?:hidden agenda\s*\(\s*)?start the game with this conspiracy face down in the command zone and secretly choose a card name$/i.test(normalized) ||
    /^(?:secretly\s+)?choose\s+a\s+card\s+name$/i.test(normalized)
  ) {
    return {
      kind: 'choose_card_name',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^choose (?:an opponent|target opponent)$/i.test(normalized)) {
    return {
      kind: 'choose_opponent',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return null;
}

export function expandChoiceUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseChoiceUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseChosenColorProtectionUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(?:until end of turn,\s+)?(.+?)\s+gains?\s+protection from the color of your choice until end of turn$/i
  );
  if (!match) return null;

  return [
    {
      kind: 'choose_color',
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: 'Choose a color',
    },
    {
      kind: 'grant_temporary_ability',
      target: parseObjectSelector(String(match[1] || '').trim()),
      duration: 'end_of_turn',
      abilities: ['protection from the chosen color'],
      raw: normalized,
    },
  ];
}

export function expandChosenColorProtectionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      if (step.kind !== 'unknown') {
        expandedSteps.push(step);
        continue;
      }

      const expanded = parseChosenColorProtectionUnknownStep(step);
      if (!expanded) {
        expandedSteps.push(step);
        continue;
      }

      changed = true;
      expandedSteps.push(...expanded);
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function normalizeUnknownStepText(step: OracleEffectStep | undefined): string {
  if (step?.kind !== 'unknown') return '';
  return normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
}

function isArtifactTokenReminderLeadUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^(?:(?:it(?:'|â€™)s|it is)|(?:an?\s+[a-z0-9 ,.'â€™-]+?\s+token\s+is))\s+an artifact with\s+"[^"]*$/i.test(normalized) ||
    /^(?:they(?:'|â€™)re|they are)\s+artifacts with\s+"[^"]*$/i.test(normalized)
  );
}

function isArtifactTokenReminderTailUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s"']+/, '')
    .replace(/[.)\s"']+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^activate only as a sorcery$/i.test(normalized) ||
    /^this mana can(?:'|â€™)t be spent to cast a nonartifact spell$/i.test(normalized) ||
    /^shuffle$/i.test(normalized)
  );
}

function stripInlineCopyRetargetTail(text: string): { readonly body: string; readonly allowNewTargets: boolean } {
  let body = normalizeOracleText(String(text || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.;]\s*$/g, '')
    .trim();
  if (!body) return { body: '', allowNewTargets: false };

  let allowNewTargets = false;
  const nextBody = body
    .replace(
      /(?:\.\s*|\s+and\s+)(?:you\s+)?may choose\s+(?:a new target|new targets)\s+for\s+the\s+cop(?:y|ies)$/i,
      () => {
        allowNewTargets = true;
        return '';
      }
    )
    .trim();

  body = nextBody || body;
  return {
    body: body.replace(/[.;]\s*$/g, '').trim(),
    allowNewTargets,
  };
}

function parseCopySpellRetargetTail(step: OracleEffectStep | undefined): string | null {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return null;
  return /^you may choose\s+(?:a new target|new targets)\s+for\s+the\s+cop(?:y|ies)$/i.test(normalized)
    ? normalized
    : null;
}

type CopySpellCastTail = {
  readonly raw: string;
  readonly castCost?: 'mana_cost' | string;
  readonly withoutPayingManaCost?: boolean;
  readonly optional?: boolean;
};

function parseCopySpellCastTail(step: OracleEffectStep | undefined): CopySpellCastTail | null {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return null;
  const normalizedTail = normalized.replace(/^if you do,\s*/i, '').trim();

  if (/^you may cast the copy$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || 'You may cast the copy',
      castCost: 'mana_cost',
      optional: true,
    };
  }

  const alternateCostMatch = normalizedTail.match(
    /^you may cast the copy by paying (\{[^}]+\}(?:\{[^}]+\})*) rather than paying its mana cost$/i
  );
  if (alternateCostMatch) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      castCost: String(alternateCostMatch[1] || '').trim(),
      optional: true,
    };
  }

  if (/^you may cast the copy without paying its mana cost$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      withoutPayingManaCost: true,
      optional: true,
    };
  }

  if (/^you may cast any number of the copies without paying their mana costs$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      withoutPayingManaCost: true,
      optional: true,
    };
  }

  return null;
}

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

function applyCopySpellRetargetTailToSteps(
  steps: readonly OracleEffectStep[],
  retargetTail: string
): {
  readonly steps: readonly OracleEffectStep[];
  readonly changed: boolean;
  readonly applied: boolean;
} {
  let changed = false;
  let applied = false;

  const nextSteps = steps.map((step) => {
    if (step.kind === 'copy_spell') {
      applied = true;
      const nextRaw = copySpellRawMentionsRetarget(step.raw)
        ? step.raw
        : appendFollowupSentence(step.raw, retargetTail);
      const nextStep = {
        ...step,
        allowNewTargets: true,
        raw: nextRaw,
      } as OracleEffectStep;
      if (!step.allowNewTargets || nextRaw !== step.raw) {
        changed = true;
      }
      return nextStep;
    }

    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      const nested = applyCopySpellRetargetTailToSteps(step.steps, retargetTail);
      if (!nested.applied) return step;
      applied = true;
      if (nested.changed) {
        changed = true;
        return {
          ...step,
          steps: nested.steps,
        } as OracleEffectStep;
      }
      return step;
    }

    if (step.kind === 'choose_mode') {
      let modeChanged = false;
      let modeApplied = false;
      const nextModes = step.modes.map((mode) => {
        const nested = applyCopySpellRetargetTailToSteps(mode.steps, retargetTail);
        if (!nested.applied) return mode;
        modeApplied = true;
        if (!nested.changed) return mode;
        modeChanged = true;
        return {
          ...mode,
          steps: nested.steps,
        };
      });

      if (!modeApplied) return step;
      applied = true;
      if (modeChanged) {
        changed = true;
        return {
          ...step,
          modes: nextModes,
        } as OracleEffectStep;
      }
      return step;
    }

    return step;
  });

  return {
    steps: changed ? nextSteps : steps,
    changed,
    applied,
  };
}

function applyCopySpellCastTail(
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  castTail: CopySpellCastTail
): Extract<OracleEffectStep, { kind: 'copy_spell' }> {
  return {
    ...step,
    ...(castTail.castCost ? { castCost: castTail.castCost } : {}),
    ...(castTail.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
    ...((step.optional || castTail.optional) ? { optional: true } : {}),
    raw: appendFollowupSentence(step.raw, castTail.raw),
  };
}

function copySpellRawMentionsRetarget(raw: string | undefined): boolean {
  return /choose\s+(?:a new target|new targets)\s+for\s+the\s+cop(?:y|ies)/i.test(
    normalizeOracleText(String(raw || ''))
  );
}

function normalizeCopyAbilityUnknownStepText(step: OracleEffectStep | undefined): string {
  if (step?.kind !== 'unknown') return '';

  const stripped = stripInlineCopyRetargetTail(String(step.raw || ''));
  let normalized = stripped.body.replace(/^[â€¢Â·â—â—¦â–ªâ–«â–ºâž¤\uFFFD]+\s*/u, '').trim();

  while (normalized) {
    const nextNormalized = normalized
      .replace(/^then\b\s*/i, '')
      .replace(/^(?:raid|spell mastery)\s*[-—]\s*/i, '')
      .replace(/^(?:[ivxlcdm]+|\d+(?:-\d+)?|\+\s*\{[^}]+\}|-\d+)\s*[|—-]\s*/i, '')
      .trim();

    if (nextNormalized === normalized) break;
    normalized = nextNormalized;
  }

  return normalized;
}

function isCopyAbilityUnknownStep(step: OracleEffectStep | undefined): boolean {
  if (step?.kind !== 'unknown') return false;

  const normalized = normalizeCopyAbilityUnknownStepText(step);
  if (!normalized) return false;

  const prefixedCopyPattern = /^(?:until end of turn,\s+)?(?:(?:if|when|whenever)\s+.+?,\s+)*(?:you may\s+)?copy\s+(?:that ability|the ability|that spell|the spell|that spell or ability|it|target\s+.+)$/i;

  return /^(?:you may\s+)?copy\s+(?:that ability|the ability|target triggered ability(?: you control)?|target activated or triggered ability(?: you control)?(?: from .+)?)$/i.test(
    normalized
  ) ||
    /^(?:you may\s+)?copy that spell or ability$/i.test(normalized) ||
    /^(?:you may\s+)?copy the next .+ spell you cast this turn when you cast it$/i.test(normalized) ||
    /^(?:if you do,\s+)?when you next cast .+?,\s+copy it$/i.test(normalized) ||
    /^(?:when you cast this spell,\s+)?copy\b.+$/i.test(normalized) ||
    prefixedCopyPattern.test(normalized);
}

function parseCopySpellUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  nextStep?: OracleEffectStep
): OracleEffectStep | null {
  const retargetTail = parseCopySpellRetargetTail(nextStep);
  const stripped = stripInlineCopyRetargetTail(String(step.raw || ''));
  const normalized = stripped.body.replace(/^[â€¢Â·â—â—¦â–ªâ–«â–ºâž¤\uFFFD]+\s*/u, '').trim();
  if (!normalized) return null;
  const allowNewTargets = stripped.allowNewTargets || retargetTail !== null;
  const rawRetargetTail = retargetTail ?? (stripped.allowNewTargets ? 'You may choose new targets for the copy' : null);
  const optional = Boolean(step.optional) || /^you may\s+/i.test(normalized);
  const abilityWordStripped = normalized.replace(/^spell mastery\s*[^a-z0-9]+\s*/i, '').trim();

  if (abilityWordStripped !== normalized) {
    const conditionalMatch = abilityWordStripped.match(/^if\s+(.+?),\s+(.+)$/i);
    if (conditionalMatch) {
      const nestedRaw = String(conditionalMatch[2] || '').trim();
      const nestedStep = parseCopySpellUnknownStep(
        {
          ...step,
          raw: nestedRaw,
          optional: Boolean(step.optional) || /^you may\s+/i.test(nestedRaw),
        },
        nextStep
      );
      if (nestedStep) {
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: String(conditionalMatch[1] || '').trim() },
          steps: [nestedStep],
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: appendFollowupSentence(normalized, rawRetargetTail),
        };
      }
    }
  }

  if (/^copy this spell for each spell cast before it this turn$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'spells_cast_before_this_turn' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:when you cast this spell,\s+)?copy it for each time you paid its replicate cost$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'replicate_count' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^you may copy this spell$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^copy this spell$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy the spell countered this way$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy that card$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy (?:that spell|it)$/i.test(normalized)) {
    const targetText = /that spell/i.test(normalized) ? 'that spell' : 'it';
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: targetText },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy the exiled card$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'linked_exiled_cards',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?create a copy of that card$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy (?:a|the) card(?:s)? (?:you )?exiled with .+$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'linked_exiled_cards',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const targetedSpellMatch = normalized.match(/^(?:you may\s+)?copy\s+(target(?:\s+.+?)?\s+spell(?:\s+.+)?)$/i);
  if (targetedSpellMatch) {
    const targetText = String(targetedSpellMatch[1] || '').trim();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: parseObjectSelector(targetText),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  return null;
}

function expandCopySpellUnknownSteps(
  steps: readonly OracleEffectStep[]
): { steps: readonly OracleEffectStep[]; changed: boolean } {
  let changed = false;
  const expandedSteps: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const nextStep = steps[i + 1];
    const retargetTail = parseCopySpellRetargetTail(nextStep);

    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      const nested = expandCopySpellUnknownSteps(step.steps);
      const nestedRetarget = retargetTail !== null
        ? applyCopySpellRetargetTailToSteps(nested.steps, retargetTail)
        : { steps: nested.steps, changed: false, applied: false };
      if (nested.changed || nestedRetarget.changed) {
        changed = true;
        expandedSteps.push({
          ...step,
          steps: nestedRetarget.steps,
        });
        if (nestedRetarget.applied) {
          i += 1;
        }
      } else {
        expandedSteps.push(step);
        if (nestedRetarget.applied) {
          changed = true;
          i += 1;
        }
      }
      continue;
    }

    if (step.kind === 'choose_mode') {
      let modeChanged = false;
      const expandedModes = step.modes.map((mode) => {
        const nested = expandCopySpellUnknownSteps(mode.steps);
        if (!nested.changed) return mode;
        modeChanged = true;
        return {
          ...mode,
          steps: nested.steps,
        };
      });

      const retargetedModes = retargetTail !== null
        ? expandedModes.map((mode) => applyCopySpellRetargetTailToSteps(mode.steps, retargetTail))
        : [];
      const hasRetargetedMode = retargetedModes.some((result) => result.applied);
      const hasRetargetModeChange = retargetedModes.some((result) => result.changed);
      const finalModes = hasRetargetedMode
        ? expandedModes.map((mode, idx) => ({
            ...mode,
            steps: retargetedModes[idx]?.steps || mode.steps,
          }))
        : expandedModes;

      if (modeChanged || hasRetargetModeChange) {
        changed = true;
        expandedSteps.push({
          ...step,
          modes: finalModes,
        });
        if (hasRetargetedMode) {
          i += 1;
        }
      } else {
        expandedSteps.push(step);
        if (hasRetargetedMode) {
          changed = true;
          i += 1;
        }
      }
      continue;
    }

    if (step.kind === 'unknown') {
      const castTail = parseCopySpellCastTail(nextStep);
      const trailingRetargetTail = castTail ? parseCopySpellRetargetTail(steps[i + 2]) : retargetTail;
      const expanded = parseCopySpellUnknownStep(step, castTail ? steps[i + 2] : nextStep);
      if (!expanded) {
        if (retargetTail !== null && isCopyAbilityUnknownStep(step)) {
          changed = true;
          expandedSteps.push({
            ...step,
            raw: appendFollowupSentence(step.raw, retargetTail),
          });
          i += 1;
          continue;
        }

        expandedSteps.push(step);
        continue;
      }

      changed = true;
      expandedSteps.push(castTail && expanded.kind === 'copy_spell' ? applyCopySpellCastTail(expanded, castTail) : expanded);
      i += (castTail ? 1 : 0) + (trailingRetargetTail !== null ? 1 : 0);
      continue;
    }

    if (step.kind === 'copy_spell') {
      const castTail = parseCopySpellCastTail(nextStep);
      const preservedThenFollowupStep =
        castTail === null &&
        retargetTail === null &&
        nextStep?.sequence === 'then' &&
        parseCopySpellRetargetTail(steps[i + 2]) !== null
          ? nextStep
          : null;
      const trailingRetargetTail = castTail
        ? parseCopySpellRetargetTail(steps[i + 2])
        : retargetTail ?? (preservedThenFollowupStep ? parseCopySpellRetargetTail(steps[i + 2]) : null);
      if (castTail || trailingRetargetTail !== null) {
        changed = true;
        const castMerged = castTail ? applyCopySpellCastTail(step, castTail) : step;
        expandedSteps.push(
          trailingRetargetTail !== null
            ? {
                ...castMerged,
                allowNewTargets: true,
                raw: copySpellRawMentionsRetarget(castMerged.raw)
                  ? castMerged.raw
                  : appendFollowupSentence(castMerged.raw, trailingRetargetTail),
              }
            : castMerged
        );
        if (preservedThenFollowupStep) {
          expandedSteps.push(preservedThenFollowupStep);
        }
        i +=
          (castTail ? 1 : 0) +
          (trailingRetargetTail !== null ? 1 : 0) +
          (preservedThenFollowupStep ? 1 : 0);
        continue;
      }
    }

    expandedSteps.push(step);
  }

  return {
    steps: changed ? expandedSteps : steps,
    changed,
  };
}

export function expandCopySpellUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const expanded = expandCopySpellUnknownSteps(ability.steps);
    return expanded.changed ? { ...ability, steps: expanded.steps } : ability;
  });
}

function isRedundantCastAdditionalCostUnknownStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'unknown') return false;
  const normalized = normalizeUnknownStepText(step);
  return normalized !== null && /^as an additional cost to cast this spell,\s+.+$/i.test(normalized);
}

function isStandaloneCastAdditionalCostAbility(ability: OracleIRAbility): boolean {
  return ability.steps.length > 0 && ability.steps.every(isRedundantCastAdditionalCostUnknownStep);
}

export function pruneRedundantCastAdditionalCostUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  let changed = false;
  const filtered: OracleIRAbility[] = [];

  for (const ability of abilities) {
    if (isStandaloneCastAdditionalCostAbility(ability)) {
      changed = true;
      continue;
    }

    let firstMeaningfulStepIndex = 0;
    while (
      firstMeaningfulStepIndex < ability.steps.length &&
      isRedundantCastAdditionalCostUnknownStep(ability.steps[firstMeaningfulStepIndex])
    ) {
      firstMeaningfulStepIndex += 1;
    }

    if (firstMeaningfulStepIndex > 0 && firstMeaningfulStepIndex < ability.steps.length) {
      filtered.push({
        ...ability,
        steps: ability.steps.slice(firstMeaningfulStepIndex),
      });
      changed = true;
      continue;
    }

    filtered.push(ability);
  }

  return changed ? filtered : abilities.slice();
}

function parseCopyChapterAbilityUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^copy its chapter (i|ii|iii|iv|v|vi|vii|viii|ix|x) ability$/i);
  if (!match) return null;

  const roman = String(match[1] || '').trim().toUpperCase();
  const chapterMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
  };
  const chapter = chapterMap[roman];
  if (!chapter) return null;

  return {
    kind: 'copy_chapter_ability',
    subject: 'last_moved_card',
    chapter,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  };
}

export function expandCopyChapterAbilityUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCopyChapterAbilityUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

type DieRollResultBand = {
  readonly min: number;
  readonly max: number;
  readonly raw: string;
  readonly steps: readonly OracleEffectStep[];
};

function buildDieRollBand(
  min: number,
  max: number,
  effectText: string,
  raw: string
): DieRollResultBand | null {
  if (/^Copy that card\.\s*You may cast the copy\.?$/i.test(effectText)) {
    return {
      min,
      max,
      raw,
      steps: [
        {
          kind: 'copy_spell',
          subject: 'last_moved_card',
          castCost: 'mana_cost',
          optional: true,
          raw: effectText,
        },
      ],
    };
  }

  if (/^Copy that card\.\s*You may cast the copy by paying \{1\} rather than paying its mana cost\.?$/i.test(effectText)) {
    return {
      min,
      max,
      raw,
      steps: [
        {
          kind: 'copy_spell',
          subject: 'last_moved_card',
          castCost: '{1}',
          optional: true,
          raw: effectText,
        },
      ],
    };
  }

  if (
    /^Copy each card exiled with this artifact\.\s*You may cast any number of the copies without paying their mana costs\.?$/i.test(
      effectText
    )
  ) {
    return {
      min,
      max,
      raw,
      steps: [
        {
          kind: 'copy_spell',
          subject: 'linked_exiled_cards',
          withoutPayingManaCost: true,
          optional: true,
          raw: effectText,
        },
      ],
    };
  }

  const createTokenStep = parseTokenCreationMetadataStep(effectText);
  if (createTokenStep) {
    return {
      min,
      max,
      raw,
      steps: [createTokenStep],
    };
  }

  return null;
}

function parseDieRollBandAbility(ability: OracleIRAbility): DieRollResultBand | null {
  if (!ability) return null;
  if (ability.type !== 'static') return null;

  const rawText = String(ability.text || '').trim();
  const match = rawText.match(/^(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*([\s\S]+)$/);
  if (!match) return null;

  const min = Number.parseInt(String(match[1] || ''), 10);
  const max = Number.parseInt(String(match[2] || match[1] || ''), 10);
  const effectText = String(match[3] || '').trim();
  if (!Number.isFinite(min) || !Number.isFinite(max) || !effectText) return null;
  return buildDieRollBand(min, max, effectText, rawText);
}

function rewriteInlineDieRollTableAbility(ability: OracleIRAbility): OracleIRAbility {
  if (ability.type !== 'activated') return ability;

  const steps = ability.steps;
  const rollIndex = steps.findIndex(
    step =>
      (step.kind === 'unknown' && /^Roll a d20$/i.test(String(step.raw || '').trim()))
      || (step.kind === 'roll_die' && step.sides === 20)
  );
  if (rollIndex < 0) return ability;
  if (
    steps[rollIndex + 1]?.kind !== 'unknown' ||
    !/^Activate only as a sorcery$/i.test(String(steps[rollIndex + 1]?.raw || '').trim())
  ) {
    return ability;
  }

  const bands: DieRollResultBand[] = [];
  let cursor = rollIndex + 2;
  while (cursor + 1 < steps.length) {
    const copyClause = steps[cursor];
    const castClause = steps[cursor + 1];
    if (copyClause?.kind !== 'unknown' || castClause?.kind !== 'unknown' || !castClause.optional) break;

    const rangeMatch = String(copyClause.raw || '').trim().match(/^(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?\s*\|\s*(.+)$/);
    if (!rangeMatch) break;

    const min = Number.parseInt(String(rangeMatch[1] || ''), 10);
    const max = Number.parseInt(String(rangeMatch[2] || rangeMatch[1] || ''), 10);
    const copyText = String(rangeMatch[3] || '').trim();
    const castText = String(castClause.raw || '').trim();
    const band = buildDieRollBand(min, max, `${copyText}. ${castText}`, `${String(copyClause.raw || '').trim()}. ${castText}`);
    if (!band) break;

    bands.push(band);
    cursor += 2;
  }

  if (bands.length === 0) return ability;

  const rollStep = steps[rollIndex]?.kind === 'roll_die'
    ? steps[rollIndex]
    : {
        kind: 'roll_die' as const,
        who: { kind: 'you' as const },
        sides: 20,
        raw: 'Roll a d20',
      };

  return {
    ...ability,
    steps: [
      ...steps.slice(0, rollIndex),
      rollStep,
      {
        kind: 'die_roll_results',
        who: { kind: 'you' },
        sides: 20,
        results: bands,
        raw: bands.map(band => band.raw).join('\n'),
      },
      ...steps.slice(cursor),
    ],
  };
}

function splitActivatedTrailingRollClause(
  ability: OracleIRAbility
): { ability: OracleIRAbility; hadInlineRoll: boolean } {
  if (ability.type !== 'activated') return { ability, hadInlineRoll: false };
  if (ability.steps.length === 0) return { ability, hadInlineRoll: false };

  const lastStep = ability.steps[ability.steps.length - 1];
  if (lastStep?.kind !== 'move_zone') return { ability, hadInlineRoll: false };

  const stepRaw = String(lastStep.raw || '').trim();
  const whatText = lastStep.what.kind === 'raw' ? String(lastStep.what.text || '').trim() : '';
  const text = String(ability.text || '').trim();
  const effectText = String(ability.effectText || '').trim();

  if (
    !/\band roll a d20\.?$/i.test(stepRaw) &&
    !/\band roll a d20\.?$/i.test(whatText) &&
    !/\band roll a d20\.?$/i.test(effectText)
  ) {
    return { ability, hadInlineRoll: false };
  }

  const clean = (value: string): string =>
    value
      .replace(/\s+and roll a d20\.?$/i, '')
      .replace(/[.]\s*$/g, '')
      .trim();

  const cleanedRaw = clean(stepRaw);
  const cleanedWhatText = clean(whatText);
  const cleanedEffectText = clean(effectText);
  const cleanedText = clean(text);

  const rewrittenSteps = [
    ...ability.steps.slice(0, -1),
    {
      ...lastStep,
      ...(lastStep.what.kind === 'raw' && cleanedWhatText
        ? { what: { ...lastStep.what, text: cleanedWhatText } }
        : {}),
      raw: cleanedRaw || stepRaw,
    },
  ] as OracleEffectStep[];

  return {
    hadInlineRoll: true,
    ability: {
      ...ability,
      text: cleanedText || text,
      effectText: cleanedEffectText || effectText,
      steps: rewrittenSteps,
    },
  };
}

export function mergeDieRollResultTableAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const mergedInline = abilities.map(rewriteInlineDieRollTableAbility);
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < mergedInline.length; i += 1) {
    const rewrittenCurrent = splitActivatedTrailingRollClause(mergedInline[i]);
    const current = rewrittenCurrent.ability;
    const rollAbility = mergedInline[i + 1];
    const hasInlineRollStep = current?.type === 'activated' && current.steps.some(
      (step) => step.kind === 'roll_die' && step.sides === 20
    );
    const hasSeparateRollAbility =
      rollAbility?.type === 'static' &&
      /^Roll a d20\.\s*Activate only as a sorcery\.?$/i.test(String(rollAbility.text || '').trim());
    if (
      current?.type !== 'activated' ||
      (!hasSeparateRollAbility && !rewrittenCurrent.hadInlineRoll && !hasInlineRollStep)
    ) {
      merged.push(current);
      continue;
    }

    const bands: DieRollResultBand[] = [];
    let cursor = i + (hasSeparateRollAbility ? 2 : 1);
    while (cursor < mergedInline.length) {
      const band = parseDieRollBandAbility(mergedInline[cursor]);
      if (!band) break;
      bands.push(band);
      cursor += 1;
    }

    if (bands.length === 0) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: [
        current.text,
        ...(hasSeparateRollAbility ? [rollAbility.text] : []),
        ...bands.map(band => band.raw),
      ].join('\n'),
      effectText: [
        current.effectText,
        ...(hasSeparateRollAbility ? [rollAbility.effectText] : []),
        ...bands.map(band => band.raw),
      ].join('\n'),
      steps: [
        ...current.steps,
          ...(!hasInlineRollStep
            ? [{
                kind: 'roll_die' as const,
                who: { kind: 'you' as const },
                sides: 20,
                raw: 'Roll a d20',
              }]
            : []),
          {
            kind: 'die_roll_results',
            who: { kind: 'you' },
            sides: 20,
            results: bands,
            raw: bands.map(band => band.raw).join('\n'),
          },
      ],
    });
    i = cursor - 1;
  }

  return merged;
}

function parseCopySagaChapterAbilityStep(
  step: OracleEffectStep
): Extract<OracleEffectStep, { kind: 'copy_saga_chapter_ability' }> | null {
    if (!step || step.kind !== 'unknown') return null;

  const match = String(step.raw || '').trim().match(/^Copy its chapter (I|II|III|IV|V|VI|VII|VIII|IX|X) ability$/i);
  if (!match) return null;

  const chapterMap: Record<string, number> = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
  };
  const chapterNumber = chapterMap[String(match[1] || '').trim().toUpperCase()];
  if (!Number.isFinite(chapterNumber)) return null;

  return {
    kind: 'copy_saga_chapter_ability',
    subject: 'last_moved_card',
    chapterNumber,
    raw: String(step.raw || '').trim(),
  };
}

export function mergeSagaChapterCopyFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];
    const currentSteps = Array.isArray(current?.steps) ? current.steps : [];
    const nextSteps = Array.isArray(next?.steps) ? next.steps : [];
    const chapterCopyStep =
      nextSteps.length === 1
        ? ((nextSteps[0] as OracleEffectStep).kind === 'copy_chapter_ability'
            ? (nextSteps[0] as Extract<OracleEffectStep, { kind: 'copy_chapter_ability' }>)
            : null)
        : null;

    if (!current || !chapterCopyStep || currentSteps.length === 0) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: [...currentSteps, chapterCopyStep],
    });
    i += 1;
  }

  return merged;
}

export function mergeCopyChapterAbilityFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];
    const currentSteps = current?.steps || [];
    const nextSteps = next?.steps || [];

    if (
      currentSteps.length === 1 &&
      currentSteps[0]?.kind === 'move_zone' &&
      nextSteps.length === 1 &&
      nextSteps[0]?.kind === 'copy_chapter_ability' &&
      current?.type === next?.type
    ) {
      merged.push({
        ...current,
        text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
        effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
        steps: [...currentSteps, ...nextSteps],
      });
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function parseCopyPermanentUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  abilityText: string
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(this creature|this permanent)\s+becomes a copy of\s+(that card|it|the exiled card),\s+except it has this ability$/i
  );
  if (!match) return null;

  return {
    kind: 'copy_permanent',
    target: parseObjectSelector(String(match[1] || '').trim()),
    source: parseObjectSelector(String(match[2] || '').trim()),
    retainAbilityText: String(abilityText || '').trim() || undefined,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandCopyPermanentUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCopyPermanentUnknownStep(step, String(ability.text || '').trim());
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parsePreventDamageUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (/^prevent all combat damage that would be dealt this turn$/i.test(normalized)) {
    return {
      kind: 'prevent_damage',
      amount: 'all',
      duration: 'this_turn',
      combatOnly: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const nextDamageMatch = normalized.match(
    /^prevent the next (.+?) damage that would be dealt to (.+?) this turn$/i
  );
  if (nextDamageMatch) {
    const amount = parseQuantity(String(nextDamageMatch[1] || '').trim());
    if (amount.kind === 'number') {
      return {
        kind: 'prevent_damage',
        amount,
        recipientTarget: parseObjectSelector(String(nextDamageMatch[2] || '').trim()),
        duration: 'this_turn',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  const sourceChoiceNextDamageMatch = normalized.match(
    /^the next time (?:a|target) source(?: of your choice)? would deal damage to (.+?) this turn, prevent that damage$/i
  );
  if (sourceChoiceNextDamageMatch) {
    return {
      kind: 'prevent_damage',
      amount: 'all',
      target: parseObjectSelector('target source'),
      recipientTarget: parseObjectSelector(String(sourceChoiceNextDamageMatch[1] || '').trim()),
      duration: 'this_turn',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const selfDamageMatch = normalized.match(
    /^if damage would be dealt to this creature, prevent that damage$/i
  );
  if (selfDamageMatch) {
    return {
      kind: 'prevent_damage',
      amount: 'all',
      recipientTarget: parseObjectSelector('this creature'),
      duration: 'this_turn',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const match = normalized.match(
    /^prevent all damage that would be dealt this turn by (target source(?: of your choice)?) that shares a color with the exiled card$/i
  );
  if (!match) return null;

  return {
    kind: 'prevent_damage',
    amount: 'all',
    target: parseObjectSelector(String(match[1] || '').trim()),
    duration: 'this_turn',
    sharesColorWithLinkedExiledCard: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandPreventDamageUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parsePreventDamageUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseWinLossUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  if (/^you win the game$/i.test(normalized)) {
    return {
      kind: 'win_game',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^you lose the game$/i.test(normalized)) {
    return {
      kind: 'lose_game',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return null;
}

function expandWinLossUnknownStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'conditional') {
    let changed = false;
    const expandedNestedSteps = step.steps.map((nestedStep) => {
      const expandedNested = expandWinLossUnknownStep(nestedStep);
      if (expandedNested !== nestedStep) changed = true;
      return expandedNested;
    });
    return changed ? { ...step, steps: expandedNestedSteps } : step;
  }

  if (step.kind !== 'unknown') return step;
  return parseWinLossUnknownStep(step) || step;
}

export function expandWinLossUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      const expanded = expandWinLossUnknownStep(step);
      if (expanded !== step) changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseLeaveBattlefieldReplacementUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^if\s+(it|that card|that creature|that permanent|them|those creatures|those permanents)\s+would\s+leave\s+the\s+battlefield,\s+exile\s+(?:it|them)\s+instead\s+of\s+putting\s+(?:it|them)\s+anywhere\s+else$/i
  );
  if (!match) return null;

  return {
    kind: 'grant_leave_battlefield_replacement',
    target: parseObjectSelector(String(match[1] || '').trim()),
    destination: 'exile',
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function expandConditionalLeaveBattlefieldReplacementStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'conditional') return step;

  let changed = false;
  const expandedNestedSteps = step.steps.map((nestedStep) => {
    const expandedNested = expandConditionalLeaveBattlefieldReplacementStep(nestedStep);
    if (expandedNested !== nestedStep) changed = true;
    return expandedNested;
  });

  const normalizedCondition = normalizeOracleText(String(step.condition?.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const normalizedRaw = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const targetMatch = normalizedCondition.match(
    /^(it|that card|that creature|that permanent|them|those creatures|those permanents)\s+would\s+leave\s+the\s+battlefield$/i
  );
  const nestedReplacement = expandedNestedSteps.length === 1 ? expandedNestedSteps[0] : null;

  if (targetMatch && nestedReplacement?.kind === 'exile') {
    const exileTargetText =
      nestedReplacement.target?.kind === 'raw'
        ? normalizeOracleText(String(nestedReplacement.target.text || '')).trim()
        : '';
    const exilePronoun = String(exileTargetText.match(/^(it|them)\b/i)?.[1] || '').trim().toLowerCase();
    const targetPronoun = String(targetMatch[1] || '').trim().toLowerCase();
    if (
      /^(it|them)\s+instead\s+of\s+putting\s+(it|them)\s+anywhere\s+else$/i.test(exileTargetText) &&
      exilePronoun === targetPronoun
    ) {
      return {
        kind: 'grant_leave_battlefield_replacement',
        target: parseObjectSelector(String(targetMatch[1] || '').trim()),
        destination: 'exile',
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalizedRaw || step.raw,
      };
    }
  }

  return changed ? { ...step, steps: expandedNestedSteps } : step;
}

export function expandLeaveBattlefieldReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind === 'conditional') {
        const expandedConditional = expandConditionalLeaveBattlefieldReplacementStep(step);
        if (expandedConditional !== step) changed = true;
        return expandedConditional;
      }
      if (step.kind !== 'unknown') return step;
      const expanded = parseLeaveBattlefieldReplacementUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseGraveyardPermissionDuration(raw: string | undefined):
  | 'this_turn'
  | 'during_resolution'
  | 'during_next_turn'
  | 'until_end_of_next_turn'
  | 'until_end_of_combat_on_next_turn'
  | 'until_next_turn'
  | 'until_next_upkeep'
  | 'until_next_end_step' {
  const normalized = normalizeOracleText(String(raw || '')).trim();
  if (!normalized) return 'during_resolution';
  if (normalized === 'this turn' || normalized === 'until end of turn' || normalized === 'until the end of turn') {
    return 'this_turn';
  }
  if (normalized === 'during your next turn' || normalized === 'during their next turn' || normalized === 'during the next turn') {
    return 'during_next_turn';
  }
  if (
    normalized === 'until your next turn' ||
    normalized === 'until their next turn' ||
    normalized === 'until the next turn' ||
    normalized === 'through your next turn' ||
    normalized === 'through their next turn' ||
    normalized === 'through the next turn'
  ) {
    return 'until_next_turn';
  }
  if (
    normalized === 'until the end of your next turn' ||
    normalized === 'until the end of their next turn' ||
    normalized === 'until the end of the next turn' ||
    normalized === 'until end of your next turn' ||
    normalized === 'until end of their next turn' ||
    normalized === 'until end of the next turn'
  ) {
    return 'until_end_of_next_turn';
  }
  if (
    normalized === 'until your next upkeep' ||
    normalized === 'until their next upkeep' ||
    normalized === 'until the next upkeep'
  ) {
    return 'until_next_upkeep';
  }
  if (
    normalized === 'until your next end step' ||
    normalized === 'until their next end step' ||
    normalized === 'until the next end step'
  ) {
    return 'until_next_end_step';
  }
  if (
    normalized === 'until end of combat on your next turn' ||
    normalized === 'until end of combat on their next turn' ||
    normalized === 'until end of combat on the next turn'
  ) {
    return 'until_end_of_combat_on_next_turn';
  }
  return 'during_resolution';
}

function normalizeGraveyardGrantSelector(rawSelector: string, qualifier = '', stripTerminalCardWords = false): string {
  let selector = normalizeOracleText(rawSelector)
    .replace(/^(?:each|all)\s+/i, '')
    .trim();
  if (stripTerminalCardWords) {
    selector = selector
      .replace(/\s+cards?$/i, '')
      .replace(/\s+spells?$/i, '')
      .trim();
  }
  const cleanQualifier = normalizeOracleText(qualifier).trim();
  return `${selector}${cleanQualifier ? ` ${cleanQualifier}` : ''}`.replace(/\s+/g, ' ').trim();
}

function parseGraveyardKeywordAbilityCost(rawCost: string | undefined): string | undefined {
  const cost = normalizeOracleText(String(rawCost || ''))
    .replace(/[.)]+$/g, '')
    .trim();
  if (!cost) return undefined;
  if (/^(?:\{[^}]+\}\s*)+$/.test(cost)) return cost.replace(/\s+/g, '');
  if (/^pay\s+.+$/i.test(cost)) return cost;
  return undefined;
}

function parseGraveyardPermissionUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[\u2022]\s+/, '')
    .replace(
      /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+-\s+(?=(?:you|each|target|up to one target|during|once|flashback|escape|retrace|jump-start|harmonize|mayhem)\b)/i,
      ''
    )
    .replace(/^\(\s*/, '')
    .replace(/\s*\)\s*$/i, '')
    .trim();
  if (!normalized) return null;

  const mayhemSelfMatch = normalized.match(
    /^mayhem\b.*?you may play this card from your graveyard(?:\s+if\s+(.+?))?[.)]*$/i
  );
  if (mayhemSelfMatch) {
    const permissionStep: OracleEffectStep = {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'play',
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
    const conditionText = String(mayhemSelfMatch[1] || '').trim();
    if (conditionText) {
      return {
        kind: 'conditional',
        condition: { kind: 'as_long_as', raw: conditionText },
        steps: [permissionStep],
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
    return permissionStep;
  }

  const keywordSelfMatch = normalized.match(/^(flashback|escape|retrace|jump-start|harmonize)\b/i);
  if (keywordSelfMatch) {
    return {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'cast',
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const duringYourTurnKeywordMatch = normalized.match(
    /^during your turn,\s+(.+?)\s+in\s+your\s+graveyard\s+(?:has|have)\s+(flashback|escape|retrace|jump-start|harmonize)$/i
  );
  if (duringYourTurnKeywordMatch) {
    const selectorText = normalizeGraveyardGrantSelector(String(duringYourTurnKeywordMatch[1] || ''), '', true);
    const permissionStep: OracleEffectStep = {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'cast',
      what: { kind: 'raw', text: selectorText },
      duration: 'this_turn',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };

    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: "it's your turn" },
      steps: [permissionStep],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const onceEachTurnPermissionMatch = normalized.match(
    /^(?:once\s+)?during each of your turns,\s+you may\s+(cast|play)\s+(.+?)\s+from\s+your\s+graveyard(?:\s+(.+))?$/i
  );
  if (onceEachTurnPermissionMatch) {
    const trailingText = String(onceEachTurnPermissionMatch[3] || '')
      .trim()
      .replace(
        /^for (?:its|their|that card's|that spell's|those cards'|those spells') [a-z0-9' -]+ cost\b/i,
        ''
      )
      .replace(
        /^by\b.*\s+in addition to paying (?:its|their|that card's|that spell's|those cards'|those spells') other costs\b/i,
        ''
      )
      .trim();

    const permissionStep: OracleEffectStep = {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: String(onceEachTurnPermissionMatch[1] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
      what: parseObjectSelector(String(onceEachTurnPermissionMatch[2] || '').trim()),
      duration: trailingText ? parseGraveyardPermissionDuration(trailingText) : 'this_turn',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };

    return {
      kind: 'conditional',
      condition: { kind: 'as_long_as', raw: "it's your turn" },
      steps: [permissionStep],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const grantedQuotedKeywordMatch = normalized.match(
    /^(until end of turn,\s+)?((?:each|all|target|up to one target)\s+.+?)\s+in\s+your\s+graveyard\s+(?:has|have|gain|gains)\s+"?(flashback|escape|retrace|jump-start|harmonize)\s*(?:-|:)\s*((?:\{[^}]+\}\s*)+)(?:,\s*([^"]+?))?\.?'?"?(?:\s*\(.*)?$/i
  );
  if (grantedQuotedKeywordMatch) {
    return {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'cast',
      what: { kind: 'raw', text: normalizeGraveyardGrantSelector(String(grantedQuotedKeywordMatch[2] || '')) },
      duration: grantedQuotedKeywordMatch[1] ? 'this_turn' : 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const activatedKeywordGrantMatch = normalized.match(
    /^(until end of turn,\s+)?((?:(?:each|all|target|up to one target)\s+)?[a-z0-9][^"]*?)\s+in\s+your\s+graveyard((?:\s+that(?:'s| is)\s+.+?)?)\s+(?:has|have|gain|gains)\s+(unearth|embalm|eternalize)(?:\s+((?:(?:\{[^}]+\}\s*)+|pay\s+.+?)))?(?:\s+(until end of turn|this turn))?$/i
  );
  if (activatedKeywordGrantMatch) {
    const leadingDuration = Boolean(activatedKeywordGrantMatch[1]);
    const trailingDuration = String(activatedKeywordGrantMatch[6] || '').trim().toLowerCase();
    const costRaw = parseGraveyardKeywordAbilityCost(activatedKeywordGrantMatch[5]);
    const keyword = String(activatedKeywordGrantMatch[4] || '').trim().toLowerCase();
    if (keyword !== 'unearth' && keyword !== 'embalm' && keyword !== 'eternalize') return null;
    return {
      kind: 'grant_graveyard_keyword_ability',
      who: { kind: 'you' },
      what: {
        kind: 'raw',
        text: normalizeGraveyardGrantSelector(
          String(activatedKeywordGrantMatch[2] || ''),
          String(activatedKeywordGrantMatch[3] || '')
        ),
      },
      keyword,
      ...(costRaw ? { costRaw } : {}),
      duration: leadingDuration || trailingDuration === 'until end of turn' || trailingDuration === 'this turn' ? 'this_turn' : 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const grantedKeywordMatch = normalized.match(
    /^((?:(?:each|all|target|up to one target)\s+)?[a-z0-9].+?)\s+in\s+your\s+graveyard((?:\s+that(?:'s| is)\s+.+?)?)\s+(?:has|have|gain|gains)\s+(flashback|escape|retrace|jump-start|harmonize)(?:\s+(until end of turn|this turn))?$/i
  );
  if (grantedKeywordMatch) {
    const rawSelector = String(grantedKeywordMatch[1] || '').trim();
    const qualifier = String(grantedKeywordMatch[2] || '').trim();
    const qualifiedSelector = normalizeGraveyardGrantSelector(rawSelector, qualifier);
    const durationText = String(grantedKeywordMatch[4] || '').trim().toLowerCase();

    return {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'cast',
      what: { kind: 'raw', text: qualifiedSelector },
      duration: durationText === 'until end of turn' || durationText === 'this turn' ? 'this_turn' : 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const grantedQuotedSelfPermissionMatch = normalized.match(
    /^(?:until end of turn,\s+)?((?:each|all|target|up to one target)\s+.+?)\s+in\s+your\s+graveyard\s+(?:has|gain|gains)\s+"you may\s+(cast|play)\s+this card from your graveyard\.?"?$/i
  );
  if (grantedQuotedSelfPermissionMatch) {
    const selectorText = String(grantedQuotedSelfPermissionMatch[1] || '')
      .trim()
      .replace(/^(?:each|all)\s+/i, '')
      .trim();

    return {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: String(grantedQuotedSelfPermissionMatch[2] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
      what: { kind: 'raw', text: selectorText },
      duration: /^until end of turn,/i.test(normalized) ? 'this_turn' : 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const match = normalized.match(
    /^(.+?)\s+may\s+(cast|play)\s+(.+?)\s+from\s+(your|their|his or her|its owner's|its controller's)\s+graveyard(?:\s+(.+))?$/i
  );
  if (!match) return null;

  const trailingText = String(match[5] || '')
    .trim()
    .replace(
      /^for (?:its|their|that card's|that spell's|those cards'|those spells') [a-z0-9' -]+ cost\b/i,
      ''
    )
    .replace(/[.)]\s*$/g, '')
    .trim();

  const permissionStep: OracleEffectStep = {
    kind: 'grant_graveyard_permission',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    permission: String(match[2] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
    what: parseObjectSelector(String(match[3] || '').trim()),
    duration: parseGraveyardPermissionDuration(trailingText),
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };

  const asLongAsMatch = trailingText.match(/^as long as (.+)$/i);
  if (asLongAsMatch) {
    return {
      kind: 'conditional',
      condition: { kind: 'as_long_as', raw: String(asLongAsMatch[1] || '').trim() },
      steps: [permissionStep],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return permissionStep;
}

function parseCombinedGraveyardPlayCastPermissionUnknownSteps(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep[] | null {
  let normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[\u2022]\s+/, '')
    .replace(
      /^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\s+-\s+(?=(?:during|once|until|you)\b)/i,
      ''
    )
    .replace(/^\(\s*/, '')
    .replace(/\s*\)\s*$/i, '')
    .trim();
  if (!normalized) return null;

  let duration: Extract<Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>['duration'], string> = 'during_resolution';
  let condition: OracleClauseCondition | null = null;
  const turnScopedMatch = normalized.match(/^(?:once\s+)?during each of your turns,\s+(.+)$/i);
  if (turnScopedMatch) {
    condition = { kind: 'as_long_as', raw: "it's your turn" };
    duration = 'this_turn';
    normalized = String(turnScopedMatch[1] || '').trim();
  }

  const leadingDurationMatch = normalized.match(/^(until (?:the )?end of turn|this turn),\s+(.+)$/i);
  if (leadingDurationMatch) {
    duration = 'this_turn';
    normalized = String(leadingDurationMatch[2] || '').trim();
  }

  const match = normalized.match(/^you may play\s+(.+?)\s+and\s+cast\s+(.+?)\s+from your graveyard(?:\s+(.+))?$/i);
  if (!match) return null;

  const playText = String(match[1] || '').trim();
  const castText = String(match[2] || '').trim();
  const trailingText = String(match[3] || '').trim();
  const resolvedDuration = trailingText ? parseGraveyardPermissionDuration(trailingText) : duration;
  if (!playText || !castText) return null;

  const steps: OracleEffectStep[] = [
    {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'play',
      what: parseObjectSelector(playText),
      duration: resolvedDuration,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    },
    {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'cast',
      what: parseObjectSelector(castText),
      duration: resolvedDuration,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    },
  ];

  if (!condition) return steps;
  return [
    {
      kind: 'conditional',
      condition,
      steps,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    },
  ];
}

export function expandGraveyardPermissionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.flatMap((step) => {
      if (step.kind !== 'unknown') return [step];
      const expandedMany = parseCombinedGraveyardPlayCastPermissionUnknownSteps(step);
      if (expandedMany) {
        changed = true;
        return expandedMany;
      }
      const expanded = parseGraveyardPermissionUnknownStep(step);
      if (!expanded) return [step];
      changed = true;
      return [expanded];
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandGraveyardOrExilePermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      expandedSteps.push(step);
      if (step.kind !== 'grant_graveyard_permission') continue;

      const normalizedRaw = normalizeOracleText(String(step.raw || ''))
        .replace(/^then\b\s*/i, '')
        .trim();
      if (!/\bfrom\s+your\s+graveyard\s+or\s+from\s+exile\b/i.test(normalizedRaw)) continue;

      expandedSteps.push({
        kind: 'grant_exile_permission',
        who: step.who,
        permission: step.permission,
        what: step.what,
        duration: step.duration,
        optional: step.optional,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalizedRaw,
      });
      changed = true;
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandFreeGraveyardCastPermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      expandedSteps.push(step);
      if (step.kind !== 'grant_graveyard_permission') continue;

      const normalizedRaw = normalizeOracleText(String(step.raw || ''))
        .replace(/^then\b\s*/i, '')
        .trim();
      if (!/\bwithout paying (?:its|their|that card's|that spell's|those cards'|those spells') mana costs?\b/i.test(normalizedRaw)) {
        continue;
      }

      expandedSteps.push({
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        withoutPayingManaCost: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalizedRaw,
      });
      changed = true;
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function tryLowerAmassAbilitySteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  const singularizeAmassSubtype = (rawSubtype: string): string => {
    const normalizedSubtype = String(rawSubtype || '').trim().replace(/\s+/g, ' ');
    if (!normalizedSubtype) return 'Zombie';
    return /s$/i.test(normalizedSubtype) ? normalizedSubtype.slice(0, -1) : normalizedSubtype;
  };

  const getTypeArticle = (typeName: string): 'a' | 'an' => (/^[aeiou]/i.test(typeName) ? 'an' : 'a');

  const parseAmassLead = (
    step: OracleEffectStep
  ): { amountText: string; amount: OracleQuantity; subtype: string } | null => {
    if (!step || step.kind !== 'unknown') return null;

    const match = normalizeReminderStepRaw(step).match(/^amass(?:\s+([a-z][a-z' -]*?))?\s+(\d+|x)$/i);
    if (!match) return null;

    const rawSubtype = String(match[1] || '').trim();
    const amountText = String(match[2] || '').trim().toUpperCase();
    return {
      amountText,
      amount: parseQuantity(String(match[2] || '').trim()),
      subtype: singularizeAmassSubtype(rawSubtype || 'Zombie'),
    };
  };

  const isSplitAmassCounterReminder = (step: OracleEffectStep): boolean => {
    if (!step || step.kind !== 'unknown') return false;

    return /^put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on an army you control$/i.test(
      normalizeReminderStepRaw(step)
    );
  };

  const parseSplitAmassSubtypeReminder = (step: OracleEffectStep | undefined): string | null => {
    if (!step || step.kind !== 'unknown') return null;

    const match = normalizeReminderStepRaw(step).match(/^it(?:'|â€™)?s also (?:a|an)\s+([a-z][a-z' -]*)$/i);
    if (!match) return null;

    return singularizeAmassSubtype(String(match[1] || '').trim());
  };

  const normalizeSplitAmassCreateConditional = (
    step: OracleEffectStep
  ): Extract<OracleEffectStep, { kind: 'conditional' }> | null => {
    if (!step || step.kind !== 'conditional') return null;

    const normalizedCondition = normalizeOracleText(String(step.condition?.raw || '')).toLowerCase();
    if (normalizedCondition !== "you don't control an army") return null;
    if (step.steps.length !== 1 || step.steps[0]?.kind !== 'create_token' || !/\barmy\b/i.test(String(step.steps[0]?.token || ''))) {
      return null;
    }

    const createStep = step.steps[0];
    const normalizedToken = String(createStep.token || '').trim();
    if (!normalizedToken) return null;

    return {
      ...step,
      condition: { kind: 'if', raw: "you don't control an Army creature" },
      steps: [
        {
          ...createStep,
          raw: `create a ${normalizedToken} creature token`,
        },
      ],
      raw: `If you don't control an Army creature, create a ${normalizedToken} creature token`,
    };
  };

  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index];
    const chooseStep = steps[index + 1];
    const addCounterStep = steps[index + 2];
    const addTypeUnknownStep = steps[index + 3];

    const isAmassCreateConditional =
      current?.kind === 'conditional' &&
      normalizeOracleText(String(current.condition?.raw || '')).toLowerCase() === "you don't control an army creature" &&
      current.steps.length === 1 &&
      current.steps[0]?.kind === 'create_token' &&
      /\barmy\b/i.test(String(current.steps[0]?.token || ''));
    const isChooseArmyUnknown =
      chooseStep?.kind === 'unknown' &&
      normalizeOracleText(String(chooseStep.raw || '')).toLowerCase() === 'choose an army creature you control';
    const isContextualArmyCounter =
      addCounterStep?.kind === 'add_counter' &&
      addCounterStep.target.kind === 'raw' &&
      normalizeOracleText(String(addCounterStep.target.text || '')).toLowerCase() === 'that creature';

    const amassLead = parseAmassLead(current);
    const splitAmassSubtype = parseSplitAmassSubtypeReminder(addCounterStep);
    const splitAmassCreateConditional = normalizeSplitAmassCreateConditional(addTypeUnknownStep);

    if (amassLead && isSplitAmassCounterReminder(chooseStep) && splitAmassSubtype && splitAmassCreateConditional) {
      changed = true;
      index += 3;
      nextSteps.push({
        ...splitAmassCreateConditional,
        ...(current.sequence ? { sequence: current.sequence } : {}),
      });
      nextSteps.push({
        kind: 'add_counter',
        amount: amassLead.amount,
        counter: '+1/+1',
        target: { kind: 'raw', text: 'Army creature you control' },
        raw: `Put ${amassLead.amountText} +1/+1 counter${amassLead.amountText === '1' ? '' : 's'} on an Army creature you control`,
      });
      nextSteps.push({
        kind: 'add_types',
        target: { kind: 'raw', text: 'Army creature you control' },
        addTypes: [splitAmassSubtype],
        raw:
          `If it isn't ${getTypeArticle(splitAmassSubtype)} ${splitAmassSubtype}, ` +
          `it becomes ${getTypeArticle(splitAmassSubtype)} ${splitAmassSubtype} in addition to its other types`,
      });
      continue;
    }

    if (!isAmassCreateConditional || !isChooseArmyUnknown || !isContextualArmyCounter) {
      nextSteps.push(current);
      continue;
    }

    changed = true;
    nextSteps.push(current);
    nextSteps.push({
      ...addCounterStep,
      target: { kind: 'raw', text: 'Army creature you control' },
      raw: String(addCounterStep.raw || '').replace(/\bthat creature\b/i, 'an Army creature you control'),
    });

    if (addTypeUnknownStep?.kind === 'unknown') {
      const typeUpgradeMatch = normalizeOracleText(String(addTypeUnknownStep.raw || '')).match(
        /^if it isn't (?:a|an) ([a-z][a-z' -]*), it becomes (?:a|an) \1 in addition to its other types$/i
      );
      if (typeUpgradeMatch) {
        index += 3;
        nextSteps.push({
          kind: 'add_types',
          target: { kind: 'raw', text: 'Army creature you control' },
          addTypes: [String(typeUpgradeMatch[1] || '').trim()],
          ...(addTypeUnknownStep.sequence ? { sequence: addTypeUnknownStep.sequence } : {}),
          raw: addTypeUnknownStep.raw,
        });
        continue;
      }
    }

    index += 2;
  }

  return changed ? nextSteps : null;
}

export function lowerAmassReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = tryLowerAmassAbilitySteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

function isRedundantAmassSubtypeReminderUnknownStep(
  step: OracleEffectStep,
  ability: OracleIRAbility
): boolean {
  if (step.kind !== 'unknown') return false;

  const normalizedStep = normalizeReminderStepRaw(step);
  if (!/^it(?:'|’)?s also (?:a|an) [a-z][a-z' -]*$/i.test(normalizedStep)) {
    return false;
  }

  const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (normalizedAbilityText.includes('amass')) {
    return true;
  }

  const hasAmassLead = ability.steps.some(
    (candidate) =>
      candidate.kind === 'unknown' &&
      /^amass(?:\s+[a-z][a-z' -]*?)?\s+(?:\d+|x)(?:,|$)/i.test(normalizeReminderStepRaw(candidate))
  );
  const hasArmyCounterReminder = ability.steps.some(
    (candidate) =>
      candidate.kind === 'unknown' &&
      /^put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) \+1\/\+1 counters? on an army you control$/i.test(
        normalizeReminderStepRaw(candidate)
      )
  );
  const hasArmyCreateConditional = ability.steps.some(
    (candidate) =>
      candidate.kind === 'conditional' &&
      /you don't control an army/i.test(normalizeOracleText(String(candidate.condition?.raw || ''))) &&
      candidate.steps.some(
        (nested) => nested.kind === 'create_token' && /\barmy\b/i.test(String(nested.token || ''))
      )
  );

  return hasAmassLead || hasArmyCounterReminder || hasArmyCreateConditional;
}

export function pruneRedundantAmassSubtypeReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(
      (step) => !isRedundantAmassSubtypeReminderUnknownStep(step, ability)
    );
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function buildDiscoverKeywordSteps(amountText: string, sequence?: 'then'): readonly OracleEffectStep[] {
  const normalizedAmountText = String(amountText || '').trim().toUpperCase();

  return [
    {
      kind: 'impulse_exile_top',
      who: { kind: 'you' },
      amount: parseQuantity(`until you exile a nonland card with mana value ${normalizedAmountText} or less`),
      duration: 'during_resolution',
      permission: 'cast',
      ...(sequence ? { sequence } : {}),
      raw:
        `Exile cards from the top of your library until you exile a nonland card with mana value ${normalizedAmountText} or less. ` +
        'You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.',
    },
    {
      kind: 'modify_exile_permissions',
      scope: 'last_exiled_cards',
      withoutPayingManaCost: true,
      raw: 'You may cast that card without paying its mana cost.',
    },
  ] as const;
}

function getDiscoverKeywordAmountFromUnknownStep(step: OracleEffectStep): string | null {
    if (!step || step.kind !== 'unknown') return null;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  const match = normalized.match(/^(?:you\s+)?discover\s+(\d+|x)$/i);
  return match ? String(match[1] || '').trim() : null;
}

function isDiscoverReminderTailUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^exile cards from the top of your library until you exile a nonland card (?:with mana value (\d+|x) or less|with that mana value or less|whose mana value is less than this spell(?:'|â€™)s mana value)$/i.test(normalized) ||
    /^cast it without paying its mana cost or put it into your hand$/i.test(normalized) ||
    /^put the rest on the bottom(?: of your library)? in a random order$/i.test(normalized)
  );
}

function tryLowerDiscoverKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.kind !== 'unknown') {
      nextSteps.push(step);
      continue;
    }

    const discoverAmount = getDiscoverKeywordAmountFromUnknownStep(step);
    if (!discoverAmount) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    nextSteps.push(...buildDiscoverKeywordSteps(discoverAmount, step.sequence));

    while (index + 1 < steps.length && isDiscoverReminderTailUnknownStep(steps[index + 1])) {
      index += 1;
    }
  }

  return changed ? nextSteps : null;
}

export function lowerDiscoverKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');
    const fullReminderMatch = normalizedText.match(/^discover\s+(\d+|x)\s*\(/i);

    if (isUnknownOnlyAbility && fullReminderMatch) {
      return {
        ...ability,
        steps: [...buildDiscoverKeywordSteps(String(fullReminderMatch[1] || '').trim())],
      };
    }

    const lowered = tryLowerDiscoverKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

export function pruneRedundantDiscoverReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!normalizedText.includes('discover')) return ability;

    const nextSteps = ability.steps.filter((step) => !isDiscoverReminderTailUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function tryLowerConniveKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
  let changed = false;
  const nextSteps: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind !== 'unknown') {
      nextSteps.push(step);
      continue;
    }

    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .trim();
    const conniveMatch = normalized.match(/^connive(?:\s+(\d+))?$/i);
    if (!conniveMatch) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    const amount = Number.parseInt(String(conniveMatch[1] || '1'), 10);
    const quantityText = amount === 1 ? 'a card' : `${amount} cards`;
    nextSteps.push({
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: amount },
      raw: `Draw ${quantityText}.`,
    });
    nextSteps.push({
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'number', value: amount },
      sequence: 'then',
      raw: `Discard ${quantityText}.`,
    });
    nextSteps.push({
      kind: 'conditional',
      condition: { kind: 'if', raw: 'a nonland card was discarded this way' },
      steps: [
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'this creature' },
          counter: '+1/+1',
          amount: { kind: 'x' },
          raw: 'Put X +1/+1 counters on this creature, where X is the number of nonland cards discarded this way.',
        },
      ],
      raw:
        'If a nonland card was discarded this way, put X +1/+1 counters on this creature, where X is the number of nonland cards discarded this way.',
    });
  }

  return changed ? nextSteps : null;
}

export function lowerConniveKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = tryLowerConniveKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
  });
}

function parseKeywordActionUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const adaptMatch = normalized.match(/^adapt\s+(\d+|x)$/i);
  if (adaptMatch) {
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: 'there are no +1/+1 counters on it' },
      steps: [
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'this permanent' },
          counter: '+1/+1',
          amount: parseQuantity(String(adaptMatch[1] || '').trim()),
          raw: `Put ${String(adaptMatch[1] || '').toUpperCase()} +1/+1 counters on this permanent.`,
        },
      ],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const collectEvidenceMatch = normalized.match(/^collect evidence\s+(\d+)$/i);
  if (collectEvidenceMatch) {
    return {
      kind: 'collect_evidence',
      who: { kind: 'you' },
      amount: parseQuantity(String(collectEvidenceMatch[1] || '').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^proliferate$/i.test(normalized)) {
    return {
      kind: 'proliferate',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^the ring tempts you$/i.test(normalized)) {
    return {
      kind: 'ring_tempts_you',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^investigate$/i.test(normalized)) {
    return {
      kind: 'investigate',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^populate$/i.test(normalized)) {
    return {
      kind: 'populate',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^explore$/i.test(normalized)) {
    return {
      kind: 'explore',
      target: { kind: 'raw', text: 'this creature' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const subjectExploreMatch = normalized.match(/^(.+?) explores(?: again)?$/i);
  if (subjectExploreMatch) {
    const subjectText = String(subjectExploreMatch[1] || '').trim();
    const normalizedSubject = normalizeOracleText(subjectText).replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = (
      normalizedSubject === 'it' || normalizedSubject === 'this creature'
    )
      ? 'this creature'
      : normalizedSubject === 'this permanent'
        ? 'this permanent'
        : subjectText;

    return {
      kind: 'explore',
      target: { kind: 'raw', text: targetText },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const timeTravelMatch = normalized.match(/^time travel(?:\s+(\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+times?)?)?$/i);
  if (timeTravelMatch) {
    return {
      kind: 'time_travel',
      who: { kind: 'you' },
      amount: parseQuantity(String(timeTravelMatch[1] || '1').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const fatesealMatch = normalized.match(/^fateseal\s+(\d+|x)$/i);
  if (fatesealMatch) {
    return {
      kind: 'fateseal',
      who: { kind: 'you' },
      target: { kind: 'target_opponent' },
      amount: parseQuantity(String(fatesealMatch[1] || '').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const manifestTopCardMatch = normalized.match(
    /^manifest the top card of (your|that player's|target player's|target opponent's) library$/i
  );
  if (manifestTopCardMatch) {
    const libraryRef = String(manifestTopCardMatch[1] || '').toLowerCase();
    return {
      kind: 'move_zone',
      what: { kind: 'raw', text: `the top card of ${libraryRef} library` },
      to: 'battlefield',
      toRaw: 'battlefield face down',
      entersFaceDown: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const cloakTopCardMatch = normalized.match(
    /^cloak the top card of (your|that player's|target player's|target opponent's) library$/i
  );
  if (cloakTopCardMatch) {
    const libraryRef = String(cloakTopCardMatch[1] || '').toLowerCase();
    return {
      kind: 'move_zone',
      what: { kind: 'raw', text: `the top card of ${libraryRef} library` },
      to: 'battlefield',
      toRaw: 'battlefield face down',
      entersFaceDown: true,
      faceDownWardCost: '{2}',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^forage$/i.test(normalized)) {
    return {
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
      modes: [
        {
          label: 'Exile three cards from your graveyard',
          raw: 'Exile three cards from your graveyard',
          steps: [
            {
              kind: 'move_zone',
              what: { kind: 'raw', text: 'three cards from your graveyard' },
              to: 'exile',
              toRaw: 'exile',
              raw: 'Exile three cards from your graveyard',
            },
          ],
        },
        {
          label: 'Sacrifice a Food',
          raw: 'Sacrifice a Food',
          steps: [
            {
              kind: 'sacrifice',
              who: { kind: 'you' },
              what: { kind: 'raw', text: 'a Food' },
              raw: 'Sacrifice a Food',
            },
          ],
        },
      ],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^exert$/i.test(normalized)) {
    return {
      kind: 'exert',
      target: { kind: 'raw', text: 'this permanent' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^open an attraction$/i.test(normalized)) {
    return {
      kind: 'open_attraction',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^roll to visit your attractions$/i.test(normalized)) {
    return {
      kind: 'roll_visit_attractions',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^take the initiative$/i.test(normalized)) {
    return {
      kind: 'take_initiative',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^become the monarch$/i.test(normalized)) {
    return {
      kind: 'become_monarch',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^venture into the dungeon$/i.test(normalized)) {
    return {
      kind: 'venture_into_dungeon',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^clash with an opponent$/i.test(normalized)) {
    return {
      kind: 'clash',
      who: { kind: 'you' },
      opponent: { kind: 'target_opponent' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^manifest dread$/i.test(normalized)) {
    return {
      kind: 'manifest_dread',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const endureMatch = normalized.match(/^endure\s+(\d+)$/i);
  if (endureMatch) {
    const endureAmount = Number.parseInt(String(endureMatch[1] || '0'), 10);
    if (Number.isFinite(endureAmount) && endureAmount > 0) {
      return {
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
        modes: [
          {
            label: `Put ${endureAmount} +1/+1 counter${endureAmount === 1 ? '' : 's'} on this permanent`,
            raw: `Put ${endureAmount} +1/+1 counter${endureAmount === 1 ? '' : 's'} on this permanent`,
            steps: [
              {
                kind: 'add_counter',
                target: { kind: 'raw', text: 'this permanent' },
                counter: '+1/+1',
                amount: { kind: 'number', value: endureAmount },
                raw: `Put ${endureAmount} +1/+1 counter${endureAmount === 1 ? '' : 's'} on this permanent`,
              },
            ],
          },
          {
            label: `Create a ${endureAmount}/${endureAmount} white Spirit creature token`,
            raw: `Create a ${endureAmount}/${endureAmount} white Spirit creature token`,
            steps: [
              {
                kind: 'create_token',
                who: { kind: 'you' },
                amount: { kind: 'number', value: 1 },
                token: `${endureAmount}/${endureAmount} white Spirit`,
                raw: `Create a ${endureAmount}/${endureAmount} white Spirit creature token`,
              },
            ],
          },
        ],
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  const conniveMatch = normalized.match(/^connive(?:\s+(\d+|x))?$/i);
  if (conniveMatch) {
    return {
      kind: 'connive',
      target: { kind: 'raw', text: 'this creature' },
      amount: parseQuantity(String(conniveMatch[1] || '1').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const subjectConniveMatch = normalized.match(/^(.+?)\s+connives(?:\s+(\d+|x))?$/i);
  if (subjectConniveMatch) {
    const subjectText = String(subjectConniveMatch[1] || '').trim();
    const normalizedSubject = normalizeOracleText(subjectText).replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = (
      normalizedSubject === 'it' || normalizedSubject === 'this creature'
    )
      ? 'this creature'
      : normalizedSubject === 'this permanent'
        ? 'this permanent'
        : subjectText;

    return {
      kind: 'connive',
      target: { kind: 'raw', text: targetText },
      amount: parseQuantity(String(subjectConniveMatch[2] || '1').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const goadMatch = normalized.match(/^goad\s+(.+)$/i);
  if (goadMatch) {
    return {
      kind: 'goad',
      target: { kind: 'raw', text: String(goadMatch[1] || '').trim() },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const suspectMatch = normalized.match(/^suspect\s+(.+)$/i);
  if (suspectMatch) {
    return {
      kind: 'suspect',
      target: { kind: 'raw', text: String(suspectMatch[1] || '').trim() },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const expandedKeywordAction = parseKeywordActionAbility(normalized);
  if (expandedKeywordAction?.effect) {
    const expandedClauses = splitIntoClauses(String(expandedKeywordAction.effect || '').trim());
    if (expandedClauses.length === 1) {
      const rawClause = String(expandedClauses[0] || '').trim().replace(/[.]+$/g, '');
      if (rawClause) {
        const normalizedClause = normalizeClauseForParse(rawClause);
        const withMeta = <T extends OracleEffectStep>(candidate: T): T => {
          const out: any = { ...candidate };
          if (step.sequence) out.sequence = step.sequence;
          return out;
        };

        const parsed =
          tryParseSimpleActionClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseTemporaryModifyPtClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseLifeAndCombatClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseSimpleCreateTokenClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseZoneAndRemovalClause({ clause: normalizedClause.clause, rawClause, withMeta });

        if (parsed) {
          return parsed;
        }
      }
    }
  }

  return null;
}

const TURN_SCOPED_STATIC_KEYWORD_ABILITIES = new Set([
  'banding',
  'flying',
  'trample',
  'vigilance',
  'lifelink',
  'deathtouch',
  'reach',
  'menace',
  'hexproof',
  'indestructible',
  'first strike',
  'double strike',
  'haste',
  'ward',
]);

function parseTurnScopedStaticKeywordList(raw: string): string[] | null {
  const normalized = String(raw || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const abilities: string[] = [];
  for (const part of parts) {
    if (!TURN_SCOPED_STATIC_KEYWORD_ABILITIES.has(part)) return null;
    if (!abilities.includes(part)) abilities.push(part);
  }

  return abilities.length > 0 ? abilities : null;
}

function parseTurnScopedStaticKeywordUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^during your turn,\s+(.+?)\s+(?:has|have)\s+(.+)$/i);
  if (!match) return null;

  const abilities = parseTurnScopedStaticKeywordList(String(match[2] || '').trim());
  if (!abilities) return null;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: "it's your turn" },
    steps: [
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(match[1] || '').trim()),
        duration: 'this_turn',
        abilities,
        raw: normalized,
      },
    ],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandKeywordActionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseKeywordActionUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandTurnScopedStaticKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseTurnScopedStaticKeywordUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function mergeDestroyCantRegenerateFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const mergedSteps: OracleEffectStep[] = [];
    let changed = false;

    for (let index = 0; index < ability.steps.length; index += 1) {
      const step = ability.steps[index];
      const next = ability.steps[index + 1];

      if (
        step?.kind === 'destroy' &&
        next?.kind === 'unknown' &&
        /^(?:it|they|that (?:permanent|creature|artifact|enchantment|land|planeswalker)|those (?:permanents|creatures|artifacts|enchantments|lands|planeswalkers)) can't be regenerated$/i.test(
          normalizeOracleText(String(next.raw || '')).replace(/^then\b\s*/i, '').trim()
        )
      ) {
        mergedSteps.push({
          ...step,
          cantBeRegenerated: true,
          raw: `${String(step.raw || '').trim()} ${String(next.raw || '').trim()}`.trim(),
        });
        changed = true;
        index += 1;
        continue;
      }

      mergedSteps.push(step);
    }

    return changed ? { ...ability, steps: mergedSteps } : ability;
  });
}

function createVotesForChoiceQuantity(choice: string, multiplier: number = 1) {
  return {
    kind: 'votes_for_choice' as const,
    choice: String(choice || '').trim(),
    ...(multiplier !== 1 ? { multiplier } : {}),
  };
}

function expandVoteScaledStep(step: OracleEffectStep): OracleEffectStep {
  const normalizedRaw = normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim();
  if (!normalizedRaw) return step;

  if (
    step.kind === 'gain_life' ||
    step.kind === 'draw' ||
    step.kind === 'investigate' ||
    step.kind === 'create_token'
  ) {
    const voteMatch = normalizedRaw.match(/\s+for each ([a-z0-9][a-z0-9' -]*) vote$/i);
    if (!voteMatch || step.amount.kind !== 'number') return step;
    return {
      ...step,
      amount: createVotesForChoiceQuantity(String(voteMatch[1] || '').trim(), step.amount.value),
    };
  }

  if (step.kind === 'add_counter' && step.target.kind === 'raw' && step.amount.kind === 'number') {
    const targetMatch = String(step.target.text || '').match(/^(.*?)\s+for each ([a-z0-9][a-z0-9' -]*) vote$/i);
    if (!targetMatch) return step;
    const targetText = String(targetMatch[1] || '').trim();
    const choice = String(targetMatch[2] || '').trim();
    if (!targetText || !choice) return step;
    return {
      ...step,
      target: parseObjectSelector(targetText),
      amount: createVotesForChoiceQuantity(choice, step.amount.value),
    };
  }

  return step;
}

function parseVoteScaledUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim();
  if (!normalized) return null;

  {
    const investigateMatch = normalized.match(/^for each ([a-z0-9][a-z0-9' -]*) vote,\s*investigate$/i);
    if (investigateMatch) {
      return {
        kind: 'investigate',
        who: { kind: 'you' },
        amount: createVotesForChoiceQuantity(String(investigateMatch[1] || '').trim()),
        ...(step.optional ? { optional: step.optional } : {}),
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: step.raw,
      };
    }
  }

  {
    const createTokenMatch = normalized.match(/^for each ([a-z0-9][a-z0-9' -]*) vote,\s*create (?:a|an) (.+?) token$/i);
    if (createTokenMatch) {
      const choice = String(createTokenMatch[1] || '').trim();
      const token = String(createTokenMatch[2] || '').trim();
      if (!choice || !token) return null;
      return {
        kind: 'create_token',
        who: { kind: 'you' },
        amount: createVotesForChoiceQuantity(choice),
        token,
        ...(step.optional ? { optional: step.optional } : {}),
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: step.raw,
      };
    }
  }

  return null;
}

export function expandVoteChoiceCountAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind === 'unknown') {
        const expanded = parseVoteScaledUnknownStep(step);
        if (expanded) {
          changed = true;
          return expanded;
        }
      }

      const nextStep = expandVoteScaledStep(step);
      if (nextStep !== step) changed = true;
      return nextStep;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function isRedundantActivationRestrictionUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    /^activate only as a sorcery[.)"â€]*$/i.test(normalized) ||
    /^(?:station|saddle) only as a sorcery[.)]*$/i.test(normalized) ||
    /^activate only during your turn[.)"â€]*$/i.test(normalized) ||
    /^activate only during your turn, before attackers are declared[.)"â€]*$/i.test(normalized) ||
    /^activate only during your upkeep[.)]*$/i.test(normalized) ||
    /^activate only if there are seven or more cards in your graveyard[.)"â€]*$/i.test(normalized) ||
    /^activate(?: this ability)? only once(?: each turn)?[.)"â€]*$/i.test(normalized)
  );
}

function isRedundantSpellTimingRestrictionUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^cast this spell only during the declare attackers step and only if you(?:'|’)?ve been attacked this step[.)]*$/i.test(normalized);
}

export function pruneRedundantSpellTimingRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantSpellTimingRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

export function pruneRedundantActivationRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantActivationRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantXCantBeZeroUnknownStep(step: OracleEffectStep): boolean {
  if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^x can't be 0[.)"â€]*$/i.test(normalized);
}

export function pruneRedundantXCantBeZeroUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantXCantBeZeroUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isStationThresholdReminderUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^it(?:'|â€™)s an artifact creature at \d+\+[.)]*$/i.test(normalized) || /^\d+\+\s*\|/i.test(normalized);
}

function isRedundantStationChargeCounterReminderUnknownStep(
  step: OracleEffectStep,
  ability: OracleIRAbility
): boolean {
  if (ability.type !== 'activated' || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^put charge counters equal to its power on this spacecraft$/i.test(normalized)) {
    return false;
  }

  return ability.steps.some(candidate => isStationThresholdReminderUnknownStep(candidate));
}

export function pruneRedundantStationChargeCounterReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(
      (step) => !isRedundantStationChargeCounterReminderUnknownStep(step, ability)
    );
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantHandRevealDiscardChoiceUnknownStep(
  step: OracleEffectStep,
  ability: OracleIRAbility
): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!/^you choose a nonland card from it$/i.test(normalized)) {
    return false;
  }

  const hasRevealHandStep = ability.steps.some((candidate) => candidate.kind === 'reveal_hand');
  const hasTargetedDiscardThatCardStep = ability.steps.some(
    (candidate) =>
      candidate.kind === 'discard' &&
      candidate.target?.kind === 'raw' &&
      /^that card$/i.test(String(candidate.target.text || '').trim())
  );

  return hasRevealHandStep && hasTargetedDiscardThatCardStep;
}

export function pruneRedundantHandRevealDiscardChoiceUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(
      (step) => !isRedundantHandRevealDiscardChoiceUnknownStep(step, ability)
    );
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantBuybackCostPaymentUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^you may pay an additional buyback cost as you cast this spell[.)]*$/i.test(normalized);
}

export function pruneRedundantBuybackCostReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some((step) => step.kind !== 'unknown')) return ability;
    const nextSteps = ability.steps.filter(step => !isRedundantBuybackCostPaymentUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isStandaloneAnyPlayerMayActivateAbility(ability: OracleIRAbility): boolean {
  const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^any player may activate this ability[.)]*$/i.test(normalizedText)) return false;
  return ability.steps.length > 0 && ability.steps.every((step) => isRedundantAnyPlayerMayActivateUnknownStep(step));
}

function isRedundantAnyPlayerMayActivateUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^any player may activate this ability[.)]*$/i.test(normalized);
}

export function pruneRedundantAnyPlayerMayActivateUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities
    .filter((ability) => !isStandaloneAnyPlayerMayActivateAbility(ability))
    .map((ability) => {
    if (ability.type !== 'activated') return ability;
    if (!ability.steps.some((step) => step.kind !== 'unknown')) return ability;
    const nextSteps = ability.steps.filter(step => !isRedundantAnyPlayerMayActivateUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantImpulseCleanupUnknownStep(step: OracleEffectStep): boolean {
    if (!step || step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    (/\bput\s+the\s+exiled\s+cards\b/i.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+(?:that|their|your)\s+library\b/i.test(normalized)) ||
    (/\bput\s+the\s+exiled\s+card\b/i.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+(?:that|their|your)\s+library\b/i.test(normalized)) ||
    (/\bput\s+all\s+cards\s+exiled\b/i.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+their\s+library\b/i.test(normalized)) ||
    /\bshuffles\s+the\s+rest\s+into\s+their\s+library\b/i.test(normalized)
  );
}

export function pruneRedundantImpulseCleanupUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const nextSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      const previous = nextSteps[nextSteps.length - 1];
      if (previous?.kind === 'impulse_exile_top' && isRedundantImpulseCleanupUnknownStep(step)) {
        changed = true;
        const previousRaw = normalizeOracleText(String(previous.raw || ''))
          .replace(/[.]+$/g, '')
          .trim();
        const cleanupRaw = normalizeOracleText(String(step.raw || ''))
          .replace(/[.]+$/g, '')
          .trim();
        nextSteps[nextSteps.length - 1] = {
          ...previous,
          raw: `${previousRaw}. ${cleanupRaw}`.trim(),
        };
        continue;
      }

      nextSteps.push(step);
    }

    return changed ? { ...ability, steps: nextSteps } : ability;
  });
}

export function mergeDeterministicKeywordFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];

    const nextIsKeywordFollowup =
      next?.type === 'static' &&
      next.steps.length === 1 &&
      (
        next.steps[0]?.kind === 'proliferate' ||
        next.steps[0]?.kind === 'ring_tempts_you' ||
        next.steps[0]?.kind === 'investigate' ||
        next.steps[0]?.kind === 'populate'
      );

    if (!current || !nextIsKeywordFollowup) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: [...current.steps, ...next.steps],
    });
    i += 1;
  }

  return merged;
}

export function mergeDeterministicGraveyardPermissionFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const merged: OracleIRAbility[] = [];
  const normalizedAbilities = abilities.map((ability) => ({
    ...ability,
    steps: attachGraveyardExileReplacementModifier(ability.steps),
  }));

  for (let i = 0; i < normalizedAbilities.length; i += 1) {
    const current = normalizedAbilities[i];
    const next = normalizedAbilities[i + 1];

    const currentHasGraveyardPermission = Boolean(
      current?.steps.some((step) => step.kind === 'grant_graveyard_permission')
    );
    const nextStartsWithModifier =
      next?.type === 'static' &&
      next.steps.length >= 1 &&
      next.steps[0]?.kind === 'modify_graveyard_permissions' &&
      next.steps.slice(1).every((step) => isReminderGenericGraveyardGrant(step));

    if (!current || !currentHasGraveyardPermission || !nextStartsWithModifier) {
      merged.push(current);
      continue;
    }

    merged.push({
      ...current,
      text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
      effectText: `${String(current.effectText || '').trim()} ${String(next.effectText || '').trim()}`.trim(),
      steps: [...current.steps, next.steps[0]],
    });
    i += 1;
  }

  return merged;
}

function convertReminderSelfExileStepsToPermissionModifiers(
  steps: readonly OracleEffectStep[]
): readonly OracleEffectStep[] {
  const nextSteps: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    if (current.kind === 'conditional') {
      const nested = convertReminderSelfExileStepsToPermissionModifiers(current.steps);
      nextSteps.push(nested === current.steps ? current : { ...current, steps: nested });
      continue;
    }

    const next = steps[i + 1];
    if (isReminderSelfGraveyardGrant(current) && next && isReminderSelfExileStep(next)) {
      nextSteps.push(current);
      nextSteps.push({
        kind: 'modify_graveyard_permissions',
        scope: 'last_granted_graveyard_cards',
        exileInsteadOfGraveyard: true,
        ...(next.sequence ? { sequence: next.sequence } : {}),
        raw: String(next.raw || '').trim(),
      });
      i += 1;
      continue;
    }

    nextSteps.push(current);
  }

  return nextSteps;
}

export function convertReminderSelfExilePermissionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const converted = convertReminderSelfExileStepsToPermissionModifiers(ability.steps);
    return converted === ability.steps ? ability : { ...ability, steps: converted };
  });
}

function parseBattlefieldControllerForPostprocess(toRaw: string) {
  const normalized = normalizeOracleText(toRaw).toLowerCase();
  if (/\bunder\s+your\s+control\b/i.test(normalized)) return { kind: 'you' } as const;
  if (
    /\bunder\s+its\s+owner'?s\s+control\b/i.test(normalized) ||
    /\bunder\s+their\s+owners'?\s+control\b/i.test(normalized)
  ) {
    return { kind: 'owner_of_moved_cards' } as const;
  }
  return undefined;
}

function parseMoveZoneWithAttachFollowup(rawClause: string): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(?:(?:it|this permanent|this enchantment)\s+becomes an aura with\s+"[^"]*?(?:\.)?"\s*)?(return|put)\s+(.+?)\s+(to|onto)\s+(.+?)\s+and attach\s+(this enchantment|this equipment|this permanent|it)\s+to\s+(it|that creature)$/i
  );
  if (!match) return null;

  const action = String(match[1] || '').trim().toLowerCase();
  const whatRaw = String(match[2] || '').trim();
  const preposition = String(match[3] || '').trim().toLowerCase();
  const toRaw = String(match[4] || '').trim();
  const attachmentRaw = String(match[5] || '').trim();
  const targetRaw = String(match[6] || '').trim();
  if (!whatRaw || !toRaw || !attachmentRaw || !targetRaw) return null;

  const fullToRaw = `${preposition} ${toRaw}`.trim();
  const to = inferZoneFromDestination(fullToRaw);
  if (to !== 'battlefield') return null;

  const moveStep: OracleEffectStep = {
    kind: 'move_zone',
    what: parseObjectSelector(whatRaw),
    to,
    toRaw: fullToRaw,
    battlefieldController: parseBattlefieldControllerForPostprocess(fullToRaw),
    raw: `${action === 'return' ? 'Return' : 'Put'} ${whatRaw} ${preposition} ${toRaw}`,
  };

  const attachStep: OracleEffectStep = {
    kind: 'attach',
    attachment: parseObjectSelector(attachmentRaw),
    to: parseObjectSelector(targetRaw),
    raw: `attach ${attachmentRaw} to ${targetRaw}`,
  };

  return [moveStep, attachStep];
}

function parseStandaloneAttachUnknownStep(rawClause: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).replace(/^then\b\s*/i, '').trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^(?:(you)\s+may\s+)?attach\s+(this enchantment|this equipment|this permanent|it)\s+to\s+(target creature(?: you control)?|target land(?: you control)?|that creature|that land|it)$/i
  );
  if (!match) return null;

  return {
    kind: 'attach',
    attachment: parseObjectSelector(String(match[2] || '').trim()),
    to: parseObjectSelector(String(match[3] || '').trim()),
    optional: Boolean(match[1]),
    raw: normalized,
  };
}

export function expandMoveZoneAttachUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const expandSteps = (steps: readonly OracleEffectStep[]): { readonly steps: readonly OracleEffectStep[]; readonly changed: boolean } => {
    let changed = false;
    const expandedSteps = steps.flatMap((step) => {
      if (step.kind === 'conditional') {
        const expandedNested = expandSteps(step.steps);
        if (!expandedNested.changed) return [step];
        changed = true;
        return [{ ...step, steps: expandedNested.steps }];
      }

      if (step.kind === 'move_zone') {
        const expanded = parseMoveZoneWithAttachFollowup(String(step.raw || ''));
        if (expanded) {
          changed = true;
          return [...expanded];
        }
        return [step];
      }

      if (step.kind !== 'unknown') return [step];
      const expanded = parseMoveZoneWithAttachFollowup(step.raw);
      if (expanded) {
        changed = true;
        return [...expanded];
      }
      const standaloneAttach = parseStandaloneAttachUnknownStep(step.raw);
      if (!standaloneAttach) return [step];
      changed = true;
      return [standaloneAttach];
    });

    return { steps: expandedSteps, changed };
  };

  return abilities.map((ability) => {
    const expanded = expandSteps(ability.steps);
    return expanded.changed ? { ...ability, steps: expanded.steps } : ability;
  });
}

function parseCreateEmblemUnknownStep(rawClause: string, cardName?: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized) return null;

  if (!/^you get an emblem with\b/i.test(normalized)) return null;

  const abilities = Array.from(normalized.matchAll(/"([^"]+)"/g))
    .map(match => String(match[1] || '').trim())
    .filter(Boolean);
  if (abilities.length === 0) {
    const fallback = String(normalized.match(/^you get an emblem with\s+([\s\S]+)$/i)?.[1] || '')
      .replace(/[.]+$/g, '')
      .trim();
    if (fallback) abilities.push(fallback);
  }
  if (abilities.length === 0) return null;

  return {
    kind: 'create_emblem',
    abilities,
    ...(cardName ? { name: `${cardName} Emblem` } : {}),
    raw: normalized,
  };
}

export function expandCreateEmblemUnknownAbilities(
  abilities: readonly OracleIRAbility[],
  cardName?: string
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCreateEmblemUnknownStep(step.raw, cardName);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}
