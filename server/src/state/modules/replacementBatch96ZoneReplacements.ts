// server/src/state/modules/replacementBatch96ZoneReplacements.ts
// B96: graveyard-to-exile zone replacements.
//   "If a TYPE you control would die, exile it instead." (Lorcan)
//   "If a permanent would be put into a graveyard, exile it instead." (Samurai of the Pale Curtain)
//   "If a COLOR or COLOR permanent, spell, or card not on the battlefield would
//    be put into a graveyard, exile it instead." (Sanctifier en-Vec)
// Public: parseBatch96GraveyardExileSentence, collectBatch96ZoneReplacementSpecs,
// collectBatch96ZoneReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const COLOR_WORD: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
};

export type Batch96GraveyardExileKind =
  | { kind: 'type_you_control_dies'; type: string }
  | { kind: 'permanent_to_graveyard' }
  | { kind: 'colored_object_to_graveyard'; colors: string[] };

const TYPE_DIES_RE = /if an? ([a-z][a-z -]{0,40}?) you control would die, exile it instead/i;
const PERM_GY_RE = /if a permanent would be put into a graveyard, exile it instead/i;
const COLOR_GY_RE = /if an? (white|blue|black|red|green) or (white|blue|black|red|green) permanent, spell, or card not on the battlefield would be put into a graveyard, exile it instead/i;

export function parseBatch96GraveyardExileSentence(oracle: string): Batch96GraveyardExileKind[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const out: Batch96GraveyardExileKind[] = [];
  const typeDies = text.match(TYPE_DIES_RE);
  if (typeDies) out.push({ kind: 'type_you_control_dies', type: String(typeDies[1] || '').trim().toLowerCase() });
  if (PERM_GY_RE.test(text)) out.push({ kind: 'permanent_to_graveyard' });
  const colors = text.match(COLOR_GY_RE);
  if (colors) {
    const c1 = COLOR_WORD[String(colors[1] || '').toLowerCase()];
    const c2 = COLOR_WORD[String(colors[2] || '').toLowerCase()];
    const list = [c1, c2].filter(Boolean) as string[];
    if (list.length) out.push({ kind: 'colored_object_to_graveyard', colors: list });
  }
  return out;
}

export function collectBatch96ZoneReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch96GraveyardExileSentence(oracle).map((entry, i) => {
    const suffix = entry.kind === 'type_you_control_dies'
      ? `type-you-control-dies-exile${i ? `-${i}` : ''}`
      : entry.kind === 'permanent_to_graveyard'
        ? `permanent-to-graveyard-exile${i ? `-${i}` : ''}`
        : `colored-object-to-graveyard-exile${i ? `-${i}` : ''}`;
    const match: Record<string, unknown> = { destinationZone: 'graveyard' };
    if (entry.kind === 'type_you_control_dies') {
      match.sourceZone = 'battlefield';
      match.objectTypeLineIncludes = entry.type;
      match.objectControllerIsSourceController = true;
    } else if (entry.kind === 'permanent_to_graveyard') {
      match.sourceZone = 'battlefield';
    } else {
      match.objectColorsIncludeAny = entry.colors;
    }
    return {
      id: `${source.sourcePermanentId}:${suffix}`,
      event: 'zone-change' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match,
      instead: { redirectZone: 'exile' },
      effectId: suffix.replace(/-\d+$/, ''),
      reason: entry.kind,
      metadata: entry.kind === 'colored_object_to_graveyard' ? { colors: entry.colors } : entry.kind === 'type_you_control_dies' ? { type: entry.type } : {},
    } as ReplacementEffectSpec;
  });
}

export function collectBatch96ZoneReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch96ZoneReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
