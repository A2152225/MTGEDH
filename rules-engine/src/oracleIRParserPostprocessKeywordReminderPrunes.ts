/**
 * Keyword reminder-text prunes for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 17745-18458 of the
 * pre-split file).
 * Cluster moved: the per-keyword passes that drop reminder-only steps and abilities (morph,
 * foretell, manifest/cloak and manifest dread, convoke, cascade, kicker, prototype, backup,
 * cumulative upkeep, soulbond, extort, bending, read ahead, madness, cleave, cipher) plus the
 * attack-requirement and can't-be-countered reminder prunes.
 * Public entry symbols: the prune and upgrade ability passes exported inline below.
 */
import type { OracleEffectStep, OracleIRAbility, OraclePlayerSelector } from './oracleIR';
import { normalizeUnknownStepText } from './oracleIRParserPostprocessCopySpellTailHelpers';
import { normalizeLeadingConditionalCondition } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText } from './oracleIRParserUtils';

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
    /^turn it face up any time for its mana cost if it(?:'|’)s a creature card$/i.test(normalized)
  );
}

function isManifestDreadFaceDownSplitMoveZoneStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  const raw = normalizeReminderStepRaw(step);
  if (
    /^(?:put\s+)?one onto the battlefield face down as a 2\/2 creature and the other into (?:your|their) graveyard$/i.test(raw) ||
    /^put one of them onto the battlefield face down as a 2\/2 creature and the other into your graveyard$/i.test(raw)
  ) {
    return true;
  }
  if (step.what.kind !== 'raw') return false;
  const what = normalizeOracleText(String(step.what.text || '')).trim().toLowerCase();
  return what === 'one onto the battlefield face down as a 2/2 creature and the other';
}

