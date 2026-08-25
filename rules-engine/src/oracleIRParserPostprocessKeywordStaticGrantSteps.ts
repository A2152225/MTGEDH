/**
 * Keyword-only static ability grants for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 981-1584 of the
 * pre-split file).
 * Cluster moved: the standalone keyword static table and its text guards, ward keyword
 * extraction, annihilator trigger metadata enrichment, and the structured keyword-action
 * grant step builders.
 * Public entry symbols: enrichAnnihilatorGrantMetadataAbilities,
 * enrichWardGrantMetadataAbilities, plus the grant builders re-exported at the foot of this
 * file for the postprocess parent.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import {
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

const STANDALONE_KEYWORD_STATICS = [
  'double strike',
  'first strike',
  'indestructible',
  'trample',
  'haste',
  'vigilance',
  'lifelink',
  'deathtouch',
  'menace',
  'reach',
  'flying',
  'hexproof',
  'flash',
  'defender',
  'wither',
  'infect',
  'prowess',
  'shadow',
  'shroud',
  'convoke',
  'banding',
  'riot',
  'provoke',
  'haunt',
] as const;

function isKeywordOnlyStaticAbilityText(text: string): boolean {
  const normalized = normalizeOracleText(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  const withoutParens = normalized
    .replace(/;/g, ',')
    .replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\.?\s*$/g, '')
    .replace(/\s*\([^)]*$/g, '')
    .trim();
  if (!withoutParens) return false;
  if (/^enchant\b/i.test(withoutParens)) return false;
  if (/\b(?:when|whenever|at the beginning|choose|destroy|create|draw|exile|sacrifice)\b/i.test(withoutParens)) {
    return false;
  }
  return /\b(?:flying|trample|haste|vigilance|lifelink|deathtouch|menace|reach|first strike|double strike|hexproof|indestructible|prowess|ward\s+\{|protection from|toxic\s+\d+|convoke|shadow|shroud|flash|defender|banding|riot|flanking|provoke|haunt|firebending\s+\d+)\b/i.test(
    withoutParens
  );
}

function hasNonBandingKeywordOnlyStaticText(text: string): boolean {
  const withoutBandingTail = normalizeOracleText(text)
    .replace(/;\s*banding\b[^.]*/gi, '')
    .replace(/,\s*banding\b[^.]*/gi, '')
    .replace(/\bbanding\b(?:\s*\([^)]*\))?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutBandingTail) return false;
  return isKeywordOnlyStaticAbilityText(withoutBandingTail);
}

function normalizeWardKeywordAbility(costRaw: string): string {
  const cost = String(costRaw || '').trim();
  const simple = cost.match(/^\{(\d+)\}$/);
  return simple ? `ward ${simple[1]}` : `ward ${cost}`;
}

function extractWardKeywordAbilities(text: string): { abilities: string[]; remaining: string } {
  const abilities: string[] = [];
  let remaining = text;
  for (const match of text.matchAll(/\bward\s+(\{[^}]+\})/gi)) {
    const ability = normalizeWardKeywordAbility(String(match[1] || ''));
    if (!abilities.includes(ability)) abilities.push(ability);
    remaining = remaining.replace(match[0], ' ').trim();
  }
  return { abilities, remaining };
}

function buildAnnihilatorTriggerMetadata(count: number): {
  abilities: string[];
  effectText: string[];
  steps: OracleEffectStep[];
} {
  const sacrificeRaw =
    count === 1
      ? 'Defending player sacrifices a permanent of their choice.'
      : `Defending player sacrifices ${count} permanents of their choice.`;
  const triggerText = `Whenever this creature attacks, ${sacrificeRaw.charAt(0).toLowerCase()}${sacrificeRaw.slice(1)}`;
  return {
    abilities: [`annihilator ${count}`],
    effectText: [triggerText],
    steps: [{
      kind: 'sacrifice',
      who: parsePlayerSelector('defending player'),
      what: parseObjectSelector(count === 1 ? 'a permanent of their choice' : `${count} permanents of their choice`),
      raw: sacrificeRaw,
    }],
  };
}

function hasAnnihilatorAttackTriggerMetadata(step: OracleEffectStep): boolean {
  const withNested = step as OracleEffectStep & {
    steps?: readonly OracleEffectStep[];
    effectText?: readonly string[];
  };
  if (Array.isArray(withNested.steps) && withNested.steps.some((nested) => nested.kind === 'sacrifice')) return true;
  const lines = Array.isArray(withNested.effectText) ? withNested.effectText : [];
  return lines.some((line) => /whenever this creature attacks/i.test(String(line || '')));
}

