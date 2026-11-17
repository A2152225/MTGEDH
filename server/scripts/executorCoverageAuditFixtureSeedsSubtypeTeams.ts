/**
 * Gap-closure fixture seeds for mass-selector clauses (subtype teams, counters, combat bindings).
 * Origin parent: executorCoverageAuditFixtureSeeds.ts (enrichExecutorCoverageGapFixtureSeeds).
 * Public: enrichExecutorCoverageSubtypeTeamSeeds.
 *
 * Generic: driven by selector phrases in the clause text, never by card name.
 */
import type { GameState } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes.js';
import type { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

type AuditCtx = ReturnType<typeof buildOracleIRExecutionContext>;

function withBattlefieldPerm(state: GameState, perm: any): GameState {
  const battlefield = Array.isArray(state.battlefield) ? [...(state.battlefield as any[])] : [];
  const id = String(perm?.id || '').trim();
  const idx = battlefield.findIndex((entry) => String(entry?.id || '').trim() === id);
  if (idx >= 0) battlefield[idx] = { ...battlefield[idx], ...perm };
  else battlefield.push(perm);
  return { ...state, battlefield } as GameState;
}

function creaturePerm(id: string, controller: string, typeLine: string, extra: Record<string, unknown> = {}): any {
  return {
    id,
    controller,
    owner: controller,
    name: `Audit ${id}`,
    type_line: typeLine,
    power: 2,
    toughness: 2,
    card: { name: `Audit ${id}`, type_line: typeLine, ...(extra.keywords ? { keywords: extra.keywords } : {}) },
    ...extra,
  };
}

const SUBTYPE_PHRASES: readonly RegExp[] = [
  /\b(?:each|all)\s+(?:other\s+|another\s+)?([a-z][a-z/ -]*?)(?:\s+creatures?)?\s+you control/g,
  /\bother\s+([a-z]+)\s+you control/g,
  /\b([a-z]+)\s+creatures?\s+(?:you control\s+)?(?:get|gain|have)\b/g,
  /that(?:'s| is)\s+an?\s+([a-z]+)\s+or\s+an?\s+([a-z]+)/g,
  /\b([a-z]+s)\s+you control(?:\s+other\s+than)?/g,
];

/** Creature types named by team selectors ("other Humans you control", "Elf creatures get", "Ape or a Monkey"). */
function collectSubtypeTeamTypes(text: string): string[] {
  const types = new Set<string>();
  for (const pattern of SUBTYPE_PHRASES) {
    for (const match of text.matchAll(pattern)) {
      for (const group of match.slice(1)) {
        for (const word of String(group || '').split(/[^a-z]+/)) {
          const type = normalizeCreatureTypeWord(word);
          if (type) types.add(type);
        }
      }
    }
  }
  return [...types];
}

function titleCase(word: string): string {
  return word.replace(/(^|[ -])([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

export function enrichExecutorCoverageSubtypeTeamSeeds(
  text: string,
  state: GameState,
  ctx: AuditCtx,
): { state: GameState; ctx: AuditCtx } {
  let nextState = state;
  let nextCtx = ctx;

  for (const type of collectSubtypeTeamTypes(text)) {
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm(`bf-audit-team-${type.replace(/\s+/g, '-')}`, 'p1', `Creature — ${titleCase(type)}`),
    );
  }

  if (/planeswalkers? you control/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-planeswalker',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Planeswalker',
      type_line: 'Legendary Planeswalker — Audit',
      loyalty: 3,
      counters: { loyalty: 3 },
      card: { name: 'Audit Planeswalker', type_line: 'Legendary Planeswalker — Audit', loyalty: '3' },
    });
  }

  if (/equipment you control/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-equipment',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Equipment',
      type_line: 'Artifact — Equipment',
      card: { name: 'Audit Equipment', type_line: 'Artifact — Equipment' },
    });
  }

  const counterNames = new Set<string>();
  for (const match of text.matchAll(/with an? ([a-z0-9+/\- ]+?) counters? on (?:it|them)/g)) {
    counterNames.add(String(match[1] || '').trim());
  }
  if (/with an? counters? on (?:it|them)/.test(text)) counterNames.add('+1/+1');
  if (counterNames.size > 0) {
    const counters: Record<string, number> = {};
    for (const name of counterNames) counters[name] = 1;
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm('bf-audit-countered', 'p1', 'Creature — Soldier', { counters }),
    );
  }

  const seedSourceName = String((ctx as any).sourceName || '').trim();
  if (
    seedSourceName
    && (/\bnamed (?:this permanent|this creature)\b/.test(text) || text.includes(`named ${seedSourceName.toLowerCase()}`))
  ) {
    const sourceName = seedSourceName;
    nextState = withBattlefieldPerm(nextState, {
      ...creaturePerm('bf-audit-namesake', 'p1', 'Creature — Soldier'),
      name: sourceName,
      card: { name: sourceName, type_line: 'Creature — Soldier' },
    });
  }

  const powerCondition = text.match(/creature with power (\d+) or greater/);
  if (powerCondition) {
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm('bf-audit-big-creature', 'p1', 'Creature — Giant', { power: Number(powerCondition[1]) }),
    );
  }

  if (/blocking it|blocking this creature|blocked this combat|blocked by/.test(text)) {
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm('bf-audit-blocker', 'p2', 'Creature — Soldier', {
        blocking: ['bf-source'],
        isBlocking: true,
      }),
    );
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm('bf-audit-blocked', 'p2', 'Creature — Soldier', {
        attacking: true,
        blockedBy: [{ blockerId: 'bf-source' }],
      }),
    );
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) =>
        String(perm?.id || '') === 'bf-source'
          ? {
              ...perm,
              blocking: Array.isArray(perm.blocking) ? [...perm.blocking, 'bf-audit-blocked'] : ['bf-audit-blocked'],
              blockedBy: [{ blockerId: 'bf-audit-blocker' }],
            }
          : perm,
      ),
    } as GameState;
  }

  if (/attacking red creatures|attacking white creatures/.test(text)) {
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm('bf-audit-attacker-red', 'p1', 'Creature — Soldier', {
        attacking: true,
        isAttacking: true,
        colors: ['R'],
        card: { name: 'Audit Red Attacker', type_line: 'Creature — Soldier', colors: ['R'] },
      }),
    );
    nextState = withBattlefieldPerm(
      nextState,
      creaturePerm('bf-audit-attacker-white', 'p1', 'Creature — Soldier', {
        attacking: true,
        isAttacking: true,
        colors: ['W'],
        card: { name: 'Audit White Attacker', type_line: 'Creature — Soldier', colors: ['W'] },
      }),
    );
  }

  if (/\b(?:each of )?those creatures\b/.test(text)) {
    nextState = withBattlefieldPerm(nextState, creaturePerm('bf-audit-antecedent-1', 'p2', 'Creature — Soldier'));
    nextState = withBattlefieldPerm(nextState, creaturePerm('bf-audit-antecedent-2', 'p2', 'Creature — Soldier'));
    nextCtx = {
      ...nextCtx,
      lastAntecedentBattlefieldPermanentIds: ['bf-audit-antecedent-1', 'bf-audit-antecedent-2'],
    } as AuditCtx;
  }

  if (/unlocked doors among rooms/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-room',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Room',
      type_line: 'Enchantment — Room',
      unlockedDoors: ['left', 'right'],
      card: { name: 'Audit Room', type_line: 'Enchantment — Room' },
    });
  }

  if (/sacrificed creature's (?:power|toughness|mana value)/.test(text)) {
    nextCtx = {
      ...nextCtx,
      lastSacrificedPermanents: [
        {
          id: 'bf-audit-sacrificed',
          name: 'Audit Sacrificed Creature',
          type_line: 'Creature — Giant',
          power: 3,
          toughness: 3,
          card: { name: 'Audit Sacrificed Creature', type_line: 'Creature — Giant', power: '3', toughness: '3' },
        },
      ],
    } as AuditCtx;
  }

  if (/same name as that creature/.test(text)) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        referencedObjectName: 'Audit Referenced Creature',
      },
    } as AuditCtx;
    nextState = withBattlefieldPerm(nextState, {
      ...creaturePerm('bf-audit-same-name-token', 'p1', 'Token Creature — Soldier'),
      name: 'Audit Referenced Creature',
      isToken: true,
      card: { name: 'Audit Referenced Creature', type_line: 'Token Creature — Soldier' },
    });
  }

  if (/tokens created with this/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      ...creaturePerm('bf-audit-created-token', 'p1', 'Token Creature — Soldier'),
      isToken: true,
      createdBySourceId: 'bf-source',
    });
  }

  if (/creatures? that convoked/.test(text)) {
    nextState = withBattlefieldPerm(nextState, creaturePerm('bf-audit-convoker', 'p1', 'Creature — Soldier'));
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        convokedCreatureIds: ['bf-audit-convoker'],
      },
    } as AuditCtx;
  }

  return { state: nextState, ctx: nextCtx };
}
