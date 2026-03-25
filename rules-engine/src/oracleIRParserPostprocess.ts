import type { OracleClauseCondition, OracleEffectStep, OracleIRAbility } from './oracleIR';
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

export function expandDeterministicMoveZoneFollowupAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => ({
    ...ability,
    steps: splitSimpleReturnFollowupClauses(ability.steps),
  }));
}

function parseSimpleConditionalUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || '')).trim();
  if (!normalized) return null;

  const match =
    normalized.match(/^if\s+([^,]+),\s*(.+)$/i) ||
    normalized.match(/^when\s+(you do),\s*(.+)$/i);
  if (!match) return null;

  const conditionRaw = normalizeLeadingConditionalCondition(String(match[1] || '').trim());
  const body = String(match[2] || '').trim();
  if (!conditionRaw || !body) return null;

  const normalizedBody = normalizeClauseForParse(body.replace(/[.]+$/g, '').trim());
  const withMeta = <T extends OracleEffectStep>(candidate: T): T => {
    const out: any = { ...candidate };
    if (normalizedBody.sequence) out.sequence = normalizedBody.sequence;
    if (normalizedBody.optional) out.optional = normalizedBody.optional;
    return out;
  };
  const bodyClause = String(normalizedBody.clause || '').trim();

  const parsedBodySteps =
    (() => {
      const moveWithAttach = parseMoveZoneWithAttachFollowup(bodyClause);
      if (moveWithAttach && moveWithAttach.length > 0) return [...moveWithAttach];

      const singleStep =
        parseExilePermissionModifierUnknownStep({ ...step, raw: body }) ??
        parseCopySpellUnknownStep({ ...step, raw: body }) ??
        parseReturnFromYourGraveyardToHandClause(bodyClause) ??
        tryParseZoneAndRemovalClause({ clause: bodyClause, rawClause: body, withMeta }) ??
        tryParseSimpleCreateTokenClause({ clause: bodyClause, rawClause: body, withMeta }) ??
        tryParseLifeAndCombatClause({ clause: bodyClause, rawClause: body, withMeta }) ??
        tryParseTemporaryModifyPtClause({ clause: bodyClause, rawClause: body, withMeta }) ??
        tryParseSimpleActionClause({ clause: bodyClause, rawClause: body, withMeta });
      if (!singleStep || singleStep.kind === 'unknown') return null;
      return [singleStep];
    })();

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

  return null;
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

  return null;
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

function parseCopySpellUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

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
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseCopySpellUnknownStep(step);
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

export function expandLeaveBattlefieldReplacementUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
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

  const grantedKeywordMatch = normalized.match(
    /^((?:each|target|up to one target)\s+.+?)\s+in\s+your\s+graveyard\s+(?:has|gain|gains)\s+(flashback|escape|retrace|jump-start|harmonize)(?:\s+(until end of turn|this turn))?$/i
  );
  if (grantedKeywordMatch) {
    const rawSelector = String(grantedKeywordMatch[1] || '').trim();
    const selectorText = /^(?:each|all)\s+/i.test(rawSelector)
      ? rawSelector.replace(/^(?:each|all)\s+/i, '').trim()
      : rawSelector;
    const durationText = String(grantedKeywordMatch[3] || '').trim().toLowerCase();

    return {
      kind: 'grant_graveyard_permission',
      who: { kind: 'you' },
      permission: 'cast',
      what: { kind: 'raw', text: selectorText },
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

  return {
    kind: 'grant_graveyard_permission',
    who: parsePlayerSelector(String(match[1] || '').trim()),
    permission: String(match[2] || '').trim().toLowerCase() === 'play' ? 'play' : 'cast',
    what: parseObjectSelector(String(match[3] || '').trim()),
    duration: parseGraveyardPermissionDuration(trailingText),
    optional: true,
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
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

function parseKeywordActionUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

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
      (next.steps[0]?.kind === 'proliferate' || next.steps[0]?.kind === 'ring_tempts_you');

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

  for (let i = 0; i < abilities.length; i += 1) {
    const current = abilities[i];
    const next = abilities[i + 1];

    const currentHasGraveyardPermission = Boolean(
      current?.steps.some((step) => step.kind === 'grant_graveyard_permission')
    );
    const nextIsModifier =
      next?.type === 'static' &&
      next.steps.length === 1 &&
      next.steps[0]?.kind === 'modify_graveyard_permissions';

    if (!current || !currentHasGraveyardPermission || !nextIsModifier) {
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
  const normalized = normalizeOracleText(rawClause).trim();
  if (!normalized) return null;

  const match = normalized.match(
    /^attach\s+(this enchantment|this equipment|this permanent|it)\s+to\s+(target creature(?: you control)?|that creature|it)$/i
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