function splitAnnihilatorFromGrantStep(step: OracleEffectStep): OracleEffectStep[] {
  if (step.kind !== 'grant_static_ability' && step.kind !== 'grant_temporary_ability') return [step];

  const abilities = Array.isArray(step.abilities) ? step.abilities.map((a) => String(a).toLowerCase()) : [];
  const annihilatorCounts: number[] = [];
  const remainingAbilities: string[] = [];
  for (const ability of abilities) {
    const match = ability.match(/^annihilator\s+(\d+)$/i);
    if (match) {
      const count = Number.parseInt(String(match[1] || '0'), 10);
      if (Number.isFinite(count) && count > 0) annihilatorCounts.push(count);
    } else {
      remainingAbilities.push(ability);
    }
  }
  if (annihilatorCounts.length === 0 || hasAnnihilatorAttackTriggerMetadata(step)) return [step];

  const sequence = step.sequence ? { sequence: step.sequence } : {};
  const duration =
    step.kind === 'grant_temporary_ability'
      ? (step.duration || 'end_of_turn')
      : (step.duration || 'static');
  const result: OracleEffectStep[] = [];

  const hasOtherGrantContent =
    remainingAbilities.length > 0 ||
    (Array.isArray(step.effectText) && step.effectText.length > 0) ||
    step.power !== undefined ||
    step.toughness !== undefined;
  if (hasOtherGrantContent) {
    result.push({
      ...step,
      ...(remainingAbilities.length > 0 ? { abilities: remainingAbilities } : { abilities: undefined }),
    });
  }

  for (const count of annihilatorCounts) {
    result.push({
      kind: step.kind,
      target: step.target,
      duration,
      ...buildAnnihilatorTriggerMetadata(count),
      raw: `annihilator ${count}`,
      ...sequence,
    } as unknown as OracleEffectStep);
  }

  return result;
}

function enrichAnnihilatorGrantMetadataOnStep(step: OracleEffectStep): OracleEffectStep[] {
  if (step.kind === 'choose_mode') {
    return [{
      ...step,
      modes: step.modes.map((mode) => ({
        ...mode,
        steps: enrichAnnihilatorGrantMetadataOnSteps(mode.steps),
      })),
    }];
  }

  if (step.kind === 'die_roll_results') {
    return [{
      ...step,
      results: step.results.map((result) => ({
        ...result,
        steps: enrichAnnihilatorGrantMetadataOnSteps(result.steps),
      })),
    }];
  }

  if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
    return [{ ...step, steps: enrichAnnihilatorGrantMetadataOnSteps(step.steps) }];
  }

  return splitAnnihilatorFromGrantStep(step);
}

function enrichAnnihilatorGrantMetadataOnSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  for (const step of steps) out.push(...enrichAnnihilatorGrantMetadataOnStep(step));
  return out;
}

export function enrichAnnihilatorGrantMetadataAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = enrichAnnihilatorGrantMetadataOnSteps(ability.steps);
    return steps.length !== ability.steps.length || steps.some((step, index) => step !== ability.steps[index])
      ? { ...ability, steps }
      : ability;
  });
}

function parseWithClauseKeywordAbilities(withClause: string): string[] {
  const abilities: string[] = [];
  let remaining = normalizeOracleText(withClause).trim();
  for (const keyword of STANDALONE_KEYWORD_STATICS) {
    const pattern = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (pattern.test(remaining)) {
      if (!abilities.includes(keyword)) abilities.push(keyword);
      remaining = remaining.replace(new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'gi'), ' ').trim();
    }
  }
  for (const wardAbility of extractWardKeywordAbilities(remaining).abilities) {
    if (!abilities.includes(wardAbility)) abilities.push(wardAbility);
  }
  return abilities;
}

function enrichWardGrantMetadataOnStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'grant_static_ability' && step.kind !== 'grant_temporary_ability') return step;
  const existing = Array.isArray(step.abilities) ? step.abilities.map((a) => String(a).toLowerCase()) : [];
  if (existing.some((a) => a.startsWith('ward'))) return step;

  const sourceText = [
    String(step.raw || ''),
    ...(Array.isArray(step.effectText) ? step.effectText.map((line) => String(line || '')) : []),
  ].join(' ');
  if (!/\bward\s+\{/i.test(sourceText)) return step;

  const withMatch = sourceText.match(/\bwith\s+(.+?)(?:[.)]|$)/i);
  const extracted = withMatch ? parseWithClauseKeywordAbilities(String(withMatch[1] || '')) : [];
  if (extracted.length === 0) return step;

  const merged = [...existing];
  for (const ability of extracted) {
    if (!merged.includes(ability)) merged.push(ability);
  }
  return { ...step, abilities: merged };
}

function enrichWardGrantMetadataOnSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind === 'choose_mode') {
      return {
        ...step,
        modes: step.modes.map((mode) => ({ ...mode, steps: enrichWardGrantMetadataOnSteps(mode.steps) })),
      };
    }
    if (step.kind === 'die_roll_results') {
      return {
        ...step,
        results: step.results.map((result) => ({ ...result, steps: enrichWardGrantMetadataOnSteps(result.steps) })),
      };
    }
    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      return { ...step, steps: enrichWardGrantMetadataOnSteps(step.steps) };
    }
    return enrichWardGrantMetadataOnStep(step);
  });
}

export function enrichWardGrantMetadataAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = enrichWardGrantMetadataOnSteps(ability.steps);
    return steps.some((step, index) => step !== ability.steps[index]) ? { ...ability, steps } : ability;
  });
}

function createAnnihilatorGrantStep(
  count: number,
  sequence: { sequence?: 'then' },
  rawSuffix: string
): OracleEffectStep {
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector('this permanent'),
    ...buildAnnihilatorTriggerMetadata(count),
    duration: 'static',
    raw: rawSuffix,
    ...sequence,
  } as unknown as OracleEffectStep;
}

function createStructuredKeywordActionGrantStep(
  abilities: readonly string[],
  rawSuffix: string,
  sequence: { sequence?: 'then' },
  target = 'this card'
): OracleEffectStep {
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    abilities: abilities.map((ability) => String(ability).toLowerCase()),
    duration: 'static',
    raw: rawSuffix,
    ...sequence,
  } as unknown as OracleEffectStep;
}

function createSemanticStaticGrantStep(
  target: string,
  effectText: string,
  rawSuffix: string,
  sequence: { sequence?: 'then' }
): OracleEffectStep {
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw: rawSuffix,
    ...sequence,
  } as unknown as OracleEffectStep;
}

