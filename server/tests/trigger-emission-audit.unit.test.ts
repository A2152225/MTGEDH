import { describe, expect, it } from 'vitest';
import {
  classifyPathBucket,
  evaluateFamily,
  isLiveCallSite,
  type CallSite,
  type TriggerEmissionFamily,
} from '../scripts/trigger-emission-audit.js';

describe('trigger-emission-audit helpers', () => {
  it('classifies oracle IR paths', () => {
    expect(classifyPathBucket('src/state/modules/oracleIrServerZoneSync.ts')).toBe('ir');
    expect(classifyPathBucket('src/state/modules/executeSpellEffect.ts')).toBe('legacy_effect');
    expect(classifyPathBucket('src/state/modules/stack-mechanics.ts')).toBe('stack');
    expect(classifyPathBucket('src/socket/game-actions.ts')).toBe('socket');
  });

  it('detects live call sites vs imports/definitions', () => {
    expect(isLiveCallSite("import { processSpellCounteredTriggers } from './x.js';", 'processSpellCounteredTriggers')).toBe(false);
    expect(isLiveCallSite('export function processSpellCounteredTriggers(ctx: any): void {', 'processSpellCounteredTriggers')).toBe(false);
    expect(isLiveCallSite('processSpellCounteredTriggers(ctx, event);', 'processSpellCounteredTriggers')).toBe(true);
  });

  it('treats zone proxy buckets as IR-satisfied for shared helpers', () => {
    const family: TriggerEmissionFamily = {
      id: 'draw',
      label: 'Draw',
      detectors: ['detectCardDrawTriggers'],
      emitters: ['processDrawTriggers'],
      requiresIrPath: true,
      irProxyBuckets: ['zones'],
      exampleCards: ['Smothering Tithe'],
    };
    const map = new Map<string, CallSite[]>([
      ['processDrawTriggers', [{
        file: 'src/state/modules/zones.ts',
        line: 10,
        text: 'processDrawTriggers(ctx, pid, n);',
        bucket: 'zones',
      }]],
      ['detectCardDrawTriggers', [{
        file: 'src/state/modules/zones.ts',
        line: 20,
        text: 'detectCardDrawTriggers(card, perm);',
        bucket: 'zones',
      }]],
    ]);
    expect(evaluateFamily(family, map, map).status).toBe('ok');
  });

  it('flags missing IR emission like the Baral failure mode', () => {
    const family: TriggerEmissionFamily = {
      id: 'spell_countered',
      label: 'Spell countered',
      detectors: ['detectSpellCounteredTriggers'],
      emitters: ['processSpellCounteredTriggers'],
      requiresIrPath: true,
      exampleCards: ['Baral, Chief of Compliance'],
    };
    const emitterLegacyOnly: CallSite[] = [{
      file: 'src/state/modules/executeSpellEffect.ts',
      line: 10,
      text: 'processSpellCounteredTriggers(ctx, event);',
      bucket: 'legacy_effect',
    }];
    const detectorUsed: CallSite[] = [{
      file: 'src/state/modules/spellCounteredTriggerUtils.ts',
      line: 20,
      text: 'detectSpellCounteredTriggers(permanent.card, permanent);',
      bucket: 'other',
    }];
    const map = new Map<string, CallSite[]>([
      ['processSpellCounteredTriggers', emitterLegacyOnly],
      ['detectSpellCounteredTriggers', detectorUsed],
    ]);
    const result = evaluateFamily(family, map, map);
    expect(result.status).toBe('missing_ir_path');
    expect(result.severity).toBe('gap');
  });

  it('flags detector-only families as no_emitter gaps', () => {
    const family: TriggerEmissionFamily = {
      id: 'equipped',
      label: 'Equipment becomes attached',
      detectors: ['detectEquippedTriggers'],
      emitters: [],
      requiresIrPath: false,
      exampleCards: ['Shadowspear'],
    };
    const result = evaluateFamily(family, new Map(), new Map());
    expect(result.status).toBe('no_emitter');
    expect(result.severity).toBe('gap');
  });
});