function isRedundantManifestDreadReminderStep(step: OracleEffectStep): boolean {
  const normalized = normalizeReminderStepRaw(step);
  if (!normalized) return false;

  if (isManifestDreadFaceDownSplitMoveZoneStep(step)) {
    return true;
  }

  if (step.kind === 'look_top' && /^look at the top two cards of your library$/i.test(normalized)) {
    return true;
  }

  if (
    /^(?:then\s+)?puts? one onto the battlefield face down as a 2\/2 creature and the other into (?:your|their) graveyard$/i.test(normalized) ||
    /^turn it face up any time for its mana cost if it(?:'|’)s a creature card$/i.test(normalized)
  ) {
    return true;
  }

  if (step.kind === 'unknown') {
    return /^(?:that player )?looks? at the top two cards of (?:your|their) library$/i.test(normalized) || /^manifest one of them$/i.test(normalized);
  }

  return step.kind === 'move_zone' && /^then put the rest into your graveyard$/i.test(normalized);
}

function buildManifestDreadStep(
  who: OraclePlayerSelector,
  raw: string,
  sequence?: 'then'
): OracleEffectStep {
  return {
    kind: 'manifest_dread',
    who,
    ...(sequence ? { sequence } : {}),
    raw,
  };
}

function tryUpgradeManifestDreadGrantStep(
  step: OracleEffectStep
): OracleEffectStep | OracleEffectStep[] | null {
  if (step.kind !== 'grant_static_ability') return null;

  const effectText = (Array.isArray(step.effectText) ? step.effectText : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeOracleText(effectText || step.raw || '').replace(/[.]+$/g, '').trim();
  if (!/\bmanifest dread\b/i.test(normalized)) return null;

  const sequence = step.sequence;
  if (/^manifest dread twice$/i.test(normalized)) {
    const dreadStep = buildManifestDreadStep({ kind: 'you' }, normalized, sequence);
    return [dreadStep, { ...dreadStep }];
  }

  const conditional = normalized.match(/^manifest dread if (.+)$/i);
  if (conditional) {
    return {
      kind: 'conditional',
      condition: {
        kind: 'if',
        raw: normalizeLeadingConditionalCondition(String(conditional[1] || '').trim()),
      },
      steps: [buildManifestDreadStep({ kind: 'you' }, 'manifest dread', sequence)],
      ...(sequence ? { sequence } : {}),
      raw: normalized,
    };
  }

  if (/^its controller manifests dread$/i.test(normalized)) {
    return buildManifestDreadStep({ kind: 'target_player' }, normalized, sequence);
  }

  if (/^manifest dread$/i.test(normalized)) {
    return buildManifestDreadStep({ kind: 'you' }, normalized, sequence);
  }

  return null;
}

export function upgradeManifestDreadGrantAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const upgraded: OracleEffectStep[] = [];
    let changed = false;

    for (const step of ability.steps) {
      const next = tryUpgradeManifestDreadGrantStep(step);
      if (next) {
        changed = true;
        if (Array.isArray(next)) upgraded.push(...next);
        else upgraded.push(next);
        continue;
      }
      upgraded.push(step);
    }

    return changed ? { ...ability, steps: upgraded } : ability;
  });
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
    const hasManifestDreadReminderText =
      /\bmanifests? dread/i.test(normalizedText) &&
      (
        /\((?:to manifest dread, )?look at the top two cards of your library/i.test(normalizedText) ||
        /\bput one onto the battlefield face down as a 2\/2 creature and the other into your graveyard/i.test(normalizedText) ||
        /\bmanifests? dread\.?\s*\((?:that player )?looks? at the top two cards of (?:your|their) library\./i.test(normalizedText)
      );
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

const CONVOKE_DELVE_INNER_REMINDER_PATTERN =
  /^each creature you tap while casting(?: this spell| a noncreature spell from exile)? pays for \{1\} or one mana of that creature(?:'|')s color\.?\)?$/i;

export function pruneConvokeReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.filter((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (CONVOKE_DELVE_INNER_REMINDER_PATTERN.test(normalizedText)) {
      return false;
    }

    if (
      ability.steps.length > 0 &&
      ability.steps.every((step) => step.kind === 'grant_static_ability') &&
      CONVOKE_DELVE_INNER_REMINDER_PATTERN.test(normalizedText)
    ) {
      return false;
    }

    if (ability.type !== 'static' || ability.steps.length === 0 || !ability.steps.every((step) => step.kind === 'unknown')) {
      return true;
    }

    return !/^convoke(?:\s*\([^)]*\))?[.)]*$/i.test(normalizedText);
  });
}

export function pruneCascadeReminderAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.flatMap((ability) => {
    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (/^cascade\s*,\s*cascade\s*\([^)]*\)[.)]*$/i.test(normalizedText)) {
      return [{ ...ability, steps: [{ kind: 'unknown', raw: 'Then do it again' }] as OracleEffectStep[] }];
    }
    return /^cascade\s*\([^)]*\)[.)]*$/i.test(normalizedText) ? [] : [ability];
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

  return /^if that(?:'|’)?s another creature, it gains the following ability until end of turn[.)]*$/i.test(
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
      /^target land you control becomes a 0\/0 (?:land )?creature with haste that(?:'|’)?s still a land$/i.test(normalized) ||
      /^when it dies or is exiled, return it to the battlefield tapped$/i.test(normalized)
    );
  }

  if (step.kind === 'grant_static_ability') {
    return /^target land you control becomes a 0\/0 (?:land )?creature with haste that(?:'|’)?s still a land$/i.test(normalized);
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
    if (ability.type !== 'static' || ability.steps.length === 0) {
      return true;
    }

    const normalizedText = normalizeOracleText(String(ability.text || ability.effectText || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!(normalizedText.startsWith('cleave ') && normalizedText.includes('remove the words in square brackets'))) {
      return true;
    }

    // Reminder-only cleave lines may lower into unknown, grant_static_ability, and/or
    // "If you do, �" conditional tails after parenthetical splitting.
    return !ability.steps.every(
      (step) =>
        step.kind === 'unknown'
        || step.kind === 'grant_static_ability'
        || step.kind === 'conditional',
    );
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

export { CONVOKE_DELVE_INNER_REMINDER_PATTERN, normalizeReminderStepRaw };
