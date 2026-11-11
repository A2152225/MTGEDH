/**
 * Runtime loader for precomputed CardAIProfiles.
 *
 * Origin: AI_Upgrade Phase 1 (P1-4).
 * Public entry symbols: getCardAIProfile, clearCardAIProfileCache.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardAIProfile } from '../../../../rules-engine/src/ai/cardProfileTypes.js';

export type { CardAIProfile, CardRole, CardAIProfileNeed } from '../../../../rules-engine/src/ai/cardProfileTypes.js';
export { CARD_ROLES } from '../../../../rules-engine/src/ai/cardProfileTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROFILES_PATH = path.resolve(__dirname, '../../../data/ai-card-profiles.json');

let byName: Map<string, CardAIProfile> | null = null;

function loadProfiles(filePath = DEFAULT_PROFILES_PATH): Map<string, CardAIProfile> {
  const map = new Map<string, CardAIProfile>();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { profiles?: CardAIProfile[] };
    for (const p of parsed.profiles || []) {
      if (!p?.name) continue;
      map.set(p.name.toLowerCase(), p);
      for (const face of p.name.split(' // ')) {
        const key = face.trim().toLowerCase();
        if (key) map.set(key, p);
      }
    }
  } catch {
    console.warn('[ai] card profiles not loaded; every card falls back to v0 priority');
  }
  return map;
}

export function getCardAIProfile(name: string): CardAIProfile | undefined {
  byName ??= loadProfiles();
  return byName.get(String(name || '').toLowerCase());
}

/** Test helper: reset cache / load from an alternate path. */
export function clearCardAIProfileCache(opts?: { reloadFrom?: string }): void {
  byName = opts?.reloadFrom ? loadProfiles(opts.reloadFrom) : null;
}
