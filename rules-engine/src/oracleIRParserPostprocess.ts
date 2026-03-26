import type {
  OracleClauseCondition,
  OracleEffectStep,
  OracleGraveyardAdditionalCost,
  OracleIRAbility,
} from './oracleIR';
import { AbilityType } from './oracleTextParser';
import {
  inferZoneFromDestination,
  normalizeCounterName,
  normalizeLeadingConditionalCondition,
} from './oracleIRParserSacrificeHelpers';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { tryParseTemporaryModifyPtClause } from './oracleIRParserModifyPtClauses';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
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
    .replace(/,?\s+without paying (?:its|their|that spell(?:'|â€™)s|those spells(?:'|â€™)) mana costs?\b/gi, '')
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!clause) return null;
  const lower = clause.toLowerCase();

  const exiledWithSourceRef =
    "(?:the )?(?:cards?|spells?) exiled with (?:this (?:creature|artifact|enchantment|planeswalker|permanent|class|saga)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',â€™]+)";

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

  let clause = normalized
    .trim()
    .replace(/^then\b\s*/i, '')
    .replace(/[,.;]\s*$/g, '')
    .trim();

  if (!clause) return null;

  clause = clause
    .replace(/^(they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['â€™]s (?:controller|owner)) (?:may|can)\b/i, 'You may')
    .replace(/^((?:until|through)\b[^,]*,),\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['â€™]s (?:controller|owner)) (?:may|can)\b/i, '$1 you may')
    .replace(/^(during your next turn,?)\s*(?:they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*['â€™]s (?:controller|owner)) (?:may|can)\b/i, '$1 you may');

  clause = clause.replace(/^((?:until|through)\b.*?)(?:,\s*|\s+)you (?:may|can)\s+(play|cast)\s+(.+)$/i, 'You may $2 $3 $1');

  clause = clause
    .replace(/,?\s+without paying (?:its|their|that spell(?:'|â€™)s|those spells(?:'|â€™)) mana costs?\b/gi, '')
    .replace(
      /,?\s+by paying\b.*\s+rather than paying (?:its|their|that spell(?:'|â€™)s|those spells(?:'|â€™)) mana costs?\.?\s*$/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();

  const lower = clause.toLowerCase();
  const permissionSubject =
    '(?:you|they|that player|that opponent|defending player|the defending player|he or she|its controller|its owner|that [a-z0-9][a-z0-9 -]*[\'â€™]s (?:controller|owner))';
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

function mergeBattlefieldEntryAuraRewriteFollowups(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const merged: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const current = steps[i];
    const next = steps[i + 1];

    if (next?.kind === 'unknown') {
      const parsed = parseBattlefieldEntryAuraRewriteFollowup(next.raw);
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
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const current = ability.steps[i];
      const next = ability.steps[i + 1];

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

  const parseSingleClause = (rawClause: string): readonly OracleEffectStep[] | null => {
    const clause = String(rawClause || '').trim();
    if (!clause) return null;

    const moveWithAttach = parseMoveZoneWithAttachFollowup(clause);
    if (moveWithAttach && moveWithAttach.length > 0) return [...moveWithAttach];

    const singleStep =
      parseExilePermissionModifierUnknownStep({ ...step, raw: clause }) ??
      parseCopySpellUnknownStep({ ...step, raw: clause }) ??
      parseReturnFromYourGraveyardToHandClause(clause) ??
      tryParseZoneAndRemovalClause({ clause, rawClause: clause, withMeta }) ??
      tryParseSimpleCreateTokenClause({ clause, rawClause: clause, withMeta }) ??
      tryParseLifeAndCombatClause({ clause, rawClause: clause, withMeta }) ??
      tryParseTemporaryModifyPtClause({ clause, rawClause: clause, withMeta }) ??
      tryParseSimpleActionClause({ clause, rawClause: clause, withMeta });
    if (!singleStep || singleStep.kind === 'unknown') return null;
    return [singleStep];
  };

  const bodyClause = String(normalizedBody.clause || '').trim();
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
    /^you may (?:cast|play) (?:(?:cards?|spells?) this way|(?:those|the exiled) (?:cards?|spells?)|that card|that spell|it|them) without paying (?:its|their|that spell(?:'s)?|those spells(?:')?) mana costs?$/i.test(
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

function parseGraveyardAdditionalCostFromText(rawText: string): OracleGraveyardAdditionalCost | null {
  let normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  normalized = normalized.replace(/^(?:flashback|jump-start|retrace|escape|harmonize)\b[:—-]?\s*/i, '').trim();
  normalized = normalized.replace(/^(?:\{[^}]+\})+(?:,\s*|\s+)/, '').trim();

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

    const additionalCost = parseGraveyardAdditionalCostFromText(step.raw);
    if (!additionalCost) continue;

    const next = steps[i + 1];
    if (next?.kind === 'modify_graveyard_permissions' && next.additionalCost) continue;

    expanded.push({
      kind: 'modify_graveyard_permissions',
      scope: 'last_granted_graveyard_cards',
      additionalCost,
      raw: additionalCost.raw,
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

export function expandUnearthKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const normalizedEffect = normalizeOracleText(String(ability.effectText || '')).trim().toLowerCase();
    const normalizedText = normalizeOracleText(String(ability.text || '')).trim().toLowerCase();
    const alreadyExpanded =
      ability.steps.some((step) => step.kind === 'move_zone') &&
      ability.steps.some((step) => step.kind === 'schedule_delayed_battlefield_action') &&
      ability.steps.some((step) => step.kind === 'grant_leave_battlefield_replacement');
    if (alreadyExpanded) {
      return ability;
    }
    if (normalizedEffect !== 'unearth' && !normalizedText.startsWith('unearth ')) {
      return ability;
    }

    const manaCost = extractLeadingInlineManaCost(ability.cost) || String(ability.cost || '').trim();
    const existingSteps = ability.steps.filter(
      (step) => !(step.kind === 'unknown' && normalizeOracleText(String(step.raw || '')).trim().toLowerCase() === 'unearth')
    );

    return {
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
    };
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
    const alreadyExpanded = ability.steps.some((step) => step.kind === 'search_library');
    const matchesCanonicalEffect =
      normalizedEffect.startsWith('search your library for a card with the same mana value as this card') ||
      normalizedText.startsWith('search your library for a card with the same mana value as this card');
    if (alreadyExpanded || (!normalizedText.startsWith('transmute ') && !matchesCanonicalEffect)) {
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
    const matchesKeywordLine = normalizedText === 'myriad';
    const matchesCanonicalEffect =
      normalizedEffect.startsWith(canonicalEffectPrefix) ||
      normalizedText.startsWith(canonicalEffectPrefix);
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
    const mobilizeMatch = normalizedText.match(/^mobilize\s+(\d+)$/i);
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

  if (/^choose an opponent$/i.test(normalized)) {
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

function parseCopySpellUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>,
  nextStep?: OracleEffectStep
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const nextNormalized =
    nextStep?.kind === 'unknown'
      ? normalizeOracleText(String(nextStep.raw || ''))
          .replace(/^then\b\s*/i, '')
          .trim()
      : '';

  if (/^copy this spell for each spell cast before it this turn$/i.test(normalized)) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: { kind: 'spells_cast_before_this_turn' },
      allowNewTargets: /^you may choose new targets for the copies$/i.test(nextNormalized),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: nextNormalized ? `${normalized}. ${nextNormalized}` : normalized,
    };
  }

  if (
    /^you may copy this spell(?:\s+and\s+may choose\s+(?:a new target|new targets)\s+for the copy)?$/i.test(normalized)
  ) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      allowNewTargets: /may choose\s+(?:a new target|new targets)\s+for the copy/i.test(normalized),
      optional: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (
    /^copy this spell(?:\s+and\s+(?:you\s+)?may choose\s+(?:a new target|new targets)\s+for the copy)?$/i.test(normalized)
  ) {
    return {
      kind: 'copy_spell',
      subject: 'this_spell',
      allowNewTargets: /may choose\s+(?:a new target|new targets)\s+for the copy/i.test(normalized),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  return null;
}

export function expandCopySpellUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (let i = 0; i < ability.steps.length; i += 1) {
      const step = ability.steps[i];
      if (step.kind !== 'unknown') {
        expandedSteps.push(step);
        continue;
      }

      const nextStep = ability.steps[i + 1];
      const expanded = parseCopySpellUnknownStep(step, nextStep);
      if (!expanded) {
        expandedSteps.push(step);
        continue;
      }

      changed = true;
      expandedSteps.push(expanded);
      if (
        expanded.kind === 'copy_spell' &&
        expanded.subject === 'this_spell' &&
        expanded.copies?.kind === 'spells_cast_before_this_turn' &&
        nextStep?.kind === 'unknown' &&
        /^you may choose new targets for the copies$/i.test(
          normalizeOracleText(String(nextStep.raw || ''))
            .replace(/^then\b\s*/i, '')
            .trim()
        )
      ) {
        i += 1;
      }
    }

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
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
    step => step.kind === 'unknown' && /^Roll a d20$/i.test(String(step.raw || '').trim())
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

  return {
    ...ability,
    steps: [
      ...steps.slice(0, rollIndex),
      {
        kind: 'roll_die',
        who: { kind: 'you' },
        sides: 20,
        raw: 'Roll a d20',
      },
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
    const firstBand = parseDieRollBandAbility(mergedInline[i + 1]);
    const hasSeparateRollAbility =
      rollAbility?.type === 'static' &&
      /^Roll a d20\.\s*Activate only as a sorcery\.?$/i.test(String(rollAbility.text || '').trim());
    if (
      current?.type !== 'activated' ||
      (!hasSeparateRollAbility && !rewrittenCurrent.hadInlineRoll)
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
        {
          kind: 'roll_die',
          who: { kind: 'you' },
          sides: 20,
          raw: 'Roll a d20',
        },
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
  if (step.kind !== 'unknown') return null;

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

function parseGraveyardPermissionUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/^\(\s*/, '')
    .replace(/\s*\)\s*$/i, '')
    .trim();
  if (!normalized) return null;

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
    /^during your turn,\s+(.+?)\s+in\s+your\s+graveyard\s+have\s+(flashback|escape|retrace|jump-start|harmonize)$/i
  );
  if (duringYourTurnKeywordMatch) {
    const selectorText = String(duringYourTurnKeywordMatch[1] || '')
      .trim()
      .replace(/\s+cards?$/i, '')
      .replace(/\s+spells?$/i, '')
      .trim();
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

  const grantedKeywordMatch = normalized.match(
    /^((?:each|target|up to one target)\s+.+?)\s+in\s+your\s+graveyard((?:\s+that(?:'s| is)\s+.+?)?)\s+(?:has|gain|gains)\s+(flashback|escape|retrace|jump-start|harmonize)(?:\s+(until end of turn|this turn))?$/i
  );
  if (grantedKeywordMatch) {
    const rawSelector = String(grantedKeywordMatch[1] || '').trim();
    const qualifier = String(grantedKeywordMatch[2] || '').trim();
    const selectorText = /^(?:each|all)\s+/i.test(rawSelector)
      ? rawSelector.replace(/^(?:each|all)\s+/i, '').trim()
      : rawSelector;
    const qualifiedSelector = `${selectorText}${qualifier ? ` ${qualifier}` : ''}`.trim();
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

export function expandGraveyardPermissionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseGraveyardPermissionUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
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

function tryLowerDiscoverKeywordSteps(steps: readonly OracleEffectStep[]): readonly OracleEffectStep[] | null {
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
    const discoverMatch = normalized.match(/^discover\s+(\d+|x)$/i);
    if (!discoverMatch) {
      nextSteps.push(step);
      continue;
    }

    changed = true;
    const amountText = String(discoverMatch[1] || '').trim().toUpperCase();
    nextSteps.push({
      kind: 'impulse_exile_top',
      who: { kind: 'you' },
      amount: { kind: 'unknown', raw: `until you exile a nonland card with mana value ${amountText} or less` },
      duration: 'during_resolution',
      permission: 'cast',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw:
        `Exile cards from the top of your library until you exile a nonland card with mana value ${amountText} or less. ` +
        "You may cast that card without paying its mana cost. Put the remaining exiled cards on the bottom of your library in a random order.",
    });
    nextSteps.push({
      kind: 'modify_exile_permissions',
      scope: 'last_exiled_cards',
      withoutPayingManaCost: true,
      raw: 'You may cast that card without paying its mana cost.',
    });
  }

  return changed ? nextSteps : null;
}

export function lowerDiscoverKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const lowered = tryLowerDiscoverKeywordSteps(ability.steps);
    return lowered ? { ...ability, steps: lowered } : ability;
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

  return null;
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
  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return /^activate only as a sorcery$/i.test(normalized);
}

export function pruneRedundantActivationRestrictionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const nextSteps = ability.steps.filter(step => !isRedundantActivationRestrictionUnknownStep(step));
    return nextSteps.length === ability.steps.length ? ability : { ...ability, steps: nextSteps };
  });
}

function isRedundantImpulseCleanupUnknownStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'unknown') return false;

  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return false;

  return (
    (/\bput\s+the\s+exiled\s+cards\b/.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+(?:that|their|your)\s+library\b/.test(normalized)) ||
    (/\bput\s+all\s+cards\s+exiled\b/.test(normalized) &&
      /\bon\s+the\s+bottom\s+of\s+their\s+library\b/.test(normalized)) ||
    /\bshuffles\s+the\s+rest\s+into\s+their\s+library\b/.test(normalized)
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
      if (
        previous?.kind === 'impulse_exile_top' &&
        previous.duration === 'during_resolution' &&
        previous.permission === 'cast' &&
        previous.amount?.kind === 'unknown' &&
        isRedundantImpulseCleanupUnknownStep(step)
      ) {
        changed = true;
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
    /^attach\s+(this enchantment|this equipment|this permanent|it)\s+to\s+(target creature(?: you control)?|target land(?: you control)?|that creature|that land|it)$/i
  );
  if (!match) return null;

  return {
    kind: 'attach',
    attachment: parseObjectSelector(String(match[1] || '').trim()),
    to: parseObjectSelector(String(match[2] || '').trim()),
    raw: normalized,
  };
}

export function expandMoveZoneAttachUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.flatMap((step) => {
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

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

function parseCreateEmblemUnknownStep(rawClause: string, cardName?: string): OracleEffectStep | null {
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized) return null;

  const match = normalized.match(/^you get an emblem with\s+"([^"]+)"$/i);
  if (!match) return null;

  const abilityText = String(match[1] || '').trim();
  if (!abilityText) return null;

  return {
    kind: 'create_emblem',
    abilities: [abilityText],
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
