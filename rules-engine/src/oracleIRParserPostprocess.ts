import type { OracleIRAbility } from './oracleIR';
import { normalizeOracleText, splitIntoClauses } from './oracleIRParserUtils';

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
