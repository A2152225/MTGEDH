// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Extracted from oracleIRParserPostprocess.ts: the keyword-action unknown-step lowering cluster (parseKeywordActionUnknownStep plus the turn-scoped static keyword list).
//
// Public entry points:
//   parseKeywordActionUnknownStep
//   expandKeywordActionUnknownAbilities
//   expandTurnScopedStaticKeywordAbilities

import type { OracleEffectStep, OracleIRAbility } from './oracleIR';
import { tryParseLifeAndCombatClause } from './oracleIRParserLifeAndCombatClauses';
import { tryParseTemporaryModifyPtClause } from './oracleIRParserModifyPtClauses';
import { tryParseSimpleActionClause } from './oracleIRParserSimpleActionClauses';
import { tryParseSimpleCreateTokenClause } from './oracleIRParserTokenSimpleClauses';
import {
  normalizeClauseForParse,
  normalizeOracleText,
  parseObjectSelector,
  parseQuantity,
  splitIntoClauses,
} from './oracleIRParserUtils';
import { tryParseZoneAndRemovalClause } from './oracleIRParserZoneAndRemovalActions';
import { parseKeywordActionAbility } from './oracleTextParserKeywordActionAbilities';

export function parseKeywordActionUnknownStep(step: Extract<OracleEffectStep, { kind: 'unknown' }>): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .trim();
  if (!normalized) return null;

  const adaptMatch = normalized.match(/^adapt\s+(\d+|x)$/i);
  if (adaptMatch) {
    return {
      kind: 'conditional',
      condition: { kind: 'if', raw: 'there are no +1/+1 counters on it' },
      steps: [
        {
          kind: 'add_counter',
          target: { kind: 'raw', text: 'this permanent' },
          counter: '+1/+1',
          amount: parseQuantity(String(adaptMatch[1] || '').trim()),
          raw: `Put ${String(adaptMatch[1] || '').toUpperCase()} +1/+1 counters on this permanent.`,
        },
      ],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const collectEvidenceMatch = normalized.match(/^collect evidence\s+(\d+)$/i);
  if (collectEvidenceMatch) {
    return {
      kind: 'collect_evidence',
      who: { kind: 'you' },
      amount: parseQuantity(String(collectEvidenceMatch[1] || '').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

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

  if (/^investigate$/i.test(normalized)) {
    return {
      kind: 'investigate',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^populate$/i.test(normalized)) {
    return {
      kind: 'populate',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^explore$/i.test(normalized)) {
    return {
      kind: 'explore',
      target: { kind: 'raw', text: 'this creature' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const airbendMatch = normalized.match(/^airbend\s+(.+)$/i);
  if (airbendMatch) {
    return {
      kind: 'airbend',
      target: parseObjectSelector(String(airbendMatch[1] || '').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const subjectExploreMatch = normalized.match(/^(.+?) explores(?: again)?$/i);
  if (subjectExploreMatch) {
    const subjectText = String(subjectExploreMatch[1] || '').trim();
    const normalizedSubject = normalizeOracleText(subjectText).replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = (
      normalizedSubject === 'it' || normalizedSubject === 'this creature'
    )
      ? 'this creature'
      : normalizedSubject === 'this permanent'
        ? 'this permanent'
        : subjectText;

    return {
      kind: 'explore',
      target: { kind: 'raw', text: targetText },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const timeTravelMatch = normalized.match(/^time travel(?:\s+(\d+|x|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+times?)?)?$/i);
  if (timeTravelMatch) {
    return {
      kind: 'time_travel',
      who: { kind: 'you' },
      amount: parseQuantity(String(timeTravelMatch[1] || '1').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const fatesealMatch = normalized.match(/^fateseal\s+(\d+|x)$/i);
  if (fatesealMatch) {
    return {
      kind: 'fateseal',
      who: { kind: 'you' },
      target: { kind: 'target_opponent' },
      amount: parseQuantity(String(fatesealMatch[1] || '').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const manifestTopCardMatch = normalized.match(
    /^manifest the top card of (your|that player's|target player's|target opponent's) library$/i
  );
  if (manifestTopCardMatch) {
    const libraryRef = String(manifestTopCardMatch[1] || '').toLowerCase();
    return {
      kind: 'move_zone',
      what: { kind: 'raw', text: `the top card of ${libraryRef} library` },
      to: 'battlefield',
      toRaw: 'battlefield face down',
      entersFaceDown: true,
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const cloakTopCardMatch = normalized.match(
    /^cloak the top card of (your|that player's|target player's|target opponent's) library$/i
  );
  if (cloakTopCardMatch) {
    const libraryRef = String(cloakTopCardMatch[1] || '').toLowerCase();
    return {
      kind: 'move_zone',
      what: { kind: 'raw', text: `the top card of ${libraryRef} library` },
      to: 'battlefield',
      toRaw: 'battlefield face down',
      entersFaceDown: true,
      faceDownWardCost: '{2}',
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^forage$/i.test(normalized)) {
    return {
      kind: 'choose_mode',
      minModes: 1,
      maxModes: 1,
      modes: [
        {
          label: 'Exile three cards from your graveyard',
          raw: 'Exile three cards from your graveyard',
          steps: [
            {
              kind: 'move_zone',
              what: { kind: 'raw', text: 'three cards from your graveyard' },
              to: 'exile',
              toRaw: 'exile',
              raw: 'Exile three cards from your graveyard',
            },
          ],
        },
        {
          label: 'Sacrifice a Food',
          raw: 'Sacrifice a Food',
          steps: [
            {
              kind: 'sacrifice',
              who: { kind: 'you' },
              what: { kind: 'raw', text: 'a Food' },
              raw: 'Sacrifice a Food',
            },
          ],
        },
      ],
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^exert$/i.test(normalized)) {
    return {
      kind: 'exert',
      target: { kind: 'raw', text: 'this permanent' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^open an attraction$/i.test(normalized)) {
    return {
      kind: 'open_attraction',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^roll to visit your attractions$/i.test(normalized)) {
    return {
      kind: 'roll_visit_attractions',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^take the initiative$/i.test(normalized)) {
    return {
      kind: 'take_initiative',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^become the monarch$/i.test(normalized)) {
    return {
      kind: 'become_monarch',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^venture into (?:the dungeon|undercity)$/i.test(normalized)) {
    return {
      kind: 'venture_into_dungeon',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^clash with an opponent$/i.test(normalized)) {
    return {
      kind: 'clash',
      who: { kind: 'you' },
      opponent: { kind: 'target_opponent' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  if (/^manifest dread$/i.test(normalized)) {
    return {
      kind: 'manifest_dread',
      who: { kind: 'you' },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const endureMatch = normalized.match(/^endure\s+(\d+)$/i);
  if (endureMatch) {
    const endureAmount = Number.parseInt(String(endureMatch[1] || '0'), 10);
    if (Number.isFinite(endureAmount) && endureAmount > 0) {
      return {
        kind: 'choose_mode',
        minModes: 1,
        maxModes: 1,
        modes: [
          {
            label: `Put ${endureAmount} +1/+1 counter${endureAmount === 1 ? '' : 's'} on this permanent`,
            raw: `Put ${endureAmount} +1/+1 counter${endureAmount === 1 ? '' : 's'} on this permanent`,
            steps: [
              {
                kind: 'add_counter',
                target: { kind: 'raw', text: 'this permanent' },
                counter: '+1/+1',
                amount: { kind: 'number', value: endureAmount },
                raw: `Put ${endureAmount} +1/+1 counter${endureAmount === 1 ? '' : 's'} on this permanent`,
              },
            ],
          },
          {
            label: `Create a ${endureAmount}/${endureAmount} white Spirit creature token`,
            raw: `Create a ${endureAmount}/${endureAmount} white Spirit creature token`,
            steps: [
              {
                kind: 'create_token',
                who: { kind: 'you' },
                amount: { kind: 'number', value: 1 },
                token: `${endureAmount}/${endureAmount} white Spirit`,
                raw: `Create a ${endureAmount}/${endureAmount} white Spirit creature token`,
              },
            ],
          },
        ],
        ...(step.sequence ? { sequence: step.sequence } : {}),
        raw: normalized,
      };
    }
  }

  const conniveMatch = normalized.match(/^connive(?:\s+(\d+|x))?$/i);
  if (conniveMatch) {
    return {
      kind: 'connive',
      target: { kind: 'raw', text: 'this creature' },
      amount: parseQuantity(String(conniveMatch[1] || '1').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const subjectConniveMatch = normalized.match(/^(.+?)\s+connives(?:\s+(\d+|x))?$/i);
  if (subjectConniveMatch) {
    const subjectText = String(subjectConniveMatch[1] || '').trim();
    const normalizedSubject = normalizeOracleText(subjectText).replace(/\s+/g, ' ').trim().toLowerCase();
    const targetText = (
      normalizedSubject === 'it' || normalizedSubject === 'this creature'
    )
      ? 'this creature'
      : normalizedSubject === 'this permanent'
        ? 'this permanent'
        : subjectText;

    return {
      kind: 'connive',
      target: { kind: 'raw', text: targetText },
      amount: parseQuantity(String(subjectConniveMatch[2] || '1').trim()),
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const goadMatch = normalized.match(/^goad\s+(.+)$/i);
  if (goadMatch) {
    return {
      kind: 'goad',
      target: { kind: 'raw', text: String(goadMatch[1] || '').trim() },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const suspectMatch = normalized.match(/^suspect\s+(.+)$/i);
  if (suspectMatch) {
    return {
      kind: 'suspect',
      target: { kind: 'raw', text: String(suspectMatch[1] || '').trim() },
      ...(step.sequence ? { sequence: step.sequence } : {}),
      raw: normalized,
    };
  }

  const expandedKeywordAction = parseKeywordActionAbility(normalized);
  if (expandedKeywordAction?.effect) {
    const expandedClauses = splitIntoClauses(String(expandedKeywordAction.effect || '').trim());
    if (expandedClauses.length === 1) {
      const rawClause = String(expandedClauses[0] || '').trim().replace(/[.]+$/g, '');
      if (rawClause) {
        const normalizedClause = normalizeClauseForParse(rawClause);
        const withMeta = <T extends OracleEffectStep>(candidate: T): T => {
          const out: any = { ...candidate };
          if (step.sequence) out.sequence = step.sequence;
          return out;
        };

        const parsed =
          tryParseSimpleActionClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseTemporaryModifyPtClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseLifeAndCombatClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseSimpleCreateTokenClause({ clause: normalizedClause.clause, rawClause, withMeta }) ??
          tryParseZoneAndRemovalClause({ clause: normalizedClause.clause, rawClause, withMeta });

        if (parsed) {
          return parsed;
        }
      }
    }
  }

  return null;
}

const TURN_SCOPED_STATIC_KEYWORD_ABILITIES = new Set([
  'banding',
  'flying',
  'trample',
  'vigilance',
  'lifelink',
  'deathtouch',
  'reach',
  'menace',
  'hexproof',
  'indestructible',
  'first strike',
  'double strike',
  'haste',
  'ward',
]);

function parseTurnScopedStaticKeywordList(raw: string): string[] | null {
  const normalized = String(raw || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const abilities: string[] = [];
  for (const part of parts) {
    if (!TURN_SCOPED_STATIC_KEYWORD_ABILITIES.has(part)) return null;
    if (!abilities.includes(part)) abilities.push(part);
  }

  return abilities.length > 0 ? abilities : null;
}

function parseTurnScopedStaticKeywordUnknownStep(
  step: Extract<OracleEffectStep, { kind: 'unknown' }>
): OracleEffectStep | null {
  const normalized = normalizeOracleText(String(step.raw || ''))
    .replace(/^then\b\s*/i, '')
    .replace(/[.]+$/g, '')
    .trim();
  if (!normalized) return null;

  const match = normalized.match(/^during your turn,\s+(.+?)\s+(?:has|have)\s+(.+)$/i);
  if (!match) return null;

  const abilities = parseTurnScopedStaticKeywordList(String(match[2] || '').trim());
  if (!abilities) return null;

  return {
    kind: 'conditional',
    condition: { kind: 'if', raw: "it's your turn" },
    steps: [
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(match[1] || '').trim()),
        duration: 'this_turn',
        abilities,
        raw: normalized,
      },
    ],
    ...(step.sequence ? { sequence: step.sequence } : {}),
    raw: normalized,
  };
}

export function expandKeywordActionUnknownAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  const expandStep = (step: OracleEffectStep): OracleEffectStep => {
    if (step.kind === 'conditional') {
      const conditional = step as Extract<OracleEffectStep, { kind: 'conditional' }>;
      const nested = (conditional.steps || []).map((inner) => expandStep(inner));
      if (nested.some((inner, index) => inner !== conditional.steps[index])) {
        return { ...conditional, steps: nested };
      }
      return step;
    }
    if (step.kind !== 'unknown') return step;
    const expanded = parseKeywordActionUnknownStep(step);
    return expanded || step;
  };

  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      const next = expandStep(step);
      if (next !== step) changed = true;
      return next;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

export function expandTurnScopedStaticKeywordAbilities(
  abilities: readonly OracleIRAbility[]
): OracleIRAbility[] {
  return abilities.map((ability) => {
    let changed = false;
    const expandedSteps = ability.steps.map((step) => {
      if (step.kind !== 'unknown') return step;
      const expanded = parseTurnScopedStaticKeywordUnknownStep(step);
      if (!expanded) return step;
      changed = true;
      return expanded;
    });

    return changed ? { ...ability, steps: expandedSteps } : ability;
  });
}

