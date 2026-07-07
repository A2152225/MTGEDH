import { parseOracleTextToIR } from './oracleIRParser';
import type { OracleEffectStep } from './oracleIR';
import type { ActivatedAbilityCostReducerConfig } from './activatedAbilityCostReduction';

const ONE_MANA_FLOOR_PATTERN = /can(?:no|'?)t reduce (?:the )?(?:mana in )?(?:that )?(?:ability'?s )?(?:activation )?cost to less than one mana/i;

function normalizeClause(raw: string): string {
  return String(raw || '')
    .replace(/\u2014|\u2013/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

function stripAbilityNamePrefix(clause: string): string {
  return normalizeClause(clause).replace(/^[^-]+-\s*/, '').trim();
}

function splitOracleIntoClauses(oracleText: string): string[] {
  const clauses: string[] = [];
  for (const line of String(oracleText || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
      const normalized = normalizeClause(sentence);
      if (normalized) clauses.push(normalized);
    }
  }
  return clauses;
}

function parseGenericReductionAmount(text: string): number {
  const match = String(text || '').match(/\{(\d+)\}/);
  if (!match) return 0;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasOneManaFloor(text: string): boolean {
  return ONE_MANA_FLOOR_PATTERN.test(String(text || ''));
}

function inferMinimumTotalMana(clauses: readonly string[]): number {
  return clauses.some((clause) => hasOneManaFloor(clause)) ? 1 : 0;
}

function stripConditionalPrefix(clause: string): string {
  return normalizeClause(clause).replace(/^as long as you control your commander,\s*/i, '').trim();
}

function buildReducerSpec(
  cardName: string,
  clause: string,
  allClauses: readonly string[],
): ActivatedAbilityCostReducerConfig | null {
  const normalized = stripConditionalPrefix(stripAbilityNamePrefix(clause));
  const requiresCommander = /as long as you control your commander/i.test(clause);
  const minimumTotalMana = inferMinimumTotalMana(allClauses);

  const abilitiesYouActivate = normalized.match(
    /^abilities you activate(?: that aren't mana abilities)? cost (\{[^}]+\}) less to activate/i,
  );
  if (abilitiesYouActivate) {
    const genericReduction = parseGenericReductionAmount(abilitiesYouActivate[1]);
    if (genericReduction <= 0) return null;
    return {
      nameMatch: '',
      cardName,
      genericReduction,
      minimumTotalMana: Math.max(minimumTotalMana, 1),
      reducerControllerScope: 'you_control',
      sourceControllerScope: 'any',
      excludesManaAbilities: /aren't mana abilities/i.test(normalized),
    };
  }

  const activatedAbilitiesOf = normalized.match(
    /(?:^|,\s*)activated abilities of (.+?) cost (\{[^}]+\}) less to activate/i,
  );
  if (activatedAbilitiesOf) {
    const targetRaw = String(activatedAbilitiesOf[1] || '').trim().toLowerCase();
    const genericReduction = parseGenericReductionAmount(activatedAbilitiesOf[2]);
    if (genericReduction <= 0) return null;

    const youControl = targetRaw.includes('you control');
    const sourceControllerScope = youControl || targetRaw.includes('your ')
      ? 'you_control'
      : 'any';

    if (targetRaw.includes('artifact token')) {
      return {
        nameMatch: '',
        cardName,
        genericReduction,
        minimumTotalMana,
        reducerControllerScope: 'you_control',
        sourceControllerScope: 'you_control',
        sourceZone: 'battlefield',
        sourceTypes: ['artifact'],
        sourceMustBeToken: true,
        requiresCommander,
      };
    }

    if (targetRaw.includes('land')) {
      return {
        nameMatch: '',
        cardName,
        genericReduction,
        minimumTotalMana,
        reducerControllerScope: 'you_control',
        sourceControllerScope: 'you_control',
        sourceZone: 'battlefield',
        sourceTypes: ['land'],
        requiresCommander,
      };
    }

    if (targetRaw.includes('graveyard') || targetRaw.includes('in your graveyard') || targetRaw.includes('cards in your graveyard')) {
      return {
        nameMatch: '',
        cardName,
        genericReduction,
        minimumTotalMana: Math.max(minimumTotalMana, 1),
        reducerControllerScope: 'you_control',
        sourceControllerScope: 'you_control',
        sourceZone: 'graveyard',
        requiresCommander,
      };
    }

    if (targetRaw.includes('creature')) {
      const heartstoneStyle = !youControl && !targetRaw.includes('your ');
      return {
        nameMatch: '',
        cardName,
        genericReduction,
        minimumTotalMana,
        reducerControllerScope: heartstoneStyle ? 'any' : 'you_control',
        sourceControllerScope: heartstoneStyle ? 'any' : 'you_control',
        sourceTypes: ['creature'],
        requiresCommander,
      };
    }
  }

  return null;
}

function collectClauseCandidatesFromSteps(steps: readonly OracleEffectStep[]): string[] {
  const clauses: string[] = [];
  for (const step of steps) {
    if (step.kind === 'grant_static_ability') {
      const effectLines = Array.isArray(step.effectText) ? step.effectText : [];
      for (const line of effectLines) {
        const text = String(line || '').trim();
        if (text) clauses.push(text);
      }
      const raw = String(step.raw || '').trim();
      if (raw && /less to activate/i.test(raw)) {
        clauses.push(raw);
      }
    }
    if (step.kind === 'unknown') {
      const raw = String((step as { raw?: string }).raw || '').trim();
      if (raw && /less to activate/i.test(raw)) {
        clauses.push(raw);
      }
    }
  }
  return clauses;
}

export function parseActivatedAbilityCostReducerSpecsFromOracleText(
  oracleText: string,
  cardName: string,
): ActivatedAbilityCostReducerConfig[] {
  const specs: ActivatedAbilityCostReducerConfig[] = [];
  const seen = new Set<string>();

  const addSpec = (spec: ActivatedAbilityCostReducerConfig | null) => {
    if (!spec || spec.genericReduction <= 0) return;
    const key = JSON.stringify({
      cardName: spec.cardName,
      genericReduction: spec.genericReduction,
      minimumTotalMana: spec.minimumTotalMana,
      reducerControllerScope: spec.reducerControllerScope,
      sourceControllerScope: spec.sourceControllerScope,
      sourceZone: spec.sourceZone,
      sourceTypes: spec.sourceTypes,
      sourceMustBeToken: spec.sourceMustBeToken,
      excludesManaAbilities: spec.excludesManaAbilities,
      requiresCommander: spec.requiresCommander,
    });
    if (seen.has(key)) return;
    seen.add(key);
    specs.push(spec);
  };

  const oracleClauses = splitOracleIntoClauses(oracleText);
  for (const clause of oracleClauses) {
    if (!/less to activate/i.test(clause)) continue;
    addSpec(buildReducerSpec(cardName, clause, oracleClauses));
  }

  const ir = parseOracleTextToIR(String(oracleText || ''), cardName);
  const steps = (ir.abilities || []).flatMap((ability) => [...(ability.steps || [])]);
  const irClauses = collectClauseCandidatesFromSteps(steps);
  for (const clause of irClauses) {
    addSpec(buildReducerSpec(cardName, clause, [...oracleClauses, ...irClauses]));
  }

  return specs;
}

export function parseActivatedAbilityCostReducerSpecsFromPermanent(permanent: any): ActivatedAbilityCostReducerConfig[] {
  const cardName = String(permanent?.card?.name || permanent?.name || '').trim();
  const oracleText = String(
    permanent?.card?.oracle_text
    || permanent?.card?.oracleText
    || permanent?.oracle_text
    || '',
  ).trim();
  if (!cardName || !oracleText) return [];
  return parseActivatedAbilityCostReducerSpecsFromOracleText(oracleText, cardName);
}
