/**
 * Final step-shape repairs for the oracle IR postprocess pass.
 *
 * Origin parent: rules-engine/src/oracleIRParserPostprocess.ts (lines 28139-29087 of the
 * pre-split file - the whole tail).
 * Cluster moved: choose-mode bullet absorption, move-zone selector repair, the elided-subject
 * repairs (that player hand-bottom then draw, target player draw then discard), graveyard
 * choose-then-return, compound exile-look, Eventide draw/lose-life, random choose-mode sagas,
 * monarch and adjacent-spell "instead" conditionals, create-token follow-up absorption, and
 * the ignorable reminder unknown prune.
 * Public entry symbols: the repair and prune passes exported inline below; repairMoveZoneStep
 * is re-exported at the foot of this file for the postprocess parent.
 */
import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { repairAnyPlayerMayTaxSteps } from './oracleIRAnyPlayerMay';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOps';
import { repairGainControlCompoundRiderSteps } from './oracleIRGainControlCompoundRepair';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import {
  parseLifeTailStep,
  parseSimpleCounterTailStep,
} from './oracleIRParserPostprocessBattlefieldEntryCounterAndDrawLife';
import {
  appendFollowupSentence,
  isCopyAbilityUnknownStep,
  parseCopySpellRetargetTail,
} from './oracleIRParserPostprocessCopySpellTailHelpers';
import { parseCopySpellUnknownStep } from './oracleIRParserPostprocessCopySpellUnknownSteps';
import { parseBattlefieldControllerForPostprocess } from './oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import {
  tryParseCreateTokenFollowupModifier,
  type CreateTokenFollowupModifier,
} from './oracleIRParserTokenFollowup';
import {
  normalizeOracleText,
  parseObjectSelector,
  parsePlayerSelector,
  splitIntoClauses,
} from './oracleIRParserUtils';
import { repairRemoveCountersCostReduceSteps } from './oracleIRRemoveCountersCostReduce';

function absorbChooseModeBulletSteps(
  steps: readonly OracleEffectStep[],
  startIndex: number
): { readonly consumed: number; readonly modeSteps: readonly OracleEffectStep[] } {
  const bulletSteps: OracleEffectStep[] = [steps[startIndex]];
  let scan = startIndex + 1;
  if (
    scan < steps.length &&
    bulletSteps[0].kind === 'draw' &&
    steps[scan].kind === 'lose_life' &&
    /\bdraw a card\b/i.test(String(bulletSteps[0].raw || '')) &&
    /\bloses?\s+1\s+life\b/i.test(String(steps[scan].raw || ''))
  ) {
    bulletSteps.push(steps[scan]);
    scan += 1;
  }
  return { consumed: scan - startIndex, modeSteps: bulletSteps };
}

