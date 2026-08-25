/**
 * Graveyard cast/play permission lowering for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 25722-26282).
 * Cluster moved: `grant_graveyard_permission` unknown-step parsing - permission duration,
 * selector and keyword-cost helpers plus the combined play-and-cast permission splitter.
 * Public entry symbols: expandGraveyardPermissionUnknownAbilities,
 * expandGraveyardOrExilePermissionAbilities, expandFreeGraveyardCastPermissionAbilities.
 */
import type { OracleClauseCondition, OracleEffectStep, OracleIRAbility } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';

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
    .replace(/^when you do,\s*/i, '')
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
    } as unknown as OracleEffectStep;
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