function parseStructuredKeywordActionGrant(
  raw: string,
  sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const dredgeMatch = raw.match(/^dredge\s+(\d+)$/i);
  if (dredgeMatch) {
    const ability = `dredge ${String(dredgeMatch[1] || '').trim()}`;
    return [createStructuredKeywordActionGrantStep([ability], raw, sequence)];
  }

  const soulshiftMatch = raw.match(/^soulshift\s+(\d+)$/i);
  if (soulshiftMatch) {
    const ability = `soulshift ${String(soulshiftMatch[1] || '').trim()}`;
    return [createStructuredKeywordActionGrantStep([ability], raw, sequence)];
  }

  const miracleMatch = raw.match(/^miracle\s+((?:\{[^}]+\})+)$/i);
  if (miracleMatch) {
    const ability = `miracle ${String(miracleMatch[1] || '').trim()}`;
    return [createStructuredKeywordActionGrantStep([ability], raw, sequence)];
  }

  const blitzMatch = raw.match(/^blitz\s+((?:\{[^}]+\})+)$/i);
  if (blitzMatch) {
    const ability = `blitz ${String(blitzMatch[1] || '').trim()}`;
    return [createStructuredKeywordActionGrantStep([ability], raw, sequence)];
  }

  const crewCyclingMatch = raw.match(/^crew\s+(\d+)\s+cycling\s+(\{[^}]+\})$/i);
  if (crewCyclingMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`crew ${String(crewCyclingMatch[1] || '').trim()}`, `cycling ${String(crewCyclingMatch[2] || '').trim()}`],
        raw,
        sequence,
        'this permanent'
      ),
    ];
  }

  const crewMatch = raw.match(/^crew\s+(\d+)$/i);
  if (crewMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`crew ${String(crewMatch[1] || '').trim()}`],
        raw,
        sequence,
        'this permanent'
      ),
    ];
  }

  const thenAmassMatch = raw.match(/^then amass orcs (\d+|x)$/i);
  if (thenAmassMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`amass orcs ${String(thenAmassMatch[1] || '').trim()}`],
        raw,
        sequence,
        'this card'
      ),
    ];
  }

  const flyingCrewMatch = raw.match(/^flying\s+crew\s+(\d+)$/i);
  if (flyingCrewMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        ['flying', `crew ${String(flyingCrewMatch[1] || '').trim()}`],
        raw,
        sequence,
        'this permanent'
      ),
    ];
  }

  const amassWhereMatch = raw.match(/^amass orcs x, where x is .+$/i);
  if (amassWhereMatch) {
    return [createStructuredKeywordActionGrantStep(['amass orcs x'], raw, sequence, 'this card')];
  }

  const bushidoMatch = raw.match(/^bushido\s+(\d+)$/i);
  if (bushidoMatch) {
    return [createStructuredKeywordActionGrantStep([`bushido ${String(bushidoMatch[1] || '').trim()}`], raw, sequence)];
  }

  const bolsterWhereMatch = raw.match(/^bolster x, where x is .+$/i);
  if (bolsterWhereMatch) {
    return [createStructuredKeywordActionGrantStep(['bolster x'], raw, sequence, 'this card')];
  }

  if (/^support x$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['support x'], raw, sequence)];
  }

  const entwineMatch = raw.match(/^entwine ((?:\{[^}]+\})+)$/i);
  if (entwineMatch) {
    return [createStructuredKeywordActionGrantStep([`entwine ${String(entwineMatch[1] || '').trim()}`], raw, sequence)];
  }

  if (/^partner(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['partner'], raw, sequence)];
  }

  if (/^changeling(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['changeling'], raw, sequence)];
  }

  if (/^infect(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['infect'], raw, sequence)];
  }

  if (/^devoid(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['devoid'], raw, sequence)];
  }

  if (/^fear(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['fear'], raw, sequence)];
  }

  if (/^start your engines!?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['start your engines'], raw, sequence)];
  }

  if (/^aftermath(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['aftermath'], raw, sequence)];
  }

  if (/^skulk(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['skulk'], raw, sequence)];
  }

  if (/^horsemanship(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['horsemanship'], raw, sequence)];
  }

  if (/^persist(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['persist'], raw, sequence)];
  }

  if (/^undying(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['undying'], raw, sequence)];
  }

  if (/^rebound(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['rebound'], raw, sequence)];
  }

  if (/^provoke(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['provoke'], raw, sequence)];
  }

  if (/^haunt(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['haunt'], raw, sequence)];
  }

  if (/^decayed(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['decayed'], raw, sequence)];
  }

  const recoverMatch = raw.match(/^recover\s+((?:\{[^}]+\})+)$/i);
  if (recoverMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`recover ${String(recoverMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  const mtmeMatch = raw.match(/^more than meets the eye\s+((?:\{[^}]+\})+)$/i);
  if (mtmeMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`more than meets the eye ${String(mtmeMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  const championMatch = raw.match(/^champion\s+(?:a|an)\s+(.+)$/i);
  if (championMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`champion ${String(championMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  if (/^bloodthirst\s+x(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['bloodthirst x'], raw, sequence)];
  }

  const echoMatch = raw.match(/^echo\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i);
  if (echoMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`echo ${String(echoMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  const commanderNinjutsuMatch = raw.match(/^commander ninjutsu\s+((?:\{[^}]+\})+)$/i);
  if (commanderNinjutsuMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`commander ninjutsu ${String(commanderNinjutsuMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  const freerunningMatch = raw.match(/^freerunning\s+((?:\{[^}]+\})+)(?:\s*\([^)]*\))?\.?$/i);
  if (freerunningMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`freerunning ${String(freerunningMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  const afterlifeMatch = raw.match(/^afterlife\s+(\d+)(?:\s*\([^)]*\))?\.?$/i);
  if (afterlifeMatch) {
    return [
      createStructuredKeywordActionGrantStep(
        [`afterlife ${String(afterlifeMatch[1] || '').trim()}`],
        raw,
        sequence
      ),
    ];
  }

  if (/^storm(?:\s*\([^)]*\))?\.?$/i.test(raw)) {
    return [createStructuredKeywordActionGrantStep(['storm'], raw, sequence)];
  }

  if (/^enchant (?:permanent|artifact(?: or creature)?|artifact|creature(?: you control)?|land|player)$/i.test(raw)) {
    return [createSemanticStaticGrantStep('this aura', raw, raw, sequence)];
  }

  if (/^regenerate enchanted creature$/i.test(raw)) {
    return [{
      kind: 'regenerate',
      target: parseObjectSelector('enchanted creature'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const landwalkMatch = raw.match(
    /^(plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)(?:\s*\([^)]*\))?(?:,\s*(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)(?:\s*\([^)]*\))?)*\.?$/i
  );
  if (landwalkMatch) {
    const abilities = [...new Set(
      (raw.toLowerCase().match(/\b(?:plainswalk|islandwalk|swampwalk|mountainwalk|forestwalk)\b/g) || [])
    )];
    if (abilities.length > 0) {
      return [createStructuredKeywordActionGrantStep(abilities, raw, sequence)];
    }
  }

  const amassMillMatch = raw.match(
    /^amass orcs (\d+), mill (five|one|two|three|four|six|seven|eight|nine|ten|\d+) cards$/i
  );
  if (amassMillMatch) {
    return [
      createStructuredKeywordActionGrantStep([`amass orcs ${String(amassMillMatch[1] || '').trim()}`], raw, sequence, 'this card'),
      {
        kind: 'mill',
        who: { kind: 'you' },
        amount: parseQuantity(String(amassMillMatch[2] || '').trim()),
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  return null;
}

export {
  STANDALONE_KEYWORD_STATICS,
  createAnnihilatorGrantStep,
  createSemanticStaticGrantStep,
  createStructuredKeywordActionGrantStep,
  extractWardKeywordAbilities,
  hasNonBandingKeywordOnlyStaticText,
  isKeywordOnlyStaticAbilityText,
  parseStructuredKeywordActionGrant,
};