export function repairSplitChooseModeBulletSteps(
  steps: readonly OracleEffectStep[]
): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    if (step.kind !== 'choose_mode') {
      out.push(step);
      index += 1;
      continue;
    }

    const minModes = Math.max(0, Number((step as any).minModes) || 0);
    const modes = Array.isArray((step as any).modes) ? [...(step as any).modes] : [];
    let scan = index + 1;

    // Shared-characteristics modes (Outlaws' Merriment): the effect sits in a lead sentence and each
    // bullet only supplies power/toughness, subtypes, and abilities. The lead is not a mode of its
    // own - it is the template every bullet fills in.
    const sharedLead = steps[scan];
    const sharedLeadRaw = String((sharedLead as any)?.raw || '');
    const sharedLeadMatch =
      sharedLead?.kind === 'create_token'
        ? sharedLeadRaw.match(/\bcreate\s+(?:a|an|one)\s+(.+?)\s+creature token\s+with those characteristics\b/i)
        : null;
    if (sharedLeadMatch) {
      const sharedColors = String(sharedLeadMatch[1] || '').trim();
      const bulletModes: Array<{ label: string; raw: string; steps: OracleEffectStep[] }> = [];
      let bulletScan = scan + 1;
      while (bulletScan < steps.length) {
        const bulletRaw = String(steps[bulletScan]?.raw || '').trim();
        if (!/^[\u2022\uFFFD]\s*/.test(bulletRaw)) break;
        const body = bulletRaw.replace(/^[\u2022\uFFFD]\s*/, '').replace(/\.\s*$/, '').trim();
        const bulletMatch = body.match(/^(\d+\/\d+)\s+(.+?)(?:\s+with\s+([\s\S]+))?$/i);
        if (!bulletMatch) break;
        const [, powerToughness, subtypes, abilities] = bulletMatch;
        const descriptor =
          `${powerToughness} ${sharedColors} ${String(subtypes || '').trim()} creature` +
          (abilities ? ` with ${String(abilities).trim()}` : '');
        bulletModes.push({
          label: `Mode ${bulletModes.length + 1}`,
          raw: body,
          steps: [
            {
              ...(sharedLead as any),
              token: descriptor,
              raw:
                `Create a ${descriptor.replace(/\s+creature\b/, ' creature token')}` +
                (/["'.]$/.test(descriptor) ? '' : '.'),
            } as OracleEffectStep,
          ],
        });
        bulletScan += 1;
      }

      if (bulletModes.length > 0) {
        out.push({ ...step, modes: bulletModes, raw: bulletModes.map((mode) => mode.raw).join('\n\u2022 ') } as OracleEffectStep);
        index = bulletScan;
        continue;
      }
    }

    while (scan < steps.length) {
      const nextRaw = String(steps[scan]?.raw || '').trim();
      const needsMoreModes = modes.length < minModes;
      const looksLikeBullet = /^[\u2022�]\s*/.test(nextRaw);
      const looksLikeTargetPlayerMode = /^target player\b/i.test(nextRaw.replace(/^[\u2022�]\s*/, ''));
      if (!needsMoreModes && !looksLikeBullet && !looksLikeTargetPlayerMode) break;
      const absorbed = absorbChooseModeBulletSteps(steps, scan);
      const label = String(absorbed.modeSteps[0]?.raw || '')
        .replace(/^[\u2022�]\s*/, '')
        .trim();
      modes.push({
        label: `Mode ${modes.length + 1}`,
        raw: label || `Mode ${modes.length + 1}`,
        steps: [...absorbed.modeSteps],
      });
      scan += absorbed.consumed;
    }

    out.push({
      ...step,
      modes,
      raw: modes.map((mode) => mode.raw).join('\n\u2022 '),
    });
    index = scan;
  }
  return out;
}

export function repairSplitChooseModeBulletAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = repairSplitChooseModeBulletSteps(ability.steps);
    return steps !== ability.steps ? { ...ability, steps } : ability;
  });
}

function parseCountWord(token: string): number | null {
  const lower = String(token || '').trim().toLowerCase();
  const byWord: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  if (byWord[lower] !== undefined) return byWord[lower];
  const parsed = Number.parseInt(lower, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function repairMoveZoneStep(step: OracleEffectStep): OracleEffectStep {
  if (step.kind !== 'move_zone') return step;
  let next = step;
  const what = (step as any).what;
  if (what?.kind === 'raw') {
    const normalizedWhat = normalizeBoundPlayerZoneSelectorText(String(what.text || ''));
    if (normalizedWhat && normalizedWhat !== String(what.text || '')) {
      next = { ...next, what: parseObjectSelector(normalizedWhat) };
    }
  }
  if (next.to === 'battlefield' && !next.battlefieldController && next.toRaw) {
    const controller = parseBattlefieldControllerForPostprocess(String(next.toRaw || ''));
    if (controller) next = { ...next, battlefieldController: controller };
  }
  return next;
}

export function repairMoveZoneSelectorSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => repairMoveZoneStep(step));
}

/** After "that player puts hand on bottom�", elided "then draws that many" must keep that player. */
export function repairThatPlayerHandBottomThenDrawSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    if (
      step?.kind === 'move_zone'
      && next?.kind === 'draw'
      && step.to === 'library'
      && (step.libraryPlacement === 'bottom' || /\bbottom\b/i.test(String(step.toRaw || '')))
      && /that player's hand|their hand/i.test(String((step.what as any)?.text || step.raw || ''))
      && (next.amount as any)?.kind === 'reference_amount'
      && /that many/i.test(String((next.amount as any)?.raw || ''))
      && (next.who as any)?.kind === 'you'
      && (/^then\b/i.test(String(next.raw || '')) || next.sequence === 'then')
    ) {
      out.push(step);
      out.push({
        ...next,
        who: parsePlayerSelector('that player'),
      } as OracleEffectStep);
      index += 1;
      continue;
    }
    out.push(step);
  }
  return out;
}

export function repairGraveyardChooseThenReturnSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    const next = steps[index + 1];
    if (
      step.kind === 'choose_target_creature' &&
      next?.kind === 'move_zone' &&
      /each of them/i.test(String((next as any).what?.text || '')) &&
      next.to === 'battlefield'
    ) {
      const chooseText = String((step as any).target?.text || step.raw || '');
      const chooseRaw = String(step.raw || '');
      const fullMatch = chooseRaw.match(
        /choose up to (\w+) target creature cards with total mana value (\d+) or less in your graveyard/i
      );
      const partialMatch = chooseText.match(
        /(?:up to (\w+) )?target creature cards with total mana value (\d+) or less in your graveyard/i
      );
      const maxToken = String(fullMatch?.[1] || partialMatch?.[1] || 'three').trim();
      const totalMv = Number.parseInt(String(fullMatch?.[2] || partialMatch?.[2] || ''), 10);
      if (Number.isFinite(totalMv)) {
        out.push({
          ...next,
          what: parseObjectSelector(
            `up to ${maxToken} creature cards with total mana value ${totalMv} or less from your graveyard`
          ),
          optional: (step as any).optional,
          raw: `Return up to ${maxToken} target creature cards with total mana value ${totalMv} or less from your graveyard to the battlefield`,
        });
        index += 2;
        continue;
      }
    }
    out.push(step);
    index += 1;
  }
  return out;
}

export function repairCompoundExileLookSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  for (const step of steps) {
    if (step.kind !== 'exile') {
      out.push(step);
      continue;
    }
    const targetText = String((step as any).target?.text || '').trim();
    if (
      /^the top card of your library face down and look at it$/i.test(targetText) ||
      /^exile the top card of your library face down and look at it$/i.test(String(step.raw || ''))
    ) {
      out.push({
        kind: 'exile',
        target: parseObjectSelector('the top card of your library'),
        raw: 'Exile the top card of your library face down',
      } as unknown as OracleEffectStep);
      out.push({
        kind: 'look_top',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'look at it',
      } as unknown as OracleEffectStep);
      continue;
    }
    out.push(step);
  }
  return out;
}

export function repairEventideDrawLoseLifeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => {
    if (
      step.kind === 'draw' &&
      (step as any).amount?.kind === 'reference_amount' &&
      String((step as any).amount?.raw || '').trim().toLowerCase() === 'cards'
    ) {
      return {
        ...step,
        amount: { kind: 'reference_amount', raw: 'that many' },
      };
    }
    return step;
  });
}

function parseEffectClausesToSteps(text: string): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  for (const clause of splitIntoClauses(text)) {
    const cleaned = String(clause || '').trim().replace(/^�\s*/, '');
    if (!cleaned) continue;
    const simple = parseSimpleCounterTailStep(cleaned);
    if (simple) {
      out.push(simple);
      continue;
    }
    const combat = parseLifeTailStep(cleaned);
    if (combat) out.push(combat);
  }
  return out;
}

/**
 * Extracts a trailing quoted ability (e.g. `with haste and "When this token enters, ..."`)
 * from a token characteristics fragment, returning the plain descriptor with the quoted
 * text removed and the quoted ability text(s) separately so they can be re-attached in the
 * canonical `with "..."` shape that {@link resolveTokenCharacteristicsFromOracleStep}
 * recognizes regardless of what word (if any) originally preceded the quote.
 */
function extractBulletQuotedAbilityTail(text: string): { plain: string; quoted: string[] } {
  const quoted: string[] = [];
  const plain = String(text || '')
    .replace(/\s*(?:and|or)?\s*"([^"]+)"/gi, (_match, ability: string) => {
      const trimmed = String(ability || '').trim();
      if (trimmed) quoted.push(trimmed);
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { plain, quoted };
}

/**
 * Builds a free-text token descriptor for a "choose one at random" bullet that only lists
 * per-mode characteristics (e.g. `3/1 Human Warrior with trample and haste`), combining it
 * with the shared color/adjective clause from the lead sentence (e.g. `red and white`) so the
 * resulting `create_token` step carries a complete descriptor including keyword abilities.
 */
