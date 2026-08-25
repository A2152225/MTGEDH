// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the bare static cost-reduction sentence parser (one sentence at a time, then the
// multi-sentence wrapper) plus the static grant metadata step builder it emits.
//
// Kept out of the parent so the hoisted guard-run siblings can reach these builders without a
// leaf importing its own parent.
//
// Public entry points:
//   buildStaticGrantMetadataStep
//   tryParseBareStaticCostReductionSteps

import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

function buildStaticGrantMetadataStep(
  targetRaw: string,
  effectText: string,
  raw: string,
  sequence: { sequence?: 'then' },
): OracleEffectStep {
  return {
    kind: 'grant_static_ability',
    target: parseObjectSelector(targetRaw),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep;
}

function tryParseSingleBareStaticCostReductionSentence(
  raw: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const normalizedRaw = normalizeOracleText(String(raw || ''))
    .replace(/^as long as you control your commander,\s*/i, '')
    .replace(/^[^-]+-\s*/, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!normalizedRaw) return null;

  const spellsYouCastCostLess = normalizedRaw.match(
    /^(.+?\bspells\s+you\s+cast(?:\s+this\s+turn)?)\s+cost\s+(.+?)\s+less\s+to\s+cast(?:,?\s+(.+))?$/i,
  );
  if (spellsYouCastCostLess) {
    const tail = String(spellsYouCastCostLess[3] || '').trim();
    return [buildStaticGrantMetadataStep(
      String(spellsYouCastCostLess[1] || '').trim(),
      `cost ${String(spellsYouCastCostLess[2] || '').trim()} less to cast${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  const spellsYouControlCostLess = normalizedRaw.match(
    /^(.+?\bspells\s+you\s+control)\s+cost\s+(.+?)\s+less\s+to\s+cast(?:,?\s+(.+))?$/i,
  );
  if (spellsYouControlCostLess) {
    const tail = String(spellsYouControlCostLess[3] || '').trim();
    return [buildStaticGrantMetadataStep(
      String(spellsYouControlCostLess[1] || '').trim(),
      `cost ${String(spellsYouControlCostLess[2] || '').trim()} less to cast${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  const abilitiesYouActivateCostLess = normalizedRaw.match(
    /^abilities you activate(?: that aren't mana abilities)? cost (\{[^}]+\}) less to activate/i,
  );
  if (abilitiesYouActivateCostLess) {
    const qualifier = /aren't mana abilities/i.test(normalizedRaw) ? " that aren't mana abilities" : '';
    return [buildStaticGrantMetadataStep(
      `abilities you activate${qualifier}`,
      `cost ${String(abilitiesYouActivateCostLess[1] || '').trim()} less to activate`,
      raw,
      sequence,
    )];
  }

  const activatedAbilitiesCostLess = normalizedRaw.match(
    /^activated\s+abilities\s+of\s+(.+?)\s+cost\s+(.+?)\s+less\s+to\s+activate(?:,?\s+(.+))?$/i,
  );
  if (activatedAbilitiesCostLess) {
    const tail = String(activatedAbilitiesCostLess[3] || '').trim();
    return [buildStaticGrantMetadataStep(
      String(activatedAbilitiesCostLess[1] || '').trim(),
      `cost ${String(activatedAbilitiesCostLess[2] || '').trim()} less to activate${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  const genericSpellsCostMoreCast = normalizedRaw.match(/^(.+?)\s+cost\s+(.+?)\s+more\s+to\s+cast(?:,?\s+(.+))?$/i);
  if (genericSpellsCostMoreCast && /\bspells\b/i.test(String(genericSpellsCostMoreCast[1] || ''))) {
    const tail = String(genericSpellsCostMoreCast[3] || '').trim();
    return [buildStaticGrantMetadataStep(
      String(genericSpellsCostMoreCast[1] || '').trim(),
      `cost ${String(genericSpellsCostMoreCast[2] || '').trim()} more to cast${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  const thisSpellCostsLess = normalizedRaw.match(/^this\s+spell\s+costs\s+(.+?)\s+less\s+to\s+cast(?:,?\s+(.+))?$/i);
  if (thisSpellCostsLess) {
    const tail = String(thisSpellCostsLess[2] || '').trim();
    return [buildStaticGrantMetadataStep(
      'this spell',
      `costs ${String(thisSpellCostsLess[1] || '').trim()} less to cast${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  const thisAbilityCostsLess = normalizedRaw.match(/^this\s+ability\s+costs\s+(.+?)\s+less\s+to\s+activate(?:,?\s+(.+))?$/i);
  if (thisAbilityCostsLess) {
    const tail = String(thisAbilityCostsLess[2] || '').trim();
    return [buildStaticGrantMetadataStep(
      'this ability',
      `costs ${String(thisAbilityCostsLess[1] || '').trim()} less to activate${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  const firstInstantSorceryCostLess = normalizedRaw.match(
    /^the\s+first\s+instant\s+or\s+sorcery\s+spell\s+you\s+cast\s+each\s+turn\s+costs\s+(.+?)\s+less\s+to\s+cast(?:,?\s+(.+))?$/i,
  );
  if (firstInstantSorceryCostLess) {
    const tail = String(firstInstantSorceryCostLess[2] || '').trim();
    return [buildStaticGrantMetadataStep(
      'the first instant or sorcery spell you cast each turn',
      `costs ${String(firstInstantSorceryCostLess[1] || '').trim()} less to cast${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  if (/^dash\s+costs\s+you\s+pay\s+cost\s+(.+?)\s+less\b/i.test(normalizedRaw)) {
    return [buildStaticGrantMetadataStep('dash costs you pay', normalizedRaw.replace(/^dash\s+costs\s+you\s+pay\s+/i, ''), raw, sequence)];
  }

  if (/^equip\s+costs\s+you\s+pay\s+cost\s+(.+?)\s+less\.?$/i.test(normalizedRaw)) {
    return [buildStaticGrantMetadataStep('equip costs you pay', normalizedRaw.replace(/^equip\s+costs\s+you\s+pay\s+/i, ''), raw, sequence)];
  }

  if (/^power-up abilities of other creatures you control cost .+ less to activate\.?$/i.test(normalizedRaw)) {
    return [buildStaticGrantMetadataStep('other creatures you control', normalizedRaw, raw, sequence)];
  }

  const activatedAbilitiesCostMore = normalizedRaw.match(
    /^activated\s+abilities\s+cost\s+(.+?)\s+more\s+to\s+activate(?:,?\s+(.+))?$/i,
  );
  if (activatedAbilitiesCostMore) {
    const tail = String(activatedAbilitiesCostMore[2] || '').trim();
    return [buildStaticGrantMetadataStep(
      'activated abilities',
      `cost ${String(activatedAbilitiesCostMore[1] || '').trim()} more to activate${tail ? ` ${tail}` : ''}`,
      raw,
      sequence,
    )];
  }

  return null;
}

function tryParseBareStaticCostReductionSteps(
  raw: string,
  sequence: { sequence?: 'then' },
): readonly OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(raw || '')).trim();
  if (!normalized) return null;
  const sentences = normalized.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  for (const sentence of sentences.length > 0 ? sentences : [normalized]) {
    const parsed = tryParseSingleBareStaticCostReductionSentence(sentence, sequence);
    if (parsed) return parsed;
  }
  return null;
}


export { buildStaticGrantMetadataStep, tryParseBareStaticCostReductionSteps };
