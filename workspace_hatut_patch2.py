from pathlib import Path

SERVER = Path(r"D:\Git\MTGEDH\server\src\state\modules")
TESTS = Path(r"D:\Git\MTGEDH\server\tests")
RE = Path(r"D:\Git\MTGEDH\rules-engine\src")

# Patch Jeska block to use shared helper
jeska_path = SERVER / 'stackResolvePermanentEntryUtils.ts'
jeska_text = jeska_path.read_text(encoding='utf-8')
imp = "import { deriveSelfEntryCountersFromOracleIR } from '../../../../rules-engine/src/oracleIRSelfEntryCounters.js';\n"
imp_new = imp + "import { resolveCommanderCastsFromCommandZoneThisGame } from '../../../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';\n"
if "oracleIRExecutorCommanderCastCount" not in jeska_text:
    if imp not in jeska_text:
        raise SystemExit('jeska import anchor missing')
    jeska_text = jeska_text.replace(imp, imp_new, 1)

old_jeska = """  if (isPlaneswalker && (
    oracleTextLower.includes("enters with a loyalty counter") && 
    oracleTextLower.includes("for each time") && 
    oracleTextLower.includes("commander from the command zone")
  )) {
    // Count commander casts from tax
    // Per MTG rules, commander tax increases by {2} for each time the commander has been cast
    // from the command zone. Therefore, tax / 2 = number of times cast from command zone.
    const commandZone = (state as any).commandZone?.[controller];
    let totalCommanderCasts = 0;
    
    if (commandZone?.taxById) {
      // Sum up all commander casts: (tax / 2) for each commander in the command zone
      for (const [, tax] of Object.entries(commandZone.taxById)) {
        const taxNumber = typeof tax === 'number' ? tax : 0;
        // Commander tax = 2 * number_of_casts, so casts = tax / 2
        totalCommanderCasts += Math.floor(taxNumber / 2);
      }
    }
    
    // Add loyalty for each commander cast (including Jeska herself if she was just cast from command zone)
    if (totalCommanderCasts > 0) {
      initialCounters.loyalty = (initialCounters.loyalty || 0) + totalCommanderCasts;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} (Jeska-style): enters with ${totalCommanderCasts} additional loyalty for commander casts`);
    }
  }"""

new_jeska = """  if (isPlaneswalker && (
    oracleTextLower.includes("enters with a loyalty counter") && 
    oracleTextLower.includes("for each time") && 
    oracleTextLower.includes("commander from the command zone")
  )) {
    // Same authoritative CZ-cast count as Hatut-style "copy it for each time you've cast your commander..."
    // (taxById sum / 2, with explicit commanderCastsFromCommandZoneThisGame fallback).
    const totalCommanderCasts = resolveCommanderCastsFromCommandZoneThisGame(state as any, controller);
    
    // Add loyalty for each commander cast (including Jeska herself if she was just cast from command zone)
    if (totalCommanderCasts > 0) {
      initialCounters.loyalty = (initialCounters.loyalty || 0) + totalCommanderCasts;
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} (Jeska-style): enters with ${totalCommanderCasts} additional loyalty for commander casts`);
    }
  }"""

if old_jeska not in jeska_text:
    raise SystemExit('jeska block not found exactly')
jeska_text = jeska_text.replace(old_jeska, new_jeska, 1)
jeska_path.write_text(jeska_text, encoding='utf-8', newline='\n')
print('patched Jeska')

# Harden server resolveServerStackCopyCount: if metadata says 0 for commander-copy reference, re-resolve
sync_path = SERVER / 'oracleIrServerCopySpellSync.ts'
sync_text = sync_path.read_text(encoding='utf-8')
old_imp = """import {
  resolveCopiedTargetSpellStackItem,
  resolveCopySpellCount,
} from '../../../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
"""
new_imp = """import {
  resolveCopiedTargetSpellStackItem,
  resolveCopySpellCount,
} from '../../../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../../../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';
"""
if "oracleIRExecutorCommanderCastCount" not in sync_text:
    if old_imp not in sync_text:
        raise SystemExit('sync import missing')
    sync_text = sync_text.replace(old_imp, new_imp, 1)

old_count = """function resolveServerStackCopyCount(
  state: any,
  controller: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  irCtx: OracleIRExecutionContext,
  params: {
    sourceItem?: any;
    oracleText?: string;
    gapMetadata?: Record<string, unknown>;
  },
): number {
  if (step.copies?.kind === 'spells_cast_before_this_turn') {
    const stormCount = resolveSpellsCastBeforeThisTurnCopyCount(state, controller);
    if (stormCount > 0) return stormCount;
  }

  const metadataCount = Number(params.gapMetadata?.copyCount);
  if (Number.isFinite(metadataCount) && metadataCount >= 0) {
    let count = Math.max(0, metadataCount);
    if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
      count = 2;
    }
    return count;
  }

  let count = Math.max(0, resolveCopySpellCount(state, controller, step, irCtx));
  if (
    step.copies?.kind === 'spells_cast_before_this_turn'
    && count <= 0
  ) {
    count = resolveSpellsCastBeforeThisTurnCopyCount(state, controller);
  }
  if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
    count = 2;
  }
  return count;
}"""