function buildSharedCharacteristicTokenDescriptor(bulletCharacteristics: string, colorClause: string): string {
  const { plain, quoted } = extractBulletQuotedAbilityTail(bulletCharacteristics);
  const ptMatch = plain.match(/^(\d+\/\d+)\s+(.*)$/);
  const base = ptMatch
    ? `${ptMatch[1]} ${colorClause} ${ptMatch[2]}`
    : `${colorClause} ${plain}`;
  const withQuoted = quoted.length > 0 ? `${base} with "${quoted.join('" and "')}"` : base;
  return withQuoted.replace(/\s+/g, ' ').trim();
}

export function repairRandomChooseModeSagaAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const effectText = String(ability.effectText || ability.text || '').trim();
    if (!/choose one at random/i.test(effectText)) return ability;

    const normalized = normalizeOracleText(effectText).replace(/\s+/g, ' ');
    const bulletIndex = normalized.search(/�/);
    if (bulletIndex < 0) return ability;
    const leadText = normalized.slice(0, bulletIndex).trim();
    const sharedTokenLead = leadText.match(
      /\bcreate\s+(?:a|an)\s+(.+?)\s+(?:creature\s+)?tokens?\s+with\s+those\s+characteristics\b/i
    );
    const parts = normalized
      .slice(bulletIndex)
      .split(/\s*�\s*/)
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    if (parts.length < 2) return ability;

    const modes = parts
      .map((body, index) => {
        const labeled = body.match(/^(.+?!)\s*[-��]\s*(.+)$/);
        const label = labeled ? String(labeled[1] || '').trim() : `Mode ${index + 1}`;
        const modeBody = labeled ? String(labeled[2] || '').trim() : body;
        let steps: OracleEffectStep[] | null = null;
        if (sharedTokenLead && !/^create(?:s)?\b/i.test(modeBody)) {
          const colorClause = String(sharedTokenLead[1] || '').trim();
          const bulletCharacteristics = modeBody.replace(/[.]+$/, '').trim();
          if (colorClause && bulletCharacteristics) {
            const tokenDescriptor = buildSharedCharacteristicTokenDescriptor(bulletCharacteristics, colorClause);
            steps = [
              {
                kind: 'create_token',
                who: { kind: 'you' },
                amount: { kind: 'number', value: 1 },
                token: tokenDescriptor,
                raw: `Create a ${colorClause} creature token with those characteristics: ${bulletCharacteristics}`,
              } as unknown as OracleEffectStep,
            ];
          }
        }
        if (!steps || steps.length === 0) steps = parseEffectClausesToSteps(modeBody);
        if (steps.length === 0) return null;
        return { label, raw: modeBody, steps };
      })
      .filter(Boolean) as Array<{ label: string; raw: string; steps: OracleEffectStep[] }>;

    if (modes.length < 2) return ability;

    return {
      ...ability,
      steps: [
        {
          kind: 'choose_mode',
          minModes: 1,
          maxModes: 1,
          modes,
          raw: 'Choose one at random',
        } as unknown as OracleEffectStep,
      ],
    };
  });
}

/**
 * Folds the common "BASE. If you're the monarch, instead ALT." shape (e.g. Court of
 * Ambition) into a single `conditional` step with `steps` = the parsed ALT effect and
 * `elseSteps` = the preceding BASE step(s), instead of leaving the "instead" sentence as
 * an unparsed residual/unknown tail. Only applies when the ALT clause parses into at
 * least one executable step and the ability has base steps to use as the fallback.
 */
export function repairMonarchInsteadConditionalAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const MONARCH_INSTEAD_RAW = /^if\s+you(?:'|�)?re\s+the\s+monarch,\s*instead\s+(.+?)[.\s]*$/i;
  const MONARCH_MILL_INSTEAD_RAW =
    /^if\s+you(?:'|�)?re\s+the\s+monarch,\s*(?:each of those players|those players|they)\s+mills?\s+(.+?)\s+instead[.\s]*$/i;

  const foldMonarchMillInstead = (
    baseMill: Extract<OracleEffectStep, { kind: 'mill' }>,
    insteadStep: OracleEffectStep,
    raw: string
  ): OracleEffectStep | null => {
    const millInsteadMatch = String(insteadStep.raw || '').match(MONARCH_MILL_INSTEAD_RAW);
    const quantityTail = String(millInsteadMatch?.[1] || '').trim();
    if (!quantityTail) return null;
    const altMill = tryParseSimpleActionClause({
      clause: `each of those players mills ${quantityTail}`,
      rawClause: String(insteadStep.raw || '').trim(),
      withMeta: (candidate) => candidate,
    });
    if (altMill?.kind !== 'mill') return null;
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: "you're the monarch" },
      steps: [{ ...altMill, who: baseMill.who }],
      elseSteps: [baseMill],
      raw,
    } as unknown as OracleEffectStep;
  };

  const withinAbility = abilities.map((ability) => {
    const steps = ability.steps || [];
    if (steps.length < 2) return ability;

    const millInsteadIndex = steps.findIndex((candidate) =>
      MONARCH_MILL_INSTEAD_RAW.test(String(candidate.raw || ''))
    );
    if (millInsteadIndex > 0 && steps[millInsteadIndex - 1]?.kind === 'mill') {
      const baseMill = steps[millInsteadIndex - 1] as Extract<OracleEffectStep, { kind: 'mill' }>;
      const folded = foldMonarchMillInstead(
        baseMill,
        steps[millInsteadIndex],
        String(ability.effectText || ability.text || '').trim()
      );
      if (folded) {
        return {
          ...ability,
          steps: [
            ...steps.slice(0, millInsteadIndex - 1),
            folded,
            ...steps.slice(millInsteadIndex + 1),
          ],
        };
      }
    }

    const insteadIndex = steps.findIndex((candidate) => MONARCH_INSTEAD_RAW.test(String(candidate.raw || '')));
    if (insteadIndex <= 0) return ability;

    const insteadStep = steps[insteadIndex];
    const match = String(insteadStep.raw || '').match(MONARCH_INSTEAD_RAW);
    const altText = String(match?.[1] || '').trim();
    if (!altText) return ability;

    const altStep = tryParseLifeAndCombatClause({
      clause: altText,
      rawClause: altText,
      withMeta: (candidate) => candidate,
    });
    if (!altStep) return ability;

    const baseSteps = steps.slice(0, insteadIndex);
    const trailingSteps = steps.slice(insteadIndex + 1);

    return {
      ...ability,
      steps: [
        {
          kind: 'conditional',
          condition: { kind: 'if', raw: "you're the monarch" },
          steps: [altStep],
          elseSteps: baseSteps,
          raw: String(ability.effectText || ability.text || '').trim(),
        } as unknown as OracleEffectStep,
        ...trailingSteps,
      ],
    };
  });

  const mergedAbilities: OracleIRAbility[] = [];
  for (let index = 0; index < withinAbility.length; index += 1) {
    const current = withinAbility[index];
    const next = withinAbility[index + 1];
    const currentSteps = current?.steps || [];
    const lastStep = currentSteps[currentSteps.length - 1];
    const nextStep = next?.steps.length === 1 ? next.steps[0] : undefined;
    if (lastStep?.kind === 'mill' && nextStep && MONARCH_MILL_INSTEAD_RAW.test(String(nextStep.raw || ''))) {
      const folded = foldMonarchMillInstead(
        lastStep,
        nextStep,
        `${String(current.effectText || current.text || '').trim()} ${String(next.effectText || next.text || '').trim()}`.trim()
      );
      if (folded) {
        mergedAbilities.push({
          ...current,
          text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
          effectText: folded.raw,
          steps: [...currentSteps.slice(0, -1), folded],
        });
        index += 1;
        continue;
      }
    }
    mergedAbilities.push(current);
  }

  return repairAdjacentSpellInsteadConditionalAbilities(mergedAbilities);
}

function abilityLooksLikeSpellResolution(ability: OracleIRAbility): boolean {
  return String(ability?.type || '').toLowerCase() === 'spell';
}

function conditionalStepHasInsteadSemantics(step: OracleEffectStep): boolean {
  if (String(step?.kind || '') !== 'conditional') return false;
  const raw = String((step as any).raw || '');
  return /\binstead\b/i.test(raw);
}

/**
 * Fold adjacent spell abilities "BASE. Threshold/Delirium � ALT instead if COND."
 * into one conditional with elseSteps = BASE (Cabal Ritual, Traverse, Whispers).
 */
export function repairAdjacentSpellInsteadConditionalAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  if (abilities.length < 2) return [...abilities];

  const out: OracleIRAbility[] = [];
  for (let index = 0; index < abilities.length; index += 1) {
    const current = abilities[index];
    const next = abilities[index + 1];
    if (
      current
      && next
      && abilityLooksLikeSpellResolution(current)
      && abilityLooksLikeSpellResolution(next)
      && (current.steps || []).length > 0
      && (next.steps || []).length === 1
      && conditionalStepHasInsteadSemantics(next.steps[0]!)
      && Array.isArray((next.steps[0] as any).steps)
      && (next.steps[0] as any).steps.length > 0
      && !Array.isArray((next.steps[0] as any).elseSteps)
    ) {
      const conditional = next.steps[0] as any;
      out.push({
        ...next,
        text: `${String(current.text || '').trim()} ${String(next.text || '').trim()}`.trim(),
        effectText: `${String(current.effectText || current.text || '').trim()} ${String(next.effectText || next.text || '').trim()}`.trim(),
        steps: [
          {
            ...conditional,
            elseSteps: [...(current.steps || [])],
            raw: String(conditional.raw || next.effectText || next.text || '').trim(),
          } as OracleEffectStep,
        ],
      });
      index += 1;
      continue;
    }
    out.push(current);
  }
  return out;
}

function repairEmblemWithNestedConditionalSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    if (
      step.kind === 'create_emblem' &&
      next?.kind === 'conditional' &&
      /would be put into your graveyard/i.test(String((next as any).condition?.raw || ''))
    ) {
      out.push({
        ...step,
        abilities: [
          'You may cast instant and sorcery spells from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.',
        ],
      });
      index += 1;
      continue;
    }
    out.push(step);
  }
  return out;
}

function repairFroghemothCounterAndLifeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => {
    if (
      step.kind === 'add_counter' &&
      /this creature for each creature card exiled this way/i.test(String((step as any).target?.text || step.raw || ''))
    ) {
      return {
        ...step,
        target: parseObjectSelector('this creature'),
        raw: 'Put a +1/+1 counter on this creature for each creature card exiled this way',
      };
    }
    if (
      step.kind === 'gain_life' &&
      (step as any).amount?.kind === 'reference_amount' &&
      /noncreature card exiled this way/i.test(String((step as any).amount?.raw || ''))
    ) {
      return {
        ...step,
        amount: { kind: 'reference_amount', raw: 'noncreature cards exiled this way' },
      };
    }
    return step;
  });
}

function repairFightDamageSourceSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'deal_damage') return step;
    const sourceText = String((step as any).source?.text || '').trim();
    if (!/fights?\b/i.test(sourceText) && !/this creature/i.test(sourceText)) return step;
    const cleanedSource = sourceText.replace(/^[^-�]*[-��]\s*/i, '').trim() || 'this creature';
    return {
      ...step,
      source: parseObjectSelector(/^this creature$/i.test(cleanedSource) ? 'this creature' : cleanedSource),
    };
  });
}

function repairCopyRetargetTailSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];

  const repaired: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    const retargetTail = parseCopySpellRetargetTail(next);
    if (
      current
      && retargetTail
      && (
        current.kind === 'copy_spell'
        || current.kind === 'copy_ability'
        || (current.kind === 'unknown' && isCopyAbilityUnknownStep(current))
      )
    ) {
      if (current.kind === 'copy_spell' || current.kind === 'copy_ability') {
        repaired.push({
          ...current,
          allowNewTargets: true,
          raw: appendFollowupSentence(String(current.raw || '').trim(), retargetTail),
        } as unknown as OracleEffectStep);
      } else {
        const parsed = parseCopySpellUnknownStep(
          current as Extract<OracleEffectStep, { kind: 'unknown' }>,
          next,
        );
        if (parsed) {
          repaired.push(parsed);
        } else {
          repaired.push(current);
        }
      }
      index += 1;
      continue;
    }
    repaired.push(current);
  }
  return repaired;
}

function applyCreateTokenFollowupModifier(
  step: Extract<OracleEffectStep, { kind: 'create_token' }>,
  mod: CreateTokenFollowupModifier,
): Extract<OracleEffectStep, { kind: 'create_token' }> {
  return {
    ...step,
    ...(mod.entersTapped ? { entersTapped: true } : {}),
    ...(mod.withCounters ? { withCounters: { ...(step.withCounters || {}), ...mod.withCounters } } : {}),
    ...(mod.grantsHaste ? { grantsHaste: mod.grantsHaste } : {}),
    ...(mod.grantsAbilitiesUntilEndOfTurn
      ? {
          grantsAbilitiesUntilEndOfTurn: Array.from(
            new Set([...(step.grantsAbilitiesUntilEndOfTurn || []), ...mod.grantsAbilitiesUntilEndOfTurn]),
          ),
        }
      : {}),
    ...(mod.atNextEndStep ? { atNextEndStep: mod.atNextEndStep } : {}),
    ...(mod.atEndOfCombat ? { atEndOfCombat: mod.atEndOfCombat } : {}),
  };
}

