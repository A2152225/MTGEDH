// server/src/state/modules/replacementBatch99Collect.ts
// B99 replacements: as-transforms emblem / choose-opponent, Deification
// last-loyalty save, Enduring Angel life-floor transform.
// Public: parsers re-exported, collectBatch99ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { parseAsTransformsEmblemGrant, parseAsTransformsChooseOpponent } from './batch99TransformEvents.js';
import { parseEnduringAngelLifeFloor } from './batch99LifeFloorTransform.js';
import { parseDeificationLoyaltySave } from '../../../../rules-engine/src/planeswalkerLoyaltyReplacements.js';

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

function oracleOf(perm: any): string {
  return normalize(perm?.card?.oracle_text || perm?.oracle_text || '');
}

export function collectBatch99ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const out: ReplacementEffectSpec[] = [];
  const text = normalize(oracle);
  if (parseAsTransformsEmblemGrant(text)) {
    out.push({
      id: `${source.sourcePermanentId}:as-transforms-emblem`,
      event: 'transform' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { asTransforms: true } as any,
      instead: { grantEmblem: true } as any,
      effectId: 'as-transforms-emblem',
      reason: 'as_transforms_emblem',
    } as ReplacementEffectSpec);
  }
  if (parseAsTransformsChooseOpponent(text)) {
    out.push({
      id: `${source.sourcePermanentId}:as-transforms-choose-opponent`,
      event: 'transform' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { asTransforms: true } as any,
      instead: { chooseOpponent: true } as any,
      effectId: 'as-transforms-choose-opponent',
      reason: 'as_transforms_choose_opponent',
    } as ReplacementEffectSpec);
  }
  if (parseDeificationLoyaltySave(text)) {
    out.push({
      id: `${source.sourcePermanentId}:deification-loyalty-save`,
      event: 'damage' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { recipient: 'planeswalker_you_control_chosen_type' } as any,
      instead: { modify: 'leave_one_loyalty' } as any,
      effectId: 'deification-loyalty-save',
      reason: 'deification_loyalty_save',
      metadata: { requiresControlledCreature: true },
    } as ReplacementEffectSpec);
  }
  const floor = parseEnduringAngelLifeFloor(text);
  if (floor) {
    out.push({
      id: `${source.sourcePermanentId}:life-floor-transform`,
      event: 'life_loss' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { receivingPlayerIsSourceController: true, wouldReduceToZeroOrLess: true } as any,
      instead: { setLifeTo: floor.life, transformSource: true, loseIfDidNotTransform: true } as any,
      effectId: 'life-floor-transform',
      reason: 'life_floor_transform',
    } as ReplacementEffectSpec);
  }
  return out;
}

export function collectBatch99ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const st = state as any;
  const battlefield: any[] = Array.isArray(st?.battlefield) ? st.battlefield : [];
  const out: ReplacementEffectSpec[] = [];
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut === true) continue;
    out.push(...collectBatch99ReplacementSpecs(oracleOf(perm), {
      sourcePermanentId: String(perm.id || ''),
      sourceController: String(perm.controller || ''),
      sourceName: String(perm.card?.name || ''),
    }));
  }
  return out;
}
