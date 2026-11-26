/**
 * Gap-closure fixture seeds for executor:coverage dry-runs.
 * Origin parent: executor-coverage-audit.ts enrichAuditStateAndContextForTargets.
 * Public: enrichExecutorCoverageGapFixtureSeeds.
 *
 * Keeps the mega audit file from growing; seed only what the Batch B–F closures need.
 */
import type { GameState } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

import { enrichExecutorCoverageSubtypeTeamSeeds } from './executorCoverageAuditFixtureSeedsSubtypeTeams.js';
import { bindAuditHandExileChoices } from './executorCoverageAuditHandExileChoiceSeeds.js';

type AuditCtx = ReturnType<typeof buildOracleIRExecutionContext>;

function oracleBlob(steps: readonly OracleEffectStep[], oracleText?: string): string {
  return [
    String(oracleText || ''),
    ...steps.map((step) => String((step as any)?.raw || '')),
    ...steps.map((step) => String((step as any)?.target?.text || '')),
    ...steps.map((step) => String((step as any)?.what?.text || '')),
    ...steps.map((step) => String((step as any)?.amount?.raw || '')),
    ...steps.map((step) => String((step as any)?.scaler?.raw || '')),
  ]
    .join(' ')
    .toLowerCase();
}

function withBattlefieldPerm(state: GameState, perm: any): GameState {
  const battlefield = Array.isArray(state.battlefield) ? [...(state.battlefield as any[])] : [];
  const id = String(perm?.id || '').trim();
  const idx = battlefield.findIndex((entry) => String(entry?.id || '').trim() === id);
  if (idx >= 0) battlefield[idx] = { ...battlefield[idx], ...perm };
  else battlefield.push(perm);
  return { ...state, battlefield } as GameState;
}

function patchSource(state: GameState, patch: Record<string, unknown>): GameState {
  return {
    ...state,
    battlefield: ((state.battlefield || []) as any[]).map((perm: any) => {
      if (String(perm?.id || '').trim() !== 'bf-source') return perm;
      return { ...perm, ...patch };
    }),
  } as GameState;
}

