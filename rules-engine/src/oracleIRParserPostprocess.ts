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

function parseConditionalLookChooseFromTopPair(
  current: OracleEffectStep,
  next: OracleEffectStep | undefined
): OracleEffectStep | null {
  if (current.kind !== 'unknown' || next?.kind !== 'unknown') return null;

  const normalizedLook = normalizeOracleText(String(current.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const lookMatch = normalizedLook.match(/^if you do,\s*look at the top (a|an|\d+|x|[a-z]+) cards? of your library$/i);
  if (!lookMatch) return null;

  const amount = parseQuantity(String(lookMatch[1] || '').trim());
  if (amount.kind !== 'number') return null;

  const normalizedFollowup = normalizeOracleText(String(next.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const followupMatch = normalizedFollowup.match(
    /^you may reveal (.+?) card from among them and put it into your hand\.\s*put the rest on the bottom of your library in (a random|any) order$/i
  );
  if (!followupMatch) return null;

  const selectorText = String(followupMatch[1] || '')
    .trim()
    .replace(/^an?\s+/i, '');
  if (!selectorText) return null;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: 'you do' },
    steps: [
      {
        kind: 'look_choose_from_top',
        who: { kind: 'you' },
        amount,
        selectorText,
        destination: 'hand',
        reveal: true,
        ...(/^any$/i.test(String(followupMatch[2] || '').replace(/^a\s+/i, '')) ? { restOrder: 'any' as const } : {}),
        optional: true,
        raw: `${normalizedLook.replace(/^if you do,\s*/i, '')}. ${normalizedFollowup}`.trim(),
      },
    ],
    ...(current.sequence ? { sequence: current.sequence } : {}),
    raw: `${normalizedLook}. ${normalizedFollowup}`.trim(),
  };
}

export function mergeConditionalLookChooseFromTopAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const merged: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];
      const combined = parseConditionalLookChooseFromTopPair(current, next);
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

function counterRecordFromAddCounterStep(step: OracleEffectStep | undefined): Record<string, number> | null {
  if (!step || step.kind !== 'add_counter') return null;
  if (step.amount.kind !== 'number' || step.amount.value <= 0) return null;
  const counter = normalizeCounterName(String(step.counter || '').trim());
  if (!counter) return null;
  return { [counter]: Math.max(0, step.amount.value | 0) };
}

function parseBattlefieldEntryCounterFollowupStep(step: OracleEffectStep | undefined): {
  readonly condition?: OracleClauseCondition;
  readonly withCounters: Record<string, number>;
  readonly raw: string;
} | null {
  if (!step) return null;

  if (step.kind === 'unknown' || step.kind === 'add_counter') {
    const parsed = parseConditionalBattlefieldEntryCounters(String(step.raw || ''));
    if (parsed) return { ...parsed, raw: String(step.raw || '').trim() };
  }

  if (step.kind === 'conditional' && step.steps.length === 1) {
    const withCounters = counterRecordFromAddCounterStep(step.steps[0]);
    if (withCounters) {
      return {
        condition: step.condition,
        withCounters,
        raw: String(step.raw || '').trim(),
      };
    }
  }

  return null;
}

function parseCounterQuantityForMetadata(amountText: string, scalingText = ''): OracleQuantity {
  const amount = normalizeOracleText(amountText)
    .replace(/^up to\s+/i, '')
    .replace(/\s+of$/i, '')
    .trim();
  const scaling = normalizeOracleText(scalingText).trim();
  if (!amount) return { kind: 'unknown' };
  if (/^(?:a\s+number|number)$/i.test(amount)) {
    if (scaling) {
      const parsed = parseQuantity(`${amount} ${scaling}`.trim());
      if (parsed.kind !== 'unknown') return parsed;
    }
    return { kind: 'unknown', raw: scaling ? `${amount} ${scaling}`.trim() : amount };
  }
  if (scaling) {
    const parsed = parseQuantity(`${amount} ${scaling}`.trim());
    if (parsed.kind !== 'unknown') return parsed;
    return { kind: 'unknown', raw: `${amount} ${scaling}`.trim() };
  }
  return parseQuantity(amount);
}

function parseDynamicCounterRider(rawText: string, targetText: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawText)
    .replace(/[.)]+$/g, '')
    .trim();
  if (!normalized || !/\bcounters?\b/i.test(normalized)) return null;

  const match = normalized.match(
    /\b(?:with|put(?:s)?)\s+((?:a\s+number\s+of|number\s+of|that\s+many|x|a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve))\s+(?:additional\s+)?(.+?)\s+counters?\s+on\s+(?:it|them|that creature|those creatures|each of those creatures|each of them)(?:\s+(for\s+each|equal\s+to)\s+(.+?))?$/i
  );
  if (!match) return null;

  const counter = normalizeCounterName(String(match[2] || '').trim());
  if (!counter) return null;

  const scalingText = [match[3], match[4]].filter(Boolean).join(' ').trim();
  const amount = parseCounterQuantityForMetadata(String(match[1] || '').trim(), scalingText);
  if (amount.kind === 'number') return null;

  return {
    kind: 'add_counter',
    amount,
    counter,
    target: parseObjectSelector(targetText),
    raw: normalized,
  };
}

function stripMalformedDynamicWithCounters(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'move_zone') return step;
  const counters = (step as any).withCounters;
  if (!counters || typeof counters !== 'object') return step;
  const entries = Object.entries(counters);
  if (!entries.some(([counter]) => /\bnumber\s+of\b/i.test(counter))) return step;

  const { withCounters: _withCounters, ...rest } = step as any;
  return rest as OracleEffectStep;
}

function parseSimpleCounterTailStep(rawTail: string): OracleEffectStep | null {
  const normalized = normalizeClauseForParse(rawTail.replace(/[.]+$/g, '').trim());
  if (!normalized.clause) return null;
  const parsed = tryParseSimpleActionClause({
    clause: normalized.clause,
    rawClause: rawTail,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed && parsed.kind !== 'unknown' ? parsed : null;
}

function parseLifeTailStep(rawTail: string): OracleEffectStep | null {
  const normalized = normalizeClauseForParse(rawTail.replace(/[.]+$/g, '').trim());
  if (!normalized.clause) return null;
  const parsed = tryParseLifeAndCombatClause({
    clause: normalized.clause,
    rawClause: rawTail,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed && parsed.kind !== 'unknown' ? parsed : null;
}

function splitExileAndCounterRiderStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'exile' || (step.target as any)?.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String((step.target as any).text || '')).trim();
  const match = targetText.match(/^(it|that creature|that permanent|that card)\s+and\s+(put\s+.+?\s+counters?\s+.+)$/i);
  if (!match) return null;

  const counterStep = parseSimpleCounterTailStep(String(match[2] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;

  return [
    {
      ...step,
      target: parseObjectSelector(String(match[1] || '').trim()),
      raw: `exile ${String(match[1] || '').trim()}`,
    },
    counterStep,
  ];
}

function splitCounterAndDrawStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/\b(put\s+.+?\s+counters?\s+on\s+.+?)\s+and\s+(draw\s+.+)$/i);
  if (!match) return null;

  const counterStep = parseSimpleCounterTailStep(String(match[1] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;
  return [counterStep, { ...step, raw: String(match[2] || '').trim() }];
}

function splitLifeAndDrawStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const match = raw.match(/\b((?:you|each player|each opponent|target player|target opponent|that player|that opponent)\s+loses?\s+.+?\s+life)\s+and\s+(draws?\s+.+)$/i);
  if (!match) return null;

  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  const drawRaw = String(match[2] || '').trim();
  const drawStep: OracleEffectStep = { ...step, raw: drawRaw.replace(/^draws\b/i, 'draw').trim() };
  if (/^draws\b/i.test(drawRaw)) (drawStep as any).who = (lifeStep as any).who;
  return [lifeStep, drawStep];
}

function splitDrawAndLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').replace(/^then\s+/i, '').trim();

  const drawLose = raw.match(/^(.+?)\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+(?:(.+?)\s+)?loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (drawLose) {
    const who = String(drawLose[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawLose[2] || '').trim()}`;
    const lifeWho = String(drawLose[3] || '').trim() || who;
    const lifeRaw = `${lifeWho} ${/^you$/i.test(lifeWho) ? 'lose' : 'loses'} ${String(drawLose[4] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    const lifeStep = parseLifeTailStep(lifeRaw);
    if (drawStep?.kind === 'draw' && lifeStep?.kind === 'lose_life') return [drawStep, lifeStep];
  }

  const drawCommaLose = raw.match(/^(.+?)\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)(?:,\s+and\s+.+)?$/i);
  if (drawCommaLose) {
    const who = String(drawCommaLose[1] || '').trim();
    const drawRaw = `${who} ${/^you$/i.test(who) ? 'draw' : 'draws'} ${String(drawCommaLose[2] || '').trim()}`;
    const lifeRaw = `${who} ${/^you$/i.test(who) ? 'lose' : 'loses'} ${String(drawCommaLose[3] || '').trim()}`;
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(drawRaw).clause,
      rawClause: drawRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    const lifeStep = parseLifeTailStep(lifeRaw);
    if (drawStep?.kind === 'draw' && lifeStep?.kind === 'lose_life') return [drawStep, lifeStep];
  }

  const gainDraw = raw.match(/^(.+?)\s+gains?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)\s+and\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)$/i);
  if (gainDraw) {
    const who = String(gainDraw[1] || '').trim();
    const gainVerb = /^you$/i.test(who) ? 'gain' : 'gains';
    const drawVerb = /^you$/i.test(who) ? 'draw' : 'draws';
    const lifeStep = parseLifeTailStep(`${who} ${gainVerb} ${String(gainDraw[2] || '').trim()}`);
    const drawStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(`${who} ${drawVerb} ${String(gainDraw[3] || '').trim()}`).clause,
      rawClause: `${who} ${drawVerb} ${String(gainDraw[3] || '').trim()}`,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (lifeStep?.kind === 'gain_life' && drawStep?.kind === 'draw') return [lifeStep, drawStep];
  }

  const loseEqualDraw = raw.match(/^(.+?)\s+loses?\s+life\s+equal\s+to\s+(.+?)\s+and\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)$/i);
  if (loseEqualDraw) {
    const who = String(loseEqualDraw[1] || '').trim();
    const lifeStep = parseLifeTailStep(`${who} loses life equal to ${String(loseEqualDraw[2] || '').trim()}`);
    const drawAmount = String(loseEqualDraw[3] || '').trim().replace(/\s+cards?$/i, '');
    const drawStep: OracleEffectStep = {
      kind: 'draw',
      who: parsePlayerSelector(who),
      amount: parseQuantity(drawAmount),
      raw: `${who} draws ${String(loseEqualDraw[3] || '').trim()}`,
    };
    if (lifeStep?.kind === 'lose_life') return [lifeStep, drawStep];
  }

  return null;
}

function parseForEachLifePairUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const match = raw.match(/^for\s+each\s+(.+?),\s+(.+?)\s+loses?\s+(that much|that many|\d+|x|[a-z]+)\s+life\s+and\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life$/i);
  if (!match) return null;
  const context = String(match[1] || '').trim();
  return [
    {
      kind: 'lose_life',
      who: parsePlayerSelector(String(match[2] || '').trim()),
      amount: parseQuantity(`${String(match[3] || '').trim()} for each ${context}`),
      raw: `${String(match[2] || '').trim()} loses ${String(match[3] || '').trim()} life for each ${context}`,
    },
    {
      kind: 'gain_life',
      who: parsePlayerSelector(String(match[4] || '').trim()),
      amount: parseQuantity(`${String(match[5] || '').trim()} for each ${context}`),
      raw: `${String(match[4] || '').trim()} ${/^you$/i.test(String(match[4] || '').trim()) ? 'gain' : 'gains'} ${String(match[5] || '').trim()} life for each ${context}`,
    },
  ];
}

function parseLifePairUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^•\s*/, '')
    .replace(/^then\s+/i, '')
    .trim();
  const match = raw.match(/^(.+?)\s+loses?\s+(that much|that many|\d+|x|[a-z]+)\s+life\s+and\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life(?:,\s+where\s+.+)?$/i);
  if (!match) return null;
  return [
    {
      kind: 'lose_life',
      who: parsePlayerSelector(String(match[1] || '').trim()),
      amount: parseQuantity(String(match[2] || '').trim()),
      raw: `${String(match[1] || '').trim()} loses ${String(match[2] || '').trim()} life`,
      ...(step.sequence ? { sequence: step.sequence } : {}),
    },
    {
      kind: 'gain_life',
      who: parsePlayerSelector(String(match[3] || '').trim()),
      amount: parseQuantity(String(match[4] || '').trim()),
      raw: `${String(match[3] || '').trim()} ${/^you$/i.test(String(match[3] || '').trim()) ? 'gain' : 'gains'} ${String(match[4] || '').trim()} life`,
      ...(step.sequence ? { sequence: step.sequence } : {}),
    },
  ];
}

function parseUntilEndTriggeredLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^until\s+end\s+of\s+turn,\s+whenever\s+.+?,\s+(.+?)\s+loses?\s+(\d+|x|[a-z]+)\s+life\s+for\s+each\s+(.+)$/i);
  if (!match) return null;
  return {
    kind: 'lose_life',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    amount: parseQuantity(`${String(match[2] || '').trim()} for each ${String(match[3] || '').trim()}`),
    duration: 'end_of_turn',
    raw,
  } as OracleEffectStep;
}

function parseForAnyNumberOpponentsDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^for\s+any\s+number\s+of\s+opponents,\s+(destroy\s+.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed?.kind === 'destroy' ? parsed : null;
}

function parseDestroyClauseFallback(rawClause: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).replace(/[.)"”]+$/g, '').trim();
  if (!/^destroy\b/i.test(normalized)) return null;
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(normalized).clause,
    rawClause: normalized,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (parsed?.kind === 'destroy') return parsed;

  const targetMatch = normalized.match(/^destroy\s+(.+)$/i);
  if (!targetMatch) return null;
  return {
    kind: 'destroy',
    target: parseObjectSelector(String(targetMatch[1] || '').trim()),
    raw: normalized,
  };
}

function parseWrappedDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const candidates: string[] = [];

  const parenthetical = raw.match(/\((destroy\s+[^)]+)\)/i);
  if (parenthetical) candidates.push(String(parenthetical[1] || '').trim());

  const otherwise = raw.match(/^otherwise,?\s+(destroy\s+.+)$/i);
  if (otherwise) candidates.push(String(otherwise[1] || '').trim());

  const triggerBody = raw.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(?:you\s+may\s+)?(destroy\s+.+)$/i);
  if (triggerBody) candidates.push(String(triggerBody[1] || '').trim());

  const destroyOccurrence = raw.match(/\b(destroy\s+.+)$/i);
  if (destroyOccurrence) candidates.push(String(destroyOccurrence[1] || '').trim());

  const forEach = raw.match(/^for\s+each\s+opponent,\s+(destroy\s+.+)$/i);
  if (forEach) candidates.push(String(forEach[1] || '').trim());

  const stickerPrefix = raw.match(/^(?:\{[^}]+\}\s*)+[-–—]\s+(?:(?:when|whenever)\b.+?,\s+)?(?:you\s+may\s+)?(destroy\s+.+)$/i);
  if (stickerPrefix) candidates.push(String(stickerPrefix[1] || '').trim());

  const direct = raw.match(/^(destroy\s+.+)$/i);
  if (direct) candidates.push(String(direct[1] || '').trim());

  for (const candidate of candidates) {
    const beforeCounterTail = candidate.replace(/\s+and\s+put\b.+$/i, '').trim();
    const parsed = parseDestroyClauseFallback(beforeCounterTail);
    if (parsed) return parsed;
  }
  return null;
}

function parseSearchResultCount(raw: string): number | undefined {
  const normalized = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  switch (normalized) {
    case 'a':
    case 'an':
    case 'one':
      return 1;
    case 'two':
      return 2;
    case 'three':
      return 3;
    case 'four':
      return 4;
    case 'five':
      return 5;
    case 'six':
      return 6;
    case 'seven':
      return 7;
    case 'eight':
      return 8;
    case 'nine':
      return 9;
    case 'ten':
      return 10;
    case 'eleven':
      return 11;
    case 'twelve':
      return 12;
    default:
      return undefined;
  }
}

function normalizeLibrarySearchCriteria(rawCriteria: string): { text: string; maxResults?: number } {
  let criteria = String(rawCriteria || '').trim();
  let maxResults: number | undefined;

  const upToMatch = criteria.match(/^up to\s+([a-z0-9]+)\s+(.+)$/i);
  if (upToMatch) {
    maxResults = parseSearchResultCount(String(upToMatch[1] || ''));
    criteria = String(upToMatch[2] || '').trim();
  }

  const anyNumberMatch = criteria.match(/^any number of\s+(.+)$/i);
  if (anyNumberMatch) {
    criteria = String(anyNumberMatch[1] || '').trim();
  }

  const exactCountMatch = criteria.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(.+)$/i);
  if (exactCountMatch) {
    maxResults = parseSearchResultCount(String(exactCountMatch[1] || ''));
    criteria = String(exactCountMatch[2] || '').trim();
  }

  criteria = criteria
    .replace(/^(?:a|an)\s+/i, '')
    .replace(/\bcards?\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { text: criteria, maxResults };
}

function parseLibrarySearchUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^•\s*/, '')
    .replace(/[.)]+$/g, '')
    .trim();
  if (!raw || /\bcan't\b[\s\S]*\bsearch\b/i.test(raw)) return null;

  const searchStart = raw.match(/\b((?:(?:you|its controller|that player|that opponent)\s+may\s+)?search\s+(?:your|their|that player's|that player’s|target player's|target player’s|that opponent's|that opponent’s)\s+library[\s\S]*)$/i);
  if (!searchStart) return null;
  const searchClause = String(searchStart[1] || '').trim();
  const searchMatch = searchClause.match(/^(?:(you|its controller|that player|that opponent)\s+may\s+)?search\s+(your|their|that player's|that player’s|target player's|target player’s|that opponent's|that opponent’s)\s+library(?:\s+(?:and\/or|and)\s+graveyard)?\s+for\s+([\s\S]+)$/i);
  if (!searchMatch) return null;

  const subject = String(searchMatch[1] || '').trim();
  const libraryOwner = String(searchMatch[2] || '').toLowerCase();
  const afterFor = String(searchMatch[3] || '').trim();
  const split = afterFor.match(/^([\s\S]+?)(?:,\s*([\s\S]+)|\s+and\s+((?:put|reveal|cast|exile)\b[\s\S]+))?$/i);
  if (!split) return null;

  const { text: criteriaText, maxResults } = normalizeLibrarySearchCriteria(String(split[1] || '').trim());
  const tail = String(split[2] || split[3] || '').trim();
  const combined = `${searchClause} ${tail}`.trim();
  const destination = /\bonto\s+the\s+battlefield\b/i.test(tail)
    ? 'battlefield'
    : /\binto\s+your\s+graveyard\b|\bgraveyard\b/i.test(tail)
      ? 'graveyard'
      : /\bexile\b/i.test(tail)
        ? 'exile'
        : /\bon\s+top\b/i.test(tail)
          ? 'top'
          : /\bon\s+the\s+bottom\b|\bbottom\b/i.test(tail)
            ? 'bottom'
            : 'hand';
  const who = subject
    ? parsePlayerSelector(subject)
    : libraryOwner === 'their'
      ? parsePlayerSelector('that player')
      : /^that player/.test(libraryOwner)
        ? parsePlayerSelector('that player')
        : /^target player/.test(libraryOwner)
          ? parsePlayerSelector('target player')
          : /^that opponent/.test(libraryOwner)
            ? parsePlayerSelector('that opponent')
      : { kind: 'you' as const };

  return {
    kind: 'search_library',
    who,
    criteria: { kind: 'raw', text: criteriaText },
    destination,
    revealFound: /\breveal\b/i.test(combined) || undefined,
    entersTapped: destination === 'battlefield' && /\btapped\b/i.test(tail) || undefined,
    shuffle: /\bshuffle\b/i.test(combined) || undefined,
    maxResults,
    optional: /\bmay\s+search\b/i.test(searchClause) || undefined,
    raw: searchClause,
  };
}

function parsePrefixedDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const body = raw
    .replace(/^\+\s*(?:\{[^}]+\}\s*)+[-–—]\s*/i, '')
    .replace(/^[A-Za-z][A-Za-z0-9 ',\-]+\s+-\s+(?:\{[^}]+\}\s+-\s+)?/i, '')
    .trim();
  if (body === raw || !/^destroy\b/i.test(body)) return null;
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(body).clause,
    rawClause: body,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed?.kind === 'destroy' ? parsed : null;
}

function parseTimedDestroyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^at\s+end\s+of\s+combat,\s+(destroy\s+.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const parsed = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  return parsed?.kind === 'destroy' ? ({ ...parsed, timing: 'end_of_combat' } as OracleEffectStep) : null;
}

function parseForEachGainLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^for\s+each\s+(.+?),\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life$/i);
  if (!match) return null;
  return {
    kind: 'gain_life',
    who: parsePlayerSelector(String(match[2] || '').trim()),
    amount: parseQuantity(`${String(match[3] || '').trim()} for each ${String(match[1] || '').trim()}`),
    raw,
  } as OracleEffectStep;
}

function parseForEachManaGainLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^for\s+each\s+(.+?),\s+add\s+\{[^}]+\}\s+and\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life$/i);
  if (!match) return null;
  return {
    kind: 'gain_life',
    who: parsePlayerSelector(String(match[2] || '').trim()),
    amount: parseQuantity(`${String(match[3] || '').trim()} for each ${String(match[1] || '').trim()}`),
    raw,
  } as OracleEffectStep;
}

function parseEnterAsCopyUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  if (!/^you\s+may\s+have\s+this\s+creature\s+enter\s+as\s+a\s+copy\s+of\s+any\s+creature\s+on\s+the\s+battlefield$/i.test(raw)) {
    return null;
  }
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector('this creature'),
    effectText: ['may enter as a copy of any creature on the battlefield'],
    duration: 'static',
    raw,
  } as OracleEffectStep;
}

function parseCurrentResidualUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const sequence = step.sequence ? { sequence: step.sequence } : {};

  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as OracleEffectStep];

  if (/^(?:devour\s+(?:\d+|x)|gravestorm)\b/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  if (/^(?:any\s+(?:opponent|player)\s+may\s+sacrifice\s+a\s+(?:creature|land)\s+of\s+their\s+choice|as\s+this\s+creature\s+enters,\s+pay\s+any\s+amount\s+of\s+life|discard\s+down\s+to\s+your\s+maximum\s+hand\s+size)$/i.test(raw)) {
    return staticMetadata('choice', raw);
  }

  if (/^activated\s+abilities\s+of\s+sources\s+with\s+the\s+chosen\s+name\s+cost\s+\{2\}\s+more\s+to\s+activate\s+unless\s+they(?:'|’)?re\s+mana\s+abilities$/i.test(raw)) {
    return staticMetadata('activated abilities of sources with the chosen name', "cost {2} more to activate unless they're mana abilities");
  }

  if (/^(?:then\s+)?do\s+the\s+same\s+for\s+aura\s+cards$/i.test(raw)) {
    return staticMetadata('Aura cards', 'do the same');
  }

  if (/^(?:then\s+)?each\s+opponent\s+who\s+didn(?:'|’)?t\s+draws\s+a\s+card$/i.test(raw)) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: "each opponent who didn't" },
      steps: [{ kind: 'draw', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 1 }, raw: 'each opponent draws a card' }],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^(?:then\s+)?reveal\s+the\s+card$/i.test(raw)) {
    return staticMetadata('that card', 'reveal it');
  }

  if (/^(?:then\s+)?reveal\s+the\s+top\s+card$/i.test(raw)) {
    return [{ kind: 'reveal_top', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:then\s+)?reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'reveal_top', who: { kind: 'target_player' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:then\s+)?shuffles\s+all\s+other\s+cards\s+revealed\s+this\s+way\s+into\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('all other cards revealed this way'), to: 'library', toRaw: 'their library', raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:then\s+)?that\s+player\s+chooses\s+a\s+card\s+name$/i.test(raw)) {
    return [{ kind: 'choose_card_name', raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:then\s+)?that\s+player\s+puts\s+the\s+exiled\s+cards\s+that\s+weren(?:'|’)?t\s+cast\s+this\s+way\s+on\s+the\s+bottom\s+of\s+their\s+library\s+in\s+a\s+random\s+order$/i.test(raw)) {
    return staticMetadata('exiled cards not cast this way', 'put on the bottom of their library in a random order');
  }

  if (/^(?:then\s+)?the\s+player\s+to\s+your\s+left\s+chooses\s+a\s+third\s+color$/i.test(raw)) {
    return staticMetadata('player to your left', 'chooses a third color');
  }

  if (/^(?:then\s+)?you\s+may\s+discard\s+a\s+nonland\s+card$/i.test(raw)) {
    return [{ kind: 'discard', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, target: parseObjectSelector('a nonland card'), optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:then\s+)?you\s+may\s+pay\s+eight\s+\{e\}$/i.test(raw)) {
    return staticMetadata('energy payment', 'you may pay eight {E}');
  }

  if (/^(?:then\s+)?you\s+put\s+a\s+creature\s+card\s+from\s+a\s+graveyard\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('a creature card from a graveyard'), to: 'battlefield', toRaw: 'the battlefield under your control', raw, ...sequence } as OracleEffectStep];
  }

  if (/^there\s+is\s+an\s+additional\s+beginning\s+phase\s+after\s+this\s+phase$/i.test(raw)) {
    return staticMetadata('turn structure', raw);
  }

  if (/^they\s+don(?:'|’)?t\s+untap\s+during\s+their\s+controller(?:'|’)?s\s+next\s+untap\s+step$/i.test(raw)) {
    return [{ kind: 'skip_next_untap', target: parseObjectSelector('they'), raw, ...sequence } as OracleEffectStep];
  }

  const phaseUnlessPay = raw.match(/^(?:at\s+the\s+beginning\s+of\s+your\s+upkeep,\s+)?this\s+creature\s+phases\s+out\s+unless\s+you\s+pay\s+((?:\{[^}]+\})+)$/i);
  if (phaseUnlessPay) {
    return staticMetadata('this creature', `phases out unless you pay ${String(phaseUnlessPay[1] || '').trim()}`);
  }

  if (/^they\s+remain\s+paired\s+for\s+as\s+long\s+as\s+you\s+control\s+both\s+of\s+them\.?\)?$/i.test(raw)) {
    return staticMetadata('paired creatures', 'remain paired for as long as you control both of them');
  }

  if (/^they\s+gain\s+decayed$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      abilities: ['decayed'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const abilityCostReduction = raw.match(/^this\s+ability\s+costs\s+(\{[^}]+\})\s+less\s+to\s+activate\s+for\s+each\s+(.+)$/i);
  if (abilityCostReduction) {
    return staticMetadata('this ability', `costs ${String(abilityCostReduction[1] || '').trim()} less to activate for each ${String(abilityCostReduction[2] || '').trim()}`);
  }

  if (/^this\s+change\s+in\s+ownership\s+is\s+permanent$/i.test(raw)) {
    return staticMetadata('ownership change', 'is permanent');
  }

  if (/^this\s+creature\s+attacks\s+or\s+blocks\s+each\s+combat\s+if\s+able$/i.test(raw)) {
    return staticMetadata('this creature', 'attacks or blocks each combat if able');
  }

  const temporaryUnblockable = raw.match(/^(this\s+creature|target\s+creature|it)\s+can(?:not|'t)\s+be\s+blocked\s+(this\s+combat|this\s+turn)(?:\s+except\s+by\s+(.+))?$/i);
  if (temporaryUnblockable) {
    const exceptBy = String(temporaryUnblockable[3] || '').trim();
    return temporaryMetadata(
      String(temporaryUnblockable[1] || '').trim(),
      exceptBy ? `can't be blocked except by ${exceptBy}` : "can't be blocked",
      'this_turn'
    );
  }

  const staticCantBlockRestriction = raw.match(/^(this\s+creature)\s+can(?:not|'t)\s+block\s+(.+)$/i);
  if (staticCantBlockRestriction) {
    return staticMetadata(String(staticCantBlockRestriction[1] || '').trim(), `can't block ${String(staticCantBlockRestriction[2] || '').trim()}`);
  }

  if (/^this\s+creature\s+can(?:not|'t)\s+have\s+counters\s+put\s+on\s+it$/i.test(raw)) {
    return staticMetadata('this creature', "can't have counters put on it");
  }

  const selfPumpAndDamage = raw.match(/^this\s+creature\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn\s+and\s+deals\s+(\d+)\s+damage\s+to\s+you$/i);
  if (selfPumpAndDamage) {
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('this creature'),
        power: Number.parseInt(String(selfPumpAndDamage[1] || '0'), 10),
        toughness: Number.parseInt(String(selfPumpAndDamage[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as OracleEffectStep,
      {
        kind: 'deal_damage',
        source: parseObjectSelector('this creature'),
        target: parseObjectSelector('you'),
        amount: { kind: 'number', value: Number.parseInt(String(selfPumpAndDamage[3] || '0'), 10) || 0 },
        raw,
        sequence: 'then',
      } as OracleEffectStep,
    ];
  }

  if (/^this\s+creature\s+has\s+all\s+activated\s+abilities\s+of\s+all\s+creature\s+cards\s+exiled\s+with\s+it$/i.test(raw)) {
    return staticMetadata('this creature', 'has all activated abilities of all creature cards exiled with it');
  }

  if (/^this\s+creature\s+has\s+protection\s+from\s+the\s+chosen\s+color$/i.test(raw)) {
    return staticMetadata('this creature', 'protection from the chosen color');
  }

  if (/^this\s+creature\s+phases\s+out\s+unless\s+you$/i.test(raw)) {
    return staticMetadata('this creature', 'phases out unless you');
  }

  const selfLandAnimation = raw.match(/^this\s+land\s+becomes\s+a\s+(\d+)\/(\d+)\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
  if (selfLandAnimation) {
    const typeText = String(selfLandAnimation[3] || '').replace(/\bwith\s+.+$/i, '').trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('this land'),
      addTypes: typeText ? typeText.split(/\s+/).filter(Boolean) : ['creature'],
      power: Number.parseInt(String(selfLandAnimation[1] || '0'), 10),
      toughness: Number.parseInt(String(selfLandAnimation[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^this\s+mana\s+can(?:not|'t)\s+be\s+spent\s+to\s+(?:cast\s+nonartifact\s+spells|pay\s+generic\s+mana\s+costs)$/i.test(raw)) {
    return staticMetadata('this mana', raw.replace(/^this\s+mana\s+/i, ''));
  }

  if (/^this\s+permanent\s+gets\s+\+1\/\+1\s+for\s+each\s+experience\s+counter\s+you\s+have$/i.test(raw)) {
    return staticMetadata('this permanent', 'gets +1/+1 for each experience counter you have');
  }

  if (/^this\s+permanent(?:'|\u2019)s\s+toughness\s+is\s+equal\s+to\s+the\s+number\s+of\s+forests\s+you\s+control$/i.test(raw)) {
    return staticMetadata('this permanent', 'toughness is equal to the number of Forests you control');
  }

  if (/^those\s+permanents\s+phase\s+out$/i.test(raw)) {
    return [{ kind: 'phase_out', target: parseObjectSelector('those permanents'), raw, ...sequence } as OracleEffectStep];
  }

  if (/^transform\s+target\s+incubator\s+token\s+you\s+control$/i.test(raw)) {
    return staticMetadata('target Incubator token you control', 'transform');
  }

  const targetTemporaryPt = raw.match(/^(up\s+to\s+one\s+target\s+creature|up\s+to\s+two\s+target\s+creatures\s+you\s+control|two\s+target\s+creatures)\s+(?:each\s+)?gets?\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (targetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(targetTemporaryPt[1] || '').trim()),
      power: Number.parseInt(String(targetTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(targetTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      optional: /^up\s+to/i.test(String(targetTemporaryPt[1] || '')) || undefined,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^two\s+target\s+players\s+exchange\s+life\s+totals$/i.test(raw)) {
    return staticMetadata('two target players', 'exchange life totals');
  }

  if (/^under\s+your\s+control$/i.test(raw)) {
    return staticMetadata('control rider', 'under your control');
  }

  if (/^until\s+end\s+of\s+combat,\s+you\s+don(?:'|\u2019)?t\s+lose\s+this\s+mana\s+as\s+steps\s+end$/i.test(raw)) {
    return [{ kind: 'retain_mana', who: { kind: 'you' }, duration: 'until_end_of_combat', raw, ...sequence } as OracleEffectStep];
  }

  if (/^until\s+end\s+of\s+turn,\s+damage\s+that\s+would\s+reduce\s+your\s+life\s+total\s+to\s+less\s+than\s+1\s+reduces\s+it\s+to\s+1\s+instead$/i.test(raw)) {
    return temporaryMetadata('you', 'damage that would reduce your life total to less than 1 reduces it to 1 instead', 'end_of_turn');
  }

  const leadingTemporaryPtAndAbility = raw.match(/^until\s+end\s+of\s+turn,\s+(target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+for\s+each\s+(.+?)\s+and\s+gains\s+(.+)$/i);
  if (leadingTemporaryPtAndAbility) {
    const ability = String(leadingTemporaryPtAndAbility[5] || '').trim().toLowerCase();
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(String(leadingTemporaryPtAndAbility[1] || '').trim()),
        power: Number.parseInt(String(leadingTemporaryPtAndAbility[2] || '0'), 10),
        toughness: Number.parseInt(String(leadingTemporaryPtAndAbility[3] || '0'), 10),
        scaler: { kind: 'reference_scaler', raw: `for each ${String(leadingTemporaryPtAndAbility[4] || '').trim()}` },
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(leadingTemporaryPtAndAbility[1] || '').trim()),
        abilities: [ability],
        duration: 'end_of_turn',
        raw,
        sequence: 'then',
      } as OracleEffectStep,
    ];
  }

  const leadingAnimation = raw.match(/^until\s+end\s+of\s+turn,\s+(target\s+(?:land|noncreature\s+artifact\s+you\s+control))\s+becomes\s+a\s+(\d+)\/(\d+)\s+(.+)$/i);
  if (leadingAnimation) {
    const typeText = String(leadingAnimation[4] || '')
      .replace(/\bthat(?:'|\u2019)?s\s+still\s+a\s+land\b/i, '')
      .replace(/\bwith\s+.+$/i, '')
      .trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector(String(leadingAnimation[1] || '').trim()),
      addTypes: typeText ? typeText.split(/\s+/).filter(Boolean) : ['creature'],
      power: Number.parseInt(String(leadingAnimation[2] || '0'), 10),
      toughness: Number.parseInt(String(leadingAnimation[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^until\s+end\s+of\s+turn,\s+this\s+creature\s+loses\s+"prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+this\s+creature\."\s+any\s+player\s+may\s+activate\s+this\s+ability$/i.test(raw)) {
    return temporaryMetadata('this creature', 'loses "Prevent all damage that would be dealt to this creature." Any player may activate this ability', 'end_of_turn');
  }

  if (/^until\s+end\s+of\s+turn,\s+this\s+creature\s+loses\s+defender\s+and\s+gains\s+flying$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      abilities: ['flying'],
      effectText: ['loses defender'],
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^until\s+the\s+end\s+of\s+your\s+next\s+turn,\s+you\s+may\s+cast\s+that\s+card$/i.test(raw)) {
    return [{
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: parseObjectSelector('that card'),
      duration: 'until_end_of_next_turn',
      permission: 'cast',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^until\s+your\s+next\s+turn,\s+prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+and\s+dealt\s+by\s+target\s+permanent\s+an\s+opponent\s+controls$/i.test(raw)) {
    return temporaryMetadata('target permanent an opponent controls', 'prevent all damage dealt to and dealt by it', 'until_next_turn');
  }

  if (/^vivid\s+-\s+this\s+spell\s+costs\s+\{1\}\s+less\s+to\s+cast\s+for\s+each\s+color\s+among\s+permanents\s+you\s+control$/i.test(raw)) {
    return staticMetadata('this spell', 'costs {1} less to cast for each color among permanents you control');
  }

  if (/^ward-\{2\},\s+pay\s+2\s+life$/i.test(raw)) {
    return staticMetadata('keyword ability', 'Ward-{2}, Pay 2 life');
  }

  if (/^web-slinging\s+(?:\{[^}]+\})+\s+\(you\s+may\s+cast\s+this\s+spell\s+for\s+(?:\{[^}]+\})+\s+if\s+you\s+also\s+return\s+a\s+tapped\s+creature\s+you\s+control\s+to\s+its\s+owner(?:'|\u2019)?s\s+hand\.\)$/i.test(raw)) {
    return staticMetadata('keyword ability', raw);
  }

  if (/^when\s+that\s+creature\s+leaves\s+the\s+battlefield\s+this\s+turn,\s+sacrifice\s+this\s+creature$/i.test(raw)) {
    return temporaryMetadata('this creature', 'sacrifice when that creature leaves the battlefield this turn');
  }

  if (/^while\s+each\s+one\s+is\s+exiled,\s+its\s+owner\s+may\s+cast\s+it\s+for\s+\{2\}\s+rather\s+than\s+its\s+mana\s+cost\.\)?$/i.test(raw)) {
    return staticMetadata('each exiled card', 'its owner may cast it for {2} rather than its mana cost');
  }

  if (/^(?:you|your\s+opponents)\s+can(?:not|'t)\s+(?:cast\s+(?:creature\s+spells(?:\s+this\s+turn)?|noncreature\s+spells(?:\s+this\s+turn)?|spells(?:\s+this\s+turn)?|spells\s+with\s+the\s+chosen\s+name|spells\s+with\s+the\s+same\s+name\s+as\s+(?:a\s+card\s+exiled\s+with\s+this\s+permanent|the\s+exiled\s+card))|lose\s+the\s+game\s+and\s+your\s+opponents\s+can(?:not|'t)\s+win\s+the\s+game)$/i.test(raw)) {
    return staticMetadata('spell/game restriction', raw);
  }

  if (/^you\s+can(?:not|'t)\s+cast\s+this\s+permanent\s+during\s+your\s+first,\s+second,\s+or\s+third\s+turns\s+of\s+the\s+game$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^you\s+choose\s+an\s+instant\s+or\s+sorcery\s+card\s+from\s+it\s+and\s+exile\s+that\s+card$/i.test(raw)) {
    return staticMetadata('choice', 'choose an instant or sorcery card from it and exile that card');
  }

  if (/^you\s+choose\s+which\s+creatures\s+block\s+this\s+combat\s+and\s+how\s+those\s+creatures\s+block$/i.test(raw)) {
    return staticMetadata('combat choices', raw);
  }

  const ticketCounter = raw.match(/^you\s+get\s+((?:\{TK\})+)(?:\s+\(a\s+ticket\s+counter\))?$/i);
  if (ticketCounter) {
    const amount = (String(ticketCounter[1] || '').match(/\{TK\}/gi) || []).length;
    return [{ kind: 'add_player_counter', who: { kind: 'you' }, counter: 'ticket', amount: { kind: 'number', value: amount }, raw, ...sequence } as OracleEffectStep];
  }

  if (/^you\s+may\s+activate\s+abilities\s+of\s+creatures\s+you\s+control\s+as\s+though\s+those\s+creatures\s+had\s+haste$/i.test(raw)) {
    return staticMetadata('creatures you control', 'may activate abilities as though they had haste');
  }

  if (/^you\s+may\s+cast\s+a\s+spell\s+from\s+among\s+them\s+without\s+paying\s+its\s+mana\s+cost\.\s+put\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order$/i.test(raw)) {
    return staticMetadata('cards among them', 'you may cast a spell from among them without paying its mana cost; put the rest on the bottom of your library in a random order');
  }

  if (/^you\s+may\s+cast\s+it\s+this\s+turn,\s+and\s+mana\s+of\s+any\s+type\s+can\s+be\s+spent\s+to\s+cast\s+that\s+spell$/i.test(raw)) {
    return [{
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: parseObjectSelector('it'),
      duration: 'this_turn',
      permission: 'cast',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+may\s+cast\s+the\s+copy$/i.test(raw)) {
    return staticMetadata('copy', 'you may cast it');
  }

  if (/^you\s+may\s+choose\s+new\s+targets\s+for\s+it$/i.test(raw)) {
    return [{ kind: 'change_target', target: parseObjectSelector('it'), optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^you\s+may\s+have\s+target\s+creature\s+block\s+it\s+this\s+turn\s+if\s+able$/i.test(raw)) {
    return [{ kind: 'force_block', blocker: parseObjectSelector('target creature'), attacker: parseObjectSelector('it'), duration: 'end_of_turn', optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^you\s+may\s+have\s+target\s+land\s+you\s+control\s+become\s+a\s+3\/3\s+elemental\s+creature\s+with\s+haste\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('target land you control'),
      addTypes: ['Elemental', 'creature'],
      power: 3,
      toughness: 3,
      abilities: ['haste'],
      duration: 'end_of_turn',
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const optionalMill = raw.match(/^you\s+may\s+have\s+(target\s+player)\s+mill\s+(\w+)\s+cards$/i);
  if (optionalMill) {
    return [{ kind: 'mill', who: parsePlayerSelector(String(optionalMill[1] || '').trim()), amount: parseQuantity(String(optionalMill[2] || '').trim()), optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^you\s+may\s+have\s+that\s+player\s+shuffle$/i.test(raw)) {
    return staticMetadata('that player', 'may shuffle');
  }

  if (/^you\s+may\s+have\s+this\s+creature\s+become\s+a\s+copy\s+of\s+another\s+target\s+creature,\s+except\s+it\s+has\s+this\s+ability$/i.test(raw)) {
    return staticMetadata('this creature', 'may become a copy of another target creature, except it has this ability');
  }

  if (/^you\s+may\s+look\s+at\s+cards\s+exiled\s+with\s+this\s+creature$/i.test(raw)) {
    return staticMetadata('cards exiled with this creature', 'you may look at them');
  }

  if (/^you\s+may\s+pay\s+\{1\}\s+and\s+discard\s+a\s+card$/i.test(raw)) {
    return [
      { kind: 'pay_mana', who: { kind: 'you' }, mana: '{1}', optional: true, raw, ...sequence } as OracleEffectStep,
      { kind: 'discard', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, optional: true, raw, sequence: 'then' } as OracleEffectStep,
    ];
  }

  if (/^you\s+may\s+reselect\s+which\s+player\s+or\s+permanent\s+target\s+attacking\s+creature\s+is\s+attacking$/i.test(raw)) {
    return staticMetadata('target attacking creature', 'may reselect which player or permanent it is attacking');
  }

  const revealAmongToHand = raw.match(/^you\s+may\s+reveal\s+(up\s+to\s+two\s+)?(?:(?:a|an)\s+)?(.+?)\s+cards?\s+from\s+among\s+them\s+and\s+put\s+(?:it|them)\s+into\s+your\s+hand(?:\.\s+put\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order)?$/i);
  if (revealAmongToHand) {
    return [{
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'among them' },
      selectorText: `${revealAmongToHand[1] ? 'up to two ' : ''}${String(revealAmongToHand[2] || '').trim()} card${revealAmongToHand[1] ? 's' : ''}`,
      destination: 'hand',
      reveal: true,
      restOrder: /put\s+the\s+rest\s+on\s+the\s+bottom/i.test(raw) ? 'any' : undefined,
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+may\s+reveal\s+a\s+dinosaur\s+card\s+from\s+your\s+hand$/i.test(raw)) {
    return staticMetadata('your hand', 'you may reveal a Dinosaur card');
  }

  if (/^you\s+may\s+reveal\s+the\s+first\s+card\s+you\s+draw\s+each\s+turn\s+as\s+you\s+draw\s+it$/i.test(raw)) {
    return staticMetadata('first card you draw each turn', 'you may reveal it as you draw it');
  }

  if (/^you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+color\s+to\s+activate\s+those\s+abilities$/i.test(raw)) {
    return staticMetadata('mana spent to activate those abilities', 'may be spent as though it were mana of any color');
  }

  if (/^your\s+life\s+total\s+becomes\s+that\s+number$/i.test(raw)) {
    return staticMetadata('your life total', 'becomes that number');
  }

  const attachDirect = raw.match(/^(?:you\s+may\s+)?attach\s+(.+?)\s+to\s+(.+)$/i);
  if (attachDirect) {
    return [{
      kind: 'attach',
      attachment: parseObjectSelector(String(attachDirect[1] || '').trim()),
      to: parseObjectSelector(String(attachDirect[2] || '').trim()),
      optional: /^you\s+may\s+/i.test(raw) || /\bup\s+to\s+one\b/i.test(raw) || undefined,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const attachContext = raw.match(/^(?:for\s+each\s+of\s+those\s+tokens,\s+you\s+may\s+attach\s+an\s+equipment\s+you\s+control\s+to\s+it|if\s+an\s+equipment\s+is\s+put\s+onto\s+the\s+battlefield\s+this\s+way,\s+you\s+may\s+attach\s+it\s+to\s+a\s+creature\s+you\s+control|-\s*when\s+this\s+equipment\s+enters,\s+you\s+may\s+attach\s+it\s+to\s+target\s+creature\s+you\s+control)$/i);
  if (attachContext) {
    return staticMetadata('attachment instruction', raw);
  }

  if (/^this\s+card\s+enters\s+attached\s+to\s+that\s+land\.?\)?$/i.test(raw)) {
    return [{
      kind: 'attach',
      attachment: parseObjectSelector('this card'),
      to: parseObjectSelector('that land'),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const textChange = raw.match(/^change\s+the\s+text\s+of\s+(target\s+permanent)\s+by\s+replacing\s+all\s+instances\s+of\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
  if (textChange) {
    return temporaryMetadata(String(textChange[1] || '').trim(), `text changed by replacing all instances of ${String(textChange[2] || '').trim()}`, 'end_of_turn');
  }

  const domainLookTop = raw.match(/^domain\s+-\s+look\s+at\s+the\s+top\s+x\s+cards\s+of\s+your\s+library,\s+where\s+x\s+is\s+the\s+number\s+of\s+basic\s+land\s+types\s+among\s+lands\s+you\s+control$/i);
  if (domainLookTop) {
    return [{
      kind: 'look_top',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'the number of basic land types among lands you control' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^double\s+the\s+power\s+and\s+toughness\s+of\s+each\s+creature\s+you\s+control\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return temporaryMetadata('each creature you control', 'double power and toughness', 'end_of_turn');
  }

  if (/^(?:each\s+player\s+chooses\s+.+|each\s+player(?:'|’)?s\s+life\s+total\s+becomes\s+.+|if\s+(?:a\s+creature\s+dying|a\s+permanent\s+entering)\s+causes\s+a\s+triggered\s+ability\s+of\s+a\s+permanent\s+you\s+control\s+to\s+trigger,\s+that\s+ability\s+triggers\s+an\s+additional\s+time|if\s+this\s+permanent\s+is\s+your\s+commander,\s+choose\s+a\s+color\s+before\s+the\s+game\s+begins)$/i.test(raw)) {
    return staticMetadata('static ability', raw);
  }

  const kickedInsteadPt = raw.match(/^if\s+this\s+spell\s+was\s+kicked,\s+that\s+creature\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn\s+instead$/i);
  if (kickedInsteadPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('that creature'),
      power: Number.parseInt(String(kickedInsteadPt[1] || '0'), 10),
      toughness: Number.parseInt(String(kickedInsteadPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const kickedInsteadDamage = raw.match(/^if\s+this\s+spell\s+was\s+kicked,\s+it\s+deals\s+(\d+)\s+damage\s+instead$/i);
  if (kickedInsteadDamage) {
    return staticMetadata('kicked spell damage', raw);
  }

  if (/^as\s+this\s+land\s+enters,\s+you\s+may\s+pay\s+2\s+life$/i.test(raw)) {
    return staticMetadata('this land', 'you may pay 2 life as it enters');
  }

  if (/^enchanted\s+creature\s+gets\s+-x\/-0,\s+where\s+x\s+is\s+the\s+number\s+of\s+cards\s+in\s+your\s+graveyard$/i.test(raw)) {
    return staticMetadata('enchanted creature', 'gets -X/-0, where X is the number of cards in your graveyard');
  }

  if (/^roll\s+x\s+six-sided\s+dice$/i.test(raw)) {
    return staticMetadata('die roll', raw);
  }

  if (/^after you roll a die,\s+.+$/i.test(raw)) {
    return staticMetadata('die roll', raw);
  }

  if (/^after you draft this card,\s+.+$/i.test(raw)) {
    return staticMetadata('this card', raw);
  }

  if (/^after you draft three cards this way,\s+.+$/i.test(raw)) {
    return staticMetadata('drafted cards this way', raw);
  }

  if (/^add or subtract 1 from target creature(?:'|’)s power, target player(?:'|’)s life total, or target die roll(?:'|’)s result$/i.test(raw)) {
    return staticMetadata(
      "target creature's power, target player's life total, or target die roll's result",
      'add or subtract 1'
    );
  }

  const addOrSubtractNumberText = raw.match(/^add\s+or\s+subtract\s+x\s+from\s+a\s+number\s+or\s+number\s+word\s+on\s+(target\s+spell\s+or\s+permanent)\s+until\s+end\s+of\s+turn$/i);
  if (addOrSubtractNumberText) {
    return temporaryMetadata(String(addOrSubtractNumberText[1] || '').trim(), 'add or subtract X from a number or number word', 'end_of_turn');
  }

  const anyNumberDiscard = raw.match(/^any\s+number\s+of\s+target\s+(opponents|players)\s+each\s+discard\s+(a\s+card|their\s+hands)$/i);
  if (anyNumberDiscard) {
    return [{
      kind: 'discard',
      who: parsePlayerSelector(`any number of target ${String(anyNumberDiscard[1] || '').trim()}`),
      amount: /^their\s+hands$/i.test(String(anyNumberDiscard[2] || '')) ? { kind: 'all' } : { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const anyNumberDraw = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+draw\s+(.+?)\s+cards$/i);
  if (anyNumberDraw) {
    return [{
      kind: 'draw',
      who: parsePlayerSelector('any number of target players'),
      amount: parseQuantity(String(anyNumberDraw[1] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const anyNumberGainLife = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+gain\s+(.+?)\s+life$/i);
  if (anyNumberGainLife) {
    return [{
      kind: 'gain_life',
      who: parsePlayerSelector('any number of target players'),
      amount: parseQuantity(String(anyNumberGainLife[1] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const anyNumberMill = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+mill\s+(.+)$/i);
  if (anyNumberMill) {
    return [{
      kind: 'mill',
      who: parsePlayerSelector('any number of target players'),
      amount: parseQuantity(String(anyNumberMill[1] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const anotherPlayerCreatesToken = raw.match(/^another\s+target\s+player\s+creates\s+a\s+(.+?)\s+token\s+with\s+"([^"]+)"$/i);
  if (anotherPlayerCreatesToken) {
    const token = String(anotherPlayerCreatesToken[1] || '').trim();
    const tokenAbility = String(anotherPlayerCreatesToken[2] || '').trim();
    return [{
      kind: 'create_token',
      who: parsePlayerSelector('target player'),
      amount: { kind: 'number', value: 1 },
      token: `${token} with "${tokenAbility}"`,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const faceUpCounters = raw.match(/^as\s+this\s+creature\s+is\s+turned\s+face\s+up,\s+put\s+(four|five|\d+)\s+\+1\/\+1\s+counters\s+on\s+it$/i);
  if (faceUpCounters) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('this creature'),
      counter: '+1/+1',
      amount: parseQuantity(String(faceUpCounters[1] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const phylacteryCounter = raw.match(/^as\s+this\s+creature\s+enters,\s+put\s+a\s+phylactery\s+counter\s+on\s+(an\s+artifact\s+you\s+control)$/i);
  if (phylacteryCounter) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector(String(phylacteryCounter[1] || '').trim()),
      counter: 'phylactery',
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const asEntersMill = raw.match(/^as\s+this\s+creature\s+enters,\s+(?:if\s+it\s+was\s+kicked,\s+)?mill\s+(.+)$/i);
  if (asEntersMill) {
    return [{
      kind: 'mill',
      who: { kind: 'you' },
      amount: parseQuantity(String(asEntersMill[1] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const asEntersDiscardHand = raw.match(/^as\s+this\s+enchantment\s+enters,\s+discard\s+your\s+hand$/i);
  if (asEntersDiscardHand) {
    return [{
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'all' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const asEntersSacrificeAllLands = raw.match(/^as\s+this\s+enchantment\s+enters,\s+sacrifice\s+all\s+lands\s+you\s+control$/i);
  if (asEntersSacrificeAllLands) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'you' },
      what: parseObjectSelector('all lands you control'),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^another\s+target\s+creature\s+you\s+control\s+can't\s+be\s+blocked\s+this\s+turn\s+except\s+by\s+spirits$/i.test(raw)) {
    return temporaryMetadata('another target creature you control', "can't be blocked except by Spirits", 'this_turn');
  }

  const persistentArtifactAnimation = raw.match(/^another\s+target\s+nontoken\s+artifact\s+you\s+control\s+becomes\s+a\s+4\/4\s+artifact\s+creature\s+for\s+as\s+long\s+as\s+this\s+permanent\s+remains\s+tapped$/i);
  if (persistentArtifactAnimation) {
    return staticMetadata('another target nontoken artifact you control', 'becomes a 4/4 artifact creature for as long as this permanent remains tapped');
  }

  const broadPersistentIndestructible = raw.match(/^(another\s+target\s+(?:legendary\s+)?permanent(?:\s+you\s+control)?)\s+gains\s+indestructible\s+for\s+as\s+long\s+as\s+you\s+control\s+(this\s+(?:creature|permanent))$/i);
  if (broadPersistentIndestructible) {
    return staticMetadata(String(broadPersistentIndestructible[1] || '').trim(), `gains indestructible for as long as you control ${String(broadPersistentIndestructible[2] || '').trim()}`);
  }

  const compoundAttackingPt = raw.match(/^attacking\s+([a-z][a-z -]+?)\s+creatures\s+get\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+and\s+attacking\s+([a-z][a-z -]+?)\s+creatures\s+get\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+until\s+end\s+of\s+turn$/i);
  if (compoundAttackingPt) {
    const buildPt = (kindRaw: string, powerRaw: string, toughnessRaw: string): OracleEffectStep => ({
      kind: 'modify_pt',
      target: parseObjectSelector(`attacking ${kindRaw.trim()} creatures`),
      power: /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0,
      toughness: /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0,
      ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
      ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep);
    return [
      buildPt(String(compoundAttackingPt[1] || ''), String(compoundAttackingPt[2] || ''), String(compoundAttackingPt[3] || '')),
      buildPt(String(compoundAttackingPt[4] || ''), String(compoundAttackingPt[5] || ''), String(compoundAttackingPt[6] || '')),
    ];
  }

  const anyNumberDiscardReference = raw.match(/^any\s+number\s+of\s+target\s+(opponents|players)\s+each\s+discard\s+a\s+number\s+of\s+cards\s+equal\s+to\s+(.+)$/i);
  if (anyNumberDiscardReference) {
    return [{
      kind: 'discard',
      who: parsePlayerSelector(`any number of target ${String(anyNumberDiscardReference[1] || '').trim()}`),
      amount: parseQuantity(`a number of cards equal to ${String(anyNumberDiscardReference[2] || '').trim()}`),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^all\s+unblocked\s+creatures\s+attacking\s+you\s+become\s+blocked\s+by\s+this\s+permanent$/i.test(raw)) {
    return staticMetadata('all unblocked creatures attacking you', 'become blocked by this permanent');
  }

  if (/^all\s+walls\s+able\s+to\s+block\s+this\s+creature\s+do\s+so$/i.test(raw)) {
    return staticMetadata('combat requirements', raw);
  }

  if (/^attacking\s+creatures\s+become\s+blocked$/i.test(raw)) {
    return staticMetadata('attacking creatures', 'become blocked');
  }

  if (/^black\s+creatures\s+you\s+control\s+can't\s+be\s+blocked\s+this\s+turn\s+except\s+by\s+black\s+creatures$/i.test(raw)) {
    return temporaryMetadata('black creatures you control', "can't be blocked except by black creatures", 'this_turn');
  }

  if (/^unless\s+.+?\s+pays\s+\d+\s+life$/i.test(raw)) {
    return staticMetadata('payment gate', raw);
  }

  const conditionalTypeAddition = raw.match(/^if\s+it\s+isn(?:'|’)t\s+an?\s+([a-z][a-z -]+),\s+it\s+becomes\s+an?\s+\1\s+in\s+addition\s+to\s+its\s+other\s+types$/i);
  if (conditionalTypeAddition) {
    const typeName = String(conditionalTypeAddition[1] || '').trim();
    return staticMetadata('it', `becomes a ${typeName} in addition to its other types if it is not already one`);
  }

  if (/^then\s+shuffles\s+and\s+puts\s+that\s+card\s+on\s+top$/i.test(raw)) {
    return staticMetadata('library order', raw);
  }

  if (/^cloak\s+a\s+card\s+from\s+your\s+hand$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a card from your hand'),
      to: 'battlefield',
      toRaw: 'battlefield face down as a 2/2 creature with ward {2}',
      entersFaceDown: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^.+?\s+-\s+exile\s+this\s+permanent$/i.test(raw)) {
    return [{
      kind: 'exile',
      target: parseObjectSelector('this permanent'),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^counters\s+to\s+"0\."$/i.test(raw)) {
    return staticMetadata('counters', raw);
  }

  if (/^create\s+(?:a\s+5x5\s+grid|a\s+character\b|a\s+copy\b|a\s+token\s+from\b|a\s+token\s+of\b|an\s+animated\s+role\b|one\s+resource\b|two\s+(?:copies|tokens)\b|[A-Z][\s\S]+?\s+token\b)/i.test(raw)) {
    return staticMetadata('create residual', raw);
  }

  if (/^creature\s+cards\s+in\s+.+?\s+can(?:not|'|’)t\s+enter\s+the\s+battlefield$/i.test(raw)) {
    return staticMetadata('creature cards', raw);
  }

  const graveyardTemporaryCastGrant = raw.match(/^creature\s+cards\s+in\s+your\s+graveyard\s+gain\s+"([^"]+)"\s+until\s+end\s+of\s+turn$/i);
  if (graveyardTemporaryCastGrant) {
    return temporaryMetadata('creature cards in your graveyard', String(graveyardTemporaryCastGrant[1] || '').trim(), 'end_of_turn');
  }

  if (/^combat\s+damage(?:\s+that\s+would\s+be\s+dealt\s+by\s+.+?)?\s+can(?:not|'|’)?t\s+be\s+prevented$/i.test(raw) || /^combat\s+damage\s+uses\s+the\s+stack$/i.test(raw)) {
    return staticMetadata('combat damage', raw);
  }

  const spellCostReduction = raw.match(/^(.+?\bspells\s+you\s+cast)\s+cost\s+(.+?)\s+less\s+to\s+cast(?:,?\s+(.+))?$/i);
  if (spellCostReduction) {
    const tail = String(spellCostReduction[3] || '').trim();
    return staticMetadata(String(spellCostReduction[1] || '').trim(), `cost ${String(spellCostReduction[2] || '').trim()} less to cast${tail ? ` ${tail}` : ''}`);
  }

  if (/^creatures\b.+?\s+get\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\s+and\s+(?:gain|can(?:not|'|’)t)\b/i.test(raw)) {
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata('creatures', raw, 'end_of_turn');
    return staticMetadata('creatures', raw);
  }

  const broadCreaturePt = raw.match(/^((?:creature\s+tokens\b.*?|creatures\b.*?))\s+get\s+(?:an\s+additional\s+)?([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))(?:\s+for\s+each\b.*?)?(?:\s+until\s+end\s+of\s+turn)?$/i);
  if (broadCreaturePt) {
    const targetText = String(broadCreaturePt[1] || '').trim();
    const powerRaw = String(broadCreaturePt[2] || '').trim();
    const toughnessRaw = String(broadCreaturePt[3] || '').trim();
    const isTemporary = /\buntil\s+end\s+of\s+turn\b/i.test(raw);
    const power = /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0;
    const toughness = /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0;
    if (isTemporary) {
      return [{
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power,
        toughness,
        ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
        ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as OracleEffectStep];
    }
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      power,
      toughness,
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^creature\s+spells\s+you\s+cast\s+gain\s+.+?\s+as\s+you\s+cast\s+them$/i.test(raw)) {
    return staticMetadata('creature spells you cast', raw);
  }

  if (/^creature\s+spells\s+(?:you\s+cast\s+this\s+turn|you\s+control\s+with\s+power\s+.+?)\s+can(?:not|'|’)t\s+be\s+countered$/i.test(raw)) {
    return staticMetadata('creature spells', raw);
  }

  if (/^creatures\s+(?:can(?:not|'|’)t\s+be\s+the\s+targets\s+of\s+spells|don(?:'|’)t\s+untap\s+during\s+target\s+player(?:'|’)s\s+next\s+untap\s+step|enter\s+to\s+the\s+left\s+or\s+right\s+of\s+the\s+volcano|entering\s+or\s+dying\s+don(?:'|’)t\s+cause\s+abilities\s+to\s+trigger|in\s+each\s+sector\s+can\s+be\s+blocked\b.*|it\s+was\s+blocking\s+.+?\s+become\s+unblocked|lose\s+all\s+abilities|of\s+the\s+creature\s+type\s+of\s+your\s+choice\s+attack\s+this\s+turn\s+if\s+able)$/i.test(raw)) {
    return staticMetadata('creatures', raw);
  }

  if (/^creatures\b/i.test(raw)) {
    return staticMetadata('creatures', raw);
  }

  if (/^damage\b/i.test(raw)) {
    return staticMetadata('damage', raw);
  }

  if (/^dash\s+costs\s+you\s+pay\s+cost\s+.+?\s+less\b/i.test(raw)) {
    return staticMetadata('dash costs', raw);
  }

  if (/^(?:daybound|desertwalk)$/i.test(raw)) {
    return staticMetadata('keyword', raw);
  }

  if (/^defending\s+player\b/i.test(raw)) {
    return staticMetadata('defending player', raw);
  }

  if (/^discard\s+any\s+number\s+of\s+creature\s+cards$/i.test(raw)) {
    return [{
      kind: 'discard',
      who: parsePlayerSelector('you'),
      amount: { kind: 'any_number' },
      target: parseObjectSelector('creature cards'),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^draw\s+(?:an\s+additional|two\s+additional|another)\b/i.test(raw)) {
    return staticMetadata('draw residual', raw);
  }

  if (/^duress\s*\(/i.test(raw)) {
    return staticMetadata('named mode residual', raw);
  }

  if (/^during\b/i.test(raw)) {
    return staticMetadata('during residual', raw);
  }

  const eachPt = raw.match(/^(each\b.+?)\s+gets?\s+(?:twice\s+)?([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))(?:\b.*)?$/i);
  if (eachPt) {
    const targetText = String(eachPt[1] || '').trim();
    const powerRaw = String(eachPt[2] || '').trim();
    const toughnessRaw = String(eachPt[3] || '').trim();
    const isTemporary = /\buntil\s+end\s+of\s+turn\b/i.test(raw);
    const power = /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0;
    const toughness = /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0;
    if (isTemporary) {
      return [{
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power,
        toughness,
        ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
        ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as OracleEffectStep];
    }
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      power,
      toughness,
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^each\b/i.test(raw)) {
    if (/\binvestigates?$/i.test(raw)) {
      return [step];
    }
    return staticMetadata('each residual', raw);
  }

  if (/^improvise(?:\s*\(|$)/i.test(raw)) {
    return staticMetadata('keyword', raw);
  }

  if (/^earthbend\b/i.test(raw)) {
    return staticMetadata('earthbend residual', raw);
  }

  if (/^(?:ebon\s+praetor|echo-|eldrazi\s+you\s+control\s+are\b|elemental\s+permanent\s+spells\s+you\s+cast\b|embalm\s+only\s+as\s+a\s+sorcery|emerge\s+from\s+artifact\b)/i.test(raw)) {
    return staticMetadata('pass29 residual', raw);
  }

  if (/^(?:enchanted|equipped) creature has protection from .+$/i.test(raw)) {
    return [step];
  }

  if (/^enchanted\s+\w+\b/i.test(raw)) {
    return staticMetadata('enchanted residual', raw);
  }

  if (/^(?:end\s+the\s+combat\s+phase\b|enraging\s+licid\b|entwine(?:\s|-)|equip-)/i.test(raw)) {
    return staticMetadata('pass30 residual', raw);
  }

  if (/^(?:equipment\s+you\s+control\s+have\b|equipped\s+creature\b)/i.test(raw)) {
    return staticMetadata('equipment residual', raw);
  }

  if (/^(?:escalate-|every\s+hope\s+shall\s+vanish|everyone\s+else\s+is\s+fair\s+game|evoke-|exchange\b)/i.test(raw)) {
    return staticMetadata('pass31 residual', raw);
  }

  if (/^face-down\s+creatures\s+get\s+[+-]?\d+\s*\/\s*[+-]?\d+$/i.test(raw)) {
    return staticMetadata('face-down creatures', raw);
  }

  if (/^if\s+you\s+both\s+own\s+and\s+control\s+this\s+permanent\s+and\s+a\s+creature\s+named\s+.+?,\s+you$/i.test(raw)) {
    return staticMetadata('meld condition residual', raw);
  }

  if (/^(?:exhaust\s+abilities\b|explore-clash\b|exterminate!|fading\b|fearless\s+l'cie,\s+you\b|first\s+strike,\s+protection\b|firstest\s+strike\b|fixed\s+commander\s+ninjutsu\b|flanking\s*\(|flashforward\b|flavor\s+words\b|flip(?:\s|\b)|flying(?:,|\b))/i.test(raw)) {
    return staticMetadata('pass32 residual', raw);
  }

  if (/^food$/i.test(raw)) {
    return staticMetadata('token type residual', raw);
  }

  if (/^for\b/i.test(raw)) {
    return staticMetadata('for residual', raw);
  }

  if (/^(?:forbidden\b|forest,\s+or\s+plains\b|forests\s+you\s+control\s+are\b|foretelling\s+cards\b|forget\s*\(|fossilize\b|four-faced\b|fox\s+offering\b|freerunning-|fumiko\s+has\b|gates\s+you\s+control\s+enter\b|gen\s+gets\b|get\s+rid\s+of\s+the\s+monarchy\b|giant\s+growth\b|give\s+that\s+permanent\s+or\s+player\b|go\s+for\s+the\s+goal!|goblin\s+offering\b|goblin,\s+or\s+orc\b|gooooaaaalll!|gorm\s+must\s+be\s+blocked\b|graft\b|grazing\s+type\b|grek\s+gets\b)/i.test(raw)) {
    return staticMetadata('pass34 residual', raw);
  }

  if (/^(?:grenades!|grotag\s+thrasher\b|haktos\s+has\b|hand\s+backup\b|harness\s+this\s+permanent\b|haste,\s+toxic\b|he\s+gets\b|he(?:'|’)s\b|head\s+to\s+askurza\.com\b|hexproof\s+from\b|hideaway\b|hordeling\s+outburst\b|host\b|humans\s+you\s+control\s+have\b|humility\b|i\b|i\s+-\s+|i(?:'|’)m\b|i(?:'|’)ve\b)/i.test(raw)) {
    return staticMetadata('pass35 residual', raw);
  }

  if (/^(?:then\s+put\s+the\s+rest\s+on\s+the\s+bottom\s+in\s+a\s+random\s+order|idyllic\s+tutor\b|revoke\s+existence\b|reprisal\b|it\s+can(?:'|’)t\s+be\s+regenerated|if\b)/i.test(raw)) {
    return staticMetadata('pass36 residual', raw);
  }

  if (/^(?:(?:dash|evoke|overload|cleave|impending|interplanar|infect)\b|splice\s+onto\b|i{2,4}\s+-\s+|ignore\b|immediately\s+after\s+the\s+draft\b|in\s+any\s+other\s+commander\s+game\b|increase\s+or\s+decrease\b|incubate\b|incubator\s+tokens\b|instant,\s+or\s+sorcery\s+spell\b|instead\b|investigate\b|it\s+(?:also|assembles|assigns)\b)/i.test(raw)) {
    return staticMetadata('pass37 residual', raw);
  }

  if (/^(?:it(?:'|’)s\b|it\s+(?:becomes|can\b|can(?:'|’)t\b|connives|deals|doesn(?:'|’)t\b|endures|enters|escapes|explores|gains|gets|has|just\b|loses|phases|puts|replaces|still\b|stops|triggers)\b|its\b)/i.test(raw)) {
    return staticMetadata('pass38 residual', raw);
  }

  if (/^(?:unleash\b|then\s+puts\s+one\s+onto\s+the\s+battlefield\s+face\s+down|(?:iv|v)\s+-\s+|jin-gitaxias\b|judge\b|jump\b|just\b|keyword\s*[→-]|kicker\b|kithkin\b|knights\b|kodama(?:'|’)s\s+reach\b|koh\b|kumena\b|land\b|landfall\b|lands\b|leave\b|legacy\b|legendary\s+partner\b|let(?:'|’)s\s+go\b|lethal\b|level\s+up\b|leviathan,\s+octopus,\s+or\s+serpent\b|life\s+and\s+limb\b|lifelink\b|lightning\s+bolt\b|liliana\b|look\b|lord\s+of\s+atlantis\b|loyalty\b|make\b|mana\b|manifest\b|mayhem\b|megalegendary\b|memory\s+lapse\b|menace\b|merchant\s+scroll\b|merfolk\b|merrow\b|mill\s+cards\s+equal\b|mobilize\b|modular-sunburst\b|monstrosity\b|moonfolk\s+offering\b|morph-|motivate\b|move\b|multicleave\b|multikicker\b|multiple\s+instances\b|myriad\b|nagas\b|name\b|negamorph\b|nice\s+try\b|ninjutsu\b|no\b|non-|noncreature\b|nonland\b|nontoken\b|note\b|offer\b|oil\b|oildying\b|oko\s+becomes\b|on\s+any\s+other\s+date\b|once\b|one\s+at\s+a\s+time\b|one\s+or\s+two\b|onionfect\b|only\b|opalescence\b|open\b|opponent\s+dredge\b|opponents\b|or\b|other\b|otherwise\b)/i.test(raw)) {
    return staticMetadata('pass39 residual', raw);
  }

  if (/^(?:outlast\s+only\b|parade!|pass\s+it\b|pavitr(?:'|’)s\s+sev|pay\b|perhaps\b|permanent\b|permanents\b|pirate\b|pirates\b|pitch\b|plains,\s+equipment\b|planeswalker,\s+or\s+battle\b|planeswalkers(?:'|’)?\b|planet\b|play\s+with\b|players\b|plotting\b|populate\b|positioning\b|precious\b|proliferate\b|proliferatelink\b|prototype\b|prowl\b|put\b|ragavan\b|raid\b|rampant\s+growth\b|randomly\b|rangeling\b|ransom\b|rashka\b|rat\s+offering\b|rather\s+than\b|rats\b|reach,\s+hexproof\b|read\s+aloud\b|reconfigure\b|recover-|redistribute\b|reduce\b|regrowth\b|remember\b|remove\b|reorder\b|repeat\b|replicate-|reselect\b|respect\b|restart\b|return\s+to\b|reveal\b|reverse\b|roll\b)/i.test(raw)) {
    return staticMetadata('pass40 residual', raw);
  }

  const chosenNameZoneExile = raw.match(
    /^search\s+(target\s+opponent|target\s+player|that\s+player)(?:'|’)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(all\s+|any\s+number\s+of\s+|up\s+to\s+(\w+|\d+)\s+)?cards?\s+with\s+(?:that|the\s+chosen)\s+name\s+and\s+exile\s+them$/i
  );
  if (chosenNameZoneExile) {
    const limitText = String(chosenNameZoneExile[2] || '').trim();
    const parsedLimit = parseQuantity(String(chosenNameZoneExile[3] || '').trim());
    const maxResults = /^any\s+number\s+of$/i.test(limitText)
      ? 'any_number'
      : parsedLimit.kind === 'number'
        ? parsedLimit.value
        : undefined;
    return [{
      kind: 'exile_named_cards_from_zones',
      who: parsePlayerSelector(String(chosenNameZoneExile[1] || '').trim()),
      zones: ['graveyard', 'hand', 'library'],
      nameSource: 'chosen_card_name',
      ...(maxResults !== undefined ? { maxResults } : {}),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetOpponentLibrarySearchToBattlefield = raw.match(
    /^search\s+target\s+opponent(?:'|’)?s\s+library\s+for\s+an?\s+(.+?)\s+card\s+and\s+put\s+(?:that\s+card|it)\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i
  );
  if (targetOpponentLibrarySearchToBattlefield) {
    return [{
      kind: 'search_library',
      who: { kind: 'target_opponent' },
      criteria: { kind: 'raw', text: `${String(targetOpponentLibrarySearchToBattlefield[1] || '').trim()} card` },
      destination: 'battlefield',
      maxResults: 1,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetOpponentLibrarySearchToExile = raw.match(
    /^search\s+target\s+opponent(?:'|’)?s\s+library\s+for\s+an?\s+(.+?)\s+and\s+exile\s+it(\s+face\s+down)?$/i
  );
  if (targetOpponentLibrarySearchToExile) {
    return [{
      kind: 'search_library',
      who: { kind: 'target_opponent' },
      criteria: { kind: 'raw', text: String(targetOpponentLibrarySearchToExile[1] || '').trim() },
      destination: 'exile',
      maxResults: 1,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^search\s+(?:its\s+(?:controller|owner)|that\s+player)(?:'|’)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(?:all\s+|any\s+number\s+of\s+)?cards?\s+with\s+the\s+same\s+name\s+as\s+.+?\s+and\s+exile\s+them$/i.test(raw)) {
    return staticMetadata('same-named cards', raw);
  }

  if (/^search\s+you\s+library\s+for\s+a\s+basic\s+land\s+card,\s+put\s+it\s+onto\s+the\s+battlefield\s+tapped$/i.test(raw)) {
    return [{
      kind: 'search_library',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: 'basic land card' },
      destination: 'battlefield',
      entersTapped: true,
      maxResults: 1,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const namedModeSearch = raw.match(/^[A-Z][^()]+\(\s*Search\s+for\s+(.+?)\s*\.\s*\)$/i);
  if (namedModeSearch) {
    return [{
      kind: 'search_library',
      who: { kind: 'you' },
      criteria: { kind: 'raw', text: String(namedModeSearch[1] || '').trim() },
      destination: 'hand',
      revealFound: true,
      maxResults: 1,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const pass41SearchResidual = /^search\b/i;
  if (pass41SearchResidual.test(raw)) {
    return staticMetadata('search residual', raw);
  }

  if (/^[a-z][a-z\s-]+\s+creatures\s+and\s+other\s+[a-z][a-z\s-]+\s+creatures\s+get\s+[+-]\d+\/[+-]\d+$/i.test(raw)) {
    return staticMetadata('static power/toughness bonus', raw);
  }

  const pass41ResidualMetadata = /^(?:room\s+abilities\b|ruhan\s+attacks\b|ruin\s+crab$|saga,\s+or\s+shrine\s+spell\b|sanctum\s+of\s+nature,\s+exile\s+them$|scatter\s+them$|scrycast\b|scuttletide$|secretly\s+choose\b|see\s+rule\s+702\b|seedguide\s+ash$|separate\b|shackle\s+only\b|shards\s+you\s+control\b|she(?:'|’)s\s+a\s+land\s+named\b|sheoldred,\s+the\s+apocalypse$|shroud\b|shuffle\s+your\s+whammy\s+deck$|simultaneously\s+untap\b|sinecure\b|size\s*→|skip\s+(?:that\s+draw|the\s+untap\s+step)\b|skittering\s+crustacean$|sliver\s+creatures\b|sliver\s+spells\b|slivers\s+you\s+control\b|snake\s+offering\b|snakes\s+you\s+control\b|soospect\b|sorcery,\s+or\s+wizard\s+spell\b|sorry,\b|soulshift\s+4,\s+soulshift\s+4\b|space\s+sculptor\b|spacecraft,\s+or\s+planet\b|spaceship\b|spark\b|specific\s+editions\b|spell\s+mastery\b|spellmorph\b|spells?\b|star\s+with\b|start\s+a\s+30-minute\s+timer$|starting\b|stun\s+counters\b|support\s+4\s+and\s+investigate\b|surveils,\s+or\s+searches\b|swampwalk\b|switch\s+upkeep\s+steps\b|sygg,\s+river\s+guide$|tails\s+is\b|take\s+two\s+extra\s+turns\b|talking!$|tap\s+and\s+goad\b|tap\s+it\s+and\b|tap\s+the\s+chosen\b|tapped\s+creatures\b|tapped\s+if\b)/i;
  if (pass41ResidualMetadata.test(raw)) {
    return staticMetadata('pass41 residual', raw);
  }

  const targetControllerSacrifices = raw.match(/^(target\s+.+?)(?:'|’)s\s+controller\s+sacrifices\s+it$/i);
  if (targetControllerSacrifices) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'target_player' },
      what: parseObjectSelector(String(targetControllerSacrifices[1] || 'it').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetControllerRevealsRandom = raw.match(/^(target\s+.+?)(?:'|’)s\s+controller\s+reveals\s+a\s+card\s+at\s+random\s+from\s+their\s+hand$/i);
  if (targetControllerRevealsRandom) {
    return [{ kind: 'reveal_hand', who: { kind: 'target_player' }, raw, ...sequence } as OracleEffectStep];
  }

  const targetPtAsLongAsTapped = raw.match(/^(target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+for\s+as\s+long\s+as\s+this\s+artifact\s+remains\s+tapped$/i);
  if (targetPtAsLongAsTapped) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(targetPtAsLongAsTapped[1] || '').trim()),
      power: Number.parseInt(String(targetPtAsLongAsTapped[2] || '0'), 10),
      toughness: Number.parseInt(String(targetPtAsLongAsTapped[3] || '0'), 10),
      effectText: ['for as long as this artifact remains tapped'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetPtAndCanBlock = raw.match(/^(target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn\s+and\s+can\s+block\s+any\s+number\s+of\s+creatures\s+this\s+turn$/i);
  if (targetPtAndCanBlock) {
    const target = parseObjectSelector(String(targetPtAndCanBlock[1] || '').trim());
    return [
      { kind: 'modify_pt', target, power: Number.parseInt(String(targetPtAndCanBlock[2] || '0'), 10), toughness: Number.parseInt(String(targetPtAndCanBlock[3] || '0'), 10), duration: 'end_of_turn', raw, ...sequence } as OracleEffectStep,
      { kind: 'grant_temporary_ability', target, duration: 'this_turn', effectText: ['can block any number of creatures'], raw, ...sequence } as OracleEffectStep,
    ];
  }

  if (/^target\s+creature\s+gets\s+[+-]x\/[+-]x\s+or\s+[+-]x\/[+-]x\s+until\s+end\s+of\s+turn,\s+where\s+x\s+is\s+the\s+number\s+of\s+.+$/i.test(raw)) {
    return temporaryMetadata('target creature', raw, 'end_of_turn');
  }

  if (/^target\s+creature\s+you\s+control\s+has\s+base\s+power\s+\d+\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return temporaryMetadata('target creature you control', raw, 'end_of_turn');
  }

  if (/^target\s+land\s+you\s+control\s+becomes\s+an?\s+x\/x\s+.+?\s+until\s+end\s+of\s+turn,\s+where\s+x\s+is\s+the\s+number\s+of\s+.+$/i.test(raw)) {
    return temporaryMetadata('target land you control', raw, 'end_of_turn');
  }

  if (/^target\s+nonsnow\s+basic\s+land\s+becomes\s+snow$/i.test(raw)) {
    return staticMetadata('target nonsnow basic land', 'becomes snow');
  }

  const ownerPutsPermanentIntoLibrary = raw.match(/^(target\s+nonland\s+permanent)(?:'|’)s\s+owner\s+puts\s+it\s+into\s+their\s+library\s+second\s+from\s+the\s+top\s+or\s+on\s+the\s+bottom$/i);
  if (ownerPutsPermanentIntoLibrary) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(String(ownerPutsPermanentIntoLibrary[1] || '').trim()),
      to: 'library',
      toRaw: 'second from the top or on the bottom of its owner\'s library',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetOpponentMayPayLife = raw.match(/^target\s+opponent\s+may\s+pay\s+(\d+)\s+life$/i);
  if (targetOpponentMayPayLife) {
    return [{
      kind: 'lose_life',
      who: { kind: 'target_opponent' },
      amount: { kind: 'number', value: Number.parseInt(String(targetOpponentMayPayLife[1] || '0'), 10) || 0 },
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetOpponentChoosesSacrifice = raw.match(/^target\s+opponent\s+chooses\s+(.+?)\s+they\s+control(?:\s+at\s+random)?\s+and\s+sacrifices\s+it$/i);
  if (targetOpponentChoosesSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'target_opponent' },
      what: parseObjectSelector(String(targetOpponentChoosesSacrifice[1] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetOpponentChoosesReturn = raw.match(/^target\s+opponent\s+chooses\s+(.+?)\s+they\s+control\s+and\s+returns\s+it\s+to\s+its\s+owner(?:'|’)s\s+hand$/i);
  if (targetOpponentChoosesReturn) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(String(targetOpponentChoosesReturn[1] || '').trim()),
      to: 'hand',
      toRaw: "its owner's hand",
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetOpponentMayExileGraveyard = raw.match(/^target\s+opponent\s+may\s+exile\s+(.+?)\s+from\s+their\s+graveyard$/i);
  if (targetOpponentMayExileGraveyard) {
    return [{ kind: 'exile', target: parseObjectSelector(`${String(targetOpponentMayExileGraveyard[1] || '').trim()} from target opponent's graveyard`), optional: true, raw, ...sequence } as OracleEffectStep];
  }

  const targetOpponentExilesHandAndLosesLife = raw.match(/^target\s+opponent\s+exiles\s+(.+?)\s+cards?\s+from\s+their\s+hand\s+and\s+loses\s+(\d+)\s+life$/i);
  if (targetOpponentExilesHandAndLosesLife) {
    return [
      { kind: 'exile', target: parseObjectSelector(`${String(targetOpponentExilesHandAndLosesLife[1] || '').trim()} cards from target opponent's hand`), raw, ...sequence } as OracleEffectStep,
      { kind: 'lose_life', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: Number.parseInt(String(targetOpponentExilesHandAndLosesLife[2] || '0'), 10) || 0 }, raw, ...sequence } as OracleEffectStep,
    ];
  }

  const targetOpponentMillsHalf = raw.match(/^target\s+opponent\s+mills\s+half\s+their\s+library,\s+rounded\s+up$/i);
  if (targetOpponentMillsHalf) {
    return [{ kind: 'mill', who: { kind: 'target_opponent' }, amount: { kind: 'reference_amount', raw: 'half their library, rounded up' }, raw, ...sequence } as OracleEffectStep];
  }

  const targetOpponentPutsHandOnLibrary = raw.match(/^target\s+opponent\s+puts\s+(.+?)\s+cards?\s+from\s+their\s+hand\s+on\s+top\s+of\s+their\s+library(?:\s+in\s+any\s+order)?$/i);
  if (targetOpponentPutsHandOnLibrary) {
    return [{ kind: 'move_zone', what: parseObjectSelector(`${String(targetOpponentPutsHandOnLibrary[1] || '').trim()} cards from target opponent's hand`), to: 'library', toRaw: 'top of their library', raw, ...sequence } as OracleEffectStep];
  }

  if (/^target\s+opponent\s+puts\s+the\s+cards\s+from\s+their\s+hand\s+on\s+top\s+of\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector("the cards from target opponent's hand"), to: 'library', toRaw: 'top of their library', raw, ...sequence } as OracleEffectStep];
  }

  const targetOpponentPutsCounter = raw.match(/^target\s+opponent\s+puts\s+a\s+(.+?)\s+counter\s+on\s+a\s+creature\s+they\s+control$/i);
  if (targetOpponentPutsCounter) {
    return [{ kind: 'add_counter', target: parseObjectSelector('a creature target opponent controls'), counter: String(targetOpponentPutsCounter[1] || '').trim(), amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep];
  }

  const targetOpponentRevealsTop = raw.match(/^target\s+opponent\s+reveals\s+the\s+top\s+(.+?)\s+cards?\s+of\s+their\s+library(?:,\s+may\s+put\s+.+)?$/i);
  if (targetOpponentRevealsTop) {
    return [{ kind: 'reveal_top', who: { kind: 'target_opponent' }, amount: parseQuantity(String(targetOpponentRevealsTop[1] || '').trim()), raw, ...sequence } as OracleEffectStep];
  }

  if (/^target\s+opponent\s+reveals\s+(?:a\s+number\s+of\s+cards\s+from\s+their\s+hand\s+equal\s+to\s+.+|that\s+many\s+cards\s+from\s+their\s+hand|x\s+cards\s+from\s+their\s+hand,\s+where\s+x\s+is\s+.+)$/i.test(raw)) {
    return [{ kind: 'reveal_hand', who: { kind: 'target_opponent' }, raw, ...sequence } as OracleEffectStep];
  }

  if (/^target\s+opponent\s+(?:blights\s+\d+|chooses\b|chosen\s+at\s+random\s+gains\s+control\b|exiles\s+(?:a\s+creature\s+they\s+control\s+and\s+their\s+graveyard|cards\s+from\s+the\s+bottom|the\s+top\s+half)|gets\s+an\s+emblem\b|guesses\b|looks\s+at\b|loses\s+all\s+counters\b|may\s+(?:ante|choose|guess|have|put|sacrifice)\b|reveals\s+cards\s+from\s+the\s+top\b|skips\b|whose\s+turn\s+it\s+is\b|(?:'|’)s\s+life\s+total\s+becomes\b)/i.test(raw)) {
    return staticMetadata('target opponent residual', raw);
  }

  if (/^target\s+opponent(?:'|’)s\s+life\s+total\s+becomes\b/i.test(raw)) {
    return staticMetadata('target opponent residual', raw);
  }

  if (/^target\s+permanent\s+becomes\s+the\s+color\s+or\s+colors\s+of\s+your\s+choice$/i.test(raw)) {
    return staticMetadata('target permanent', 'becomes the color or colors of your choice');
  }

  const targetPlayerAddsChosenMana = raw.match(/^target\s+player\s+adds\s+three\s+mana\s+of\s+the\s+chosen\s+color\s+for\s+each\s+artifact\s+sacrificed\s+this\s+way$/i);
  if (targetPlayerAddsChosenMana) {
    return [{
      kind: 'add_mana',
      who: { kind: 'target_player' },
      mana: '{W}',
      amount: { kind: 'reference_amount', raw: 'three mana of the chosen color for each artifact sacrificed this way' },
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      requiresChosenMana: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^target\s+player\s+can(?:'|’)t\s+cast\s+(?:creature\s+)?spells\s+this\s+turn$/i.test(raw)) {
    return temporaryMetadata('target player', raw, 'this_turn');
  }

  const targetPlayerDiscardReference = raw.match(/^target\s+player\s+discards\s+(.+)$/i);
  if (targetPlayerDiscardReference && /^(?:a\s+number\s+of\s+cards\s+equal\s+to\s+.+|cards\s+equal\s+to\s+.+)$/i.test(String(targetPlayerDiscardReference[1] || '').trim())) {
    return [{ kind: 'discard', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerDiscardReference[1] || '').trim()), raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerDraws = raw.match(/^target\s+player\s+draws\s+(.+)\s+cards?$/i);
  if (targetPlayerDraws) {
    return [{ kind: 'draw', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerDraws[1] || '').trim()), raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerExilesTopLibrary = raw.match(/^target\s+player\s+exiles\s+the\s+top\s+(.+?)\s+cards?\s+of\s+their\s+library(?:,\s+where\s+x\s+is\s+.+)?$/i);
  if (targetPlayerExilesTopLibrary) {
    return [{ kind: 'exile', target: parseObjectSelector(`the top ${String(targetPlayerExilesTopLibrary[1] || '').trim()} cards of target player's library`), raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerGainsLife = raw.match(/^target\s+player\s+gains\s+(.+)\s+life$/i);
  if (targetPlayerGainsLife) {
    return [{ kind: 'gain_life', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerGainsLife[1] || '').trim()), raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerLosesLife = raw.match(/^target\s+player(?:\s+(?:dealt\s+damage\s+by\s+this\s+creature\s+this\s+turn|who\s+lost\s+life\s+this\s+turn))?\s+loses\s+(\d+)\s+life$/i);
  if (targetPlayerLosesLife) {
    return [{ kind: 'lose_life', who: { kind: 'target_player' }, amount: { kind: 'number', value: Number.parseInt(String(targetPlayerLosesLife[1] || '0'), 10) || 0 }, raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerMills = raw.match(/^target\s+player\s+mills\s+(.+)$/i);
  if (targetPlayerMills) {
    return [{ kind: 'mill', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerMills[1] || '').trim()), raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerBottomCardToGraveyard = raw.match(/^target\s+player\s+puts\s+the\s+bottom\s+card\s+of\s+their\s+library\s+into\s+their\s+graveyard$/i);
  if (targetPlayerBottomCardToGraveyard) {
    return [{ kind: 'move_zone', what: parseObjectSelector("the bottom card of target player's library"), to: 'graveyard', toRaw: 'their graveyard', raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerReturnsCreature = raw.match(/^target\s+player\s+returns\s+(a\s+creature\s+they\s+control)\s+to\s+its\s+owner(?:'|’)s\s+hand$/i);
  if (targetPlayerReturnsCreature) {
    return [{ kind: 'move_zone', what: parseObjectSelector(String(targetPlayerReturnsCreature[1] || '').trim()), to: 'hand', toRaw: "its owner's hand", raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerReturnsCommanders = raw.match(/^target\s+player\s+returns\s+each\s+commander\s+they\s+control\s+from\s+the\s+battlefield\s+to\s+the\s+command\s+zone$/i);
  if (targetPlayerReturnsCommanders) {
    return [{ kind: 'move_zone', what: parseObjectSelector('each commander target player controls'), to: 'command', toRaw: 'the command zone', raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerRevealTopCard = raw.match(/^target\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i);
  if (targetPlayerRevealTopCard) {
    return [{ kind: 'reveal_top', who: { kind: 'target_player' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerRevealTopCards = raw.match(/^target\s+player\s+reveals\s+the\s+top\s+(.+?)\s+cards?\s+of\s+their\s+library$/i);
  if (targetPlayerRevealTopCards) {
    return [{ kind: 'reveal_top', who: { kind: 'target_player' }, amount: parseQuantity(String(targetPlayerRevealTopCards[1] || '').trim()), raw, ...sequence } as OracleEffectStep];
  }

  if (/^target\s+player\s+reveals\s+(?:a\s+number\s+of\s+cards\s+from\s+their\s+hand\s+equal\s+to\s+.+|(?:three|x)\s+cards\s+from\s+their\s+hand(?:\s+and\s+you\s+choose\s+one\s+of\s+them|,\s+where\s+x\s+is\s+.+)?)$/i.test(raw)) {
    return [{ kind: 'reveal_hand', who: { kind: 'target_player' }, raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerSearchLibrary = raw.match(/^target\s+player\s+searches\s+their\s+library\s+for\s+a\s+card$/i);
  if (targetPlayerSearchLibrary) {
    return [{ kind: 'search_library', who: { kind: 'target_player' }, criteria: { kind: 'raw', text: 'a card' }, destination: 'hand', revealFound: false, raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerShuffleGraveyardTargets = raw.match(/^target\s+player\s+shuffles\s+any\s+number\s+of\s+target\s+cards\s+from\s+their\s+graveyard\s+into\s+their\s+library$/i);
  if (targetPlayerShuffleGraveyardTargets) {
    return [{ kind: 'move_zone', what: parseObjectSelector("any number of target cards from target player's graveyard"), to: 'library', toRaw: 'their library', raw, ...sequence } as OracleEffectStep];
  }

  const targetPlayerTakesExtraTurns = raw.match(/^target\s+player\s+takes\s+two\s+extra\s+turns\s+after\s+this\s+one$/i);
  if (targetPlayerTakesExtraTurns) {
    return [
      { kind: 'take_extra_turn', who: { kind: 'target_player' }, raw, ...sequence } as OracleEffectStep,
      { kind: 'take_extra_turn', who: { kind: 'target_player' }, raw, ...sequence } as OracleEffectStep,
    ];
  }

  if (/^target\s+player\s+(?:chooses\b|gets\s+an\s+emblem\b|loses\s+the\s+game$|reveals\s+(?:cards\s+from\s+the\s+top\b|their\s+library$)|skips\b|with\s+exactly\s+seven\s+poison\s+counters\s+loses\s+the\s+game$)/i.test(raw) || /^target\s+player(?:'|’)s\s+life\s+total\s+becomes\b/i.test(raw)) {
    return staticMetadata('target player residual', raw);
  }

  if (/^target\s+spell\s+(?:becomes\s+colorless|can(?:'|’)t\s+be\s+countered)$/i.test(raw)) {
    return staticMetadata('target spell', raw);
  }

  if (/^target\s+spell\s+or\s+permanent\s+becomes\s+(?:black|blue|colorless|green|red|white)$/i.test(raw)) {
    return staticMetadata('target spell or permanent', raw);
  }

  if (/^target\s+spell(?:'|’)s\s+controller\s+exiles\s+it\s+with\s+x\s+delay\s+counters\s+on\s+it$/i.test(raw)) {
    return staticMetadata('target spell', raw);
  }

  const ptChoice = raw.match(/^(this\s+creature|target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+or\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (ptChoice) {
    const targetText = String(ptChoice[1] || '').trim();
    const buildMode = (powerRaw: string, toughnessRaw: string): OracleEffectStep => ({
      kind: 'modify_pt',
      target: parseObjectSelector(targetText),
      power: Number.parseInt(powerRaw, 10) || 0,
      toughness: Number.parseInt(toughnessRaw, 10) || 0,
      duration: 'end_of_turn',
      raw: `${targetText} gets ${powerRaw}/${toughnessRaw} until end of turn`,
      ...sequence,
    } as OracleEffectStep);
    const firstPower = String(ptChoice[2] || '').trim();
    const firstToughness = String(ptChoice[3] || '').trim();
    const secondPower = String(ptChoice[4] || '').trim();
    const secondToughness = String(ptChoice[5] || '').trim();
    return [{
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
      modes: [
        { label: `${firstPower}/${firstToughness}`, raw: `${targetText} gets ${firstPower}/${firstToughness} until end of turn`, steps: [buildMode(firstPower, firstToughness)] },
        { label: `${secondPower}/${secondToughness}`, raw: `${targetText} gets ${secondPower}/${secondToughness} until end of turn`, steps: [buildMode(secondPower, secondToughness)] },
      ],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetConnivesReference = raw.match(/^(target\s+(?:attacking\s+)?creature(?:\s+you\s+control)?)\s+connives\s+x,\s+where\s+x\s+is\s+(.+)$/i);
  if (targetConnivesReference) {
    return [{
      kind: 'connive',
      target: parseObjectSelector(String(targetConnivesReference[1] || '').trim()),
      amount: { kind: 'reference_amount', raw: `X, where X is ${String(targetConnivesReference[2] || '').trim()}` },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const splitTwoTargetPt = raw.match(/^(target\s+creature\s+an\s+opponent\s+controls)\s+gets\s+(-?\+?\d+)\/(-?\+?\d+)\s+until\s+end\s+of\s+turn\s+and\s+(target\s+creature\s+you\s+control)\s+gets\s+(\+?-?\d+)\/(\+?-?\d+)\s+until\s+end\s+of\s+turn$/i);
  if (splitTwoTargetPt) {
    return [
      { kind: 'modify_pt', target: parseObjectSelector(String(splitTwoTargetPt[1] || '').trim()), power: Number.parseInt(String(splitTwoTargetPt[2] || '0'), 10) || 0, toughness: Number.parseInt(String(splitTwoTargetPt[3] || '0'), 10) || 0, duration: 'end_of_turn', raw, ...sequence } as OracleEffectStep,
      { kind: 'modify_pt', target: parseObjectSelector(String(splitTwoTargetPt[4] || '').trim()), power: Number.parseInt(String(splitTwoTargetPt[5] || '0'), 10) || 0, toughness: Number.parseInt(String(splitTwoTargetPt[6] || '0'), 10) || 0, duration: 'end_of_turn', raw, ...sequence } as OracleEffectStep,
    ];
  }

  if (/^target\s+creature\s+.*\s+gets\s+[+-]x\/[+-]?\d+\s+until\s+your\s+next\s+turn,\s+where\s+x\s+is\s+.+$/i.test(raw)
    || /^target\s+creature\s+defending\s+player\s+controls\s+gets\s+-\d+\/-\d+\s+and\s+loses\s+flying\s+until\s+your\s+next\s+turn$/i.test(raw)
    || /^target\s+creature\s+you\s+control\s+gets\s+\+x\/\+0\s+until\s+end\s+of\s+turn\s+and\s+up\s+to\s+one\s+target\s+creature\s+an\s+opponent\s+controls\s+gets\s+-0\/-x\s+until\s+end\s+of\s+turn,\s+where\s+x\s+is\s+.+$/i.test(raw)) {
    return temporaryMetadata('target creature P/T residual', raw, /until\s+your\s+next\s+turn/i.test(raw) ? 'until_next_turn' : 'end_of_turn');
  }

  if (/^target\s+creature\s+and\s+all\s+creatures\s+that\s+share\s+a\s+name\s+with\s+that\s+creature\s+gain\s+echo\s+\{[^}]+\}\s+until\s+the\s+end\s+of\s+your\s+next\s+turn$/i.test(raw)) {
    return temporaryMetadata('target creature and same-named creatures', raw, 'until_next_turn');
  }

  if (/^target\s+creature\s+loses\s+its\s+name$/i.test(raw)) {
    return staticMetadata('target creature', 'loses its name');
  }

  const targetOpponentRevealsTopCard = raw.match(/^target\s+opponent\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i);
  if (targetOpponentRevealsTopCard) {
    return [{ kind: 'reveal_top', who: { kind: 'target_opponent' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep];
  }

  const targetOpponentPutsGraveyardCreatureOntoBattlefield = raw.match(/^target\s+opponent\s+puts\s+a\s+creature\s+card\s+of\s+their\s+choice\s+from\s+their\s+graveyard\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i);
  if (targetOpponentPutsGraveyardCreatureOntoBattlefield) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector("a creature card of target opponent's choice from their graveyard"),
      to: 'battlefield',
      toRaw: 'the battlefield',
      battlefieldController: { kind: 'you' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^target\s+instant\s+or\s+sorcery\s+spell\s+becomes\s+the\s+color\s+of\s+your\s+choice$/i.test(raw)) {
    return staticMetadata('target instant or sorcery spell', raw);
  }

  if (/^target\s+(?:snow\s+land\s+is\s+no\s+longer\s+snow|snow\s+permanent\s+isn(?:'|’)t\s+snow\s+until\s+end\s+of\s+turn)$/i.test(raw)) {
    return staticMetadata('target snow permanent', raw);
  }

  if (/^(?:sorry,\s+.+\)|targeting\s+opponents,\s+anything\s+they\s+control,\s+and\/or\s+cards\s+in\s+their\s+graveyards\s+is\s+a\s+crime\.\))$/i.test(raw)) {
    return staticMetadata('reminder text residual', raw);
  }

  if (/^target\s+permanent$/i.test(raw)) {
    return staticMetadata('target permanent', raw);
  }

  if (/^target\s+player\s+searches\s+their\s+library\s+and\/or\s+graveyard\s+for\s+a\s+card\s+named\s+.+?,\s+reveals\s+it,\s+and\s+puts\s+it\s+into\s+their\s+hand$/i.test(raw)) {
    return staticMetadata('target player library/graveyard search', raw);
  }

  if (/^(?:tarmogoyf|tasty\s+\(this\s+creature\s+can\s+be\s+attacked\s+directly|teach\s+(?:\{[^}]+\})+\s+\(|tell\s+them\s+the\s+name\s+of\s+that\s+card|that\s+ability\s+triggers\s+an\s+additional\s+time\s+for\s+each\s+fish\s+tapped\s+this\s+way|that\s+card\s+is\s+now\s+on\s+an\s+adventure\s+for\s+you)$/i.test(raw)) {
    return staticMetadata('pass44 residual', raw);
  }

  if (/^that\s+artifact\s+gains\s+haste$/i.test(raw)) {
    return [{ kind: 'grant_static_ability', target: parseObjectSelector('that artifact'), abilities: ['haste'], raw, ...sequence } as OracleEffectStep];
  }

  const attackingPlayerCreatesToken = raw.match(/^that\s+attacking\s+player\s+(may\s+)?creates?\s+a\s+(tapped\s+)?(.+?\s+token(?:\s+(?:named\s+.+?|with\s+.+?))?)(?:\s+that(?:'|’)s\s+attacking\s+that\s+opponent)?$/i);
  if (attackingPlayerCreatesToken) {
    return [{
      kind: 'create_token',
      who: { kind: 'target_player' },
      amount: { kind: 'number', value: 1 },
      token: String(attackingPlayerCreatesToken[3] || '').trim(),
      ...(attackingPlayerCreatesToken[2] ? { entersTapped: true } : {}),
      ...(/\bthat(?:'|’)s\s+attacking\s+that\s+opponent\b/i.test(raw) ? { attacking: 'defending_player' as const } : {}),
      ...(attackingPlayerCreatesToken[1] ? { optional: true } : {}),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+attacking\s+player\s+may\s+tap\s+or\s+untap\s+target\s+permanent\s+of\s+their\s+choice$/i.test(raw)) {
    return [{ kind: 'tap_or_untap', target: parseObjectSelector('target permanent of their choice'), optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^that\s+creature\s+becomes\s+green$/i.test(raw)) {
    return staticMetadata('that creature', 'becomes green');
  }

  if (/^that\s+creature\s+becomes\s+your\s+commander$/i.test(raw)) {
    return staticMetadata('that creature', 'becomes your commander');
  }

  const thatCreatureGainsAbilities = raw.match(/^that\s+creature\s+gains\s+(.+)$/i);
  if (thatCreatureGainsAbilities && /\b(?:menace|deathtouch|haste)\b/i.test(String(thatCreatureGainsAbilities[1] || ''))) {
    return [{ kind: 'grant_static_ability', target: parseObjectSelector('that creature'), abilities: String(thatCreatureGainsAbilities[1] || '').split(/\s*,\s*|\s+and\s+/i).map(part => part.trim()).filter(Boolean), raw, ...sequence } as OracleEffectStep];
  }

  if (/^that\s+creature\s+can\s+block\s+up\s+to\s+two\s+additional\s+creatures\s+this\s+turn$/i.test(raw)) {
    return temporaryMetadata('that creature', 'can block up to two additional creatures', 'this_turn');
  }

  if (/^that\s+creature\s+deals\s+damage\s+equal\s+to\s+its\s+power\s+divided\s+as\s+you\s+choose\s+among\s+any\s+number\s+of\s+target\s+creatures\s+that\s+player\s+controls$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^that\s+creature\s+deals\s+damage\s+equal\s+to\s+its\s+power\s+divided\s+as\s+its\s+controller\s+chooses\s+among\s+any\s+number\s+of\s+those\s+wolves$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^that\s+creature\s+doesn(?:'|’)t\s+untap\s+during\s+its\s+controller(?:'|’)s\s+untap\s+step\s+for\s+as\s+long\s+as\s+(?:you\s+control\s+this\s+creature|this\s+(?:creature|equipment)\s+remains\s+on\s+the\s+battlefield)$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^(?:delirium\s*-?|democracy\b|devour\b|deworded\b|discover\b|distribute\b|divination,|do\s+this\s+x\s+times|doing\s+the\s+chosen\s+action\s+costs\b|don(?:'|’)t\s+(?:count|touch)\b|double\s+agenda\b|double\b)/i.test(raw)) {
    return staticMetadata('pass26 residual', raw);
  }

  if (/^commander\s+creatures\s+you\s+own\s+are\s+.+?\s+in\s+addition\s+to\s+their\s+other\s+types$/i.test(raw)) {
    return staticMetadata('commander creatures you own', raw);
  }

  const namedModeDamage = raw.match(/^[A-Z][^()]+\(\s*(\d+)\s+damage\s+to\s+(.+?)\s*\.\s*\)$/i);
  if (namedModeDamage) {
    return [{
      kind: 'deal_damage',
      amount: { kind: 'number', value: Number.parseInt(String(namedModeDamage[1] || '0'), 10) || 0 },
      target: parseObjectSelector(String(namedModeDamage[2] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const namedSelfPumpForEach = raw.match(/^[A-Z][A-Za-z0-9' -]+\s+gets\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+until\s+end\s+of\s+turn\s+for\s+each\s+(.+)$/i);
  if (namedSelfPumpForEach) {
    const powerRaw = String(namedSelfPumpForEach[1] || '').trim();
    const toughnessRaw = String(namedSelfPumpForEach[2] || '').trim();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('this permanent'),
      power: /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0,
      toughness: /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0,
      ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
      ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
      scaler: { kind: 'reference_scaler', raw: `for each ${String(namedSelfPumpForEach[3] || '').trim()}` },
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^change\s+the\s+text\s+of\s+.+?\s+by\s+replacing\s+all\s+instances\s+of\s+.+/i.test(raw)) {
    const target = raw.match(/^change\s+the\s+text\s+of\s+(.+?)\s+by\s+replacing/i)?.[1] || 'target spell or permanent';
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata(String(target).trim(), raw, 'end_of_turn');
    return staticMetadata(String(target).trim(), raw);
  }

  if (/^change\s+(?:this\s+creature(?:'|’)s|the)\s+base\s+(?:power|toughness|power\s+and\s+toughness)\b/i.test(raw)) {
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata('this creature', raw, 'end_of_turn');
    return staticMetadata('this creature', raw);
  }

  if (/^change\s+the\s+base\s+power\s+and\s+toughness\s+of\s+.+/i.test(raw)) {
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata('affected creatures', raw, 'end_of_turn');
    return staticMetadata('affected creatures', raw);
  }

  if (/^changing\s+targets\s+this\s+way\s+doesn(?:'|’)t\s+trigger\s+abilities\s+of\s+permanents\s+named\s+this\s+permanent$/i.test(raw)) {
    return staticMetadata('target-changing effect', raw);
  }

  if (/^choose\b/i.test(raw)) {
    const choice = /\bcolor\b/i.test(raw)
      ? 'generic'
      : /\bcard\s+name\b/i.test(raw)
        ? 'generic'
        : /\bcreature\s+type\b/i.test(raw)
          ? 'generic'
          : 'generic';
    return [{ kind: 'player_choice', choice, raw, ...sequence } as OracleEffectStep];
  }

  if (/^at\s+(?:the\s+)?(?:beginning\s+of|end\s+of|this\s+turn's\s+next)\s+.+/i.test(raw)) {
    return staticMetadata('delayed trigger', raw);
  }

  if (/^(?:ascend\s+magiccon|ask\s+(?:a\s+)?(?:person|player)\s+outside\s+the\s+game|assign\s+each\s+pile|assist\s+kicker|backup\b|bank\b|battlebond\b|bedtime\s+story\b|before\b|bestow-|blight\b|blitz\b|bolster\b|buyback-|buddy\s+list\b|call\s+someone\b|cast\s+(?:a\s+)?(?:any\s+number|copy|it\s+any\s+time|random|the\s+copies)\b|cards\s+exiled\s+this\s+way\b|cards\s+in\s+graveyards\b|cards\s+that\s+can\s+tax\b|cascade\b|casualty\s+x\b|compleated\b|conjure\b|copies\s+become\s+tokens\b|copy\b|coststorm\b)/i.test(raw)) {
    return staticMetadata('pass21 residual', raw);
  }

  if (/^(?:aura\s+and\s+equipment\s+spells|auras\s+and\s+equipment\s+you\s+control|avalanche!$|aven\s+mindcensor,|bats,\s+birds,\s+and\/or\s+mice\s+you\s+control\s+enter|because\s+let|basic\s+lands\s+of\s+the\s+first\s+chosen\s+type|black\s+and\/or\s+red\s+permanents\s+and\s+spells|blightning$|blood\s+moon$|bloodbraid\s+elf$|blitz\s+costs|blue,\s+black,\s+or\s+red,\s+put\s+a\s+\+1\/\+1\s+counter|boast\s+abilities\s+you\s+activate|bog-strider\s+ash$|braulios(?:'|’)?s\s+power|bring\s+(?:it\s+down|out\s+another)|by,\s+like|c\s+is\s+the\s+hypotenuse|calculate\s+the\s+hypotenuse|cast\s+a\s+sorcery\s+spell,\s+or\s+activate\s+a\s+loyalty\s+ability|charix,|check\s+it\s+off$|chicago\s+\(|control\s+a\s+blood,|count\s+the\s+|counter\s+(?:all|hits|on|that|up)|counters?\s+(?:and\s+stickers|can(?:not|'|’)t|remain|to\s+"0")|coven\s+-)/i.test(raw)) {
    return staticMetadata('pass21 residual', raw);
  }

  const pass19ResidualMetadata = /^(?:add\s+helm\s+of\s+kaldra|add\s+one\s+mana\s+of\s+that\s+color\s+unless\s+any\s+player|after\s+each\s+opponent|after\s+each\s+player|after\s+that\s+turn|after\s+this\s+phase|all\s+creatures\s+attack\s+enchanted\s+creature|all\s+creatures\s+can\s+attack|all\s+creatures\s+with\s+magnet\s+counters|all\s+incubator\s+tokens|all\s+instances\s+of\s+color\s+words|all\s+lands\s+lose|all\s+morph\s+costs|all\s+nontoken\s+permanents|all\s+permanents\s+other\s+than|all\s+slivers?\s+have\s+"?|all\s+suspected\s+creatures|all\s+targeted\s+spells|all\s+will\s+be\s+one|allons-y|am$|amass\s+|an\s+opponent\s+|and\s+before\s+the\s+game\s+begins|and\s+remember|angel\s+spells\s+and\s+human\s+spells|annihilator\s+x|annihinfect|announce\s+the\s+top|ante\s+this\s+artifact|any\s+number\s+of\s+role\s+enchantments|any\s+number\s+of\s+target\s+players\s+each$|any\s+number\s+of\s+target\s+opponents\s+each\s+sacrifice|any\s+number\s+of\s+target\s+noncreature\s+artifacts|any\s+opponent\s+may|any\s+other\s+commanders|any\s+other\s+player\s+may|any\s+player$|any\s+player\s+may|any\s+time\s+you\s+could\s+mulligan|anything\s+that\s+replaces|anything\s+that\s+could\s+have\s+changed|anywhere\s+this\s+card\s+goes|apiary,|argentum\s+is|artifact\s+creatures\s+with\s+indestructible|artifact\s+offering|artifact\s+cards\s+and\s+red\s+creature\s+cards|artifacts\s+you\s+control\s+have\s+"?\{t\}|artifacts\s+and\s+enchantments\s+you\s+own|artifacts\s+and\s+creatures\s+target\s+opponent|as\b)/i;
  if (pass19ResidualMetadata.test(raw)) {
    return staticMetadata('pass19 residual', raw);
  }

  const opponentLibraryCreatureSearch = raw.match(/^search\s+target\s+opponent(?:'|’)?s\s+library\s+for\s+a\s+creature\s+card\s+and\s+put\s+that\s+card\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i);
  if (opponentLibraryCreatureSearch) {
    return [{
      kind: 'search_library',
      who: { kind: 'target_opponent' },
      criteria: { kind: 'raw', text: 'creature card' },
      destination: 'battlefield',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^search\s+its\s+controller(?:'|’)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+all\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+spell\s+and\s+exile\s+them$/i.test(raw)) {
    return staticMetadata('same-named cards', raw);
  }

  if (/^target\s+opponent\s+chooses\s+two\s+of\s+those\s+cards$/i.test(raw)) {
    return staticMetadata('choice', raw);
  }

  if (/^target\s+opponent\s+exiles\s+an\s+enchantment\s+they\s+control$/i.test(raw)) {
    return [{ kind: 'exile', target: parseObjectSelector('an enchantment they control'), raw, ...sequence } as OracleEffectStep];
  }

  const revealUntilCreature = raw.match(/^(target\s+opponent|that\s+creature(?:'|’)?s\s+controller)\s+reveals\s+cards\s+from\s+the\s+top\s+of\s+their\s+library\s+until\s+they\s+reveal\s+a\s+creature\s+card$/i);
  if (revealUntilCreature) {
    const whoRaw = String(revealUntilCreature[1] || '').toLowerCase();
    return [{
      kind: 'reveal_top',
      who: whoRaw === 'target opponent' ? { kind: 'target_opponent' } : { kind: 'target_player' },
      amount: { kind: 'reference_amount', raw: 'until they reveal a creature card' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^target\s+permanent\s+becomes\s+white\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return temporaryMetadata('target permanent', 'becomes white', 'end_of_turn');
  }

  if (/^that\s+player\s+draws\s+two\s+additional\s+cards$/i.test(raw)) {
    return [{ kind: 'draw', who: { kind: 'target_player' }, amount: { kind: 'number', value: 2 }, raw, ...sequence } as OracleEffectStep];
  }

  if (/^that\s+token\s+gains\s+haste$/i.test(raw)) {
    return staticMetadata('that token', 'gains haste');
  }

  if (/^the\s+"legend\s+rule"\s+doesn(?:'|’)?t\s+apply\s+to\s+permanents\s+you\s+control$/i.test(raw)) {
    return staticMetadata('permanents you control', 'legend rule does not apply');
  }

  if (/^the\s+new\s+target\s+must\s+be\s+a\s+player$/i.test(raw)) {
    return staticMetadata('new target', 'must be a player');
  }

  if (/^(?:the\s+next\s+1\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+this\s+creature\s+this\s+turn\s+is\s+dealt\s+to\s+target\s+creature\s+you\s+control\s+instead|the\s+next\s+time\s+(?:(?:a|an)\s+(?:white|blue|black|red|green|artifact)\s+source\s+of\s+your\s+choice|a\s+source\s+of\s+your\s+choice\s+of\s+the\s+chosen\s+color)\s+would\s+deal\s+damage\s+to\s+you\s+this\s+turn,\s+prevent\s+that\s+damage)$/i.test(raw)) {
    return staticMetadata('damage prevention', raw);
  }

  const ownerLibraryChoice = raw.match(/^the\s+owner\s+of\s+target\s+(nonland\s+)?permanent\s+puts\s+it\s+(?:into\s+their\s+library\s+second\s+from\s+the\s+top\s+or\s+on\s+the\s+bottom|on\s+their\s+choice\s+of\s+the\s+top\s+or\s+bottom\s+of\s+their\s+library)$/i);
  if (ownerLibraryChoice) {
    return [{ kind: 'move_zone', what: parseObjectSelector(`target ${ownerLibraryChoice[1] ? 'nonland ' : ''}permanent`), to: 'library', toRaw: 'top or bottom of their library', raw, ...sequence } as OracleEffectStep];
  }

  if (/^the\s+owner\s+of\s+target\s+permanent\s+shuffles\s+it\s+into\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('target permanent'), to: 'library', toRaw: 'their library', raw, ...sequence } as OracleEffectStep];
  }

  if (/^the\s+player\s+puts\s+that\s+card\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('that card'), to: 'battlefield', toRaw: 'the battlefield', raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:the\s+player\s+to\s+your\s+right\s+chooses\s+a\s+color,\s+you\s+choose\s+another\s+color|the\s+player\s+to\s+your\s+right\s+gains\s+control\s+of\s+this\s+artifact|the\s+token\s+enters\s+tapped\s+and\s+attacking|the\s+tokens\s+are\s+goaded\s+for\s+the\s+rest\s+of\s+the\s+game)$/i.test(raw)) {
    return staticMetadata('static ability', raw);
  }

  if (/^the\s+token\s+gets\s+\+1\/\+1\s+until\s+end\s+of\s+turn\.?\)?$/i.test(raw)) {
    return [{ kind: 'modify_pt', target: parseObjectSelector('the token'), power: 1, toughness: 1, duration: 'end_of_turn', raw, ...sequence } as OracleEffectStep];
  }

  if (/^(?:enchanted\s+creature\s+has\s+".+"|the\s+same\s+is\s+true\s+for\s+.+|if\s+an\s+opponent\s+would\s+put\s+one\s+or\s+more\s+counters\s+on\s+a\s+permanent\s+or\s+player,\s+they\s+put\s+half\s+that\s+many\s+of\s+each\s+of\s+those\s+kinds\s+of\s+counters\s+on\s+that\s+permanent\s+or\s+player\s+instead,\s+rounded\s+down|for\s+each\s+kind\s+of\s+counter\s+on\s+target\s+permanent(?:\s+or\s+player)?,\s+(?:give\s+that\s+permanent\s+or\s+player\s+another\s+counter\s+of\s+that\s+kind|put\s+another\s+counter\s+of\s+that\s+kind\s+on\s+it\s+or\s+remove\s+one\s+from\s+it)|if\s+you\s+would\s+roll\s+one\s+or\s+more\s+dice,\s+instead\s+roll\s+that\s+many\s+dice\s+plus\s+one\s+and\s+ignore\s+the\s+lowest\s+roll|its\s+controller\s+adds\s+an\s+additional\s+two\s+mana\s+in\s+any\s+combination\s+of\s+colors|jump\s+-\s+during\s+your\s+turn,\s+this\s+permanent\s+has\s+flying|lock\s+or\s+unlock\s+a\s+door\s+of\s+target\s+room\s+you\s+control|look\s+at\s+target\s+face-down\s+creature|otherwise,\s+suspect\s+it|players\s+discard\s+cards\s+and\s+sacrifice\s+creatures\s+the\s+same\s+way|reveal\s+the\s+first\s+card\s+you\s+draw\s+each\s+turn|flip\s+five\s+coins|that\s+source\s+deals\s+double\s+that\s+damage\s+to\s+that\s+player\s+or\s+permanent|it\s+has\s+trample,\s+haste,\s+and\s+"at\s+the\s+beginning\s+of\s+the\s+end\s+step,\s+sacrifice\s+this\s+token\."|it(?:'|’)?s\s+a\s+2\/2\s+cyberman\s+artifact\s+creature|if\s+it\s+isn(?:'|’)?t\s+a\s+creature,\s+it\s+becomes\s+a\s+0\/0\s+robot\s+creature\s+in\s+addition\s+to\s+its\s+other\s+types|if\s+that\s+spell\s+would\s+be\s+put\s+into\s+a\s+graveyard,\s+put\s+it\s+on\s+the\s+bottom\s+of\s+its\s+owner(?:'|’)?s\s+library\s+instead|if\s+you\s+do,\s+increase\s+or\s+decrease\s+the\s+result\s+by\s+1|i+\s+-\s+you\s+may\s+sacrifice\s+a\s+creature|iii\s+-\s+choose\s+target\s+opponent)$/i.test(raw)) {
    return staticMetadata('static ability', raw);
  }

  if (/^parley\s+-\s+each\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'reveal_top', who: { kind: 'each_player' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep];
  }

  if (/^if\s+it(?:'|’)?s\s+a\s+land\s+card,\s+the\s+player\s+puts\s+it\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('it'), to: 'battlefield', toRaw: 'the battlefield', raw, ...sequence } as OracleEffectStep];
  }

  if (/^otherwise,\s+you\s+may\s+put\s+it\s+into\s+your\s+graveyard$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('it'), to: 'graveyard', toRaw: 'your graveyard', optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^if\s+you\s+don(?:'|’)?t,\s+it\s+enters\s+tapped$/i.test(raw)) {
    return staticMetadata('it', 'enters tapped');
  }

  if (/^put\s+the\s+cards\s+in\s+your\s+hand\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+any\s+order$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('the cards in your hand'), to: 'library', toRaw: 'bottom of your library', raw, ...sequence } as OracleEffectStep];
  }

  if (/^put\s+those\s+counters\s+on\s+up\s+to\s+one\s+target\s+creature$/i.test(raw)) {
    return [{ kind: 'add_counter', target: parseObjectSelector('up to one target creature'), counter: 'those counters', amount: { kind: 'reference_amount', raw: 'those counters' }, optional: true, raw, ...sequence } as OracleEffectStep];
  }

  if (/^put\s+onto\s+the\s+battlefield\s+under\s+your\s+control\s+all\s+creature\s+cards\s+in\s+all\s+graveyards\s+that\s+were\s+put\s+there\s+from\s+anywhere\s+this\s+turn$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('all creature cards in all graveyards that were put there from anywhere this turn'), to: 'battlefield', toRaw: 'the battlefield under your control', raw, ...sequence } as OracleEffectStep];
  }

  if (/^return\s+to\s+your\s+hand\s+all\s+creature\s+cards\s+in\s+your\s+graveyard\s+that\s+were\s+put\s+there\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('all creature cards in your graveyard that were put there from the battlefield this turn'), to: 'hand', toRaw: 'your hand', raw, ...sequence } as OracleEffectStep];
  }

  const scryResult = raw.match(/^\d+\s*-\s*\d+\s*\|\s*scry\s+(\d+)$/i);
  if (scryResult) {
    return [{
      kind: 'scry',
      who: { kind: 'you' },
      amount: parseQuantity(scryResult[1]),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^(?:if\s+you\s+do,\s+)?(?:you\s+may\s+)?repeat\s+this\s+process(?:\s+any\s+number\s+of\s+times|\s+once)?$/i.test(raw)) {
    return staticMetadata('this process', raw);
  }

  if (/^you\s+may\s+put\s+it\s+on\s+the\s+bottom\.?\)?$/i.test(raw)) {
    return staticMetadata('it', 'may put on the bottom');
  }

  if (/^you\s+may\s+reveal\s+a\s+creature\s+card\s+with\s+power\s+2\s+or\s+less\s+from\s+among\s+them\s+and\s+put\s+it\s+into\s+your\s+hand\.\s*put\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order$/i.test(raw)) {
    return [{
      kind: 'look_choose_from_top',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'among them' },
      selectorText: 'creature card with power 2 or less',
      destination: 'hand',
      reveal: true,
      restOrder: 'any',
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const keywordMetadata = raw.match(/^(airbend\s+up\s+to\s+one\s+target\s+creature|incubate\s+x,\s+where\s+x\s+is\s+(?:its\s+power|that\s+spell(?:'|’)?s\s+mana\s+value)|it\s+endures\s+\d+|support\s+x)$/i);
  if (keywordMetadata) {
    return staticMetadata('keyword action', raw);
  }

  if (/^then\s+amass\s+orcs\s+(?:\d+|x)$/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  const equipmentCostLess = raw.match(/^equip\s+costs\s+you\s+pay\s+cost\s+(.+)\s+less$/i);
  if (equipmentCostLess) {
    return staticMetadata('equip costs you pay', `cost ${String(equipmentCostLess[1] || '').trim()} less`);
  }

  if (/^add\s+mana\s+of\s+the\s+chosen\s+color\s+or\s+chosen\s+combination\s+of\s+colors$/i.test(raw)) {
    return staticMetadata('mana choice', raw);
  }

  const allLandType = raw.match(/^(all|each)\s+lands?\s+(?:are|is)\s+(?:an?\s+)?(islands?|swamps?|mountains?|plains?|forests?)\s+in\s+addition\s+to\s+(?:their|its)\s+other\s+(?:types|land\s+types)$/i);
  if (allLandType) {
    const landTypeRaw = String(allLandType[2] || '').toLowerCase();
    const landType = /^islands?$/.test(landTypeRaw) ? 'Island'
      : /^swamps?$/.test(landTypeRaw) ? 'Swamp'
        : /^mountains?$/.test(landTypeRaw) ? 'Mountain'
          : /^plains?$/.test(landTypeRaw) ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('all lands'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const nonbasicLandType = raw.match(/^nonbasic\s+lands\s+are\s+(islands|swamps|mountains|plains|forests)$/i);
  if (nonbasicLandType) {
    const landTypeRaw = String(nonbasicLandType[1] || '').toLowerCase();
    const landType = landTypeRaw === 'islands' ? 'Island'
      : landTypeRaw === 'swamps' ? 'Swamp'
        : landTypeRaw === 'mountains' ? 'Mountain'
          : landTypeRaw === 'plains' ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('nonbasic lands'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const landTypeWithCounter = raw.match(/^that\s+land\s+is\s+an?\s+(island|swamp|mountain|plains|forest)\s+in\s+addition\s+to\s+its\s+other\s+types\s+for\s+as\s+long\s+as\s+it\s+has\s+a\s+(.+?)\s+counter\s+on\s+it$/i);
  if (landTypeWithCounter) {
    const landTypeRaw = String(landTypeWithCounter[1] || '').toLowerCase();
    const landType = landTypeRaw === 'island' ? 'Island'
      : landTypeRaw === 'swamp' ? 'Swamp'
        : landTypeRaw === 'mountain' ? 'Mountain'
          : landTypeRaw === 'plains' ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('that land'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const broadTemporaryPt = raw.match(/^(all\s+other\s+creatures|another\s+target\s+creature|creatures\s+target\s+player\s+controls|attacking\s+creatures\s+with\s+flying|each\s+creature\s+you\s+control\s+named\s+this\s+permanent|target\s+1\/1\s+creature|one\s+or\s+two\s+target\s+creatures)\s+(?:each\s+)?gets?\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (broadTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(broadTemporaryPt[1] || '').trim()),
      power: Number.parseInt(String(broadTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(broadTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      optional: /^one\s+or\s+two/i.test(String(broadTemporaryPt[1] || '')) || undefined,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const staticPt = raw.match(/^(creatures\s+of\s+the\s+chosen\s+type|during\s+your\s+turn,\s+this\s+creature|as\s+long\s+as\s+equipped\s+creature\s+is\s+a\s+human,\s+it)\s+gets?\s+(?:an\s+additional\s+)?([+-]\d+)\/([+-]\d+)$/i);
  if (staticPt) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(String(staticPt[1] || '').trim()),
      power: Number.parseInt(String(staticPt[2] || '0'), 10),
      toughness: Number.parseInt(String(staticPt[3] || '0'), 10),
      effectText: [raw],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetLandAnimation = raw.match(/^(target\s+land(?:\s+you\s+control)?)\s+becomes\s+a\s+(\d+)\/(\d+)\s+([^\.]+?)\s+until\s+end\s+of\s+turn$/i);
  if (targetLandAnimation) {
    const typeText = String(targetLandAnimation[4] || '').replace(/\bwith\s+.+$/i, '').trim();
    const abilities = /\bhaste\b/i.test(String(targetLandAnimation[4] || '')) ? ['haste'] : undefined;
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector(String(targetLandAnimation[1] || '').trim()),
      addTypes: typeText ? typeText.split(/\s+/).filter(Boolean) : ['creature'],
      power: Number.parseInt(String(targetLandAnimation[2] || '0'), 10),
      toughness: Number.parseInt(String(targetLandAnimation[3] || '0'), 10),
      abilities,
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const permanentArtifact = raw.match(/^(target\s+permanent)\s+becomes\s+an\s+artifact\s+in\s+addition\s+to\s+its\s+other\s+types(?:\s+until\s+end\s+of\s+turn)?$/i);
  if (permanentArtifact) {
    return [{
      kind: 'add_types',
      target: parseObjectSelector(String(permanentArtifact[1] || '').trim()),
      addTypes: ['artifact'],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const combatRequirement = raw.match(/^(all\s+creatures\s+able\s+to\s+block\s+enchanted\s+creature\s+do\s+so|all\s+creatures\s+block\s+each\s+combat\s+if\s+able|target\s+creature\s+attacks\s+target\s+opponent\s+this\s+turn\s+if\s+able|target\s+creature\s+blocks\s+target\s+creature\s+this\s+turn\s+if\s+able|no\s+more\s+than\s+one\s+creature\s+can\s+(?:attack|block)\s+each\s+combat)$/i);
  if (combatRequirement) {
    return staticMetadata('combat requirements', raw);
  }

  const damageRedirect = raw.match(/^all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(.+?)\s+is\s+dealt\s+to\s+(.+?)\s+instead$/i);
  if (damageRedirect) {
    return staticMetadata(String(damageRedirect[1] || '').trim(), `damage is dealt to ${String(damageRedirect[2] || '').trim()} instead`);
  }

  const temporaryDamageRedirect = raw.match(
    /^all\s+(combat\s+)?damage\s+that\s+would\s+be\s+dealt(?:\s+this\s+turn)?\s+to\s+(.+?)(?:\s+this\s+turn)?(?:\s+by\s+(.+?)(?:\s+this\s+turn)?)?\s+is\s+dealt\s+to\s+(.+?)\s+instead(?:\s+\(if.+\))?$/i
  );
  if (temporaryDamageRedirect) {
    const damageKind = String(temporaryDamageRedirect[1] || '').trim().toLowerCase() === 'combat'
      ? 'combat damage'
      : 'damage';
    const recipientText = String(temporaryDamageRedirect[2] || '').trim();
    const sourceText = String(temporaryDamageRedirect[3] || '').trim();
    const redirectedToText = String(temporaryDamageRedirect[4] || '').trim();
    const effectText = `${damageKind} that would be dealt${sourceText ? ` by ${sourceText}` : ''} is dealt to ${redirectedToText} instead`;
    return temporaryMetadata(recipientText, effectText, 'this_turn');
  }

  const temporarySourceDamageRedirect = raw.match(
    /^all\s+damage\s+that\s+would\s+be\s+dealt\s+this\s+turn\s+by\s+(.+?)\s+is\s+dealt\s+to\s+(.+?)\s+instead$/i
  );
  if (temporarySourceDamageRedirect) {
    const sourceText = String(temporarySourceDamageRedirect[1] || '').trim();
    const redirectedToText = String(temporarySourceDamageRedirect[2] || '').trim();
    return temporaryMetadata(sourceText, `damage it would deal is dealt to ${redirectedToText} instead`, 'this_turn');
  }

  if (/^prevent\s+all\s+combat\s+damage\s+that\s+would\s+be\s+dealt\s+this\s+turn$/i.test(raw)) {
    return [{
      kind: 'prevent_damage',
      amount: 'all',
      duration: 'this_turn',
      combatOnly: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const nextDamageToTarget = raw.match(/^prevent\s+the\s+next\s+(.+?)\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+(.+?)\s+this\s+turn$/i);
  if (nextDamageToTarget) {
    return [{
      kind: 'prevent_damage',
      amount: parseQuantity(String(nextDamageToTarget[1] || '').trim()),
      recipientTarget: parseObjectSelector(String(nextDamageToTarget[2] || '').trim()),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const linkedSourcePrevent = raw.match(/^prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+this\s+turn\s+by\s+(target\s+source(?:\s+of\s+your\s+choice)?)\s+that\s+shares\s+a\s+color\s+with\s+the\s+exiled\s+card$/i);
  if (linkedSourcePrevent) {
    return [{
      kind: 'prevent_damage',
      amount: 'all',
      target: parseObjectSelector(String(linkedSourcePrevent[1] || '').trim()),
      duration: 'this_turn',
      sharesColorWithLinkedExiledCard: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const preventAllDamage = raw.match(/^prevent\s+(all|the\s+next\s+(?:\d+|x))\s+((?:damage\b.+?)|(?:.+?damage.+?))(?:\s+this\s+turn)?$/i);
  if (preventAllDamage) {
    const amountRaw = String(preventAllDamage[1] || '').trim();
    return [{
      kind: 'prevent_damage',
      amount: /^all$/i.test(amountRaw) ? 'all' : parseQuantity(amountRaw.replace(/^the\s+next\s+/i, '')),
      target: parseObjectSelector(String(preventAllDamage[2] || '').trim()),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const conditionalPreventDamage = raw.match(/^if\s+a\s+source\s+an\s+opponent\s+controls\s+would\s+deal\s+damage\s+to\s+you,\s+prevent\s+(\d+)\s+of\s+that\s+damage$/i);
  if (conditionalPreventDamage) {
    return [{
      kind: 'prevent_damage',
      amount: parseQuantity(String(conditionalPreventDamage[1] || '0')),
      target: parseObjectSelector('that damage'),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const preventXOfThatDamage = raw.match(/^prevent\s+x\s+of\s+that\s+damage,\s+where\s+x\s+is\s+the\s+amount\s+of\s+mana\s+that\s+player\s+paid\s+this\s+way$/i);
  if (preventXOfThatDamage) {
    return [{
      kind: 'prevent_damage',
      amount: { kind: 'reference_amount', raw: 'the amount of mana that player paid this way' },
      target: parseObjectSelector('that damage'),
      duration: 'this_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const anyTargetsDiscard = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+discard\s+a\s+card$/i);
  if (anyTargetsDiscard) {
    return [{
      kind: 'discard',
      who: { kind: 'any_number_of_target_players' },
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const eachPlayerDrawUpTo = raw.match(/^each\s+player\s+may\s+draw\s+up\s+to\s+(.+?)\s+cards?$/i);
  if (eachPlayerDrawUpTo) {
    return [{
      kind: 'draw',
      who: { kind: 'each_player' },
      amount: parseQuantity(String(eachPlayerDrawUpTo[1] || '').trim()),
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const eachPlayerLoseHalf = raw.match(/^each\s+player\s+loses\s+half\s+their\s+life$/i);
  if (eachPlayerLoseHalf) {
    return [{
      kind: 'lose_life',
      who: { kind: 'each_player' },
      amount: { kind: 'reference_amount', raw: 'half their life' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const playerMayPutLand = raw.match(/^each\s+player\s+may\s+put\s+a\s+land\s+card\s+from\s+their\s+hand\s+onto\s+the\s+battlefield$/i);
  if (playerMayPutLand) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land card from their hand'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const shuffleHandGraveyard = raw.match(/^each\s+player\s+may\s+shuffle\s+their\s+hand\s+and\s+graveyard\s+into\s+their\s+library$/i);
  if (shuffleHandGraveyard) {
    return [{
      kind: 'shuffle_zones_into_library',
      who: { kind: 'each_player' },
      zones: ['hand', 'graveyard'],
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const shuffleHand = raw.match(/^each\s+player\s+shuffles\s+the\s+cards\s+from\s+their\s+hand\s+into\s+their\s+library$/i);
  if (shuffleHand) {
    return [{
      kind: 'shuffle_zones_into_library',
      who: { kind: 'each_player' },
      zones: ['hand'],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const creatureControllerSacrifice = raw.match(/^target\s+creature(?:'|’)?s\s+controller\s+sacrifices\s+it$/i);
  if (creatureControllerSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'target_player' },
      what: parseObjectSelector('it'),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const eachOtherSacrifice = raw.match(/^each\s+other\s+player\s+sacrifices\s+a\s+(.+?)(?:\s+of\s+their\s+choice)?$/i);
  if (eachOtherSacrifice) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'each_opponent' },
      what: parseObjectSelector(`a ${String(eachOtherSacrifice[1] || '').trim()}`),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const opponentExilesControlled = raw.match(/^(target\s+opponent)\s+exiles\s+(a\s+.+?\s+they\s+control(?:\s+with\s+the\s+greatest\s+mana\s+value\s+among\s+.+)?)$/i);
  if (opponentExilesControlled) {
    return [{
      kind: 'exile',
      target: parseObjectSelector(String(opponentExilesControlled[2] || '').trim()),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const handExileFaceDown = raw.match(/^(target\s+player)\s+exiles\s+all\s+cards\s+from\s+their\s+hand\s+face\s+down$/i);
  if (handExileFaceDown) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('all cards from their hand'),
      to: 'exile',
      toRaw: 'exile face down',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const millHalfLibrary = raw.match(/^(target\s+player)\s+mills\s+half\s+their\s+library,\s+rounded\s+down$/i);
  if (millHalfLibrary) {
    return [{
      kind: 'mill',
      who: parsePlayerSelector(millHalfLibrary[1]),
      amount: { kind: 'reference_amount', raw: 'half their library rounded down' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const playerSearchBasicLand = raw.match(/^(target\s+player)\s+searches\s+their\s+library\s+for\s+a\s+basic\s+land\s+card,\s+puts\s+it\s+onto\s+the\s+battlefield\s+tapped$/i);
  if (playerSearchBasicLand) {
    return [{
      kind: 'search_library',
      who: parsePlayerSelector(playerSearchBasicLand[1]),
      criteria: { kind: 'raw', text: 'basic land card' },
      destination: 'battlefield',
      entersTapped: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^reveal\s+that\s+card,\s+put\s+it\s+into\s+your\s+hand$/i.test(raw)) {
    return [
      { kind: 'grant_static_ability', target: parseObjectSelector('that card'), effectText: ['reveal'], duration: 'static', raw, ...sequence } as OracleEffectStep,
      { kind: 'move_zone', what: parseObjectSelector('that card'), to: 'hand', toRaw: 'your hand', raw, sequence: 'then' } as OracleEffectStep,
    ];
  }

  if (/^reveal\s+the\s+top\s+card\s+of\s+your\s+library\s+and\s+put\s+it\s+into\s+your\s+hand$/i.test(raw)) {
    return [
      { kind: 'reveal_top', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as OracleEffectStep,
      { kind: 'move_zone', what: parseObjectSelector('the top card of your library'), to: 'hand', toRaw: 'your hand', raw, sequence: 'then' } as OracleEffectStep,
    ];
  }

  const chooseMetadata = raw.match(/^(?:as\s+this\s+creature\s+enters,\s+)?(?:secretly\s+)?choose\s+(.+)$/i);
  if (chooseMetadata) {
    const choiceText = String(chooseMetadata[1] || '').trim();
    if (/^(?:a\s+card\s+in\s+your\s+hand|a\s+creature\s+at\s+random|a\s+land\s+type|a\s+number|a\s+player\s+at\s+random|another\s+target\s+creature|any\s+number\s+of\s+creatures\s+with\s+different\s+powers|target\s+attacking\s+or\s+blocking\s+creature|target\s+creature\s+you\s+don(?:'|’)?t\s+control|target\s+opponent\s+who\s+has\s+more\s+life\s+than\s+you\s+do\s+as\s+you\s+activate\s+this\s+ability|target\s+player|target\s+wall\s+creature|a\s+creature\s+type|an\s+opponent)$/i.test(choiceText)) {
      return staticMetadata('choice', `choose ${choiceText}`);
    }
  }

  const staticRestriction = raw.match(/^(players\s+can(?:'|’)?t\s+(?:cast\s+spells\s+from\s+graveyards\s+or\s+libraries|draw\s+cards|play\s+lands|untap\s+more\s+than\s+one\s+artifact\s+during\s+their\s+untap\s+steps)|spells\s+and\s+abilities\s+your\s+opponents\s+control\s+can(?:'|’)?t\s+cause\s+you\s+to\s+sacrifice\s+permanents|spells\s+you\s+control\s+can(?:'|’)?t\s+be\s+countered|enchanted\s+creature\s+can(?:'|’)?t\s+be\s+the\s+target\s+of\s+spells\s+or\s+abilities\s+your\s+opponents\s+control|enchanted\s+creature\s+has\s+protection\s+from\s+black\s+and\s+from\s+red|enchanted\s+creature\s+loses\s+flying|nontoken\s+creatures\s+you\s+control\s+have\s+riot|each\s+nonland\s+card\s+in\s+your\s+hand\s+without\s+foretell\s+has\s+foretell|each\s+creature\s+card\s+in\s+your\s+graveyard\s+has\s+scavenge)$/i);
  if (staticRestriction) {
    return staticMetadata('static restriction', raw);
  }

  const staticAbilityText = raw.match(/^(during\s+your\s+turn,\s+you\s+may\s+play\s+cards\s+exiled\s+with\s+this\s+permanent|each\s+player\s+may\s+play\s+an\s+additional\s+land\s+on\s+each\s+of\s+their\s+turns|if\s+you\s+cast\s+a\s+spell\s+this\s+way,\s+you\s+may\s+cast\s+it\s+as\s+though\s+it\s+had\s+flash|if\s+you\s+cast\s+a\s+spell\s+this\s+way,\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+color\s+to\s+cast\s+it|its\s+foretell\s+cost\s+is\s+equal\s+to\s+its\s+mana\s+cost\s+reduced\s+by\s+\{2\}|only\s+your\s+opponents\s+may\s+activate\s+this\s+ability\s+and\s+only\s+as\s+a\s+sorcery|spend\s+this\s+mana\s+only\s+to\s+pay\s+cumulative\s+upkeep\s+costs|that\s+mana\s+becomes\s+colorless|that\s+player\s+may\s+pay\s+any\s+amount\s+of\s+mana)$/i);
  if (staticAbilityText) {
    return staticMetadata('static ability', raw);
  }

  const copyMetadata = raw.match(/^(copy\s+it,\s+except\s+the\s+copy\s+isn(?:'|’)?t\s+legendary|each\s+copy\s+targets\s+a\s+different\s+one\s+of\s+those\s+permanents\s+and\s+players)$/i);
  if (copyMetadata) {
    return staticMetadata('copy', raw);
  }

  const revealHandChoice = raw.match(/^target\s+player\s+reveals\s+three\s+cards\s+from\s+their\s+hand\s+and\s+you\s+choose\s+one\s+of\s+them$/i);
  if (revealHandChoice) {
    return [
      { kind: 'reveal_hand', who: { kind: 'target_player' }, raw, ...sequence } as OracleEffectStep,
      { kind: 'grant_static_ability', target: parseObjectSelector('revealed cards'), effectText: ['you choose one of them'], duration: 'static', raw, sequence: 'then' } as OracleEffectStep,
    ];
  }

  const phaseCombatRemoval = raw.match(/^remove\s+target\s+attacking\s+or\s+blocking\s+creature\s+from\s+combat$/i);
  if (phaseCombatRemoval) {
    return temporaryMetadata('target attacking or blocking creature', 'removed from combat');
  }

  const tapOtherwise = raw.match(/^otherwise,\s+tap\s+it$/i);
  if (tapOtherwise) {
    return [{ kind: 'tap_or_untap', target: parseObjectSelector('it'), mode: 'tap', raw, ...sequence } as OracleEffectStep];
  }

  const skipUntapPlayer = raw.match(/^that\s+player\s+skips\s+their\s+next\s+untap\s+step$/i);
  if (skipUntapPlayer) {
    return staticMetadata('that player', 'skips their next untap step');
  }

  const untapLand = raw.match(/^that\s+player\s+untaps\s+a\s+land\s+they\s+control$/i);
  if (untapLand) {
    return [{ kind: 'tap_or_untap', target: parseObjectSelector('a land they control'), mode: 'untap', raw, ...sequence } as OracleEffectStep];
  }

  if (/^its\s+controller\s+manifests\s+dread$/i.test(raw)) {
    return [{
      kind: 'manifest_dread',
      who: { kind: 'target_player' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^it\s+gains\s+haste\s+until\s+your\s+next\s+turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('it'),
      abilities: ['haste'],
      duration: 'until_next_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^it\s+gains\s+suspend$/i.test(raw)) {
    return staticMetadata('it', 'gains suspend');
  }

  if (/^it\s+becomes\s+(?:night|foretold)$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^it\s+/i, ''));
  }

  if (/^it\s+enters\s+tapped\s+and\s+attacking$/i.test(raw)) {
    return staticMetadata('it', 'enters tapped and attacking');
  }

  if (/^it\s+enters\s+with\s+three\s+times\s+that\s+many\s+\+1\/\+1\s+counters\s+on\s+it\.?\)?$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('it'),
      counter: '+1/+1',
      amount: { kind: 'reference_amount', raw: 'three times that many' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+many\s+plus\s+one\s+of\s+each\s+of\s+those\s+kinds\s+of\s+counters\s+are\s+put\s+on\s+that\s+permanent$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('that permanent'),
      counter: 'each of those kinds',
      amount: { kind: 'reference_amount', raw: 'that many plus one' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^put\s+twice\s+that\s+many\s+of\s+each\s+of\s+those\s+kinds\s+of\s+counters\s+on\s+that\s+permanent\s+or\s+player$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('that permanent or player'),
      counter: 'each of those kinds',
      amount: { kind: 'reference_amount', raw: 'twice that many' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^put\s+all\s+creatures\s+on\s+the\s+bottom\s+of\s+their\s+owners(?:'|’)?\s+libraries$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('all creatures'),
      to: 'library',
      toRaw: "bottom of their owners' libraries",
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+player\s+puts\s+that\s+card\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('that card'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+player\s+returns\s+a\s+land\s+they\s+control\s+to\s+its\s+owner(?:'|’)?s\s+hand$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land they control'),
      to: 'hand',
      toRaw: "its owner's hand",
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const topBottomRest = raw.match(/^(?:(?:then\s+)?puts?\s+the\s+(?:rest|revealed\s+cards)\s+on\s+the\s+bottom(?:\s+of\s+(?:your|their)\s+library)?\s+in\s+(?:a\s+)?(?:random|any)\s+order|put\s+up\s+to\s+one\s+of\s+them\s+on\s+top\s+of\s+your\s+library\s+and\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order)$/i);
  if (topBottomRest) {
    return staticMetadata('library order', raw);
  }

  if (/^manifest\s+the\s+top\s+card\s+of\s+your\s+library\s+and\s+attach\s+this\s+enchantment\s+to\s+it$/i.test(raw)) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('the top card of your library'),
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: 'Manifest the top card of your library',
        ...sequence,
      } as OracleEffectStep,
      {
        kind: 'attach',
        attachment: parseObjectSelector('this enchantment'),
        to: parseObjectSelector('it'),
        raw: 'attach this enchantment to it',
        sequence: 'then',
      } as OracleEffectStep,
    ];
  }

  const revealHandCards = raw.match(/^reveal\s+any\s+number\s+of\s+(.+?)\s+cards\s+in\s+your\s+hand$/i);
  if (revealHandCards) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(`${String(revealHandCards[1] || '').trim()} cards in your hand`),
      effectText: ['reveal any number'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const handToTop = raw.match(/^(target\s+(?:opponent|player))\s+puts\s+a\s+card\s+from\s+their\s+hand\s+on\s+top\s+of\s+their\s+library$/i);
  if (handToTop) {
    const who = String(handToTop[1] || '').trim();
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(`a card from ${who}'s hand`),
      to: 'library',
      toRaw: 'top of their library',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^target\s+unblocked\s+attacking\s+creature\s+becomes\s+blocked$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target unblocked attacking creature'),
      duration: 'this_turn',
      effectText: ['becomes blocked'],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+player\s+exiles\s+it$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('it'),
      to: 'exile',
      toRaw: 'exile',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+player\s+reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i.test(raw)) {
    return [{
      kind: 'reveal_top',
      who: parsePlayerSelector('that player'),
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^the\s+replicate\s+cost\s+is\s+equal\s+to\s+its\s+mana\s+cost$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('replicate cost'),
      effectText: ['is equal to its mana cost'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^(?:then\s+)?manifest\s+those\s+cards$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('those cards'),
      to: 'battlefield',
      toRaw: 'battlefield face down',
      entersFaceDown: true,
      raw,
      sequence: 'then',
    } as OracleEffectStep];
  }

  if (/^(?:then\s+)?puts\s+all\s+cards\s+they\s+exiled\s+this\s+way\s+onto\s+the\s+battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('all cards they exiled this way'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      raw,
      sequence: 'then',
    } as OracleEffectStep];
  }

  if (/^(?:then\s+)?shuffle\s+and\s+put\s+that\s+card\s+on\s+top$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('that card'),
      effectText: ['shuffle and put on top'],
      duration: 'static',
      raw,
      sequence: 'then',
    } as OracleEffectStep];
  }

  if (/^(?:then\s+)?those\s+choices\s+are\s+revealed$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('those choices'),
      effectText: ['are revealed'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const theyEachPt = raw.match(/^they\s+each\s+get\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (theyEachPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('they'),
      power: Number.parseInt(String(theyEachPt[1] || '0'), 10),
      toughness: Number.parseInt(String(theyEachPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetEachPt = raw.match(/^(up\s+to\s+\w+\s+target\s+creatures?)\s+each\s+get\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (targetEachPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(targetEachPt[1] || '').trim()),
      power: Number.parseInt(String(targetEachPt[2] || '0'), 10),
      toughness: Number.parseInt(String(targetEachPt[3] || '0'), 10),
      duration: 'end_of_turn',
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const theyHaveQuoted = raw.match(/^they\s+have\s+"([^"]+)"$/i);
  if (theyHaveQuoted) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      effectText: [String(theyHaveQuoted[1] || '').trim()],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const theyArePtType = raw.match(/^they(?:'|’)?re\s+(\d+)\/(\d+)\s+(.+)$/i);
  if (theyArePtType) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      power: Number.parseInt(String(theyArePtType[1] || '0'), 10),
      toughness: Number.parseInt(String(theyArePtType[2] || '0'), 10),
      effectText: [`are ${String(theyArePtType[3] || '').trim()}`],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^this\s+creature\s+blocks\s+each\s+combat\s+if\s+able$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['blocks each combat if able'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^this\s+creature\s+can\s+block\s+an\s+additional\s+creature\s+this\s+turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      duration: 'this_turn',
      effectText: ['can block an additional creature'],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^this\s+creature\s+saddles\s+mounts\s+and\s+crews\s+vehicles\s+as\s+though\s+its\s+power\s+were\s+2\s+greater$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this creature'),
      effectText: ['saddles Mounts and crews Vehicles as though its power were 2 greater'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^those\s+creatures\s+don(?:'|’)?t\s+untap\s+during\s+their\s+controllers(?:'|’)?\s+next\s+untap\s+steps$/i.test(raw)) {
    return [{
      kind: 'skip_next_untap',
      target: parseObjectSelector('those creatures'),
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^twice\s+that\s+many\s+\+1\/\+1\s+counters\s+are\s+put\s+on\s+that\s+creature$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('that creature'),
      counter: '+1/+1',
      amount: { kind: 'reference_amount', raw: 'twice that many' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^when\s+the\s+last\s+is\s+removed,\s+they\s+may\s+play\s+it\s+without\s+paying\s+its\s+mana\s+cost$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('it'),
      effectText: ['may play without paying its mana cost when the last counter is removed'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^while\s+an\s+opponent\s+is\s+choosing\s+targets\s+as\s+part\s+of\s+casting\s+a\s+spell\s+they\s+control\s+or\s+activating\s+an\s+ability\s+they\s+control,\s+that\s+player\s+must\s+choose\s+at\s+least\s+one\s+flagbearer\s+on\s+the\s+battlefield\s+if\s+able$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('opponents choosing targets'),
      effectText: ['must choose at least one Flagbearer on the battlefield if able'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^while\s+voting,\s+you\s+may\s+vote\s+an\s+additional\s+time$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: ['may vote an additional time'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^x\s+is\s+the\s+mana\s+value\s+of\s+that\s+card$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('X'),
      effectText: ['is the mana value of that card'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const chooseFromIt = raw.match(/^you\s+choose\s+(.+?)\s+from\s+it$/i);
  if (chooseFromIt) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('it'),
      effectText: [`choose ${String(chooseFromIt[1] || '').trim()}`],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+choose\s+one\s+of\s+them$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('them'),
      effectText: ['choose one'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+control\s+target\s+player\s+during\s+that\s+player(?:'|’)?s\s+next\s+turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target player'),
      duration: 'until_next_turn',
      effectText: ['you control that player during their next turn'],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const unspentManaMatch = raw.match(/^you\s+don(?:'|’)?t\s+lose\s+unspent\s+(.+?)\s+mana\s+as\s+steps\s+and\s+phases\s+end$/i);
  if (unspentManaMatch) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [`don't lose unspent ${String(unspentManaMatch[1] || '').trim()} mana as steps and phases end`],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+get\s+that\s+many\s+\{E\}\s+\(energy\s+counters\)$/i.test(raw)) {
    return [{
      kind: 'add_player_counter',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'that many' },
      counter: 'energy',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+may\s+cast\s+spells\s+this\s+turn\s+as\s+though\s+they\s+had\s+flash$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      duration: 'this_turn',
      effectText: ['may cast spells as though they had flash'],
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+may\s+cast\s+that\s+card\s+for\s+as\s+long\s+as\s+it\s+remains\s+exiled,\s+and\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+color\s+to\s+cast\s+that\s+spell$/i.test(raw)) {
    return [{
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: parseObjectSelector('that card'),
      duration: 'as_long_as_remains_exiled',
      permission: 'cast',
      optional: true,
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (
    /^you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy\.?'?"?$/i.test(raw) &&
    /"/.test(String(step.raw || ''))
  ) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('the copy'),
      effectText: ['you may choose new targets'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const collectEvidenceMatch = raw.match(/^you\s+may\s+collect\s+evidence\s+(\d+)$/i);
  if (collectEvidenceMatch) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('you'),
      effectText: [`may collect evidence ${String(collectEvidenceMatch[1] || '').trim()}`],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const payToEndMatch = raw.match(/^you\s+may\s+pay\s+((?:\{[^}]+\})+)\s+to\s+end\s+this\s+effect$/i);
  if (payToEndMatch) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this effect'),
      effectText: [`may pay ${String(payToEndMatch[1] || '').trim()} to end this effect`],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^you\s+may\s+pay\s+\{W\}\{U\}\{B\}\{R\}\{G\}\s+rather\s+than\s+pay\s+the\s+mana\s+cost\s+for\s+spells\s+you\s+cast$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('spells you cast'),
      effectText: ['you may pay {W}{U}{B}{R}{G} rather than pay the mana cost'],
      duration: 'static',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^enchanted\s+land\s+has\s+.*sacrifice\s+a\s+creature:\s+you$/i.test(raw)) {
    return staticMetadata('granted activated ability text', raw);
  }

  if (/^(?:gain\s+life\s+equal\s+to\s+)?the\s+sacrificed\s+creature(?:'|\u2019)s\s+toughness\.?"?$/i.test(raw)) {
    return staticMetadata('reference life amount', raw);
  }

  const reparsedSimple = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(raw).clause,
    rawClause: raw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (reparsedSimple && reparsedSimple.kind !== 'unknown') {
    return [reparsedSimple];
  }

  if (/^at\s+the\s+beginning\s+of\s+your\s+upkeep,\s+surveil\s+\d+$/i.test(raw)) {
    return staticMetadata('triggered surveil ability', raw);
  }

  if (/^banana\s+with\s+"\{T\},\s+sacrifice\s+this\s+token:\s+add\s+\{[RG]\}\s+or\s+\{[RG]\}$/i.test(raw)) {
    return staticMetadata('token option', raw);
  }

  if (/^elesh\s+norn,\s+mother\s+of\s+machines$/i.test(raw)) {
    return staticMetadata('named card option', raw);
  }

  if (/^for\s+each\s+opponent,\s+exile\s+cards\s+from\s+the\s+top\s+of\s+their\s+library\s+until\s+you\s+exile\s+a\s+nonland\s+card$/i.test(raw)) {
    return staticMetadata('opponent library exile mode', raw);
  }

  if (/^if\s+the\s+result\s+is\s+a\s+natural\s+20,\s+for\s+each\s+nonlegendary\s+creature\s+you\s+control,\s+create\s+a\s+token\s+that(?:'|\u2019)?s\s+a\s+copy\s+of\s+that\s+creature$/i.test(raw)) {
    return staticMetadata('die result token-copy mode', raw);
  }

  const targetCreatureBecomesSubtype = raw.match(/^target\s+creature\s+becomes\s+a\s+([a-z][a-z -]+?)\s+until\s+end\s+of\s+turn$/i);
  if (targetCreatureBecomesSubtype) {
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('target creature'),
      addTypes: [String(targetCreatureBecomesSubtype[1] || '').trim()],
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^target\s+player\s+chooses\s+a\s+creature\s+they\s+control\s+and\s+puts\s+two\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('a creature target player controls'),
      counter: '+1/+1',
      amount: { kind: 'number', value: 2 },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^target\s+player\s+puts\s+a\s+\+1\/\+1\s+counter\s+on\s+each\s+creature\s+they\s+control$/i.test(raw)) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('each creature target player controls'),
      counter: '+1/+1',
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const targetPlayerReturns = raw.match(/^target\s+player\s+returns\s+(.+?)\s+from\s+their\s+graveyard\s+to\s+their\s+hand$/i);
  if (targetPlayerReturns) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector(`${String(targetPlayerReturns[1] || '').trim()} from target player's graveyard`),
      to: 'hand',
      toRaw: 'their hand',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^that\s+creature(?:'|\u2019)s\s+controller\s+mills\s+cards\s+equal\s+to\s+its\s+power$/i.test(raw)) {
    return [{
      kind: 'mill',
      who: parsePlayerSelector("that creature's controller"),
      amount: { kind: 'reference_amount', raw: 'cards equal to its power' },
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  const selfCreatureAnimation = raw.match(/^until\s+end\s+of\s+turn,\s+this\s+creature\s+becomes\s+a\s+([a-z][a-z -]+?)\s+with\s+base\s+power\s+and\s+toughness\s+(\d+)\/(\d+)(?:\s+and\s+gains\s+(.+))?$/i);
  if (selfCreatureAnimation) {
    const typeText = String(selfCreatureAnimation[1] || '').trim();
    const abilityText = String(selfCreatureAnimation[4] || '').trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('this creature'),
      addTypes: typeText ? [typeText] : ['creature'],
      power: Number.parseInt(String(selfCreatureAnimation[2] || '0'), 10),
      toughness: Number.parseInt(String(selfCreatureAnimation[3] || '0'), 10),
      ...(abilityText ? { abilities: [abilityText.toLowerCase()] } : {}),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as OracleEffectStep];
  }

  if (/^when\s+this\s+creature\s+enters,\s+put\s+a\s+\+1\/\+1\s+counter\s+on\s+target\s+creature\s+or\s+a\s+lore\s+counter\s+on\s+target\s+saga\s+you\s+control$/i.test(raw)) {
    return staticMetadata('triggered counter choice', raw);
  }

  if (/^10,000\s+needles\s+-\s+whenever\s+this\s+creature\s+attacks,\s+it\s+gets\s+\+9999\/\+0\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return staticMetadata('attack trigger', raw);
  }

  if (/^the\s+battlefield\s+with\s+a\s+number\s+of\s+.+?\s+counters?\s+on\s+it\s+equal\s+to\s+.+$/i.test(raw)) {
    return staticMetadata('battlefield entry counter fragment', raw);
  }

  if (/^20\s*\|\s*copy\s+that\s+spell\.\s+you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy$/i.test(raw)) {
    return staticMetadata('die result copy mode', raw);
  }

  if (/^3\s+points\s+each\s+→\s+\+1\/\+1$/i.test(raw)) {
    return staticMetadata('sticker stat menu', raw);
  }

  if (/^4\s+and\s+higher\?\)?$/i.test(raw)) {
    return [];
  }

  if (/^5,\s+or\s+6,\s+create\s+two\s+0\/1\s+colorless\s+eldrazi\s+spawn\s+creature\s+tokens\s+with\s+"sacrifice\s+this\s+token:\s+add\s+\{C\}\."$/i.test(raw)) {
    return staticMetadata('die result token creation mode', raw);
  }

  if (/^9\s+or\s+less\s*\|\s*put\s+those\s+cards\s+into\s+your\s+hand$/i.test(raw)) {
    return staticMetadata('die result hand move mode', raw);
  }

  if (/^a\s+copy\s+of\s+an\s+artifact\s+spell\s+becomes\s+a\s+token\.\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+creature\s+with\s+(?:first\s+strike|infect|shroud)\b.+\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+deck\s+can\s+have\s+up\s+to\s+(?:\w+|\d+)\s+cards\s+named\s+this\s+permanent$/i.test(raw)) {
    return [];
  }

  if (/^a\s+(?:food|treasure)\s+token\s+is\s+an\s+artifact\s+with\s+".+"\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+performer,\s+or\s+a\s+robot,\s+you\s+may\s+get\s+\{TK\}\s+or\s+create\s+a\s+treasure\s+token$/i.test(raw)) {
    return staticMetadata('conditional ticket-or-token choice', raw);
  }

  if (/^if\s+you\s+control\s+an\s+employee,\s+a\s+performer,\s+or\s+a\s+robot,\s+you\s+may\s+get\s+\{TK\}\s+or\s+create\s+a\s+treasure\s+token$/i.test(raw)) {
    return staticMetadata('conditional ticket-or-token choice', raw);
  }

  if (/^a\s+player\s+losing\s+unspent\s+mana\s+causes\s+that\s+player\s+to\s+lose\s+that\s+much\s+life$/i.test(raw)) {
    return staticMetadata('mana burn replacement', raw);
  }

  if (/^a\s+player\s+of\s+your\s+choice\s+adds\s+\{C\}$/i.test(raw)) {
    return staticMetadata('chosen player mana ability', raw);
  }

  if (/^a\s+player\s+who\s+controls\s+more\s+permanents\s+than\s+each\s+other\s+player\s+can(?:not|'t)\s+play\s+lands\s+or\s+cast\s+artifact,\s+creature,\s+or\s+enchantment\s+spells$/i.test(raw)) {
    return staticMetadata('play/cast restriction', raw);
  }

  if (/^a\s+player\s+wins\s+if\s+their\s+card\s+had\s+a\s+greater\s+mana\s+value\.\)?$/i.test(raw)) {
    return [];
  }

  if (/^a\s+realm\s+can\s+host\s+any\s+number\s+of\s+creatures$/i.test(raw)) {
    return staticMetadata('realm hosting rule', raw);
  }

  const shouldDeferSupplementalFallback =
    /^you\s+get\s+an\s+emblem\s+with\s+"/i.test(raw) ||
    /^(?:[ivxlcdm]+|spell\s+mastery)\s+-/i.test(raw) ||
    /\bcopy\b/i.test(raw);
  if (!shouldDeferSupplementalFallback && /^(?:-\s+.+|-\d+:\s+.+|\.\.|\[[^\]]+\](?:\s+.+)?|(?:\{[^}]+\}(?:,\s*)?)+(?:\s*-\s*|(?:,\s*|\s+)[^:]+:\s*|:\s*).+|(?:\{P\}|\{TK\})+(?:\s*-\s*.+)|\{[WUBRG]\/P\}\s+can\s+be\s+paid\s+with\s+either\s+\{[WUBRG]\}\s+or\s+2\s+life\.?\)?|(?:â€¢|•)\s+.+|\d+\/\d+\s+.+|\d+\s*-\s+.+|[a-z][a-z0-9 '&!,.-]+\s+-\s+.+|abrupt\s+decay|an\s+opponent\s+lost\s+\d+\s+or\s+more\s+life\s+this\s+turn|planeswalk\s+to\s+.+|there\s+are\s+.+|treasure|you(?:'|\u2019)?ve\s+cast\s+.+|\+\s+(?:\{[^}]+\})+\s+-\s+.+|(?:\u221e|âˆž)\s+-\s+.+|\u2610.+|\d+(?:\s*-\s*\d+)?(?:\s+or\s+\d+)?\s*(?:\||-|point\s+each|is\b).+)$/i.test(raw)) {
    return staticMetadata('supplemental ability text', raw);
  }

  return null;
}

function parseDrawReplacementGainLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^the\s+next\s+time\s+you\s+would\s+draw\s+a\s+card\s+this\s+turn,\s+(.+?)\s+gains?\s+(that much|that many|\d+|x|[a-z]+)\s+life\s+instead$/i);
  if (!match) return null;
  return {
    kind: 'gain_life',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    amount: parseQuantity(String(match[2] || '').trim()),
    replacementOf: 'draw_card',
    duration: 'end_of_turn',
    raw,
  } as OracleEffectStep;
}

function parseResultLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^\d+(?:\s*-\s*\d+|\+)?\s*\|\s+(.+)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function splitMillDrawLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'draw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const match = raw.match(/^(.+?)\s+mills?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+draws?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+and\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const millRaw = `${who} mills ${String(match[2] || '').trim()}`;
  const drawRaw = `${who} draws ${String(match[3] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[4] || '').trim()}`;
  const millStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(millRaw).clause,
    rawClause: millRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const drawStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(drawRaw).clause,
    rawClause: drawRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (!millStep || millStep.kind !== 'mill' || !drawStep || drawStep.kind !== 'draw' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [millStep, drawStep, lifeStep];
}

function splitDiscardAndLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'discard') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const match = raw.match(/^(.+?)\s+discards?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)(?:,\s+and\s+.+)?$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const discardRaw = `${who} discards ${String(match[2] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[3] || '').trim()}`;
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [{ ...step, raw: discardRaw }, lifeStep];
}

function splitDiscardMillLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'discard') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const match = raw.match(/^(.+?)\s+discards?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+mills?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?),\s+and\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const discardRaw = `${who} discards ${String(match[2] || '').trim()}`;
  const millRaw = `${who} mills ${String(match[3] || '').trim()}`;
  const lifeRaw = `${who} loses ${String(match[4] || '').trim()}`;
  const millStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(millRaw).clause,
    rawClause: millRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeRaw);
  if (!millStep || millStep.kind !== 'mill' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [{ ...step, raw: discardRaw }, millStep, lifeStep];
}

function splitSacrificeAndLifeStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'sacrifice') return null;
  const raw = normalizeOracleText(String(step.raw || '')).replace(/^•\s*/, '').trim();
  const match = raw.match(/^(.+?)\s+sacrifices?\s+(.+?)(?:,\s+discards?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?))?,?\s+and\s+loses?\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const sacrificeWhat = String(match[2] || '').trim();
  const lifeStep = parseLifeTailStep(`${who} loses ${String(match[4] || '').trim()}`);
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  const steps: OracleEffectStep[] = [
    {
      ...step,
      what: parseObjectSelector(sacrificeWhat),
      raw: `${who} sacrifices ${sacrificeWhat}`,
    },
  ];
  const discardAmount = String(match[3] || '').trim();
  if (discardAmount) {
    const discardRaw = `${who} discards ${discardAmount}`;
    const discardStep = tryParseSimpleActionClause({
      clause: normalizeClauseForParse(discardRaw).clause,
      rawClause: discardRaw,
      withMeta: <T extends OracleEffectStep>(value: T) => value,
    });
    if (discardStep?.kind === 'discard') steps.push(discardStep);
  }
  steps.push(lifeStep);
  return steps;
}

function splitMoveZoneAndLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^otherwise,?\s*/i, '')
    .trim();
  const match = raw.match(/^(.+?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent)\s+gains?\s+.+?\s+life)$/i);
  if (!match) return null;

  const moveClause = normalizeClauseForParse(String(match[1] || '').trim()).clause;
  const moveStep = tryParseZoneAndRemovalClause({
    clause: moveClause,
    rawClause: String(match[1] || '').trim(),
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(String(match[2] || '').trim());
  if (!moveStep || moveStep.kind === 'unknown' || !lifeStep || lifeStep.kind !== 'gain_life') return null;
  return [moveStep, lifeStep];
}

function splitDamageAndLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^(.+?)\s+and\s+((?:you|each player|each opponent|target player|target opponent|that player|that opponent)\s+gains?\s+.+?\s+life(?:\s+for\s+each\s+.+)?)$/i);
  if (!match) return null;

  const damageClause = normalizeClauseForParse(String(match[1] || '').trim()).clause;
  const damageStep = tryParseLifeAndCombatClause({
    clause: damageClause,
    rawClause: String(match[1] || '').trim(),
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(String(match[2] || '').trim());
  if (!damageStep || damageStep.kind !== 'deal_damage' || !lifeStep || lifeStep.kind !== 'gain_life') return null;
  return [damageStep, lifeStep];
}

function splitAddManaAndLoseLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^otherwise,?\s*/i, '')
    .replace(/[."]+$/g, '')
    .trim();
  const match = raw.match(/^add\s+x\s+(\{[^}]+\})\s+and\s+(.+?)\s+lose(?:s)?\s+x\s+life,\s+where\s+x\s+is\s+(.+)$/i);
  if (!match) return null;

  const manaSymbol = String(match[1] || '').trim();
  const lifeWho = String(match[2] || '').trim();
  const whereText = String(match[3] || '').trim();
  if (!manaSymbol || !lifeWho || !whereText) return null;

  const addManaRaw = `Add an amount of ${manaSymbol} equal to ${whereText}`;
  const addManaStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(addManaRaw).clause,
    rawClause: addManaRaw,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(`${lifeWho} loses life equal to ${whereText}`);
  if (!addManaStep || addManaStep.kind !== 'add_mana' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [addManaStep, lifeStep];
}

function splitDestroyAndCantBlockStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'cant_block' || (step.target as any)?.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String((step.target as any).text || '')).trim();
  const match = targetText.match(/^(destroy\s+target\s+.+?),\s+and\s+(.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const destroyStep = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!destroyStep || destroyStep.kind !== 'destroy') return null;
  return [
    destroyStep,
    {
      ...step,
      target: parseObjectSelector(String(match[2] || '').trim()),
      raw: `${String(match[2] || '').trim()} can't block this turn`,
    },
  ];
}

function splitDestroyAndNoCombatDamageStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'assign_no_combat_damage' || (step.target as any)?.kind !== 'raw') return null;
  const targetText = normalizeOracleText(String((step.target as any).text || '')).trim();
  const match = targetText.match(/^(destroy\s+target\s+.+?)\s+and\s+(.+)$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const destroyStep = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!destroyStep || destroyStep.kind !== 'destroy') return null;
  return [
    destroyStep,
    {
      ...step,
      target: parseObjectSelector(String(match[2] || '').trim()),
      raw: `${String(match[2] || '').trim()} assigns no combat damage this turn`,
    },
  ];
}

function splitDestroyUnlessDamageStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'deal_damage' || ((step as any).source as any)?.kind !== 'raw') return null;
  const sourceText = normalizeOracleText(String(((step as any).source as any).text || '')).trim();
  const match = sourceText.match(/^(destroy\s+target\s+.+?)\s+unless\s+.+?\s+has\s+this\s+permanent$/i);
  if (!match) return null;
  const destroyClause = String(match[1] || '').trim();
  const destroyStep = tryParseZoneAndRemovalClause({
    clause: normalizeClauseForParse(destroyClause).clause,
    rawClause: destroyClause,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!destroyStep || destroyStep.kind !== 'destroy') return null;
  return [destroyStep, { ...step, source: parseObjectSelector('this permanent') }];
}

function splitMillAndLifeUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^(.+?)\s+each\s+mill(?:s)?\s+((?:a|an|\d+|x|[a-z]+)\s+cards?)\s+and\s+lose\s+((?:that much|that many|\d+|x|[a-z]+)\s+life)$/i);
  if (!match) return null;

  const who = String(match[1] || '').trim();
  const millClause = normalizeClauseForParse(`${who} mill ${String(match[2] || '').trim()}`).clause;
  const lifeClause = normalizeClauseForParse(`${who} each lose ${String(match[3] || '').trim()}`).clause;
  const millStep = tryParseSimpleActionClause({
    clause: millClause,
    rawClause: `${who} each mill ${String(match[2] || '').trim()}`,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  const lifeStep = parseLifeTailStep(lifeClause);
  if (!millStep || millStep.kind !== 'mill' || !lifeStep || lifeStep.kind !== 'lose_life') return null;
  return [millStep, lifeStep];
}

function splitTapAndCounterStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'tap_or_untap' || (step.target as any)?.kind !== 'raw') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const match = raw.match(/^(tap|untap)\s+(.+?)\s+and\s+(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (!match) return null;

  const counterStep = parseSimpleCounterTailStep(String(match[3] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;
  return [
    {
      ...step,
      target: parseObjectSelector(String(match[2] || '').trim()),
      raw: `${String(match[1] || '').trim()} ${String(match[2] || '').trim()}`,
    },
    counterStep,
  ];
}

function parseChooseAndPutCounterUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(?:you\s+may\s+)?choose\s+.+?\s+and\s+(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (!match) return null;
  return parseSimpleCounterTailStep(String(match[1] || '').trim());
}

function parseTriggeredIfCounterUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(?:(?:flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance)\s+)?when\s+.+?\s+enters,\s*if\s+(.+?),\s*(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (!match) return null;
  const counterStep = parseSimpleCounterTailStep(String(match[2] || '').trim());
  if (!counterStep || counterStep.kind !== 'add_counter') return null;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: normalizeLeadingConditionalCondition(String(match[1] || '').trim()) },
    steps: [counterStep],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseTriggeredLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function parseLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const lifeStep = parseLifeTailStep(String(step.raw || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function parseTrailingCommaLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  if (/^if\b/i.test(raw)) return null;
  const match = raw.match(/,\s+((?:you|each player|each other player|each opponent|target player|target opponent|that player|that opponent)\s+(?:gains?|loses?)\s+.+?\s+life)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[1] || '').trim());
  return lifeStep && (lifeStep.kind === 'gain_life' || lifeStep.kind === 'lose_life') ? lifeStep : null;
}

function parseConditionalLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^if\s+(.+),\s+(.+)$/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(String(match[2] || '').trim());
  if (!lifeStep || (lifeStep.kind !== 'gain_life' && lifeStep.kind !== 'lose_life')) return null;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: normalizeLeadingConditionalCondition(String(match[1] || '').trim()) },
    steps: [lifeStep],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parseQualifiedLifeUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const match = normalized.match(/^(each opponent)\s+who\s+(.+?)\s+loses?\s+(that much|that many|\d+|x|[a-z]+)\s+life\b/i);
  if (!match) return null;
  const lifeStep = parseLifeTailStep(`${String(match[1] || '').trim()} loses ${String(match[3] || '').trim()} life`);
  if (!lifeStep || lifeStep.kind !== 'lose_life') return null;
  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: `${String(match[1] || '').trim()} who ${String(match[2] || '').trim()}` },
    steps: [lifeStep],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

function parsePrefixedTapCounterUnknownStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  const body = normalized.replace(/^(?:[A-Za-z][A-Za-z0-9 ',\-]+\s+-\s*)?(?:\{[^}]+\}\s*)+:\s*/i, '');
  const tapCounterMatch = body.match(/^(tap|untap)\s+(.+?)\s+and\s+(put\s+.+?\s+counters?\s+on\s+.+)$/i);
  if (tapCounterMatch) {
    const counterStep = parseSimpleCounterTailStep(String(tapCounterMatch[3] || '').trim());
    if (counterStep?.kind === 'add_counter') {
      return [
        {
          kind: 'tap_or_untap',
          target: parseObjectSelector(String(tapCounterMatch[2] || '').trim()),
          mode: String(tapCounterMatch[1] || '').trim().toLowerCase() === 'untap' ? 'untap' : 'tap',
          raw: `${String(tapCounterMatch[1] || '').trim()} ${String(tapCounterMatch[2] || '').trim()}`,
        },
        counterStep,
      ];
    }
  }
  if (body === normalized) return null;
  const tapStep = tryParseSimpleActionClause({
    clause: normalizeClauseForParse(body).clause,
    rawClause: body,
    withMeta: <T extends OracleEffectStep>(value: T) => value,
  });
  if (!tapStep || tapStep.kind === 'unknown') return null;
  return splitTapAndCounterStep(tapStep) || [tapStep];
}

function expandDynamicCounterRiderSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    let cleanedStep = stripMalformedDynamicWithCounters(step);
    if (cleanedStep.kind === 'conditional') {
      const originalNestedSteps = cleanedStep.steps;
      const nestedSteps = expandDynamicCounterRiderSteps(originalNestedSteps);
      if (nestedSteps.length !== originalNestedSteps.length || nestedSteps.some((nested, index) => nested !== originalNestedSteps[index])) {
        cleanedStep = { ...cleanedStep, steps: nestedSteps };
      }
    }
    if (cleanedStep.kind === 'schedule_delayed_trigger' && !cleanedStep.steps) {
      const effect = normalizeOracleText(String(cleanedStep.effect || '')).trim();
      const parsed = parseSimpleCounterTailStep(effect) ?? parseLifeTailStep(effect);
      if (parsed && parsed.kind !== 'unknown') {
        cleanedStep = { ...cleanedStep, steps: [parsed] };
      }
    }
    const splitExile = splitExileAndCounterRiderStep(cleanedStep);
    if (splitExile) {
      expanded.push(...splitExile);
      continue;
    }
    const splitDraw = splitCounterAndDrawStep(cleanedStep);
    if (splitDraw) {
      expanded.push(...splitDraw);
      continue;
    }
    const splitLifeDraw = splitLifeAndDrawStep(cleanedStep);
    if (splitLifeDraw) {
      expanded.push(...splitLifeDraw);
      continue;
    }
    const splitDrawLife = splitDrawAndLifeStep(cleanedStep);
    if (splitDrawLife) {
      expanded.push(...splitDrawLife);
      continue;
    }
    const splitMillDrawLife = splitMillDrawLifeStep(cleanedStep);
    if (splitMillDrawLife) {
      expanded.push(...splitMillDrawLife);
      continue;
    }
    const splitDiscardLife = splitDiscardAndLifeStep(cleanedStep);
    if (splitDiscardLife) {
      expanded.push(...splitDiscardLife);
      continue;
    }
    const splitDiscardMillLife = splitDiscardMillLifeStep(cleanedStep);
    if (splitDiscardMillLife) {
      expanded.push(...splitDiscardMillLife);
      continue;
    }
    const splitSacrificeLife = splitSacrificeAndLifeStep(cleanedStep);
    if (splitSacrificeLife) {
      expanded.push(...splitSacrificeLife);
      continue;
    }
    const splitTap = splitTapAndCounterStep(cleanedStep);
    if (splitTap) {
      expanded.push(...splitTap);
      continue;
    }
    const chooseCounter = parseChooseAndPutCounterUnknownStep(cleanedStep);
    if (chooseCounter) {
      expanded.push(chooseCounter);
      continue;
    }
    const triggeredCounter = parseTriggeredIfCounterUnknownStep(cleanedStep);
    if (triggeredCounter) {
      expanded.push(triggeredCounter);
      continue;
    }
    const triggeredLife = parseTriggeredLifeUnknownStep(cleanedStep);
    if (triggeredLife) {
      expanded.push(triggeredLife);
      continue;
    }
    const conditionalLife = parseConditionalLifeUnknownStep(cleanedStep);
    if (conditionalLife) {
      expanded.push(conditionalLife);
      continue;
    }
    const qualifiedLife = parseQualifiedLifeUnknownStep(cleanedStep);
    if (qualifiedLife) {
      expanded.push(qualifiedLife);
      continue;
    }
    const forEachLifePair = parseForEachLifePairUnknownStep(cleanedStep);
    if (forEachLifePair) {
      expanded.push(...forEachLifePair);
      continue;
    }
    const lifePair = parseLifePairUnknownStep(cleanedStep);
    if (lifePair) {
      expanded.push(...lifePair);
      continue;
    }
    const untilEndLife = parseUntilEndTriggeredLifeUnknownStep(cleanedStep);
    if (untilEndLife) {
      expanded.push(untilEndLife);
      continue;
    }
    const forAnyOpponentsDestroy = parseForAnyNumberOpponentsDestroyUnknownStep(cleanedStep);
    if (forAnyOpponentsDestroy) {
      expanded.push(forAnyOpponentsDestroy);
      continue;
    }
    const prefixedDestroy = parsePrefixedDestroyUnknownStep(cleanedStep);
    if (prefixedDestroy) {
      expanded.push(prefixedDestroy);
      continue;
    }
    const timedDestroy = parseTimedDestroyUnknownStep(cleanedStep);
    if (timedDestroy) {
      expanded.push(timedDestroy);
      continue;
    }
    const wrappedDestroy = parseWrappedDestroyUnknownStep(cleanedStep);
    if (wrappedDestroy) {
      expanded.push(wrappedDestroy);
      continue;
    }
    const librarySearch = parseLibrarySearchUnknownStep(cleanedStep);
    if (librarySearch) {
      expanded.push(librarySearch);
      continue;
    }
    const forEachManaGainLife = parseForEachManaGainLifeUnknownStep(cleanedStep);
    if (forEachManaGainLife) {
      expanded.push(forEachManaGainLife);
      continue;
    }
    const forEachGainLife = parseForEachGainLifeUnknownStep(cleanedStep);
    if (forEachGainLife) {
      expanded.push(forEachGainLife);
      continue;
    }
    const enterAsCopy = parseEnterAsCopyUnknownStep(cleanedStep);
    if (enterAsCopy) {
      expanded.push(enterAsCopy);
      continue;
    }
    const replacementGainLife = parseDrawReplacementGainLifeUnknownStep(cleanedStep);
    if (replacementGainLife) {
      expanded.push(replacementGainLife);
      continue;
    }
    const resultLife = parseResultLifeUnknownStep(cleanedStep);
    if (resultLife) {
      expanded.push(resultLife);
      continue;
    }
    const trailingCommaLife = parseTrailingCommaLifeUnknownStep(cleanedStep);
    if (trailingCommaLife) {
      expanded.push(trailingCommaLife);
      continue;
    }
    const lifeStep = parseLifeUnknownStep(cleanedStep);
    if (lifeStep) {
      expanded.push(lifeStep);
      continue;
    }
    const prefixedTapCounter = parsePrefixedTapCounterUnknownStep(cleanedStep);
    if (prefixedTapCounter) {
      expanded.push(...prefixedTapCounter);
      continue;
    }
    const splitMoveLife = splitMoveZoneAndLifeUnknownStep(cleanedStep);
    if (splitMoveLife) {
      expanded.push(...splitMoveLife);
      continue;
    }
    const splitDamageLife = splitDamageAndLifeUnknownStep(cleanedStep);
    if (splitDamageLife) {
      expanded.push(...splitDamageLife);
      continue;
    }
    const splitAddManaLife = splitAddManaAndLoseLifeUnknownStep(cleanedStep);
    if (splitAddManaLife) {
      expanded.push(...splitAddManaLife);
      continue;
    }
    const splitDestroyCantBlock = splitDestroyAndCantBlockStep(cleanedStep);
    if (splitDestroyCantBlock) {
      expanded.push(...splitDestroyCantBlock);
      continue;
    }
    const splitDestroyNoDamage = splitDestroyAndNoCombatDamageStep(cleanedStep);
    if (splitDestroyNoDamage) {
      expanded.push(...splitDestroyNoDamage);
      continue;
    }
    const splitDestroyDamage = splitDestroyUnlessDamageStep(cleanedStep);
    if (splitDestroyDamage) {
      expanded.push(...splitDestroyDamage);
      continue;
    }
    const splitMillLife = splitMillAndLifeUnknownStep(cleanedStep);
    if (splitMillLife) {
      expanded.push(...splitMillLife);
      continue;
    }
    if (
      cleanedStep.kind === 'lose_life' &&
      (cleanedStep.who as any)?.kind === 'you' &&
      /^lose\s+/i.test(String(cleanedStep.raw || '').trim())
    ) {
      const previousStep = expanded[expanded.length - 1];
      if (previousStep?.kind === 'mill' && (previousStep.who as any)?.kind === 'any_number_of_target_players') {
        expanded.push({ ...cleanedStep, who: previousStep.who });
        continue;
      }
    }
    expanded.push(cleanedStep);

    if (cleanedStep.kind === 'move_zone' && cleanedStep.to === 'battlefield') {
      const movedText = String((cleanedStep.what as any)?.text || '');
      const targetText = /\b(?:cards|permanents|creatures)\b/i.test(movedText) ? 'those creatures' : 'that creature';
      const counterStep = parseDynamicCounterRider(String(cleanedStep.toRaw || cleanedStep.raw || ''), targetText);
      if (counterStep) expanded.push(counterStep);
      continue;
    }

    if (cleanedStep.kind === 'create_token' && !(cleanedStep as any).withCounters) {
      const amount = (cleanedStep as any).amount;
      const tokenCount = amount?.kind === 'number' ? Number(amount.value || 0) : 0;
      const targetText = (cleanedStep as any).who?.kind === 'each_player' || tokenCount > 1 ? 'those tokens' : 'that token';
      const counterStep = parseDynamicCounterRider(String(cleanedStep.raw || ''), targetText);
      if (counterStep) expanded.push(counterStep);
    }
  }

  return expanded;
}

export function expandDynamicCounterRiderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const expandedSteps = expandDynamicCounterRiderSteps(ability.steps);
    return expandedSteps.length === ability.steps.length && expandedSteps.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps: expandedSteps };
  });
}

function lowerCurrentResidualUnknownSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const lowered: OracleEffectStep[] = [];

  for (const step of steps) {
    let nextStep = step;
    if (nextStep.kind === 'conditional') {
      const currentSteps = nextStep.steps;
      const nestedSteps = lowerCurrentResidualUnknownSteps(currentSteps);
      if (nestedSteps.length !== currentSteps.length || nestedSteps.some((nested, index) => nested !== currentSteps[index])) {
        nextStep = { ...nextStep, steps: nestedSteps } as OracleEffectStep;
      }
    } else if (nextStep.kind === 'schedule_delayed_trigger' && Array.isArray((nextStep as any).steps)) {
      const currentSteps = (nextStep as any).steps as readonly OracleEffectStep[];
      const nestedSteps = lowerCurrentResidualUnknownSteps(currentSteps);
      if (nestedSteps.length !== currentSteps.length || nestedSteps.some((nested, index) => nested !== currentSteps[index])) {
        nextStep = { ...(nextStep as any), steps: nestedSteps } as OracleEffectStep;
      }
    }

    const currentResidual = parseCurrentResidualUnknownStep(nextStep);
    if (currentResidual) {
      lowered.push(...currentResidual);
      continue;
    }

    lowered.push(nextStep);
  }

  return lowered;
}

export function lowerCurrentResidualUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const loweredSteps = lowerCurrentResidualUnknownSteps(ability.steps);
    return loweredSteps.length === ability.steps.length && loweredSteps.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps: loweredSteps };
  });
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
    .replace(/^[\u2022\u00b7\u25cf\u25e6\u25aa\u25ab\u25ba\u2794\ufffd]+\s*/u, '')
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
    /^(?:you may\s+)?(look at|reveal) (?:the top (?:(a|an|\d+|x|[a-z]+) cards?|card)|that many cards from the top) of (your|target player's|target opponent's|that player's|that opponent's) library(?: any time)?(?:,\s*where\s+.+)?$/i
  );
  if (!match) return null;

  const who = parseTopLibraryInfoOwner(String(match[3] || '').trim());
  if (!who) return null;

  return {
    kind: /^reveal/i.test(String(match[1] || '').trim()) ? 'reveal_top' : 'look_top',
    who,
    amount: match[2] ? parseQuantity(String(match[2] || '').trim()) : (/that many cards from the top/i.test(normalized) ? { kind: 'reference_amount', raw: 'that many' } : { kind: 'number', value: 1 }),
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
      current.to === 'battlefield'
    ) {
      const parsed = parseBattlefieldEntryCounterFollowupStep(next);
      if (parsed) {
        const existingCounters = current.withCounters || {};
        const combinedCounters: Record<string, number> = { ...existingCounters };
        for (const [counter, amount] of Object.entries(parsed.withCounters)) {
          combinedCounters[counter] = Math.max(0, Number(combinedCounters[counter] || 0) + amount);
        }

        merged.push({
          ...current,
          withCounters: combinedCounters,
          ...(parsed.condition ? { withCountersCondition: parsed.condition } : {}),
          raw: `${String(current.raw || '').trim()}. ${parsed.raw}`.trim(),
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

  const match = normalized.match(/^(it|that card|that creature|that permanent) (?:gains|has) haste(?: until your next turn)?$/i);
  if (!match) return null;

  return {
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(String(match[1] || '').trim()),
    duration: /until your next turn/i.test(normalized) ? 'until_next_turn' : 'end_of_turn',
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

function parseLandAnimationUnknownStep(step: OracleEffectStep): OracleEffectStep | null {
  if (step.kind !== 'unknown') return null;
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/[.]+$/g, '')
    .trim();
  const match = normalized.match(
    /^(if you do,\s*)?(that land|target land(?: you control)?|it) becomes an? (\d+)\s*\/\s*(\d+)\s+(.+?)\s+creature(?:\s+with\s+(.+?))?\s+that'?s still a land$/i
  );
  if (!match) return null;

  const typeText = String(match[5] || '').trim();
  const abilityText = String(match[6] || '').trim();
  const addTypes = [
    'creature',
    ...typeText.split(/\s+/).map(part => part.trim()).filter(Boolean),
  ];
  const abilities = abilityText
    .split(/,|\band\b/i)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);

  const animateStep: OracleEffectStep = {
    kind: 'animate_permanent',
    target: parseObjectSelector(String(match[2] || '').trim()),
    addTypes,
    power: Number.parseInt(String(match[3] || '0'), 10) || 0,
    toughness: Number.parseInt(String(match[4] || '0'), 10) || 0,
    ...(abilities.length > 0 ? { abilities } : {}),
    duration: 'static',
    ...(step.optional ? { optional: true } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: String(step.raw || '').trim(),
  };

  if (match[1]) {
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: 'you do' },
      steps: [animateStep],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: String(step.raw || '').trim(),
    };
  }

  return animateStep;
}

export function expandLandAnimationUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const steps = ability.steps.map((step) => {
      const expanded = parseLandAnimationUnknownStep(step);
      if (expanded) {
        changed = true;
        return expanded;
      }
      return step;
    });

    return changed ? { ...ability, steps } : ability;
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
  const conditionSource = normalized.replace(/^[A-Za-z][A-Za-z0-9 ',\-]+\s+-\s+(if|when)\b/i, '$1');

  const match =
    conditionSource.match(/^if\s+(.+?\bcard),\s*(.+)$/i) ||
    conditionSource.match(/^if\s+(.+),\s*(.+)$/i) ||
    conditionSource.match(/^when\s+(you do),\s*(.+)$/i);
  if (!match) return null;

  const conditionRaw = normalizeLeadingConditionalCondition(String(match[1] || '').trim());
  const body = String(match[2] || '').trim();
  if (!conditionRaw || !body) return null;

  const bodyForParse = body.replace(/^you may reveal it and put\b/i, 'you may put');
  const rawParsedBodySteps = parseDeterministicUnknownBodySteps(step, bodyForParse);
  const parsedBodySteps = rawParsedBodySteps ? expandDynamicCounterRiderSteps(rawParsedBodySteps) : null;

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

  const permission = nextStep?.kind === 'unknown'
    ? parseEffectLevelImpulsePermissionClause(cleanImpulseClause(String(nextStep.raw || '')))
    : nextStep?.kind === 'grant_exile_permission' && /^(?:that card|the exiled card|it)$/i.test(String((nextStep.what as any)?.text || '').trim())
      ? {
          permission: nextStep.permission,
          duration: nextStep.duration,
        }
      : null;
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
    .replace(/["\s]+$/g, '')
    .trim();
  if (!normalized) return null;

  {
    const asLongAsExiledPermissionMatch = normalized.match(
      /^(?:for\s+as\s+long\s+as\s+(?:it|that\s+card|the\s+exiled\s+card|the\s+exiled\s+cards?)\s+remains?\s+exiled,\s+)?(?:(you|they|that player|the player|that opponent|an opponent|its owner|the exiled card's owner)\s+)?may\s+(cast|play)\s+(it|that card|the exiled card|this card|the exiled cards|those cards)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+if\s+[^.]+)?(?:\s+for\s+as\s+long\s+as\s+(?:it|that\s+card|the\s+exiled\s+card|they|those\s+cards)\s+remains?\s+exiled)?(?:,\s+and\s+mana\s+of\s+any\s+type\s+can\s+be\s+spent\s+to\s+cast\s+that\s+spell)?\.?$/i
    );
    if (asLongAsExiledPermissionMatch && /\bfor\s+as\s+long\s+as\b/i.test(normalized)) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(asLongAsExiledPermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(asLongAsExiledPermissionMatch[3] || '').trim()),
        duration: 'as_long_as_remains_exiled',
        permission: String(asLongAsExiledPermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const asLongAsControlSourcePermissionMatch = normalized.match(
      /^(?:(you|they|that player|the player|that opponent|an opponent|its owner|the exiled card's owner)\s+)?may\s+(cast|play)\s+(it|that card|the exiled card|this card)(?:\s+without\s+paying\s+its\s+mana\s+cost)?\s+for\s+as\s+long\s+as\s+this\s+permanent\s+remains\s+on\s+the\s+battlefield\.?$/i
    );
    if (asLongAsControlSourcePermissionMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(asLongAsControlSourcePermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(asLongAsControlSourcePermissionMatch[3] || '').trim()),
        duration: 'as_long_as_control_source',
        permission: String(asLongAsControlSourcePermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+its\s+mana\s+cost/i.test(normalized) || undefined,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const directPermissionWithManaSpendMatch = normalized.match(
      /^(until\s+end\s+of\s+turn,\s+)?(?:(you|they|that player|the player|that opponent|an opponent|each player|each opponent)\s+)?(?:may\s+)?(cast|play)s?\s+(it|that card|the exiled card|this card|that spell|them|those cards|the exiled cards)(?:\s+from\s+exile)?(?:\s+this\s+turn)?(?:\s+until\s+the\s+end\s+of\s+your\s+next\s+turn)?(?:\s+and\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\b.+|,\s+and\s+you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\b.+)?\.?$/i
    );
    if (directPermissionWithManaSpendMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(directPermissionWithManaSpendMatch[2] || 'you').trim()),
        what: parseObjectSelector(String(directPermissionWithManaSpendMatch[4] || '').trim()),
        duration: /until\s+the\s+end\s+of\s+your\s+next\s+turn/i.test(normalized)
          ? 'until_end_of_next_turn'
          : directPermissionWithManaSpendMatch[1] || /\bthis\s+turn\b/i.test(normalized)
            ? 'this_turn'
            : 'during_resolution',
        permission: String(directPermissionWithManaSpendMatch[3] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        optional: /\bmay\b/i.test(normalized) || undefined,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const broadExilePermissionMatch = normalized.match(
      /^(?:(you|they|that player|the player|that opponent|an opponent|each player|each opponent)\s+)?may\s+(cast|play)\s+((?:a|one)\s+(?:nonland\s+)?card|a\s+spell|one\s+spell|one\s+of\s+those\s+cards)(?:\s+(?:from\s+exile|they\s+exiled|exiled\s+this\s+way|from\s+among\s+the\s+exiled\s+cards))?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+this\s+turn)?\.?$/i
    );
    if (broadExilePermissionMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(broadExilePermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(broadExilePermissionMatch[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
        permission: String(broadExilePermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const eachPlayerExiledCardFreeCastMatch = normalized.match(
      /^each\s+player\s+may\s+cast\s+(the\s+nonland\s+card\s+they\s+exiled|the\s+card\s+they\s+exiled|a\s+card\s+they\s+exiled)\s+without\s+paying\s+its\s+mana\s+cost\.?$/i
    );
    if (eachPlayerExiledCardFreeCastMatch) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'each_player' },
        what: parseObjectSelector(String(eachPlayerExiledCardFreeCastMatch[1] || '').trim()),
        duration: 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const amongThemFreeCastMatch = normalized.match(
      /^(until\s+end\s+of\s+turn,\s+)?(?:for\s+each\s+[^,]+,\s+)?you\s+may\s+cast\s+(.+?)\s+from\s+among\s+(?:them|those\s+cards|the\s+exiled\s+cards|(?:the\s+)?other\s+cards\s+exiled\s+this\s+way|cards\s+exiled\s+this\s+way|cards\s+revealed\s+this\s+way)\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?(?:\.\s*then\s+put\s+the\s+rest\b.+)?\.?$/i
    );
    if (amongThemFreeCastMatch) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(amongThemFreeCastMatch[2] || '').trim()),
        duration: amongThemFreeCastMatch[1] ? 'this_turn' : 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const simpleFreePermissionMatch = normalized.match(
      /^(until\s+end\s+of\s+turn,\s+)?you\s+may\s+(cast|play)\s+(.+?)\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?\.?$/i
    );
    if (simpleFreePermissionMatch && !/\b(?:from\s+exile|from\s+(?:your|their|that\s+player's|an\s+opponent's|target\s+opponent's)\s+graveyard|from\s+your\s+hand|from\s+your\s+hand\s+or\s+the\s+top\s+of\s+your\s+library|from\s+the\s+top\s+of\s+your\s+library)\b/i.test(normalized)) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(simpleFreePermissionMatch[3] || '').trim()),
        duration: simpleFreePermissionMatch[1] ? 'this_turn' : 'during_resolution',
        permission: String(simpleFreePermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        withoutPayingManaCost: true,
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const amongThemPermissionThisTurnMatch = normalized.match(
      /^(until\s+(?:end\s+of\s+turn|the\s+end\s+of\s+your\s+next\s+turn),\s+)?you\s+may\s+(cast|play)\s+(.+?)\s+from\s+among\s+(?:them|those\s+cards|the\s+exiled\s+cards|cards\s+exiled\s+this\s+way)(?:\s+this\s+turn)?\.?$/i
    );
    if (amongThemPermissionThisTurnMatch) {
      return {
        kind: 'grant_exile_permission',
        who: { kind: 'you' },
        what: parseObjectSelector(String(amongThemPermissionThisTurnMatch[3] || '').trim()),
        duration: /next\s+turn/i.test(normalized) ? 'until_end_of_next_turn' : 'this_turn',
        permission: String(amongThemPermissionThisTurnMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
        optional: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const directPermissionMatch = normalized.match(
      /^(?:(you|they|that player|the player|that opponent|an opponent|each player|each opponent|its owner|the exiled card's owner)\s+)?(?:may\s+)?(cast|play)s?\s+(it|that card|the exiled card|this card|that spell|them|those cards|the exiled cards)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?\.?$/i
    );
    if (directPermissionMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(String(directPermissionMatch[1] || 'you').trim()),
        what: parseObjectSelector(String(directPermissionMatch[3] || '').trim()),
        duration: /\bthis\s+turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
        permission: String(directPermissionMatch[2] || '').toLowerCase().startsWith('play') ? 'play' : 'cast',
        withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
        optional: /\bmay\b/i.test(normalized) || undefined,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }

    const mandatoryFreeCastMatch = normalized.match(/^(?:otherwise,?\s*)?(?:the player|that player|they)\s+casts?\s+(it|that card|the exiled card)\s+without\s+paying\s+its\s+mana\s+cost(?:\s+if\s+able)?(?:\s+or\s+put\s+it\s+into\s+their\s+hand)?\.?$/i);
    if (mandatoryFreeCastMatch) {
      return {
        kind: 'grant_exile_permission',
        who: parsePlayerSelector(/\bthey\b/i.test(normalized) ? 'they' : 'that player'),
        what: parseObjectSelector(String(mandatoryFreeCastMatch[1] || '').trim()),
        duration: 'during_resolution',
        permission: 'cast',
        withoutPayingManaCost: true,
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

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

  const conditionalAmongThemFreeCastMatch = normalized.match(
    /^(until\s+end\s+of\s+turn,\s+)?(?:(you|they|that player|the player)\s+)?may\s+cast\s+(.+?)\s+from\s+among\s+(?:them|those\s+cards|the\s+exiled\s+cards|(?:the\s+)?other\s+cards\s+exiled\s+with\s+this\s+(?:artifact|enchantment|permanent|creature|card)|cards\s+exiled\s+this\s+way|cards\s+revealed\s+this\s+way|cards\s+exiled\s+with\s+this\s+(?:artifact|enchantment|permanent|creature|card))\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?\.?$/i
  );
  if (conditionalAmongThemFreeCastMatch) {
    return {
      kind: 'grant_exile_permission',
      who: parsePlayerSelector(String(conditionalAmongThemFreeCastMatch[2] || 'you').trim()),
      what: parseObjectSelector(String(conditionalAmongThemFreeCastMatch[3] || '').trim()),
      duration: conditionalAmongThemFreeCastMatch[1] ? 'this_turn' : 'during_resolution',
      permission: 'cast',
      withoutPayingManaCost: true,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const exiledCardPermissionMatch = normalized.match(
    /^(you|they|that player|the player|that opponent|an opponent)?\s*may\s+(cast|play)\s+(the exiled card|that card|it|them|those cards)(?:\s+from\s+exile)?(?:\s+without\s+paying\s+(?:its|their)\s+mana\s+costs?)?(?:\s+this\s+turn)?(?:\s+if\s+.+)?$/i
  );
  if (exiledCardPermissionMatch) {
    return {
      kind: 'grant_exile_permission',
      who: parsePlayerSelector(String(exiledCardPermissionMatch[1] || 'you').trim()),
      what: parseObjectSelector(String(exiledCardPermissionMatch[3] || '').trim()),
      duration: /\bthis turn\b/i.test(normalized) ? 'this_turn' : 'during_resolution',
      permission: String(exiledCardPermissionMatch[2] || '').toLowerCase() === 'play' ? 'play' : 'cast',
      withoutPayingManaCost: /without\s+paying\s+(?:its|their)\s+mana\s+costs?/i.test(normalized) || undefined,
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

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
    const match = normalized.match(/^as\s+an\s+additional\s+cost\s+to\s+cast\s+this\s+spell,\s+discard\s+a\s+card\s+or\s+pay\s+((?:\{[^}]+\}\s*)+)$/i);
    if (match) {
      manaRaw = String(match[1] || '').trim();
      optional = true;
    }
  }

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
    /^(?:then\s+)?puts? one onto the battlefield face down as a 2\/2 creature and the other into (?:your|their) graveyard$/i.test(normalized) ||
    /^turn it face up any time for its mana cost if it(?:'|â€™)s a creature card$/i.test(normalized)
  ) {
    return true;
  }

  if (step.kind === 'unknown') {
    return /^(?:that player )?looks? at the top two cards of (?:your|their) library$/i.test(normalized) || /^manifest one of them$/i.test(normalized);
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
  if (!step) return false;

  if (step.kind === 'grant_exile_permission') {
    const normalizedGrant = normalizeOracleText(String(step.raw || ''))
      .replace(/^then\b\s*/i, '')
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();
    return /^you may cast it without paying its mana cost$/i.test(normalizedGrant);
  }

  if (step.kind !== 'unknown') return false;

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

  if (step.kind === 'grant_static_ability') {
    return /^target land you control becomes a 0\/0 (?:land )?creature with haste that(?:'|â€™)?s still a land$/i.test(normalized);
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

function isAirbendPermissionStaticGrantStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;

  const targetText = normalizeOracleText(String((step.target as any)?.text || (step.target as any)?.raw || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!/^(?:it|that card|the exiled card|each exiled card|those cards)$/i.test(targetText)) {
    return false;
  }

  const effectText = step.effectText
    .map((entry) => normalizeOracleText(String(entry || '')).replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  return /^(?:its|their) owner may cast (?:it|them) for \{2\} rather than (?:its|their) mana cost$/i.test(effectText);
}

function isRedundantAirbendReminderStep(step: OracleEffectStep): boolean {
  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (step.kind === 'unknown') {
    return /^(?:exile it|exile them)$/i.test(normalized);
  }

  return isAirbendPermissionStaticGrantStep(step);
}

export function pruneRedundantAirbendReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const hasAirbendLead = ability.steps.some(
      (step) =>
        step.kind === 'airbend' ||
        (step.kind === 'unknown' && /^airbend\s+.+$/i.test(normalizeReminderStepRaw(step)))
    );
    if (!normalizedText.includes('airbend') || !hasAirbendLead) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantAirbendReminderStep(step));
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
  if (!step || (step.kind !== 'unknown' && step.kind !== 'add_counter' && step.kind !== 'grant_static_ability' && step.kind !== 'grant_temporary_ability')) return '';
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

function isRedundantArtifactTokenReminderParsedStep(step: OracleEffectStep): boolean {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)"â€\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return /^(?:search your library for a basic land card|put it onto the battlefield tapped|shuffle)$/i.test(normalized);
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
    const mentionsLanderToken = /\blander tokens?\b/i.test(normalizedAbilityText);
    const nextSteps = ability.steps.filter(step => {
      if (isRedundantArtifactTokenReminderUnknownStep(step)) return false;
      if ((hasSplitReminderLead || mentionsLanderToken) && isRedundantArtifactTokenReminderParsedStep(step)) return false;
      if (hasSplitReminderLead && isArtifactTokenReminderLeadUnknownStep(step)) return false;
      if (hasSplitReminderLead && isArtifactTokenReminderTailUnknownStep(step)) return false;
      if (mentionsJunkToken && step.kind === 'unknown' && /^you may play that card this turn$/i.test(normalizeUnknownStepText(step))) return false;
      if (
        mentionsJunkToken &&
        step.kind === 'grant_exile_permission' &&
        /^you may play that card this turn$/i.test(normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim())
      ) {
        return false;
      }
      return true;
    });
    return nextSteps.length === ability.steps.length ? [ability] : [{ ...ability, steps: nextSteps }];
  });
}

function isTokenDesignationStaticGrantStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_static_ability') return false;

  const effectText = Array.isArray((step as any).effectText) ? (step as any).effectText : [];
  return effectText.some((text) => normalizeOracleText(String(text || '')).trim().toLowerCase() === 'are tokens');
}

function isRedundantTokenDesignationReminderUnknownStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .trim();
  if (!normalized) return false;

  return (
    /^(?:they(?:'|â€™)re|they are) considered tokens for spells and abilities$/i.test(normalized) ||
    /^after a creature leaves the battlefield, it ceases to exist[.)]*$/i.test(normalized)
  );
}

export function pruneRedundantTokenDesignationReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some(isTokenDesignationStaticGrantStep)) return ability;

    const nextSteps = ability.steps.filter((step) => !isRedundantTokenDesignationReminderUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantEldraziTokenManaReminderUnknownStep(step: OracleEffectStep): boolean {
  const normalized = step.kind === 'unknown'
    ? normalizeUnknownStepText(step)
    : normalizeOracleText(String(step.raw || '')).replace(/^then\b\s*/i, '').trim();
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

function isDecayedGrantStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'grant_temporary_ability' && step.kind !== 'grant_static_ability') return false;
  const abilities = Array.isArray((step as any).abilities) ? (step as any).abilities : [];
  const effectText = Array.isArray((step as any).effectText) ? (step as any).effectText : [];
  return [...abilities, ...effectText, String((step as any).raw || '')].some((value) => /\bdecayed\b/i.test(String(value || '')));
}

export function pruneRedundantDecayedReminderUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (!ability.steps.some((step) => isDecayedTokenCreateStep(step) || isDecayedGrantStep(step))) return ability;

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

    if (/^saddle\s+\d+\s*\(/i.test(normalizedText) && /\bbecomes saddled\b/i.test(normalizedText)) {
      continue;
    }

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
      const originalText = String(ability.text || ability.effectText || '').trim();
      const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
        .replace(/\s+/g, ' ')
        .trim();

      const withoutCommanderEligibility = ability.steps.filter((step) => {
        if (step.kind !== 'unknown') return true;
        const normalizedStep = normalizeReminderStepRaw(step);
        return !/^.+\s+can be your commander[.)]*$/i.test(normalizedStep);
      });
      if (withoutCommanderEligibility.length !== ability.steps.length) {
        return withoutCommanderEligibility.length > 0 ? [{ ...ability, steps: withoutCommanderEligibility }] : [];
      }

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

      if (
        /^umbra armor(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
        /^whenever another creature enters, you may move a \+1\/\+1 counter from this creature onto it[.)]*$/i.test(normalizedText)
      ) {
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
          /^aggressive(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) ||
          (/^flanking(?:\s*\(.*\))?[.)]*$/i.test(normalizedText) && !/^[a-z]/.test(originalText)) ||
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
  const rawNormalizedText = normalizeOracleText(String(raw || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (/^[a-z0-9][a-z0-9\s'.,/&-]{0,80}\.{2,}\)?$/i.test(rawNormalizedText)) return true;
  const isParentheticalText = /^\(/.test(rawNormalizedText) || /\)$/.test(rawNormalizedText);
  const normalizedText = rawNormalizedText
    .replace(/^[()\s]+/, '')
    .replace(/[.)\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedText) return false;
  const normalizedModalHeader = normalizedText.replace(/\s*-\s*$/g, '').trim();

  return (
    /^as this saga enters and after your draw step, add a lore counter$/i.test(normalizedText) ||
    /^devoid \(this card has no color\)?$/i.test(normalizedText) ||
    /^gain the next level as a sorcery to add its ability$/i.test(normalizedText) ||
    /^offspring\s+(?:\{[^}]+\})+\s*\(you may pay an additional (?:\{[^}]+\})+ as you cast this spell$/i.test(normalizedText) ||
    /^enchant (?:creature(?: you control)?|land|player)$/i.test(normalizedText) ||
    /^ward\s*(?:\{[^}]+\}|\d+)$/i.test(normalizedText) ||
    /^ward\s*(?:-|-)\s*(?:discard|sacrifice|pay)\b.+$/i.test(normalizedText) ||
    /^a creature with hexproof can(?:not|'t) be the target of spells or abilities your opponents control$/i.test(normalizedText) ||
    /^you can(?:not|'t) be the target of spells or abilities your opponents control$/i.test(normalizedText) ||
    /^a permanent with protection can(?:not|'t) be targeted, dealt damage, or enchanted by anything with the stated quality$/i.test(normalizedText) ||
    /^a permanent with protection from everything can(?:not|'t) be targeted, dealt damage, or enchanted by anything$/i.test(normalizedText) ||
    /^commander enchantment\s*\(this aura enchants a commander creature, and remains attached to the creature as it moves between any face-up zones$/i.test(normalizedText) ||
    /^a suspected creature has menace and can(?:not|'t) block$/i.test(normalizedText) ||
    /^artifacts, legendaries, and sagas are historic$/i.test(normalizedText) ||
    /^assassins, mercenaries, pirates, rogues, and warlocks are outlaws$/i.test(normalizedText) ||
    /^each \{[wubrgc]\} in the mana costs of permanents you control counts toward your devotion to [a-z]+$/i.test(normalizedText) ||
    /^equipment, auras you control, and counters are modifications$/i.test(normalizedText) ||
    /^it(?:'|â€™)?s every creature type$/i.test(normalizedText) ||
    /^changeling \(this card is every creature type\)$/i.test(normalizedText) ||
    /^changeling$/i.test(normalizedText) ||
    /^to mill (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, put the top (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library into your graveyard$/i.test(normalizedText) ||
    /^you descended if a permanent card was put into your graveyard from anywhere$/i.test(normalizedText) ||
    /^you may put the top (?:a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library into your graveyard$/i.test(normalizedText) ||
    /^an exerted creature won(?:'|â€™)?t untap during your next untap step$/i.test(normalizedText) ||
    /^if a permanent with a stun counter would become untapped, remove one from it instead$/i.test(normalizedText) ||
    /^max speed is \d+$/i.test(normalizedText) ||
    /^note the mana value of the (?:revealed|noted) card$/i.test(normalizedText) ||
    /^reveal the card as you exile it$/i.test(normalizedText) ||
    /^damage causes loss of life$/i.test(normalizedText) ||
    /^damage dealt to creatures(?: by this creature)? also causes (?:that much )?loss of life$/i.test(normalizedText) ||
    /^damage dealt by it also causes you to gain that much life$/i.test(normalizedText) ||
    /^if you cast a spell this way, you still pay its costs$/i.test(normalizedText) ||
    /^you can play a land this way only if you have an available land play remaining$/i.test(normalizedText) ||
    /^if you cast this permanent this way, you can(?:'|â€™)?t play the other card$/i.test(normalizedText) ||
    /^you may discard .+ rather than pay this spell(?:'|â€™)?s mana cost$/i.test(normalizedText) ||
    /^if you discard a card with madness, discard it into exile$/i.test(normalizedText) ||
    /^you expend \d+ as you spend your .+ total mana to cast spells during a turn$/i.test(normalizedText) ||
    /^a\s+test\s+of\s+your\s+reflexes!?$/i.test(normalizedText) ||
    /^(?:activated\s+)?abilities\b.+\bcost\b.+\bto\s+activate(?:\s+unless\s+.+)?$/i.test(normalizedText) ||
    /^activated\s+abilities\s+cost\s+.+$/i.test(normalizedText) ||
    /^spend only black mana on x$/i.test(normalizedText) ||
    /^\{c\}\s+represents\s+colorless\s+mana$/i.test(normalizedText) ||
    /^a\s+player\s+with\s+ten\s+or\s+more\s+poison\s+counters\s+loses\s+the\s+game$/i.test(normalizedText) ||
    /^spend this mana only on costs that contain \{x\}$/i.test(normalizedText) ||
    /^spend this mana only to cast .+ spells?$/i.test(normalizedText) ||
    /^spend this mana only to cast .+ spell or activate an ability of .+ source$/i.test(normalizedText) ||
    /^the next time you would draw a card this turn, .+ instead$/i.test(normalizedText) ||
    /^(?:that player )?draws? an additional card$/i.test(normalizedText) ||
    /^spells you cast from exile this turn cost .+ less to cast(?:, where .+)?$/i.test(normalizedText) ||
    /^spend this mana only to cast spells? .+$/i.test(normalizedText) ||
    /^you may spend mana as though it were mana of any color to cast .+$/i.test(normalizedText) ||
    /^a deck can have only one card named .+$/i.test(normalizedText) ||
    /^you can(?:'|â€™)?t include this card in your deck if .+$/i.test(normalizedText) ||
    /^choose (?:(?:one|two|three|four|five)|one or both|one or more|two or more|up to (?:one|two|three|four|five)|x)(?: that hasn't been chosen)?$/i.test(normalizedModalHeader) ||
    /^choose (?:a )?player$/i.test(normalizedText) ||
    /^choose left or right$/i.test(normalizedText) ||
    /^an opponent chooses? (?:one|two) of (?:them|those cards)$/i.test(normalizedText) ||
    /^choose one at random$/i.test(normalizedText) ||
    /^choose one of them$/i.test(normalizedText) ||
    /^choose one of them at random$/i.test(normalizedText) ||
    /^then choose one of them$/i.test(normalizedText) ||
    /^you choose one of those cards$/i.test(normalizedText) ||
    /^for each (?:opponent|player),?\s+choose\b.+$/i.test(normalizedText) ||
    /^as this (?:artifact|creature|enchantment|permanent|land) enters, choose\b.+$/i.test(normalizedText) ||
    /^choose (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b.+$/i.test(normalizedText) ||
    /^then choose (?:up to )?(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b.+$/i.test(normalizedText) ||
    /^tiered\s*\(choose one additional cost\)?$/i.test(normalizedText) ||
    /^choose one additional cost$/i.test(normalizedText) ||
    /^kicker(?:\s*[\-:]\s*.+|\s+(?:\{[^}]+\})+)(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^strive\s*[\-:]\s*this spell costs .+ more to cast for each target beyond the first$/i.test(normalizedText) ||
    /^surge\s+(?:\{[^}]+\})+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^rampage\s+\d+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^unearth\s+only\s+as\s+a\s+sorcery$/i.test(normalizedText) ||
    /^buyback\s*[\-:]\s*sacrifice a land$/i.test(normalizedText) ||
    /^echo\s*[\-:]\s*discard a card$/i.test(normalizedText) ||
    /^emerge\s+(?:\{[^}]+\})+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^equip\s*[\-:]\s*(?:discard a card|sacrifice a creature)$/i.test(normalizedText) ||
    /^escalate\s+(?:\{[^}]+\})+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^as an additional cost to cast this spell, sacrifice a creature or$/i.test(normalizedText) ||
    /^as an additional cost to cast this spell, discard a card or$/i.test(normalizedText) ||
    /^you may pay \{[^}]+\} and return a basic land you control to its owner(?:'|â€™)?s hand rather than pay this spell(?:'|â€™)?s mana cost$/i.test(normalizedText) ||
    /^you may choose an additional mode if you control a commander$/i.test(normalizedText) ||
    /^you may choose the same mode more than once$/i.test(normalizedText) ||
    /^in turn order, each player may top the high bid$/i.test(normalizedText) ||
    /^the bidding ends if the high bid stands$/i.test(normalizedText) ||
    /^score one point for your team$/i.test(normalizedText) ||
    /^round(?:ed)? up(?: each time)?$/i.test(normalizedText) ||
    (
      isParentheticalText &&
      (
        /^look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library$/i.test(normalizedText) ||
        /^look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library, (?:you may put that card on the bottom|then put any number of them on the bottom(?: of your library)? and the rest on top in any order)$/i.test(normalizedText) ||
        /^to scry\s+[^,]+, look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library(?:, (?:you may put that card on the bottom|then put any number of them on the bottom(?: of your library)? and the rest on top in any order))?$/i.test(normalizedText) ||
        /^to surveil\s+[^,]+, look at the top (?:card|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x) cards?) of your library(?:, then put any number of them into your graveyard and the rest on top of your library in any order)?$/i.test(normalizedText) ||
        /^to manifest dread, look at the top two cards of your library$/i.test(normalizedText) ||
        /^put one of them onto the battlefield face down as a 2\/2 creature and the other into your graveyard$/i.test(normalizedText) ||
        /^(?:then\s+)?put any number of them on the bottom(?: of your library)? and the rest on top in any order$/i.test(normalizedText) ||
        /^you may put that card on the bottom$/i.test(normalizedText)
      )
    ) ||
    /^storm\s*\(when you cast this spell, copy it for each spell cast before it this turn$/i.test(normalizedText) ||
    /^conspire\s*\(as you cast this spell, you may tap two untapped creatures you control that share a color with it$/i.test(normalizedText) ||
    /^entwine\s+\{[^}]+\}\s+\(choose both if you pay the entwine cost\.?\)$/i.test(normalizedText) ||
    /^when you do, copy it and you may choose\s+(?:a new target|new targets)\s+for\s+the\s+copy$/i.test(normalizedText) ||
    /^when you cast (?:it|this spell), copy it for each spell cast before it this turn$/i.test(normalizedText) ||
    /^when you cast that saga, copy it for each time you paid its replicate cost$/i.test(normalizedText) ||
    /^you may choose\s+(?:a new target|new targets)\s+for\s+(?:the|that)\s+cop(?:y|ies)$/i.test(normalizedText) ||
    /^countering a copy of that spell won(?:'|â€™)?t counter the original spell$/i.test(normalizedText) ||
    /^ripple\s+\d+\s*\(when you cast this spell, you may reveal the top \w+ cards? of your library$/i.test(normalizedText) ||
    /^epic\s*\(for the rest of the game, you can(?:not|'t) cast spells$/i.test(normalizedText) ||
    /^if you do, add this card(?:'|â€™)?s effects to that spell$/i.test(normalizedText) ||
    /^(?:(?:a copy of a permanent spell)|(?:copies of .+ spells?)) becomes? (?:a )?tokens?(?: as (?:it|they) resolves?)?$/i.test(normalizedText) ||
    /^the cop(?:y|ies) become tokens? as (?:it|they) resolve$/i.test(normalizedText) ||
    /^exile all spells and abilities(?: from the stack)?(?:, including (?:this card|this spell))?$/i.test(normalizedText) ||
    /^the player whose turn it is discards down to their maximum hand size$/i.test(normalizedText) ||
    (
      isParentheticalText &&
      /^(?:at the beginning of your next upkeep,\s*)?(?:you may\s+)?(?:cast|play) (?:it|this card|the exiled card|that card) (?:from exile\s+)?without paying its mana cost$/i.test(normalizedText)
    ) ||
    /^(?:you may\s+)?cast it as a sorcery on a later turn without paying its mana cost$/i.test(normalizedText) ||
    /^if you control a commander, you may cast this spell without paying its mana cost$/i.test(normalizedText) ||
    /^if you do, you may cast the copy without paying its mana cost$/i.test(normalizedText) ||
    (
      isParentheticalText &&
      /^(?:until your next turn,\s*)?(?:it|that creature) attacks each combat if able and attacks a player other than you if able$/i.test(normalizedText)
    ) ||
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
    /^affinity for .+?(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^mentor(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^megamorph\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^plot\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^madness\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^spectacle\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^prowess(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^rebound\s*\(if you cast this spell from your hand, exile it as it resolves.*$/i.test(normalizedText) ||
    /^protection from .+\s*\(this (?:creature|permanent) can(?:not|'t) be blocked, targeted, dealt damage, enchanted, or equipped by .+\)?$/i.test(normalizedText) ||
    /^protection from .+$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce the cost to harmonize this card by \{\d+\}$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce that cost by \{x\}, where x is its power$/i.test(normalizedText) ||
    /^you may tap a creature you control to reduce that cost by an amount of generic mana equal to its power$/i.test(normalizedText) ||
    /^you may tap a creature you control to r$/i.test(normalizedText) ||
    /^you may cast a legendary sorcery only if you control a legendary creature or planeswalker$/i.test(normalizedText) ||
    /^and has the chosen base power and toughness$/i.test(normalizedText) ||
    /^formidable\s*-\s*activate only if creatures you control have total power \d+ or greater$/i.test(normalizedText) ||
    /^activate only if creatures you control have total power \d+ or greater$/i.test(normalizedText) ||
    /^activate only (?:during|as|if|before|after)\b.+$/i.test(normalizedText) ||
    /^activate only once(?: each turn)? and only if\b.+$/i.test(normalizedText) ||
    /^activate this ability only if\b.+$/i.test(normalizedText) ||
    /^activate only while\b.+$/i.test(normalizedText) ||
    /^activate only one\b.+$/i.test(normalizedText) ||
    /^cast this spell only (?:before|after)\b.+$/i.test(normalizedText) ||
    /^activate only once each turn$/i.test(normalizedText) ||
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
    /^(?:once during each of your turns,\s+)?you may cast .+ from your hand(?:\s+or the top of your library)? .+without paying (?:its|their) mana costs?$/i.test(normalizedText) ||
    /^(?:once during each of your turns,\s+)?you may cast .+ from your hand(?:\s+or the top of your library)? without paying (?:its|their) mana costs?$/i.test(normalizedText) ||
    /^if .+?,\s+you may cast this spell without paying its mana cost$/i.test(normalizedText) ||
    /^its owner may cast it as a sorcery on a later turn without paying its mana cost$/i.test(normalizedText) ||
    /^you may cast the copy without paying its mana cost(?:".*)?$/i.test(normalizedText) ||
    /^they(?:'|â€™)?re still lands$/i.test(normalizedText) ||
    /^turn it face up any time for its mana cost if it(?:'|â€™)?s a creature card$/i.test(normalizedText) ||
    /^damage wears off, and "this turn" and "until end of turn" effects end$/i.test(normalizedText) ||
    /^each mode must target a different player$/i.test(normalizedText) ||
    /^haunt\s*\(when this creature dies, exile it haunting target creature\)?$/i.test(normalizedText) ||
    /^haunt\s*\(when this spell card is put into a graveyard after resolving, exile it haunting target creature\)?$/i.test(normalizedText) ||
    /^it phases in before you untap during your next untap step$/i.test(normalizedText) ||
    /^it phases in before its controller untaps during their next untap step\)?$/i.test(normalizedText) ||
    /^treat phased-out permanents and anything attached to them as though they don(?:'|’)?t exist until their controller(?:'|’)?s next turn$/i.test(normalizedText) ||
    /^a creature destroyed this way can(?:not|'t) be regenerated$/i.test(normalizedText) ||
    /^casualty\s+\d+\s*\(as you cast this spell, you may sacrifice a creature with power \d+ or greater$/i.test(normalizedText) ||
    /^if life was paid, this planeswalker enters with two fewer loyalty counters$/i.test(normalizedText) ||
    /^if (?:they chose the same creature you chose|you do),\s*claim the prize!?$/i.test(normalizedText) ||
    /^claim the prize!?$/i.test(normalizedText) ||
    /^at the beginning of your end step, remove a time counter from it$/i.test(normalizedText) ||
    /^this ability triggers only once each turn\.?"?$/i.test(normalizedText) ||
    /^that many$/i.test(normalizedText) ||
    /^each opponent attacking that player does the same$/i.test(normalizedText) ||
    /^if it(?:'|â€™)?s a creature, it has haste\.?\)?$/i.test(normalizedText) ||
    /^if that(?:'|â€™)?s another creature, it gains the following abilities until end of turn\.?\)?$/i.test(normalizedText) ||
    /^if you do, it becomes plotted$/i.test(normalizedText) ||
    /^join forces\s+-\s+starting with you, each player may pay any amount of mana$/i.test(normalizedText) ||
    /^target opponent chooses a creature they control$/i.test(normalizedText) ||
    /^this effect reduces only the amount of colored mana you pay$/i.test(normalizedText) ||
    /^this mana can(?:not|'t) be spent to cast a nonartifact spell\.?"?\)?$/i.test(normalizedText) ||
    /^each artifact you tap after you(?:'|â€™)?re done activating mana abilities pays for \{1\}$/i.test(normalizedText) ||
    /^each copy targets a different one of those creatures$/i.test(normalizedText) ||
    /^enchanted creature has this permanent$/i.test(normalizedText) ||
    /^enchanted creature is 1\/1$/i.test(normalizedText) ||
    /^if it(?:'|â€™)?s a creature card, it can be turned face up any time for its mana cost\)?$/i.test(normalizedText) ||
    /^it has "?sacrifice this token:\s*add \{c\}\."?\s*\(\{c\} represents colorless mana\.?\)?$/i.test(normalizedText) ||
    /^it(?:'|â€™)?s an artifact with "?\{2\}, \{t\}, sacrifice this token: you gain 3 life\."?\)?$/i.test(normalizedText) ||
    /^put the rest of the cards on the bottom of your library in a random order$/i.test(normalizedText) ||
    /^put the revealed cards on the bottom of your library in any order$/i.test(normalizedText) ||
    /^equip only as a sorcery\.?\)?$/i.test(normalizedText) ||
    /^fading\s+\d+\s*\(this creature enters with \w+ fade counters on it$/i.test(normalizedText) ||
    /^freerunning\s+\{[^}]+\}(?:\{[^}]+\})*\s*\(you may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an assassin or commander\.?\)?$/i.test(normalizedText) ||
    /^reveal this card as you draft it and note how many cards you've drafted this draft round, including this card$/i.test(normalizedText) ||
    /^tapped unless .+$/i.test(normalizedText) ||
    /^this vehicle becomes an artifact creature$/i.test(normalizedText) ||
    /^spell commander\s*\(this card can be your commander$/i.test(normalizedText) ||
    /^you can cast it on a commander in your command zone\.?\)?$/i.test(normalizedText) ||
    /^tribute\s+\d+\s*\(as this creature enters, an opponent of your choice may put \w+ \+1\/\+1 counters on it\.?\)?$/i.test(normalizedText) ||
    /^undaunted\s*\(this spell costs \{1\} less to cast for each opponent\.?\)?$/i.test(normalizedText) ||
    /^if any creatures with banding a player controls are blocking or being blocked by a creature, that player divides that creature(?:'|â€™)?s combat damage, not its controller, among any of the creatures it(?:'|â€™)?s being blocked by or is blocking$/i.test(normalizedText) ||
    /^if chaos gets more votes or the vote is tied, chaos ensues$/i.test(normalizedText) ||
    /^in limited, it can partner like other monocolored legends$/i.test(normalizedText) ||
    /^it(?:'|â€™)?s an enchantment$/i.test(normalizedText) ||
    /^mana cost includes color$/i.test(normalizedText) ||
    /^provoke\s*\(whenever this creature attacks, you may have target creature defending player controls untap and block it if able\)?$/i.test(normalizedText) ||
    /^put the rest on the bottom of your library$/i.test(normalizedText) ||
    /^reveal this card as you draft it$/i.test(normalizedText) ||
    /^soulshift\s+\d+\s*\(when this creature dies, you may return target spirit card with mana value \d+ or less from your graveyard to your hand\)?$/i.test(normalizedText) ||
    /^tapped unless you control a legendary creature$/i.test(normalizedText) ||
    /^then ask a person outside the game to choose the creature that best fits the chosen criteria$/i.test(normalizedText) ||
    /^then those votes are revealed$/i.test(normalizedText) ||
    /^then you may pay any amount of \{E\}$/i.test(normalizedText) ||
    /^this ability costs \{1\} less to activate for each legendary creature you control$/i.test(normalizedText) ||
    /^this creature phases out$/i.test(normalizedText) ||
    /^this effect can(?:not|'t) reduce the mana in that cost to less than one mana$/i.test(normalizedText) ||
    /^when it dies or is exiled, return it to the battlefield tapped$/i.test(normalizedText) ||
    /^when you do$/i.test(normalizedText) ||
    /^while it(?:'|â€™)?s exiled, its owner may cast it for \{2\} rather than its mana cost$/i.test(normalizedText) ||
    /^you have ten seconds to (?:name something from the chosen category that starts with the same letter as the milled card|search your library and reveal a card with the chosen item in its art)$/i.test(normalizedText) ||
    /^\{TK\}\{TK\}\s*[-–—]\s*\d+\/\d+$/i.test(normalizedText) ||
    /^this vehicle becomes an artifact creature until end of turn$/i.test(normalizedText) ||
    /^echo\s+(?:\{[^}]+\})+\s*\(at the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost\)?$/i.test(normalizedText) ||
    /^awaken\s+\d+\s*-\s*(?:\{[^}]+\})+\s*\(if you cast this spell for .+$/i.test(normalizedText) ||
    /^bloodthirst\s+x\s*\(this creature enters with x \+1\/\+1 counters on it, where x is the damage dealt to your opponents this turn\.?\)?$/i.test(normalizedText) ||
    /^cascade,\s*cascade\s*\(when you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less$/i.test(normalizedText) ||
    /^cast it on a later turn for its foretell cost$/i.test(normalizedText) ||
    /^at the beginning of each of your upkeeps, copy this spell except for its epic ability$/i.test(normalizedText) ||
    /^eternalize only as a sorcery$/i.test(normalizedText) ||
    /^scavenge only as a sorcery$/i.test(normalizedText) ||
    /^fading\s+\d+\s*\(this enchantment enters with \w+ fade counters on it$/i.test(normalizedText) ||
    /^miracle\s+(?:\{[^}]+\})+\s*\(you may cast this card for its miracle cost when you draw it if it(?:'|â€™)?s the first card you drew this turn\.?\)?$/i.test(normalizedText) ||
    /^prowl\s+(?:\{[^}]+\})+\s*\(you may cast this for its prowl cost if you dealt combat damage to a player this turn with .+\.?\)?$/i.test(normalizedText) ||
    /^spectacle\s+(?:\{[^}]+\})+\s*\(you may cast this spell for its spectacle cost rather than its mana cost if an opponent lost life this turn\.?\)?$/i.test(normalizedText) ||
    /^poison tolerance \+\d+\s*\(it takes .+ additional poison counters? for you to lose the game to poison\.?\)?$/i.test(normalizedText) ||
    /^pledge\s*\(join a two-colored guild if you haven(?:'|â€™)?t already this game\.?\)?$/i.test(normalizedText) ||
    /^during the draft, you may turn this card face down$/i.test(normalizedText) ||
    /^as you draft a card, you may draft an additional card from that booster pack$/i.test(normalizedText) ||
    /^(?:open a magic booster pack|perhaps look up the list and roll a d20\?)$/i.test(normalizedText) ||
    /^round down each time$/i.test(normalizedText) ||
    /^sneak\s+(?:\{[^}]+\})+(?:\s*\([^)]*\))?$/i.test(normalizedText) ||
    /^sneak\s+(?:\{[^}]+\})+\s*\(you may cast this spell .+$/i.test(normalizedText) ||
    /^he enters tapped and attacking$/i.test(normalizedText) ||
    (isParentheticalText && /^(?:it|he) has haste$/i.test(normalizedText)) ||
    /^demonstrate\s*\(.*$/i.test(normalizedText) ||
    /^if you do, choose an opponent to also copy it$/i.test(normalizedText) ||
    /^players may choose new targets for their copies$/i.test(normalizedText) ||
    /^assist\s*\(.*$/i.test(normalizedText) ||
    /^that many plus one \+1\/\+1 counters are put on it$/i.test(normalizedText) ||
    /^it enters with (?:twice )?that many \+1\/\+1 counters on it$/i.test(normalizedText) ||
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

    if (/^conspire\s*\(as you cast this spell, you may tap two untapped creatures you control that share a color with it\./i.test(normalizedAbilityText)) {
      return [];
    }

    if (/^put\s+the\s+revealed\s+cards\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+any\s+order[.)]*$/i.test(normalizedAbilityText)) {
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

      if (/^20\s*\|\s*copy\s+that\s+spell\.\s+you\s+may\s+choose\s+new\s+targets\s+for\s+the\s+copy$/i.test(String(step.raw || '').trim())) {
        nextSteps.push({
          kind: 'grant_static_ability',
          target: parseObjectSelector('die result copy mode'),
          effectText: [String(step.raw || '').trim()],
          duration: 'static',
          raw: String(step.raw || '').trim(),
        } as OracleEffectStep);
        changed = true;
        continue;
      }

      if (isCurrentBatchReminderOrPlatformOnlyText(String(step.raw || ''))) {
        changed = true;
        continue;
      }

      if (/^if\s+you\s+do,\s+look\s+at\s+the\s+top\s+two\s+cards\s+of\s+your\s+library$/i.test(String(step.raw || '').trim())) {
        nextSteps.push({
          kind: 'conditional',
          condition: { kind: 'if', raw: 'you do' },
          steps: [{ kind: 'look_top', who: { kind: 'you' }, amount: { kind: 'number', value: 2 }, raw: 'look at the top two cards of your library' }],
          raw: String(step.raw || ''),
        } as OracleEffectStep);
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
    const originalText = String(ability.text || ability.effectText || '').trim();
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim();
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown');

    if (
      /^devour\s+\d+(?:\s+[^()]+)?\s*\(as this (?:creature|permanent) enters, you may sacrifice any number of creatures\.?[^)]*\)[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may reveal (?:a|an) .+? card from your hand\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^as this land enters, you may pay \d+ life\. if you don't, (?:this land|it) enters tapped[.)]*$/i.test(normalizedText) ||
      /^you have no maximum hand size(?: for the rest of the game)?[.)]*$/i.test(normalizedText) ||
      /^this spell can(?:not|'t) be countered(?:\. \(this includes by the ward ability\.\))?[.)]*$/i.test(normalizedText) ||
      /^put the revealed cards on the bottom of your library in any order$/i.test(normalizedText) ||
      /^crew\s+\d+\s*\(tap any number of creatures you control with total power \d+ or more:\s*this vehicle becomes an artifact creature until end of turn\. creatures can't be attached to other permanents\.\)$/i.test(normalizedText)
    ) {
      return [];
    }

    if (!isUnknownOnlyAbility) {
      return [ability];
    }

    if (/^(?:enchanted|equipped) creature has protection from .+$/i.test(normalizedText)) {
      return [ability];
    }

    if (/^[a-z]/.test(originalText) && /^flanking\b/i.test(normalizedText)) {
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
      /^you have no maximum hand size(?: for the rest of the game)?[.)]*$/i.test(normalizedText) ||
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

function parseRepeatedProliferateUnknownSteps(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return null;

  const clause = normalized.replace(/^then\b\s*/i, '').trim();
  const match = clause.match(/^proliferate\s+(twice|two\s+times|2\s+times)$/i);
  if (!match) return null;

  return [
    {
      kind: 'proliferate',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    },
    {
      kind: 'proliferate',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    },
  ];
}

export function expandRepeatedProliferateUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    if (ability.type === AbilityType.STATIC || ability.type === AbilityType.REPLACEMENT) {
      return ability;
    }

    let changed = false;
    const steps = ability.steps.flatMap((step) => {
      if (step.kind !== 'unknown') return [step];
      const expanded = parseRepeatedProliferateUnknownSteps(step);
      if (!expanded) return [step];
      changed = true;
      return [...expanded];
    });

    return changed ? { ...ability, steps } : ability;
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
  if (!step) return false;

  if (step.kind === 'conditional') {
    const normalized = normalizeOracleText(String(step.raw || ''))
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();
    return /^it becomes a creature again if it(?:'|â€™)?s not attached$/i.test(normalized);
  }

  if (step.kind !== 'unknown') return false;

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
    const alreadyExpanded = ability.steps.some(
      (step) => step.kind === 'search_library' && (step as any).criteria?.kind === 'same_mana_value_as_source'
    );
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

function uniqueLifeCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\b(?:gains?|loses?)\b[\s\S]*\blife\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const activatedBody = value.match(/:\s*([\s\S]*?\b(?:gains?|loses?)\b[\s\S]*\blife\b[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseLifeMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueLifeCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const triggerBody = normalized.clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    const body = triggerBody ? String(triggerBody[1] || '').trim() : normalized.clause;
    const andLife = body.match(/\band\s+((?:you|each player|each other player|each opponent|target player|target opponent|that player|that opponent)\s+(?:gains?|loses?)\s+.+?\s+life)$/i);
    for (const lifeBody of [body, andLife ? String(andLife[1] || '').trim() : '']) {
      if (!lifeBody) continue;
      const parsed = parseLifeTailStep(lifeBody);
      if (parsed?.kind === 'gain_life' || parsed?.kind === 'lose_life') return parsed;
    }
  }

  return null;
}

function hasLifeStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'gain_life' || step.kind === 'lose_life') return true;
    if (hasLifeStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasLifeStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasLifeStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function annotateLifeMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateLifeMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateLifeMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'create_token') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasLifeStepInTree(existingSteps)) return step;
    const rawParsed = parseLifeMetadataStep(step.raw);
    if (!rawParsed) return step;
    return { ...(step as any), steps: [...existingSteps, rawParsed] } as OracleEffectStep;
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasLifeStepInTree(existingSteps)) return step;
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    const metadataSteps = effectTexts
      .map((effectText) => parseLifeMetadataStep(effectText))
      .filter((parsed): parsed is OracleEffectStep => Boolean(parsed));
    const rawParsed = parseLifeMetadataStep(step.raw);
    if (rawParsed && !metadataSteps.some((parsed) => parsed.kind === rawParsed.kind && String((parsed as any).raw || '') === String((rawParsed as any).raw || ''))) {
      metadataSteps.push(rawParsed);
    }
    if (metadataSteps.length === 0) return step;
    return { ...(step as any), steps: [...existingSteps, ...metadataSteps] } as OracleEffectStep;
  }

  return step;
}

export function annotateLifeMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateLifeMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function uniqueDestroyCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\bdestroys?\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const activatedDestroyBody = value.match(/:\s*([\s\S]*?\bdestroys?\b[\s\S]*)$/i);
    if (activatedDestroyBody) addCandidate(String(activatedDestroyBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseDestroyMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueDestroyCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate);
    const triggerBody = normalized.clause.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    const body = triggerBody ? String(triggerBody[1] || '').trim() : normalized.clause;
    const parsed = tryParseZoneAndRemovalClause({
      clause: normalizeClauseForParse(body).clause,
      rawClause: body,
      withMeta: <T extends OracleEffectStep>(step: T): T => step,
    });
    if (parsed?.kind === 'destroy') return parsed;
  }

  return null;
}

function hasDestroyStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'destroy') return true;
    if (hasDestroyStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasDestroyStepInTree(mode?.steps)) return true;
      }
    }
  }
  return false;
}

function annotateDestroyMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateDestroyMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateDestroyMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability' || step.kind === 'unknown') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasDestroyStepInTree(existingSteps)) return step;
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    const metadataSteps = effectTexts
      .map((effectText) => parseDestroyMetadataStep(effectText))
      .filter((parsed): parsed is OracleEffectStep => Boolean(parsed));
    const rawParsed = parseDestroyMetadataStep(step.raw);
    const rawTarget = String(((rawParsed as any)?.target as any)?.text || '').replace(/[\s."”]+$/g, '').trim();
    if (rawParsed && !metadataSteps.some((parsed) => {
      const parsedTarget = String(((parsed as any).target as any)?.text || '').replace(/[\s."”]+$/g, '').trim();
      return parsed.kind === rawParsed.kind && parsedTarget === rawTarget;
    })) {
      metadataSteps.push(rawParsed);
    }
    if (metadataSteps.length === 0) return step;
    return { ...(step as any), steps: [...existingSteps, ...metadataSteps] } as OracleEffectStep;
  }

  return step;
}

export function annotateDestroyMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateDestroyMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function uniqueSacrificeCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''));
  const candidates: string[] = [];
  const addCandidate = (raw: string | undefined, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s(]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\bsacrifices?\b/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const unclosedGrantedTrigger = value.match(/\bgains?\b[\s\S]*"([^"]*\bsacrifices?\b[\s\S]*)$/i);
    if (unclosedGrantedTrigger) addCandidate(String(unclosedGrantedTrigger[1] || '').trim(), false);

    const activatedBody = value.match(/:\s*([\s\S]*?\bsacrifices?\b[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseSacrificeMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueSacrificeCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate).clause;
    const candidateBodies = [normalized];
    const triggerBody = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggerBody) candidateBodies.push(String(triggerBody[1] || '').trim());
    for (const body of [...candidateBodies]) {
      const conditionalBody = String(body || '').trim().match(/^if\s+.+?,\s+(.+)$/i);
      if (conditionalBody) candidateBodies.push(String(conditionalBody[1] || '').trim());
    }

    for (const body of candidateBodies) {
      const clause = normalizeClauseForParse(body).clause.replace(/[.)]+$/g, '').trim();
      if (!clause) continue;

      const scheduledSacrifice = clause.match(
        /^sacrifice\s+(.+?)\s+at\s+(?:the\s+beginning\s+of\s+)?(?:your\s+)?(?:the\s+)?(?:next\s+)?(?:end\s+step|end\s+of\s+combat|cleanup\s+step)(?:\s+if\s+.+)?$/i
      );
      const effectiveClause = scheduledSacrifice ? `sacrifice ${String(scheduledSacrifice[1] || '').trim()}` : clause;
      const parsed = tryParseZoneAndRemovalClause({
        clause: effectiveClause,
        rawClause: effectiveClause,
        withMeta: <T extends OracleEffectStep>(step: T): T => step,
      });
      if (parsed?.kind === 'sacrifice') return expandUnlessSacrificeStep(parsed);
    }
  }

  return null;
}

function uniqueCounterCandidates(rawText: string | undefined): string[] {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^[\s.)]+/, '')
    .replace(/[\s.)]+$/g, '')
    .trim();
  const candidates: string[] = [];

  const addCandidate = (raw: string, includeDerived = true): void => {
    const value = normalizeOracleText(String(raw || ''))
      .replace(/^[\s.)]+/, '')
      .replace(/[\s.)]+$/g, '')
      .trim();
    if (!value || !/\+1\/\+1\s+counters?/i.test(value)) return;
    if (!candidates.includes(value)) candidates.push(value);
    if (!includeDerived) return;

    const quoted = /"([^"]+)"/g;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = quoted.exec(value)) !== null) {
      addCandidate(String(quotedMatch[1] || '').trim(), false);
    }

    const unclosedGrant = value.match(/\b(?:has|have|gains?)\b[\s\S]*"([^"]*\+1\/\+1\s+counters?[\s\S]*)$/i);
    if (unclosedGrant) addCandidate(String(unclosedGrant[1] || '').trim(), false);

    const activatedBody = value.match(/:\s*([\s\S]*?\+1\/\+1\s+counters?[\s\S]*)$/i);
    if (activatedBody) addCandidate(String(activatedBody[1] || '').trim(), false);
  };

  addCandidate(normalized);
  return candidates;
}

function parseCounterMetadataStep(rawText: string | undefined): OracleEffectStep | null {
  for (const candidate of uniqueCounterCandidates(rawText)) {
    const normalized = normalizeClauseForParse(candidate).clause;
    const candidateBodies = [normalized];
    const triggerBody = normalized.match(/^(?:(?:when|whenever)\b.+?|at the beginning of\b.+?),\s+(.+)$/i);
    if (triggerBody) candidateBodies.push(String(triggerBody[1] || '').trim());

    for (const body of candidateBodies) {
      const clause = normalizeClauseForParse(body).clause.replace(/[.)]+$/g, '').trim();
      if (!clause) continue;
      const tail = clause.match(/\b((?:you|they|that player|each player)?\s*(?:may\s+)?put\s+[\s\S]*\+1\/\+1\s+counters?[\s\S]*)$/i);
      const parseCandidates = tail ? [clause, String(tail[1] || '').trim()] : [clause];

      for (const parseCandidate of parseCandidates) {
        const parsed = tryParseSimpleActionClause({
          clause: normalizeClauseForParse(parseCandidate).clause.replace(/[.)]+$/g, '').trim(),
          rawClause: parseCandidate,
          withMeta: <T extends OracleEffectStep>(step: T): T => step,
        });
        if (parsed?.kind === 'add_counter') return parsed;
      }
    }
  }

  return null;
}

function hasCounterStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'add_counter') return true;
    if ((step as any).withCounters?.['+1/+1'] || (step as any).castedPermanentEntersWithCounters?.['+1/+1']) return true;
    if (hasCounterStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasCounterStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasCounterStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function appendUniqueCounterMetadataSteps(
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

function shouldSkipCounterMetadataUnknown(raw: string): boolean {
  return /\b(?:monstrous|megamorph|renown|your choice of|spell costs?|can't have|remove x|for each \+1\/\+1 counter|one or more \+1\/\+1 counters would be put|twice that many|that many plus one|choose a creature with the least|turn it face up)\b/i.test(raw);
}

function annotateCounterMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateCounterMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateCounterMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateCounterMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'create_token') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (/\bto incubate\b/i.test(raw)) return step;
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasCounterStepInTree(existingSteps)) return step;
    const directCounterTail = raw.match(/\b(put\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)\s+.+?\s+counters?\s+on\s+this\s+token)\b/i);
    const parsed = directCounterTail
      ? parseSimpleCounterTailStep(String(directCounterTail[1] || '').trim())
      : parseCounterMetadataStep(raw);
    if (!parsed) return step;
    const steps = appendUniqueCounterMetadataSteps(existingSteps, [parsed]);
    return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as OracleEffectStep);
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability' || step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasCounterStepInTree(existingSteps)) return step;
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseCounterMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    if (step.kind === 'create_emblem') {
      for (const emblemAbility of step.abilities) {
        const parsed = parseCounterMetadataStep(emblemAbility);
        if (parsed) metadataSteps.push(parsed);
      }
    }
    const rawParsed = parseCounterMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueCounterMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'unknown') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (
      /\+1\/\+1\s+counters?/i.test(raw) &&
      !shouldSkipCounterMetadataUnknown(raw) &&
      (/\b(?:has|have|gains?|with)\b[\s\S]*"[\s\S]*\+1\/\+1\s+counters?/i.test(raw) || /\bput\b[\s\S]*\+1\/\+1\s+counters?/i.test(raw))
    ) {
      const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
      const parsed = parseCounterMetadataStep(raw);
      if (!parsed) return step;
      const steps = appendUniqueCounterMetadataSteps(existingSteps, [parsed]);
      return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as OracleEffectStep);
    }
  }

  return step;
}

export function annotateCounterMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateCounterMetadataOnStep);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function hasSacrificeStepInTree(steps: readonly OracleEffectStep[] | undefined): boolean {
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (step.kind === 'sacrifice') return true;
    if (hasSacrificeStepInTree((step as any).steps)) return true;
    if (Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        if (hasSacrificeStepInTree(mode?.steps)) return true;
      }
    }
    if (Array.isArray((step as any).results)) {
      for (const result of (step as any).results) {
        if (hasSacrificeStepInTree(result?.steps)) return true;
      }
    }
  }
  return false;
}

function appendUniqueSacrificeMetadataSteps(
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

function annotateSacrificeMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind === 'choose_mode') {
    const modes = step.modes.map((mode) => ({
      ...mode,
      steps: mode.steps.map(annotateSacrificeMetadataOnStep),
    }));
    return modes.some((mode, index) => mode.steps !== step.modes[index]?.steps) ? { ...step, modes } : step;
  }

  if (step.kind === 'die_roll_results') {
    const results = step.results.map((result) => ({
      ...result,
      steps: result.steps.map(annotateSacrificeMetadataOnStep),
    }));
    return results.some((result, index) => result.steps !== step.results[index]?.steps) ? { ...step, results } : step;
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    const steps = step.steps.map(annotateSacrificeMetadataOnStep);
    return steps !== step.steps ? { ...step, steps } : step;
  }

  if (step.kind === 'create_token') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (
      !step.atNextEndStep &&
      /at\s+the\s+beginning\s+of\s+(?:the\s+)?(?:next\s+)?end\s+step[,"]?\s*sacrifice\s+(?:this|that|the)?\s*(?:token|permanent|it)\b/i.test(raw)
    ) {
      return { ...step, atNextEndStep: 'sacrifice' };
    }
  }

  if (step.kind === 'grant_static_ability' || step.kind === 'grant_temporary_ability' || step.kind === 'create_emblem') {
    const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
    if (hasSacrificeStepInTree(existingSteps)) return step;
    const metadataSteps: OracleEffectStep[] = [];
    const effectTexts = Array.isArray((step as any).effectText) ? ((step as any).effectText as readonly string[]) : [];
    for (const effectText of effectTexts) {
      const parsed = parseSacrificeMetadataStep(effectText);
      if (parsed) metadataSteps.push(parsed);
    }
    if (step.kind === 'create_emblem') {
      for (const emblemAbility of step.abilities) {
        const parsed = parseSacrificeMetadataStep(emblemAbility);
        if (parsed) metadataSteps.push(parsed);
      }
    }
    const rawParsed = parseSacrificeMetadataStep(step.raw);
    if (rawParsed) metadataSteps.push(rawParsed);
    if (metadataSteps.length === 0) return step;
    const steps = appendUniqueSacrificeMetadataSteps(existingSteps, metadataSteps);
    return steps.length === existingSteps.length ? step : { ...step, steps };
  }

  if (step.kind === 'unknown') {
    const raw = normalizeOracleText(String(step.raw || ''));
    if (/\bgains?\b[\s\S]*"[\s\S]*\bwhen\b[\s\S]*\bsacrifices?\b/i.test(raw) && !/\b(?:casualty|devour|echo|vanishing|champion)\b/i.test(raw)) {
      const existingSteps = Array.isArray((step as any).steps) ? [...((step as any).steps as OracleEffectStep[])] : [];
      const parsed = parseSacrificeMetadataStep(raw);
      if (!parsed) return step;
      const steps = appendUniqueSacrificeMetadataSteps(existingSteps, [parsed]);
      return steps.length === existingSteps.length ? step : ({ ...(step as any), steps } as OracleEffectStep);
    }
  }

  return step;
}

export function annotateSacrificeMetadataAbilities(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = ability.steps.map(annotateSacrificeMetadataOnStep);
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

    const metadataWrapper = {
      kind: 'grant_static_ability',
      target: parseObjectSelector('damage metadata'),
      effectText: ['damage metadata'],
      duration: 'static',
      raw: 'Damage metadata',
      steps: [parsed],
    } as any as OracleEffectStep;
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
        next
      ) {
        const normalizedNext = normalizeOracleText(String(next.raw || '')).trim();
        const castThisWayMatch = normalizedNext.match(
          /^if you cast a spell this way, that creature enters with (?:a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i
        );
        const conditionalCounter = next.kind === 'conditional' && /^you cast a spell this way$/i.test(String(next.condition.raw || '').trim())
          ? counterRecordFromAddCounterStep(next.steps[0])
          : null;
        if (castThisWayMatch || conditionalCounter) {
          const counterName = conditionalCounter
            ? Object.keys(conditionalCounter)[0]
            : next.kind === 'add_counter'
              ? normalizeCounterName(String(next.counter || '').trim())
              : normalizeCounterName(String(castThisWayMatch?.[1] || '').trim());
          const counterAmount = conditionalCounter ? Number(conditionalCounter[counterName] || 0) : 1;
          merged.push({
            ...current,
            castedPermanentEntersWithCounters: {
              [counterName]: counterAmount,
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
    .replace(/[.;)\s]+$/g, '')
    .trim();
  if (!body) return { body: '', allowNewTargets: false };

  let allowNewTargets = false;
  const nextBody = body
    .replace(
      /(?:\.\s*|,?\s+and\s+)(?:(?:you|they|that player|the player|its controller|that spell's controller|that spell’s controller)\s+)?may choose\s+(?:a new target|new targets)\s+for\s+(?:the|that|their)\s+cop(?:y|ies)(?:\s+they\s+control)?$/i,
      () => {
        allowNewTargets = true;
        return '';
      }
    )
    .trim();

  body = nextBody || body;
  return {
    body: body.replace(/[.;)\s]+$/g, '').trim(),
    allowNewTargets,
  };
}

function parseCopySpellRetargetTail(step: OracleEffectStep | undefined): string | null {
  const normalized = normalizeUnknownStepText(step);
  if (!normalized) return null;
  return /^(?:(?:you|they|that player|the player|its controller|that spell's controller|that spell’s controller)\s+)?may choose\s+(?:a new target|new targets)\s+for\s+(?:the|that|their)\s+cop(?:y|ies)(?:\s+they\s+control)?$/i.test(normalized.replace(/[.)\s]+$/g, '').trim())
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

  if (/^cast the copies if able without paying their mana costs$/i.test(normalizedTail)) {
    return {
      raw: String((step as any)?.raw || '').trim() || normalizedTail,
      withoutPayingManaCost: true,
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

  const leadingCopyClause = normalized.match(/^.+?,\s*(copy\s+(?:that\s+spell|the\s+spell|target\s+.+|all\s+other\s+.+|each\s+of\s+those\s+spells?.*))$/i);
  if (leadingCopyClause && /\b(?:spell|ability|abilities)\b/i.test(String(leadingCopyClause[1] || ''))) {
    return parseCopySpellUnknownStep({ ...step, raw: String(leadingCopyClause[1] || '').trim() }, nextStep);
  }

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
        const nestedSteps = nestedStep.kind === 'copy_spell' && allowNewTargets
          ? [{ ...nestedStep, allowNewTargets: true }]
          : [nestedStep];
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: String(conditionalMatch[1] || '').trim() },
          steps: nestedSteps,
          ...(step.sequence ? { sequence: step.sequence } : {}),
          raw: appendFollowupSentence(normalized, rawRetargetTail),
        };
      }
    }
  }

  {
    const conditionalMatch = normalized.match(/^if\s+(.+?),\s+(.+)$/i);
    if (conditionalMatch) {
      const nestedRaw = String(conditionalMatch[2] || '').trim();
      const nestedStep = parseCopySpellUnknownStep(
        {
          ...step,
          raw: nestedRaw,
          optional: Boolean(step.optional) || /\bmay\b/i.test(nestedRaw),
        },
        nextStep
      );
      if (nestedStep) {
        const nestedSteps = nestedStep.kind === 'copy_spell' && allowNewTargets
          ? [{ ...nestedStep, allowNewTargets: true }]
          : [nestedStep];
        return {
          kind: 'conditional',
          condition: { kind: 'if', raw: String(conditionalMatch[1] || '').trim() },
          steps: nestedSteps,
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

  if (/^(?:you|they|that player|the player)?\s*may\s+copy\s+this\s+spell$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThisSpellMatch = normalized.match(/^copy this spell(?:(?:\s+(twice))|(?:\s+(\d+|x)\s+times))?(?: except for its epic ability)?$/i);
  if (copyThisSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      ...(copyThisSpellMatch[1]
        ? { copies: { kind: 'number', value: 2 } as const }
        : copyThisSpellMatch[2]
          ? { copies: /^\d+$/.test(String(copyThisSpellMatch[2] || '')) ? { kind: 'number', value: Number.parseInt(String(copyThisSpellMatch[2] || ''), 10) } as const : { kind: 'reference_amount', raw: 'x' } as const }
          : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyItForEachCommanderCastMatch = normalized.match(/^copy\s+it\s+for\s+each\s+time\s+you(?:'|â€™)?ve\s+cast\s+your\s+commander\s+from\s+the\s+command\s+zone\s+this\s+game$/i);
  if (copyItForEachCommanderCastMatch) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'reference_amount', raw: "for each time you've cast your commander from the command zone this game" },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellOrAbilityEitherMatch = normalized.match(/^(?:if you do,\s*)?(?:(?:you|they|that player|the player|each opponent|each player|up to one target opponent)\s+may\s+(?:also\s+)?)?copy that spell or ability(?:\s+(twice)|\s+(\d+|x)\s+times)?$/i);
  if (copyThatSpellOrAbilityEitherMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that spell or ability' },
      ...(copyThatSpellOrAbilityEitherMatch[1]
        ? { copies: { kind: 'number', value: 2 } as const }
        : copyThatSpellOrAbilityEitherMatch[2]
          ? { copies: /^\d+$/.test(String(copyThatSpellOrAbilityEitherMatch[2] || '')) ? { kind: 'number', value: Number.parseInt(String(copyThatSpellOrAbilityEitherMatch[2] || ''), 10) } as const : { kind: 'reference_amount', raw: 'x' } as const }
          : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellOrAbility = normalized.match(/^(?:if you do,\s*)?copy that (spell|ability)(?:\s+(twice))?$/i);
  if (copyThatSpellOrAbility) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: `that ${String(copyThatSpellOrAbility[1] || '').trim()}` },
      ...(copyThatSpellOrAbility[2] ? { copies: { kind: 'number', value: 2 } as const } : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyItForEachPreviousSpellMatch = normalized.match(
    /^copy it for each (?:other )?(instant and sorcery spell|spell) (?:you(?:'ve| have) )?cast before it this turn$/i
  );
  if (copyItForEachPreviousSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'it' },
      copies: { kind: 'spells_cast_before_this_turn' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyAllAbilitiesMatch = normalized.match(/^copy\s+(all\s+other\s+activated\s+and\s+triggered\s+abilities\s+you\s+control|that\s+ability|target\s+activated\s+or\s+triggered\s+ability.+|that\s+spell,\s+except\s+.+)$/i);
  if (copyAllAbilitiesMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: String(copyAllAbilitiesMatch[1] || '').trim() },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyEachThoseSpellsMatch = normalized.match(/^(?:if\s+.+?,\s*)?copy each of those spells(?:\s+(twice|\d+|x)\s+times?)?$/i);
  if (copyEachThoseSpellsMatch) {
    const rawCount = String(copyEachThoseSpellsMatch[1] || '').trim().toLowerCase();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'each of those spells' },
      ...(rawCount
        ? { copies: rawCount === 'twice' ? { kind: 'number', value: 2 } as const : /^\d+$/.test(rawCount) ? { kind: 'number', value: Number.parseInt(rawCount, 10) } as const : { kind: 'reference_amount', raw: rawCount } as const }
        : {}),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^for each .+? exiled this way,\s*copy it$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^for each card exiled this way,\s*copy it,\s*and you may cast the copy without paying its mana cost$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'last_moved_card',
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellTimesMatch = normalized.match(/^copy that spell\s+(twice|\d+|x)\s+times?(?:\s+instead)?$/i);
  if (copyThatSpellTimesMatch) {
    const rawCount = String(copyThatSpellTimesMatch[1] || '').trim().toLowerCase();
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that spell' },
      copies: rawCount === 'twice'
        ? { kind: 'number', value: 2 }
        : /^\d+$/.test(rawCount)
          ? { kind: 'number', value: Number.parseInt(rawCount, 10) }
          : { kind: 'reference_amount', raw: rawCount },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyNextSpellMatch = normalized.match(/^(?:until end of turn,\s*)?copy the next ((?:.+?\s+)?spell(?:\s+with\s+mana\s+value\s+[^\s]+\s+or\s+less)?) you cast this turn when you cast it$/i);
  if (copyNextSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: `next ${String(copyNextSpellMatch[1] || '').trim()} you cast this turn` },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyThatSpellForEachMatch = normalized.match(/^copy (that|the) (spell|ability|spell or ability) for each (.+)$/i);
  if (copyThatSpellForEachMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: `${String(copyThatSpellForEachMatch[1] || '').trim()} ${String(copyThatSpellForEachMatch[2] || '').trim()}` },
      copies: parseQuantity(`for each ${String(copyThatSpellForEachMatch[3] || '').trim()}`),
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^copy all spells you control$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'all spells you control' },
      copies: { kind: 'all' },
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

  if (/^(?:(?:you|they|that player|the player|each opponent|each other player|up to one target opponent)\s+may\s+(?:also\s+)?)?copy (?:that spell|the spell|it)$/i.test(normalized)) {
    const targetText = /the spell/i.test(normalized) ? 'the spell' : /that spell/i.test(normalized) ? 'that spell' : 'it';
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

  const copyAnyNumberTargetSpellsMatch = normalized.match(/^(?:you may\s+)?copy\s+any\s+number\s+of\s+(target\s+.+?\s+spells?)$/i);
  if (copyAnyNumberTargetSpellsMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: parseObjectSelector(String(copyAnyNumberTargetSpellsMatch[1] || '').trim()),
      copies: { kind: 'any_number' },
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

  if (/^(?:the token\s+)?copies\s+that\s+ability$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that ability' },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  const copyDescribedSpellMatch = normalized.match(/^(?:you may\s+)?copy\s+(the\s+spell\s+that\s+.+)$/i);
  if (copyDescribedSpellMatch) {
    return {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: String(copyDescribedSpellMatch[1] || '').trim() },
      ...(allowNewTargets ? { allowNewTargets: true } : {}),
      ...(optional ? { optional: true } : {}),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: appendFollowupSentence(normalized, rawRetargetTail),
    };
  }

  if (/^(?:you may\s+)?copy\s+each\s+card\s+exiled\s+with\s+.+$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'linked_exiled_cards',
      copies: { kind: 'all' },
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

  const targetedSpellMatch = normalized.match(/^(?:you may\s+)?copy\s+(target(?:\s+.+?)?\s+spells?(?:\s+.+)?)$/i);
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

  const targetedStackObjectMatch = normalized.match(/^(?:you may\s+)?copy\s+(target\s+.+)$/i);
  if (targetedStackObjectMatch && /\b(?:spell|ability|abilities)\b/i.test(String(targetedStackObjectMatch[1] || ''))) {
    const targetText = String(targetedStackObjectMatch[1] || '').trim();
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

  const selfDamageRemoveCounterMatch = normalized.match(
    /^if damage would be dealt to (.+?) while it has (?:a|an|one or more|\d+|[a-z]+) (.+?) counters? on it, prevent that damage and remove (a|an|one|\d+|[a-z]+) (.+?) counters? from (.+)$/i
  );
  if (selfDamageRemoveCounterMatch) {
    const recipientText = String(selfDamageRemoveCounterMatch[1] || '').trim();
    const removeAmountText = String(selfDamageRemoveCounterMatch[3] || '').trim();
    const removeCounterText = String(selfDamageRemoveCounterMatch[4] || '').trim();
    const removeTargetText = String(selfDamageRemoveCounterMatch[5] || '').trim();
    return {
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: `damage would be dealt to ${recipientText} while it has ${String(selfDamageRemoveCounterMatch[2] || '').trim()} counters on it`,
      },
      steps: [
        {
          kind: 'prevent_damage',
          amount: 'all',
          recipientTarget: parseObjectSelector(recipientText),
          duration: 'this_turn',
          raw: 'prevent that damage',
        },
        {
          kind: 'remove_counter',
          amount: parseQuantity(removeAmountText),
          counter: normalizeCounterName(removeCounterText),
          target: parseObjectSelector(removeTargetText),
          raw: `remove ${removeAmountText} ${removeCounterText} counter from ${removeTargetText}`,
        },
      ],
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
    /^mayhem\b.*?you may (cast|play) this card from your graveyard(?:\s+for\s+(?:\{[^}]+\})+)?(?:\s+if\s+(.+?))?[.)]*$/i
  );
  if (mayhemSelfMatch) {
    const permissionStep: OracleEffectStep = {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: String(mayhemSelfMatch[1] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
      what: { kind: 'raw', text: 'this card' },
      duration: 'during_resolution',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
    const conditionText = String(mayhemSelfMatch[2] || '').trim();
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

  const duringYourTurnPermissionMatch = normalized.match(
    /^during your turn,\s+you may\s+(cast|play)\s+(.+?)\s+from\s+your\s+graveyard(?:\s+(.+))?$/i
  );
  if (duringYourTurnPermissionMatch) {
    const trailingText = String(duringYourTurnPermissionMatch[3] || '')
      .trim()
      .replace(
        /^by\b.*\s+in addition to (?:their|its|that card's|that spell's|those cards'|those spells') other costs\b/i,
        ''
      )
      .replace(/[.)]\s*$/g, '')
      .trim();
    const permissionStep: OracleEffectStep = {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: String(duringYourTurnPermissionMatch[1] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
      what: parseObjectSelector(String(duringYourTurnPermissionMatch[2] || '').trim()),
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

  const leadingDurationSelfPermissionMatch = normalized.match(
    /^until\s+end\s+of\s+turn,\s+you\s+may\s+(cast|play)\s+(.+?)\s+from\s+your\s+graveyard(?:\s+(.+))?$/i
  );
  if (leadingDurationSelfPermissionMatch) {
    const trailingText = String(leadingDurationSelfPermissionMatch[3] || '')
      .trim()
      .replace(
        /^by\b.*\s+in addition to paying (?:its|their|that card's|that spell's|those cards'|those spells') other costs\b/i,
        ''
      )
      .replace(/^without paying (?:its|their) mana cost$/i, '')
      .replace(/[.)]\s*$/g, '')
      .trim();
    return {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: String(leadingDurationSelfPermissionMatch[1] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
      what: parseObjectSelector(String(leadingDurationSelfPermissionMatch[2] || '').trim()),
      duration: trailingText ? parseGraveyardPermissionDuration(trailingText) : 'this_turn',
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    } as OracleEffectStep;
  }

  const match = normalized.match(
    /^(.+?)\s+may\s+(cast|play)\s+(.+?)\s+from\s+(your|their|his or her|its owner's|its controller's|an opponent's|that player's|target opponent's)\s+graveyard(?:\s+(.+))?$/i
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
      if (step.kind === 'grant_static_ability') {
        const targetText = normalizeOracleText(String((step.target as any)?.text || '')).replace(/\s+/g, ' ').trim();
        const effectText = (step.effectText || [])
          .map((entry) => normalizeOracleText(String(entry || '')).replace(/\s+/g, ' ').trim().toLowerCase())
          .filter(Boolean)
          .join(' ');
        if (/\bgraveyard\b/i.test(targetText) && /^(?:flashback|escape|retrace|jump-start|harmonize)$/.test(effectText)) {
          const expanded = parseGraveyardPermissionUnknownStep({
            kind: 'unknown',
            raw: step.raw,
            ...(step.sequence ? { sequence: step.sequence } : {}),
          } as Extract<OracleEffectStep, { kind: 'unknown' }>);
          if (expanded) {
            changed = true;
            return [expanded];
          }
        }
      }
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

  const buildAmassSteps = (
    amassLead: { amountText: string; amount: OracleQuantity; subtype: string },
    sequence?: 'then'
  ): OracleEffectStep[] => [
    {
      kind: 'conditional',
      condition: { kind: 'if', raw: "you don't control an Army creature" },
      steps: [
        {
          kind: 'create_token',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 1 },
          token: `0/0 black ${amassLead.subtype} Army`,
          raw: `create a 0/0 black ${amassLead.subtype} Army creature token`,
        },
      ],
      ...(sequence ? { sequence } : {}),
      raw: `If you don't control an Army creature, create a 0/0 black ${amassLead.subtype} Army creature token`,
    } as OracleEffectStep,
    {
      kind: 'add_counter',
      amount: amassLead.amount,
      counter: '+1/+1',
      target: { kind: 'raw', text: 'Army creature you control' },
      raw: `Put ${amassLead.amountText} +1/+1 counter${amassLead.amountText === '1' ? '' : 's'} on an Army creature you control`,
    } as OracleEffectStep,
    {
      kind: 'add_types',
      target: { kind: 'raw', text: 'Army creature you control' },
      addTypes: [amassLead.subtype],
      raw:
        `If it isn't ${getTypeArticle(amassLead.subtype)} ${amassLead.subtype}, ` +
        `it becomes ${getTypeArticle(amassLead.subtype)} ${amassLead.subtype} in addition to its other types`,
    } as OracleEffectStep,
  ];

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

  const parseAmassSubtypeConditional = (step: OracleEffectStep | undefined): string | null => {
    if (!step || step.kind !== 'conditional') return null;

    const conditionMatch = normalizeOracleText(String(step.condition?.raw || '')).match(
      /^it isn't (?:a|an) ([a-z][a-z' -]*)$/i
    );
    if (!conditionMatch || step.steps.length !== 1 || step.steps[0]?.kind !== 'grant_static_ability') return null;

    const subtype = singularizeAmassSubtype(String(conditionMatch[1] || '').trim());
    const effectText = (step.steps[0].effectText || [])
      .map((entry) => normalizeOracleText(String(entry || '')).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    const subtypePattern = subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^becomes (?:a|an) ${subtypePattern} in addition to its other types$`, 'i').test(effectText)) {
      return null;
    }

    return subtype;
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
    const parsedSubtypeConditional = parseAmassSubtypeConditional(addCounterStep);

    if (
      isAmassCreateConditional &&
      chooseStep?.kind === 'add_counter' &&
      chooseStep.target.kind === 'raw' &&
      normalizeOracleText(String(chooseStep.target.text || '')).toLowerCase() === 'army creature you control' &&
      parsedSubtypeConditional
    ) {
      changed = true;
      nextSteps.push(current);
      nextSteps.push(chooseStep);
      nextSteps.push({
        kind: 'add_types',
        target: { kind: 'raw', text: 'Army creature you control' },
        addTypes: [parsedSubtypeConditional],
        ...(addCounterStep.sequence ? { sequence: addCounterStep.sequence } : {}),
        raw: addCounterStep.raw,
      });
      index += 2;
      continue;
    }

    if (amassLead && isSplitAmassCounterReminder(chooseStep) && splitAmassSubtype && splitAmassCreateConditional) {
      changed = true;
      index += 3;
      nextSteps.push(...buildAmassSteps({ ...amassLead, subtype: splitAmassSubtype }, current.sequence));
      continue;
    }

    if (amassLead) {
      changed = true;
      nextSteps.push(...buildAmassSteps(amassLead, current.sequence));
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
  const normalizedAbilityText = normalizeOracleText(String(ability.text || ability.effectText || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const hasLoweredAmass = ability.steps.some(
    (candidate) => candidate.kind === 'add_counter' && /army creature you control/i.test(String((candidate.target as any)?.text || ''))
  );

  if (step.kind === 'conditional') {
    const normalizedCondition = normalizeOracleText(String(step.condition?.raw || '')).trim().toLowerCase();
    return hasLoweredAmass && normalizedCondition === "you don't control an army";
  }

  if (step.kind !== 'unknown') return false;

  const normalizedStep = normalizeReminderStepRaw(step);
  if (/^(?:to\s+)?amass(?:\s+[a-z][a-z' -]*)?\s+(?:\d+|x),\s*put\s+(?:\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)\s+\+1\/\+1\s+counters?\s+on\s+an\s+army\s+you\s+control$/i.test(normalizedStep)) {
    return hasLoweredAmass || normalizedAbilityText.includes('amass');
  }
  if (!/^it(?:'|’)?s also (?:a|an) [a-z][a-z' -]*$/i.test(normalizedStep)) {
    return false;
  }
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
  const normalizedAmountText = String(amountText || '').trim();
  const displayAmountText = /^x$/i.test(normalizedAmountText) ? 'X' : normalizedAmountText;
  const quantityText = /^that spell(?:'|’)?s mana value$/i.test(normalizedAmountText)
    ? "that spell's mana value"
    : displayAmountText;

  return [
    {
      kind: 'impulse_exile_top',
      who: { kind: 'you' },
      amount: parseQuantity(`until you exile a nonland card with mana value ${quantityText} or less`),
      duration: 'during_resolution',
      permission: 'cast',
      ...(sequence ? { sequence } : {}),
      raw:
        `Exile cards from the top of your library until you exile a nonland card with mana value ${displayAmountText} or less. ` +
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
  const match = normalized.match(/^(?:you\s+)?discover\s+(\d+|x)(?:,\s*where\s+x\s+is\s+that\s+spell(?:'|’)?s\s+mana\s+value)?$/i);
  if (!match) return null;
  return /where\s+x\s+is\s+that\s+spell/i.test(normalized)
    ? "that spell's mana value"
    : String(match[1] || '').trim();
}

function isDiscoverReminderTailUnknownStep(step: OracleEffectStep): boolean {
  if (!step) return false;

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
    const isUnknownOnlyAbility = ability.steps.length > 0 && ability.steps.every((step) => step.kind === 'unknown' || isDiscoverReminderTailUnknownStep(step));
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

  const airbendMatch = normalized.match(/^airbend\s+(.+)$/i);
  if (airbendMatch) {
    return {
      kind: 'airbend',
      target: parseObjectSelector(String(airbendMatch[1] || '').trim()),
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
  if (ability.type !== 'activated') return false;

  if (step.kind === 'add_counter') {
    const targetText = String((step.target as any)?.text || '').trim();
    const amount = step.amount as any;
    return /^this spacecraft$/i.test(targetText) &&
      String(step.counter || '').toLowerCase() === 'charge' &&
      amount?.kind === 'object_stat' &&
      amount?.subject === 'it' &&
      amount?.stat === 'power' &&
      ability.steps.some(candidate => isStationThresholdReminderUnknownStep(candidate));
  }

  if (step.kind !== 'unknown') return false;

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
    /^(?:(you)\s+may\s+)?attach\s+((?:this aura|this enchantment|this equipment|this permanent|it|them|that equipment|target (?:aura|equipment|aura or equipment|equipment or aura)(?:\s+you control)?(?:\s+with\s+mana\s+value\s+.+?)?|any number of (?:(?:auras and equipment)|equipment|auras) you control))\s+to\s+(target (?:legendary\s+)?(?:creature|land|permanent|player|permanent or player)(?: (?:you control|an opponent controls|you don(?:'|â€™)?t control|you do not control))?|another creature|this creature|this permanent|that creature|that land|it)$/i
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
  const normalized = normalizeOracleText(rawClause).replace(/^•\s*/, '').trim();
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