function tryAbsorbCreateTokenFollowupStep(
  step: OracleEffectStep,
  target: { container: OracleEffectStep[]; index: number },
): boolean {
  const current = target.container[target.index];
  if (!current || current.kind !== 'create_token') return false;

  const mod = tryParseCreateTokenFollowupModifier(String(step.raw || ''));
  if (mod) {
    target.container[target.index] = applyCreateTokenFollowupModifier(current, mod);
    return true;
  }

  const normalizedRaw = normalizeOracleText(String(step.raw || '')).trim();
  if (step.kind === 'grant_static_ability' && /^those tokens gain haste$/i.test(normalizedRaw)) {
    target.container[target.index] = { ...current, grantsHaste: 'permanent' };
    return true;
  }

  if (
    step.kind === 'schedule_delayed_battlefield_action' &&
    /\bexile\b/i.test(normalizedRaw) &&
    /\bnext\s+end\s+step\b/i.test(normalizedRaw)
  ) {
    target.container[target.index] = { ...current, atNextEndStep: 'exile' };
    return true;
  }

  return false;
}

function mergeAdjacentCreateTokenFollowupSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const out: OracleEffectStep[] = [];
  let absorbTarget: { container: OracleEffectStep[]; index: number } | null = null;

  for (const step of steps) {
    if (absorbTarget && tryAbsorbCreateTokenFollowupStep(step, absorbTarget)) {
      continue;
    }

    if (step.kind === 'conditional' && Array.isArray(step.steps)) {
      const nested = mergeAdjacentCreateTokenFollowupSteps(step.steps);
      const folded: OracleEffectStep = { ...step, steps: nested };
      out.push(folded);
      if (nested.length === 1 && nested[0]?.kind === 'create_token') {
        absorbTarget = { container: nested as unknown as OracleEffectStep[], index: 0 };
      } else {
        absorbTarget = null;
      }
      continue;
    }

    out.push(step);
    absorbTarget = step.kind === 'create_token' ? { container: out, index: out.length - 1 } : null;
  }

  return out;
}


/** "Target player draws N, then discards" � elided then-discard keeps that player. */
export function repairTargetPlayerDrawThenDiscardSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const next = steps[index + 1];
    if (
      step?.kind === 'draw'
      && next?.kind === 'discard'
      && (step.who as any)?.kind === 'target_player'
      && (next.who as any)?.kind === 'you'
      && (/^then\b/i.test(String(next.raw || '')) || next.sequence === 'then')
    ) {
      out.push(step);
      out.push({
        ...next,
        who: parsePlayerSelector('target player'),
      } as OracleEffectStep);
      index += 1;
      continue;
    }
    out.push(step);
  }
  return out;
}

/**
 * Distended Mindbender-style: reveal hand + "You choose from it A and B" grant_static
 * + discard those cards ? drop the static grant and stamp dual-filter discard target.
 */
export function repairRevealHandChooseFromItDiscardSteps(
  steps: readonly OracleEffectStep[],
): OracleEffectStep[] {
  if (steps.length < 2) return [...steps];
  const out: OracleEffectStep[] = [];
  let index = 0;
  while (index < steps.length) {
    const step = steps[index];
    const mid = steps[index + 1];
    const end = steps[index + 2];
    const chooseRaw = String((mid as any)?.raw || (mid as any)?.effectText?.[0] || '').replace(/\u2019/g, "'");
    const chooseMatch = chooseRaw.match(/^you choose from it (.+)$/i);
    if (
      step?.kind === 'reveal_hand'
      && mid?.kind === 'grant_static_ability'
      && chooseMatch
      && end?.kind === 'discard'
      && /those cards/i.test(String((end as any)?.target?.text || end.raw || ''))
    ) {
      const filterText = String(chooseMatch[1] || '').trim().replace(/\.$/, '');
      const andParts = filterText.split(/\s+and\s+/i).map((part: string) => part.trim()).filter(Boolean);
      const amountValue = Math.max(1, andParts.length || 2);
      out.push(step);
      out.push({
        ...end,
        who: (step as any).who?.kind === 'target_opponent'
          ? { kind: 'target_opponent' }
          : ((end as any).who || { kind: 'target_player' }),
        amount: { kind: 'number', value: amountValue },
        target: { kind: 'raw', text: filterText },
        raw: String(end.raw || 'That player discards those cards'),
      } as OracleEffectStep);
      index += 3;
      continue;
    }
    out.push(step);
    index += 1;
  }
  return out;
}

