// Cluster: "~ has all activated abilities of <X>" (Necrotic Ooze, Mirran Safehouse,
//   Robaran Mercenaries, Marvin, Sharkey, Manascape Refractor, Myr Welder, Patchwork
//   Crawler, Thranduil, Trazyn, Rex, Mairsil, Experiment Kraj).
// Public: parseBorrowedActivatedClause, pushBorrowedActivatedSelfSpecs,
//   collectBorrowedActivatedAbilities.

import { isGrantedActivatedAbilityText } from '../../../../shared/src/attachmentAbilityGrants.js';
import type { StaticEffectSpec } from './staticEffectSpec.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpec-handlers/staticEffectSpecOracleParseHelpers.js';

export type BorrowedActivatedSpec = {
  zone: 'exiled_with' | 'exile' | 'graveyard' | 'battlefield';
  owner: 'you' | 'opponents' | 'all';
  typeWords: string[];
  counterType?: string;
  excludeMana?: boolean;
  excludeSameName?: boolean;
};

function typeWordsOf(phrase: string): string[] | null {
  const words = String(phrase || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
    .map((w) => w.replace(/s$/, '')).filter((w) => w !== 'card');
  for (const w of words) if (!/^[a-z-]+$/.test(w)) return null;
  return words;
}

export function parseBorrowedActivatedClause(clauseRaw: string): BorrowedActivatedSpec | null {
  let clause = String(clauseRaw || '').trim().toLowerCase().replace(/\.$/, '');
  let excludeMana = false;
  if (/,?\s*except mana abilities$/.test(clause)) { excludeMana = true; clause = clause.replace(/,?\s*except mana abilities$/, ''); }
  let m: RegExpMatchArray | null;
  if ((m = clause.match(/^all ((?:[a-z-]+ )*?)cards exiled with (?:it|~|this [a-z]+)$/))) {
    const typeWords = typeWordsOf(m[1]); if (!typeWords) return null;
    return { zone: 'exiled_with', owner: 'all', typeWords, excludeMana };
  }
  if ((m = clause.match(/^all ((?:[a-z-]+ )*?)cards (?:(you own) )?in exile with (?:an? )?([a-z+\-/0-9]+) counters? on (?:them|it)$/))) {
    const typeWords = typeWordsOf(m[1]); if (!typeWords) return null;
    return { zone: 'exile', owner: m[2] ? 'you' : 'all', typeWords, counterType: m[3], excludeMana };
  }
  if ((m = clause.match(/^all ((?:[a-z-]+ )*?)cards in (all graveyards|your graveyard)$/))) {
    const typeWords = typeWordsOf(m[1]); if (!typeWords) return null;
    return { zone: 'graveyard', owner: m[2] === 'your graveyard' ? 'you' : 'all', typeWords, excludeMana };
  }
  if ((m = clause.match(/^each other ([a-z]+) with (?:an? )?([+\-]\d+\/[+\-]\d+) counter on it$/))) {
    const typeWords = typeWordsOf(m[1]); if (!typeWords) return null;
    return { zone: 'battlefield', owner: 'all', typeWords, counterType: m[2], excludeMana };
  }
  let excludeSameName = false;
  if (/ that don(?:'|\u2019)t have the same name as (?:~|it|this [a-z]+)$/.test(clause)) {
    excludeSameName = true; clause = clause.replace(/ that don(?:'|\u2019)t have the same name as (?:~|it|this [a-z]+)$/, '');
  }
  if ((m = clause.match(/^(?:all )?((?:[a-z-]+ )*?[a-z-]+) (you control|your opponents control|on the battlefield)$/))) {
    const typeWords = typeWordsOf(m[1]); if (!typeWords || typeWords.length === 0) return null;
    const owner = m[2] === 'you control' ? 'you' : m[2] === 'your opponents control' ? 'opponents' : 'all';
    return { zone: 'battlefield', owner, typeWords, excludeMana, excludeSameName };
  }
  return null;
}

const SELF_RE = /(?:^|[.\n;])\s*(?:as long as [^,.\n]+ is on the battlefield, )?(?:~|it|this [a-z]+) has all activated abilities of ([^.\n]+)/gi;

export function pushBorrowedActivatedSelfSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  let text = String(oracle || '');
  const name = String(source.sourceName || '').trim();
  if (name) {
    const first = name.split(/\s*\/\/\s*/)[0];
    for (const n of [name, first, first.split(',')[0]]) {
      if (n) text = text.split(n).join('~').split(n.toLowerCase()).join('~');
    }
  }
  let i = 0;
  for (const match of text.matchAll(SELF_RE)) {
    const parsed = parseBorrowedActivatedClause(match[1] || '');
    if (!parsed) continue;
    specs.push(buildSpec(source, `borrow-activated-${i++}`, { kind: 'self' } as any, { borrowActivated: parsed } as any));
  }
}

function isManaAbilityText(text: string): boolean {
  const lower = text.toLowerCase();
  const effect = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : lower;
  return /\badd\b/.test(effect) && !/\btarget\b/.test(effect);
}

function activatedTexts(oracle: string): string[] {
  return String(oracle || '').split(/\n+/).flatMap((l) => l.split(/(?<=\.)\s+(?=[{A-Z])/))
    .map((p) => String(p || '').trim().replace(/\.$/, '')).filter((p) => isGrantedActivatedAbilityText(p));
}

function faceOf(entry: any): any { return entry?.card && typeof entry.card === 'object' ? entry.card : entry; }

function matchesTypeWords(face: any, words: readonly string[]): boolean {
  const tl = String(face?.type_line || face?.type || '').toLowerCase();
  return words.every((w) => new RegExp(`\\b${w.replace(/[^a-z-]/g, '')}s?\\b`).test(tl));
}

function counterCount(entry: any, type: string): number {
  const c = entry?.counters || entry?.card?.counters || {};
  return Number(c?.[type] || 0);
}

function zoneCards(state: any, zone: 'exile' | 'graveyard', ownerFilter: (pid: string) => boolean): any[] {
  const out: any[] = [];
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const [pid, z] of Object.entries<any>(zones)) {
    if (!ownerFilter(pid)) continue;
    if (Array.isArray(z?.[zone])) out.push(...z[zone]);
  }
  if (zone === 'exile' && Array.isArray(state?.exile)) {
    out.push(...state.exile.filter((c: any) => ownerFilter(String(c?.owner || c?.card?.owner || ''))));
  }
  return out;
}

export function collectBorrowedActivatedAbilities(state: unknown, sourcePermanentId: string, spec: BorrowedActivatedSpec): string[] {
  const st: any = state || {};
  const battlefield: any[] = Array.isArray(st.battlefield) ? st.battlefield : [];
  const sourceId = String(sourcePermanentId || '');
  const source = battlefield.find((p) => String(p?.id || '') === sourceId);
  if (!source) return [];
  const controller = String(source.controller || '');
  const ownerOk = (pid: string) => spec.owner === 'all' || (spec.owner === 'you' ? pid === controller : pid !== controller);
  let entries: any[] = [];
  if (spec.zone === 'battlefield') {
    const srcName = String(faceOf(source)?.name || '').toLowerCase();
    entries = battlefield.filter((p) => String(p?.id || '') !== sourceId && ownerOk(String(p?.controller || ''))
      && (!spec.excludeSameName || String(faceOf(p)?.name || '').toLowerCase() !== srcName));
  } else if (spec.zone === 'graveyard') {
    entries = zoneCards(st, 'graveyard', ownerOk);
  } else {
    entries = zoneCards(st, 'exile', spec.zone === 'exile' ? ownerOk : () => true);
    if (Array.isArray(source.exiledCards)) entries.push(...source.exiledCards);
    if (spec.zone === 'exiled_with') {
      entries = entries.filter((c) => String(c?.exiledWithSourceId || c?.card?.exiledWithSourceId || c?.exiledWith || '') === sourceId);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const face = faceOf(entry);
    if (!matchesTypeWords(face, spec.typeWords)) continue;
    if (spec.counterType && counterCount(entry, spec.counterType) <= 0) continue;
    for (const ability of activatedTexts(String(face?.oracle_text || entry?.oracle_text || ''))) {
      if (spec.excludeMana && isManaAbilityText(ability)) continue;
      const key = ability.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ability);
    }
  }
  return out;
}
