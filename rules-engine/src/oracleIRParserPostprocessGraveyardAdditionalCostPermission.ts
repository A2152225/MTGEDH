/**
 * Graveyard additional-cost permission modifiers for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 17221-17744 of the
 * pre-split file).
 * Cluster moved: inline mana-cost normalization, graveyard additional-cost parsing and
 * dedupe, the granted-modifier raw restore pass, and the disturb / unearth keyword cost
 * expansions.
 * Public entry symbols: restoreGrantedGraveyardAdditionalCostModifierRawAbilities,
 * expandGraveyardAdditionalCostPermissionAbilities,
 * expandKeywordManaCostGraveyardPermissionAbilities, expandDisturbKeywordAbilities,
 * expandKeywordAdditionalCostGraveyardPermissionAbilities, expandUnearthKeywordAbilities.
 */
import type {
  OracleEffectStep,
  OracleGraveyardAdditionalCost,
  OracleIRAbility,
} from './oracleIR';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseQuantity } from './oracleIRParserUtils';

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
    normalized = normalized.replace(/^(?:flashback|jump-start|retrace|escape|harmonize)\b[:—-]?\s*/i, '').trim();
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

function normalizeGraveyardAdditionalCostFilterText(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\s+cards?\b/gi, ' ')
    .replace(/\s+permanents?\b/gi, ' ')
    .replace(/\b([a-z]+)s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function graveyardAdditionalCostsEqual(
  left: OracleGraveyardAdditionalCost,
  right: OracleGraveyardAdditionalCost,
): boolean {
  if (left.kind !== right.kind) return false;

  switch (left.kind) {
    case 'discard':
    case 'sacrifice':
    case 'exile_from_graveyard':
      return left.count === right.count
        && normalizeGraveyardAdditionalCostFilterText(left.filterText)
          === normalizeGraveyardAdditionalCostFilterText(right.filterText);
    case 'remove_counter':
      return left.count === right.count
        && normalizeGraveyardAdditionalCostFilterText(left.filterText)
          === normalizeGraveyardAdditionalCostFilterText(right.filterText)
        && normalizeCounterName(String(left.counter || ''))
          === normalizeCounterName(String((right as typeof left).counter || ''));
    default:
      return false;
  }
}

function grantRawEmbedsAdditionalCost(
  grantRaw: string,
  additionalCost: OracleGraveyardAdditionalCost | undefined,
): boolean {
  if (!additionalCost) return false;
  const parsedFromGrant = parseGraveyardAdditionalCostFromText(grantRaw);
  if (!parsedFromGrant) return false;
  return graveyardAdditionalCostsEqual(parsedFromGrant, additionalCost);
}

function buildGrantedGraveyardAdditionalCostModifierRaw(
  grantRaw: string,
  additionalCost: OracleGraveyardAdditionalCost | undefined,
  castCostRaw: string | undefined,
): string {
  if (additionalCost && grantRawEmbedsAdditionalCost(grantRaw, additionalCost)) {
    return '';
  }
  if (additionalCost?.raw) {
    return additionalCost.raw;
  }
  if (castCostRaw) {
    return `Cast cost ${castCostRaw}`;
  }
  return '';
}

function stripRedundantGrantedGraveyardAdditionalCostModifier(
  modifier: Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>,
  grantRaw: string,
): Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }> {
  if (!modifier.additionalCost || !grantRawEmbedsAdditionalCost(grantRaw, modifier.additionalCost)) {
    return modifier;
  }

  return {
    ...modifier,
    raw: '',
  };
}

function dedupeRedundantGrantedGraveyardAdditionalCostModifiers(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  const deduped: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'conditional') {
      const nested = dedupeRedundantGrantedGraveyardAdditionalCostModifiers(step.steps);
      deduped.push(nested === step.steps ? step : { ...step, steps: nested });
      continue;
    }

    const next = steps[i + 1];
    if (
      step.kind === 'grant_graveyard_permission' &&
      next?.kind === 'modify_graveyard_permissions'
    ) {
      deduped.push(step);
      deduped.push(stripRedundantGrantedGraveyardAdditionalCostModifier(next, String(step.raw || '')));
      i += 1;
      continue;
    }

    deduped.push(step);
  }

  return deduped;
}

function restoreGrantedGraveyardAdditionalCostModifierRaw(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  const restored: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === 'conditional') {
      const nested = restoreGrantedGraveyardAdditionalCostModifierRaw(step.steps);
      restored.push(nested === step.steps ? step : { ...step, steps: nested });
      continue;
    }

    const next = steps[i + 1];
    if (
      step.kind === 'grant_graveyard_permission' &&
      next?.kind === 'modify_graveyard_permissions' &&
      next.additionalCost &&
      !String(next.raw || '').trim()
    ) {
      restored.push(step);
      const costRaw = String(next.additionalCost.raw || '').trim();
      restored.push(
        costRaw && !grantRawEmbedsAdditionalCost(String(step.raw || ''), next.additionalCost)
          ? { ...next, raw: costRaw }
          : next,
      );
      i += 1;
      continue;
    }

    restored.push(step);
  }

  return restored;
}

export function restoreGrantedGraveyardAdditionalCostModifierRawAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: restoreGrantedGraveyardAdditionalCostModifierRaw(ability.steps),
  }));
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

    const modifierRaw = buildGrantedGraveyardAdditionalCostModifierRaw(
      String(step.raw || ''),
      additionalCost || undefined,
      castCostRaw || undefined,
    );

    expanded.push({
      kind: 'modify_graveyard_permissions',
      scope: 'last_granted_graveyard_cards',
      ...(castCostRaw ? { castCostRaw } : {}),
      ...(additionalCost ? { additionalCost } : {}),
      raw: modifierRaw,
    });
  }

  return dedupeRedundantGrantedGraveyardAdditionalCostModifiers(expanded);
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

export {
  extractLeadingInlineManaCost,
  grantRawEmbedsAdditionalCost,
  parseGraveyardAdditionalCostFromText,
};
