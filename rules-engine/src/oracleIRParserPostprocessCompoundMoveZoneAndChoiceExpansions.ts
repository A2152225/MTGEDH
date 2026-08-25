/**
 * Reminder prunes, compound move-zone splitting and choice expansion for the oracle IR
 * postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 23014-23891 of the
 * pre-split file).
 * Cluster moved: the static myriad reminder tail prune, paradigm keyword expansion, duplicate
 * graveyard / equipment bleed / indestructible reminder prunes, the conditional graveyard and
 * exile-permission follow-up merges, mixed battlefield-and-graveyard exile splitting, compound
 * move-zone splitting, and the as-enters choice plus chosen-color protection expansions.
 * Public entry symbols: pruneStaticMyriadReminderTailAbilities, expandParadigmKeywordAbilities,
 * pruneDuplicateGraveyardReminderAbilities, pruneEquipmentBleedSteps,
 * pruneIndestructibleDestroyReminderSteps, mergeConditionalGraveyardReminderFollowupAbilities,
 * mergeExilePermissionCastCounterFollowupAbilities,
 * expandMixedBattlefieldAndGraveyardExileAbilities, expandCompoundMoveZoneAbilities,
 * expandChoiceUnknownAbilities, expandChosenColorProtectionAbilities.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { counterRecordFromAddCounterStep } from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import { isDestroyReminderFragment } from './oracleIRParserPostprocessLifeDestroyLibrarySearchSteps';
import { splitConjoinedMoveZoneFollowup } from './oracleIRParserPostprocessMoveZoneFollowupUpgrades';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

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
        /^whenever it attacks, for each opponent other than defending player, you may create a token copy (?:that(?:'|’)?s|that is) tapped and attacking that player/i.test(raw)
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

function isEquipmentBleedDiscardStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'discard') return false;
  const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim().toLowerCase();
  return /\bequip\s*\{/.test(normalizedRaw);
}

export function pruneEquipmentBleedSteps(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => {
    const filteredSteps = ability.steps.filter((step) => !isEquipmentBleedDiscardStep(step));
    return filteredSteps.length === ability.steps.length ? ability : { ...ability, steps: filteredSteps };
  });
}

function isIndestructibleDestroyReminderStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'destroy') return false;
  const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim().toLowerCase();
  return isDestroyReminderFragment(normalizedRaw)
    || normalizeOracleText(String((step.target as any)?.text || '')).trim().toLowerCase() === 'them';
}

export function pruneIndestructibleDestroyReminderSteps(
  abilities: readonly OracleIRAbility[],
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const filteredSteps = ability.steps.filter((step) => !isIndestructibleDestroyReminderStep(step));
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

function trySplitBattlefieldAndOtherZoneCompoundStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  if (step.kind !== 'move_zone' || step.what.kind !== 'raw') return null;

  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\s+/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  const whatText = normalizeOracleText(String(step.what.text || ''))
    .replace(/[.]+$/g, '')
    .trim();

  const sharedMeta = {
    ...(step.optional ? { optional: step.optional } : {}),
    ...(step.sequence ? { sequence: step.sequence } : {}),
  };

  if (
    /^put that card onto the battlefield and put all other cards revealed this way into your graveyard$/i.test(raw) ||
    /^that card onto the battlefield and put all other cards revealed this way$/i.test(whatText)
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('that card'),
        to: 'battlefield',
        toRaw: 'the battlefield',
        raw: 'put that card onto the battlefield',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('all other cards revealed this way'),
        to: 'graveyard',
        toRaw: 'your graveyard',
        raw: 'put all other cards revealed this way into your graveyard',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
    ];
  }

  if (
    /^put that card onto the battlefield and the rest into your graveyard$/i.test(raw) ||
    /^that card onto the battlefield and the rest$/i.test(whatText)
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('that card'),
        to: 'battlefield',
        toRaw: 'the battlefield',
        raw: 'put that card onto the battlefield',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('the rest'),
        to: 'graveyard',
        toRaw: 'your graveyard',
        raw: 'put the rest into your graveyard',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
    ];
  }

  if (
    /^put that card onto the battlefield and shuffle all other cards revealed this way into your library$/i.test(raw) ||
    /^that card onto the battlefield and shuffle all other cards revealed this way into your library$/i.test(whatText)
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('that card'),
        to: 'battlefield',
        toRaw: 'the battlefield',
        raw: 'put that card onto the battlefield',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('all other cards revealed this way'),
        to: 'library',
        toRaw: 'your library',
        raw: 'shuffle all other cards revealed this way into your library',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
    ];
  }

  if (
    /^put that card onto the battlefield tapped under your control and the rest into their graveyard$/i.test(raw) ||
    /^that card onto the battlefield tapped under your control and the rest$/i.test(whatText)
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('that card'),
        to: 'battlefield',
        toRaw: 'the battlefield tapped under your control',
        battlefieldController: { kind: 'you' },
        entersTapped: true,
        raw: 'put that card onto the battlefield tapped under your control',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('the rest'),
        to: 'graveyard',
        toRaw: 'their graveyard',
        raw: 'put the rest into their graveyard',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
    ];
  }

  if (
    /^put one of them onto the battlefield tapped and the other into your hand$/i.test(raw) ||
    /^one of them onto the battlefield tapped and the other$/i.test(whatText)
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('one of them onto the battlefield tapped and the other'),
        to: 'hand',
        toRaw: 'your hand',
        raw: 'put one of them onto the battlefield tapped and the other into your hand',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
    ];
  }

  if (
    /^put all cards from the pile of your choice onto the battlefield under your control and the rest into their owners' graveyards$/i.test(
      raw
    ) ||
    /^all cards from the pile of your choice onto the battlefield under your control and the rest$/i.test(whatText)
  ) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('all cards from the pile of your choice'),
        to: 'battlefield',
        toRaw: 'the battlefield under your control',
        battlefieldController: { kind: 'you' },
        raw: 'put all cards from the pile of your choice onto the battlefield under your control',
        ...sharedMeta,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('the rest'),
        to: 'graveyard',
        toRaw: "their owners' graveyards",
        raw: "put the rest into their owners' graveyards",
        ...sharedMeta,
      } as unknown as OracleEffectStep,
    ];
  }

  return null;
}

function trySplitOpportunisticDragonCompoundStep(step: OracleEffectStep): readonly OracleEffectStep[] | null {
  const raw = normalizeOracleText(String(step.raw || ''))
    .replace(/^�\s*/, '')
    .replace(/[.)"]+$/g, '')
    .trim();
  const match = raw.match(
    /^for as long as this creature remains on the battlefield, gain control of that permanent, it loses all abilities, and it can(?:'|\u2019)?t attack(?: or block)?\.?$/i
  );
  if (!match) return null;

  const sharedMeta = step.sequence ? { sequence: step.sequence } : {};
  return [
    {
      kind: 'gain_control',
      what: parseObjectSelector('that permanent'),
      newController: { kind: 'you' },
      duration: 'static',
      raw,
      ...sharedMeta,
    } as unknown as OracleEffectStep,
    {
      kind: 'cant_attack',
      target: parseObjectSelector('that permanent'),
      duration: 'static',
      raw: "that permanent can't attack",
      ...sharedMeta,
    } as unknown as OracleEffectStep,
    {
      kind: 'cant_block',
      target: parseObjectSelector('that permanent'),
      duration: 'static',
      raw: "that permanent can't block",
      ...sharedMeta,
    } as unknown as OracleEffectStep,
  ];
}

function mapAndSplitCompoundMoveZoneSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const expanded: OracleEffectStep[] = [];

  for (const step of steps) {
    if (step.kind === 'conditional' || step.kind === 'unless_pays_life' || step.kind === 'unless_pays_mana') {
      const nested = mapAndSplitCompoundMoveZoneSteps(step.steps);
      if (nested.length !== step.steps.length || nested.some((nestedStep, index) => nestedStep !== step.steps[index])) {
        expanded.push({ ...step, steps: nested } as unknown as OracleEffectStep);
        continue;
      }
    }

    if (step.kind === 'choose_mode') {
      let modeChanged = false;
      const nextModes = step.modes.map(mode => {
        const nested = mapAndSplitCompoundMoveZoneSteps(mode.steps);
        if (nested.length === mode.steps.length && nested.every((nestedStep, index) => nestedStep === mode.steps[index])) {
          return mode;
        }
        modeChanged = true;
        return { ...mode, steps: nested };
      });
      if (modeChanged) {
        expanded.push({ ...step, modes: nextModes } as unknown as OracleEffectStep);
        continue;
      }
    }

    const split = trySplitBattlefieldAndOtherZoneCompoundStep(step);
    if (split) {
      expanded.push(...split);
      continue;
    }

    if (step.kind === 'move_zone') {
      const conjoined = splitConjoinedMoveZoneFollowup(step);
      if (conjoined) {
        expanded.push(...conjoined);
        continue;
      }
    }

    const opportunisticSplit = trySplitOpportunisticDragonCompoundStep(step);
    if (opportunisticSplit) {
      expanded.push(...opportunisticSplit);
      continue;
    }

    expanded.push(step);
  }

  return expanded;
}

export function expandCompoundMoveZoneAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map(ability => {
    const steps = mapAndSplitCompoundMoveZoneSteps(ability.steps);
    return steps.length === ability.steps.length && steps.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps };
  });
}

const ALL_COLOR_MANA_OPTIONS = ['{W}', '{U}', '{B}', '{R}', '{G}'] as const;
const COLOR_WORD_TO_MANA_SYMBOL: Record<string, string> = {
  white: '{W}',
  blue: '{U}',
  black: '{B}',
  red: '{R}',
  green: '{G}',
};

function parseAsEntersChooseStepsFromText(rawText: string, sequence?: 'then'): OracleEffectStep[] | null {
  const normalized = normalizeOracleText(String(rawText || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const asEntersChoose = normalized.match(
    /^(?:as\s+.+?\s+enters(?:\s+the\s+battlefield)?,?\s+)?(?:you\s+may\s+)?choose\s+(.+)$/i,
  );
  if (!asEntersChoose) return null;
  const choiceBody = String(asEntersChoose[1] || '').trim();
  if (!choiceBody) return null;

  const optional = /you\s+may\s+choose/i.test(normalized) || undefined;
  const seq = sequence ? { sequence } : {};
  const steps: OracleEffectStep[] = [];

  const otherThanColor = choiceBody.match(/^a\s+colou?r\s+other\s+than\s+(white|blue|black|red|green)$/i);
  if (otherThanColor) {
    const excluded = COLOR_WORD_TO_MANA_SYMBOL[String(otherThanColor[1] || '').toLowerCase()];
    steps.push({
      kind: 'choose_color',
      manaOptions: ALL_COLOR_MANA_OPTIONS.filter((symbol) => symbol !== excluded),
      ...(optional ? { optional: true } : {}),
      ...seq,
      raw: normalized,
    });
    return steps;
  }

  if (/^a\s+colou?r\s+word$/i.test(choiceBody)) {
    steps.push({
      kind: 'choose_color',
      manaOptions: [...ALL_COLOR_MANA_OPTIONS],
      ...(optional ? { optional: true } : {}),
      ...seq,
      raw: normalized,
    });
    return steps;
  }

  if (/^a\s+colou?r\s+and\s+a\s+creature\s+type$/i.test(choiceBody)) {
    steps.push({
      kind: 'choose_color',
      manaOptions: [...ALL_COLOR_MANA_OPTIONS],
      ...seq,
      raw: normalized,
    });
    steps.push({
      kind: 'choose_creature_type',
      sequence: 'then',
      raw: 'Choose a creature type',
    });
    return steps;
  }

  const colorAndPlayer = choiceBody.match(/^a\s+colou?r\s+and\s+(an\s+opponent|a\s+player)$/i);
  if (colorAndPlayer) {
    const opponentOnly = /opponent/i.test(String(colorAndPlayer[1] || ''));
    steps.push({
      kind: 'choose_color',
      manaOptions: [...ALL_COLOR_MANA_OPTIONS],
      ...seq,
      raw: normalized,
    });
    steps.push({
      kind: opponentOnly ? 'choose_opponent' : 'player_choice',
      ...(opponentOnly ? {} : { choice: 'generic' as const, choiceText: 'Choose a player' }),
      sequence: 'then',
      raw: opponentOnly ? 'Choose an opponent' : 'Choose a player',
    } as OracleEffectStep);
    return steps;
  }

  if (/^a\s+basic\s+land\s+type$/i.test(choiceBody)) {
    steps.push({
      kind: 'choose_basic_land_type',
      ...(optional ? { optional: true } : {}),
      ...seq,
      raw: normalized,
    });
    return steps;
  }

  if (/^a\s+creature\s+type$/i.test(choiceBody)) {
    steps.push({
      kind: 'choose_creature_type',
      ...(optional ? { optional: true } : {}),
      ...seq,
      raw: normalized,
    });
    return steps;
  }

  const creatureTypeOtherThan = choiceBody.match(/^a\s+creature\s+type\s+other\s+than\s+(.+)$/i);
  if (creatureTypeOtherThan) {
    const excludedTypes = String(creatureTypeOtherThan[1] || '')
      .split(/\s*,\s*|\s+or\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    steps.push({
      kind: 'choose_creature_type',
      ...(excludedTypes.length > 0 ? { excludedTypes } : {}),
      ...(optional ? { optional: true } : {}),
      ...seq,
      raw: normalized,
    });
    return steps;
  }

  if (/^a\s+colou?r$/i.test(choiceBody)) {
    steps.push({
      kind: 'choose_color',
      manaOptions: [...ALL_COLOR_MANA_OPTIONS],
      ...(optional ? { optional: true } : {}),
      ...seq,
      raw: normalized,
    });
    return steps;
  }

  return null;
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

  if (/^choose (?:an opponent|target opponent)(?:\s+at\s+random|\s+who\s+.+)?$/i.test(normalized)) {
    return {
      kind: 'choose_opponent',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const asEnters = parseAsEntersChooseStepsFromText(normalized, step.sequence);
  if (asEnters && asEnters.length === 1) return asEnters[0]!;

  return null;
}

function expandCompoundOrMisparsedChooseStep(step: OracleEffectStep): OracleEffectStep[] | null {
  const raw = String((step as any).raw || '');
  const effectText = Array.isArray((step as any).effectText)
    ? String((step as any).effectText[0] || '')
    : '';
  const candidate = raw || effectText;
  if (!candidate) return null;

  // Expand compound choose_color that only captured the color half.
  if (step.kind === 'choose_color' && /choose\s+a\s+colou?r\s+and\s+a\s+creature\s+type/i.test(candidate)) {
    return [
      step,
      {
        kind: 'choose_creature_type',
        sequence: 'then',
        raw: 'Choose a creature type',
      },
    ];
  }
  if (step.kind === 'choose_color' && /choose\s+a\s+colou?r\s+and\s+an\s+opponent/i.test(candidate)) {
    return [
      step,
      {
        kind: 'choose_opponent',
        sequence: 'then',
        raw: 'Choose an opponent',
      },
    ];
  }
  if (step.kind === 'choose_color' && /choose\s+a\s+colou?r\s+and\s+a\s+player/i.test(candidate)) {
    return [
      step,
      {
        kind: 'player_choice',
        choice: 'generic',
        choiceText: 'Choose a player',
        sequence: 'then',
        raw: 'Choose a player',
      } as OracleEffectStep,
    ];
  }

  // Recover residual grant_static_ability / unknown choose clauses.
  if (step.kind === 'unknown' || step.kind === 'grant_static_ability') {
    const recovered = parseAsEntersChooseStepsFromText(candidate, (step as any).sequence);
    if (recovered && recovered.length > 0) return recovered;
  }

  return null;
}

export function expandChoiceUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      const multi = expandCompoundOrMisparsedChooseStep(step);
      if (multi) {
        changed = true;
        expandedSteps.push(...multi);
        continue;
      }

      if (step.kind === 'unknown') {
        const expanded = parseChoiceUnknownStep(step);
        if (expanded) {
          changed = true;
          expandedSteps.push(expanded);
          continue;
        }
      }

      expandedSteps.push(step);
    }

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

function expandChosenColorProtectionGrantStep(
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_ability' }>
): readonly OracleEffectStep[] | null {
  const granted = [
    ...(Array.isArray(step.abilities) ? step.abilities : []),
    ...(Array.isArray(step.effectText) ? step.effectText : []),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const raw = normalizeOracleText(String(step.raw || '')).trim();
  const isChosenColorProtection =
    granted.some((text) => /^protection from the color of your choice$/i.test(text)) ||
    /gains?\s+protection from the color of your choice/i.test(raw);
  if (!isChosenColorProtection) return null;

  const { effectText: _ignoredEffectText, ...grantWithoutChoiceText } = step;
  return [
    {
      kind: 'choose_color',
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: 'Choose a color',
    },
    {
      ...grantWithoutChoiceText,
      abilities: ['protection from the chosen color'],
    } as OracleEffectStep,
  ];
}

export function expandChosenColorProtectionAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps: OracleEffectStep[] = [];

    for (const step of ability.steps) {
      if (step.kind === 'grant_temporary_ability') {
        const expandedGrant = expandChosenColorProtectionGrantStep(step);
        if (expandedGrant) {
          changed = true;
          expandedSteps.push(...expandedGrant);
          continue;
        }
      }

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

export {
  isReminderGenericGraveyardGrant,
  isReminderSelfExileStep,
  isReminderSelfGraveyardGrant,
};