function mapChooseModeNestedRepairs(
  steps: readonly OracleEffectStep[],
  repair: (inner: readonly OracleEffectStep[]) => OracleEffectStep[],
): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'choose_mode' || !Array.isArray((step as any).modes)) return step;
    let changed = false;
    const modes = (step as any).modes.map((mode: any) => {
      const nested = repair(mode.steps || []);
      if (nested !== mode.steps) changed = true;
      return nested === mode.steps ? mode : { ...mode, steps: nested };
    });
    return changed ? { ...step, modes } : step;
  });
}

function repairAbilityExecutionSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const repairedFlat = mergeAdjacentCreateTokenFollowupSteps(
    repairFightDamageSourceSteps(
    repairFroghemothCounterAndLifeSteps(
      repairEmblemWithNestedConditionalSteps(
        repairEventideDrawLoseLifeSteps(
          repairCompoundExileLookSteps(
            repairGraveyardChooseThenReturnSteps(
              repairCopyRetargetTailSteps(
                repairRevealHandChooseFromItDiscardSteps(
                  repairTargetPlayerDrawThenDiscardSteps(
                    repairThatPlayerHandBottomThenDrawSteps(
                      repairRemoveCountersCostReduceSteps(
                        repairGainControlCompoundRiderSteps(
                          repairAnyPlayerMayTaxSteps(
                            repairMoveZoneSelectorSteps(steps),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  ),
  );
  // Choose-mode bullets are parsed in isolation; re-run draw-then-discard repair inside modes.
  return mapChooseModeNestedRepairs(repairedFlat, (inner) =>
    repairTargetPlayerDrawThenDiscardSteps(inner),
  );
}

export function repairGapClosureAbilitySteps(abilities: readonly OracleIRAbility[]): OracleIRAbility[] {
  return abilities.map((ability) => ({
    ...ability,
    steps: repairAbilityExecutionSteps(ability.steps),
  }));
}

function isIgnorableEffectReminderUnknownRaw(raw: string): boolean {
  const n = normalizeOracleText(String(raw || '')).toLowerCase();
  if (!n) return true;
  return (
    /^token creation metadata$/i.test(n) ||
    /^draw a card\.?$/.test(n) ||
    /^while each one is exiled, its owner may cast it for/.test(n) ||
    /^a food token is an artifact with/.test(n) ||
    /^a treasure token is an artifact with/.test(n) ||
    /^\{s\} can be paid with one mana from a snow source/.test(n) ||
    /^tap it\./.test(n) ||
    /^this land enters tapped unless/.test(n) ||
    /^with two \+1\/\+1 counters on it unless two or more colors of mana were spent to cast it$/.test(n)
  );
}

function pruneIgnorableUnknownStepsFromTree(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const pruned: OracleEffectStep[] = [];
  for (const step of steps) {
    if (step.kind === 'unknown' && isIgnorableEffectReminderUnknownRaw(String(step.raw || ''))) {
      continue;
    }
    if (step.kind === 'conditional' && Array.isArray(step.steps)) {
      const nested = pruneIgnorableUnknownStepsFromTree(step.steps);
      pruned.push(nested === step.steps ? step : { ...step, steps: nested });
      continue;
    }
    if (step.kind === 'choose_mode' && Array.isArray((step as any).modes)) {
      const modes = (step as any).modes.map((mode: { steps?: readonly OracleEffectStep[] }) => ({
        ...mode,
        steps: Array.isArray(mode?.steps) ? pruneIgnorableUnknownStepsFromTree(mode.steps) : mode?.steps,
      }));
      pruned.push({ ...step, modes } as unknown as OracleEffectStep);
      continue;
    }
    pruned.push(step);
  }
  return pruned;
}

export function pruneIgnorableEffectReminderUnknownSteps(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    const steps = pruneIgnorableUnknownStepsFromTree(ability.steps);
    return steps.length === ability.steps.length && steps.every((step, index) => step === ability.steps[index])
      ? ability
      : { ...ability, steps };
  });
}
export { repairMoveZoneStep };