new_count = """function isCommanderCastFromCommandZoneCopyStep(
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
): boolean {
  if (step.copies?.kind !== 'reference_amount') return false;
  const raw = String(step.copies.raw || '').trim().toLowerCase();
  return /commander.*command zone.*this game/.test(raw);
}

function resolveServerStackCopyCount(
  state: any,
  controller: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'copy_spell' }>,
  irCtx: OracleIRExecutionContext,
  params: {
    sourceItem?: any;
    oracleText?: string;
    gapMetadata?: Record<string, unknown>;
  },
): number {
  if (step.copies?.kind === 'spells_cast_before_this_turn') {
    const stormCount = resolveSpellsCastBeforeThisTurnCopyCount(state, controller);
    if (stormCount > 0) return stormCount;
  }

  const metadataCount = Number(params.gapMetadata?.copyCount);
  if (Number.isFinite(metadataCount) && metadataCount > 0) {
    let count = Math.max(0, metadataCount);
    if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
      count = 2;
    }
    return count;
  }

  // metadata copyCount 0/missing: re-resolve so commander-CZ tax (and similar) is not sticky-zeroed
  let count = Math.max(0, resolveCopySpellCount(state, controller, step, irCtx));
  if (
    count <= 0
    && isCommanderCastFromCommandZoneCopyStep(step)
  ) {
    count = resolveCommanderCastsFromCommandZoneThisGame(state, controller);
  }
  if (
    step.copies?.kind === 'spells_cast_before_this_turn'
    && count <= 0
  ) {
    count = resolveSpellsCastBeforeThisTurnCopyCount(state, controller);
  }
  if (count === 1 && shouldDoubleCopyWhenCastFromGraveyard(params, irCtx)) {
    count = 2;
  }
  return count;
}"""

if old_count not in sync_text:
    raise SystemExit('resolveServerStackCopyCount block not found')
sync_text = sync_text.replace(old_count, new_count, 1)
sync_path.write_text(sync_text, encoding='utf-8', newline='\n')
print('patched server copy sync')

# Unit test for count helper + resolveCopySpellCount + stack push
test = r'''import { describe, expect, it, vi } from 'vitest';

import * as db from '../src/db/index.js';
import { queueCopySpellStackPushFromOracleIRResult } from '../src/state/modules/oracleIrServerCopySpellSync.js';
import { resolveCommanderCastsFromCommandZoneThisGame } from '../../rules-engine/src/oracleIRExecutorCommanderCastCount.js';
import { resolveCopySpellCount } from '../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('commander cast-from-CZ copy count (Hatut-style)', () => {
  const playerId = 'p_hatut';

  it('resolves tax=4 (two CZ casts) to count 2 via taxById / 2', () => {
    const state: any = {
      commandZone: {
        [playerId]: {
          commanderIds: ['cmd_1'],
          tax: 4,
          taxById: { cmd_1: 4 },
          inCommandZone: [],
        },
      },
    };

    expect(resolveCommanderCastsFromCommandZoneThisGame(state, playerId)).toBe(2);

    const step = {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: {
        kind: 'reference_amount',
        raw: "for each time you've cast your commander from the command zone this game",
      },
      raw: "copy it for each time you've cast your commander from the command zone this game",
    } as const;

    expect(resolveCopySpellCount(state, playerId, step as any)).toBe(2);
  });

  it('pushes that many this_spell copies onto the stack when deferred to server', () => {
    const gameId = 'test_hatut_commander_cz_copies';
    const hatutStackId = 'stack_hatut_1';

    const state: any = {
      commandZone: {
        [playerId]: {
          commanderIds: ['cmd_1'],
          tax: 4,
          taxById: { cmd_1: 4 },
          inCommandZone: [],
        },
      },
      stack: {
        objects: [
          {
            id: hatutStackId,
            type: 'spell',
            controller: playerId,
            card: {
              id: 'hatut_1',
              name: 'Hatut Zeraze Strike Force',
              type_line: 'Creature — Human Warrior',
              oracle_text:
                "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nWhen this creature enters, destroy up to one target artifact or enchantment.",
            },
          },
        ],
      },
    };

    const copyStep = {
      kind: 'copy_spell',
      subject: 'this_spell',
      copies: {
        kind: 'reference_amount',
        raw: "for each time you've cast your commander from the command zone this game",
      },
      raw: "copy it for each time you've cast your commander from the command zone this game",
    } as const;

    // Simulate sticky-zero metadata from a prior buggy IR resolution; server must re-resolve from tax.
    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 0 },
      }],
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: hatutStackId,
      sourceName: 'Hatut Zeraze Strike Force',
      sourceObjectType: 'spell',
    });

    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);

    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: 'Hatut Zeraze Strike Force',
      irCtx,
      sourceItem: {
        id: 'trigger_hatut_on_cast',
        triggeringStackItemId: hatutStackId,
      },
    });

    expect(bridged).toBe(true);
    const stackItems = getStackItems(state.stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === hatutStackId || item?.isCopy === true);
    expect(copies).toHaveLength(2);
    expect(stackItems.some((item: any) => item?.id === hatutStackId)).toBe(true);

    appendEventSpy.mockRestore();
  });
});
'''

(TESTS / 'oracle-ir-hatut-commander-cz-copy.unit.test.ts').write_text(test, encoding='utf-8', newline='\n')
print('wrote test')