export function enrichExecutorCoverageGapFixtureSeeds(
  steps: readonly OracleEffectStep[],
  state: GameState,
  ctx: AuditCtx,
  options?: { readonly oracleText?: string },
): { state: GameState; ctx: AuditCtx } {
  let nextState = state;
  let nextCtx = ctx;
  const text = oracleBlob(steps, options?.oracleText);

  if (/\brats?\b/.test(text) && /you control/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-rat-1',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Rat',
      type_line: 'Creature — Rat',
      power: 1,
      toughness: 1,
      card: { name: 'Audit Rat', type_line: 'Creature — Rat' },
    });
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-rat-2',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Rat 2',
      type_line: 'Creature — Rat',
      power: 1,
      toughness: 1,
      card: { name: 'Audit Rat 2', type_line: 'Creature — Rat' },
    });
  }

  if (/attacking creatures with flying|blocking creatures with flying|creatures with flying/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-flyer-atk',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Flyer',
      type_line: 'Creature — Bird',
      power: 2,
      toughness: 2,
      attacking: true,
      keywords: ['flying'],
      card: { name: 'Audit Flyer', type_line: 'Creature — Bird', keywords: ['flying'] },
    });
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-flyer-block',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Blocker Flyer',
      type_line: 'Creature — Bird',
      power: 2,
      toughness: 2,
      blocking: true,
      isBlocking: true,
      keywords: ['flying'],
      card: { name: 'Audit Blocker Flyer', type_line: 'Creature — Bird', keywords: ['flying'] },
    });
  }

  if (/flanking/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-flanking',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Flanker',
      type_line: 'Creature — Knight',
      power: 2,
      toughness: 2,
      attacking: true,
      keywords: ['flanking'],
      card: { name: 'Audit Flanker', type_line: 'Creature — Knight', keywords: ['flanking'] },
    });
  }

  if (/first strike or double strike|double strike or first strike/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-first-strike',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit First Striker',
      type_line: 'Creature — Soldier',
      power: 2,
      toughness: 2,
      keywords: ['first strike'],
      card: { name: 'Audit First Striker', type_line: 'Creature — Soldier', keywords: ['first strike'] },
    });
  }

  if (/land creature/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-land-creature',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Land Creature',
      type_line: 'Land Creature — Elemental',
      power: 0,
      toughness: 0,
      card: { name: 'Audit Land Creature', type_line: 'Land Creature — Elemental' },
    });
  }

  if (/flash or haste|haste or flash/.test(text)) {
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-flash',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Flash',
      type_line: 'Creature — Wizard',
      power: 1,
      toughness: 1,
      keywords: ['flash'],
      card: { name: 'Audit Flash', type_line: 'Creature — Wizard', keywords: ['flash'] },
    });
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-haste',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Haste',
      type_line: 'Creature — Goblin',
      power: 1,
      toughness: 1,
      keywords: ['haste'],
      card: { name: 'Audit Haste', type_line: 'Creature — Goblin', keywords: ['haste'] },
    });
  }

  if (/number of times .* kicked|was kicked/.test(text) || /up to x targets/.test(text)) {
    nextState = patchSource(nextState, { wasKicked: true, kickedTimes: 2 });
  }

  if (/those creatures dealt|damage those creatures dealt/.test(text)) {
    nextState = {
      ...nextState,
      creaturesThatDealtDamageToPlayer: {
        ...((nextState as any).creaturesThatDealtDamageToPlayer || {}),
        p2: {
          ...(((nextState as any).creaturesThatDealtDamageToPlayer || {}).p2 || {}),
          'bf-source': { totalDamage: 3 },
          'bf-creature-1': { totalDamage: 2 },
        },
      },
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as AuditCtx;
  }

  if (/each other opponent|any other target|defending player controls/.test(text)) {
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      damagedPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        damagedPlayerId: 'p2',
      },
    } as AuditCtx;
  }

  if (/historic permanent|until you reveal a historic/.test(text)) {
    const historic = {
      id: 'lib-p2-historic-1',
      name: 'Audit Historic Artifact',
      type_line: 'Legendary Artifact',
      cmc: 3,
      manaValue: 3,
    };
    const filler = {
      id: 'lib-p2-filler-1',
      name: 'Audit Filler',
      type_line: 'Instant',
      cmc: 1,
      manaValue: 1,
    };
    nextState = {
      ...nextState,
      players: ((nextState.players || []) as any[]).map((player: any) => {
        if (String(player?.id || '') !== 'p2') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const hasHistoric = library.some((card: any) => String(card?.id || '') === historic.id);
        return {
          ...player,
          library: hasHistoric ? library : [filler, historic, ...library],
        };
      }),
      zones: {
        ...((nextState as any).zones || {}),
        p2: {
          ...(((nextState as any).zones || {}).p2 || {}),
          library: [
            filler,
            historic,
            ...(((((nextState as any).zones || {}).p2 || {}).library) || []),
          ],
        },
      },
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as AuditCtx;
  }

  if (/attacking creatures get|each attacking creature/.test(text)) {
    nextState = patchSource(nextState, { attacking: true, isAttacking: true });
    nextState = withBattlefieldPerm(nextState, {
      id: 'bf-audit-attacker-2',
      controller: 'p1',
      owner: 'p1',
      name: 'Audit Attacker',
      type_line: 'Creature — Soldier',
      power: 2,
      toughness: 2,
      attacking: true,
      card: { name: 'Audit Attacker', type_line: 'Creature — Soldier' },
    });
  }

  const seeded = enrichExecutorCoverageSubtypeTeamSeeds(text, nextState, nextCtx);
  return { state: seeded.state, ctx: bindAuditHandExileChoices(steps, seeded.state, seeded.ctx) };
}
