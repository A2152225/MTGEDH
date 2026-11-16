// server/src/state/modules/batch103Apply.ts
// B103 live applies: empty-hand draw two + lose life, delirium noncombat
// damage double, Swans prevent-and-draw, Jared monarch prevent + counters,
// Rock Hydra damage-for-counters, and Questing Beast unpreventable combat
// damage. Public entry symbols listed below.

import { parseCombatDamageCantBePrevented } from './batch103Parsers.js';
import { collectBatch103ReplacementSpecsFromState } from './replacementBatch103Collect.js';

export { parseBatch103LongTailStaticKind, pushBatch103LongTailStaticSpecs } from './staticEffectSpec-handlers/batch103LongTailStatics.js';
export { collectBatch103ReplacementSpecs, collectBatch103ReplacementSpecsFromState } from './replacementBatch103Collect.js';
export { readBatch103ColorSetting } from './batch103ColorSetting.js';

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

function findPerm(state: any, id: string): any | undefined {
  const want = String(id || '').trim();
  if (!want) return undefined;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.find((p: any) => p && String(p.id || '') === want);
}

function handCount(state: any, playerId: string): number {
  const z = state?.zones?.[playerId];
  if (Array.isArray(z?.hand)) return z.hand.length;
  const n = Number(z?.handCount);
  return Number.isFinite(n) ? n : 0;
}

function loseLife(state: any, playerId: string, amount: number): void {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n || !state || !playerId) return;
  state.life = state.life || {};
  const players: any[] = Array.isArray(state.players) ? state.players : [];
  const player = players.find((p: any) => String(p?.id || '') === playerId);
  const current = Number(state.life[playerId] ?? player?.life ?? 40);
  state.life[playerId] = current - n;
  if (player) player.life = state.life[playerId];
}

function typeLine(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];

function playerHasDelirium(state: any, playerId: string): boolean {
  const gy = state?.zones?.[playerId]?.graveyard;
  if (!Array.isArray(gy)) return false;
  const types = new Set<string>();
  for (const card of gy) {
    const tl = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
    for (const typ of CARD_TYPES) if (tl.includes(typ)) types.add(typ);
    if (tl.includes('tribal')) types.add('kindred');
  }
  return types.size >= 4;
}

export type Batch103DrawCardsFn = (ctx: any, playerId: string, amount: number) => number | unknown;
let registeredDrawCards: Batch103DrawCardsFn | null = null;
export function registerBatch103DrawCards(fn: Batch103DrawCardsFn): void {
  registeredDrawCards = fn;
}
function drawCardsOrLibrary(ctx: any, playerId: string, amount: number): number {
  if (registeredDrawCards) {
    try {
      const got = registeredDrawCards(ctx, playerId, amount);
      if (typeof got === 'number' && Number.isFinite(got)) return got;
      if (Array.isArray(got)) return got.length;
    } catch {
      // fall through to the direct library move
    }
  }
  return drawFromLibrary(ctx, playerId, amount);
}

function drawFromLibrary(ctx: any, playerId: string, amount: number): number {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (!n || !playerId) return 0;
  const state = ctx?.state || ctx;
  state.zones = state.zones || {};
  const z = state.zones[playerId] || (state.zones[playerId] = { hand: [], library: [], handCount: 0, libraryCount: 0 });
  z.hand = Array.isArray(z.hand) ? z.hand : [];
  let lib = ctx?.libraries?.get?.(playerId);
  if (!Array.isArray(lib) || lib.length === 0) lib = Array.isArray(z.library) ? z.library : [];
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(lib) || lib.length === 0) break;
    const card = lib.shift();
    z.hand.push(card);
    drawn += 1;
  }
  z.handCount = z.hand.length;
  z.library = lib;
  z.libraryCount = lib.length;
  if (ctx?.libraries?.set) ctx.libraries.set(playerId, lib);
  return drawn;
}

function isCreature(perm: any): boolean {
  if (!perm) return false;
  if (perm.notCreature === true) return false;
  if (perm.isCreature === true) return true;
  return /\bcreature\b/.test(typeLine(perm));
}

export function combatDamageCantBePreventedFor(
  state: any,
  opts: { damageDealer?: string; isCombatDamage?: boolean; damageSourcePermanentId?: string },
): boolean {
  if (opts.isCombatDamage !== true) return false;
  const dealer = String(opts.damageDealer || '').trim();
  const source = findPerm(state, String(opts.damageSourcePermanentId || ''));
  const sourceController = String(source?.controller || dealer || '').trim();
  if (!sourceController) return false;
  if (source && !isCreature(source)) return false;
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((perm: any) => {
    if (!perm || perm.phasedOut === true) return false;
    if (String(perm.controller || '').trim() !== sourceController) return false;
    return parseCombatDamageCantBePrevented(oracleOf(perm));
  });
}

export function applyBatch103EmptyHandDrawTwo(state: any, playerId: string, count: number): number {
  let n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0 || !state || !playerId) return n;
  if (handCount(state, playerId) > 0) return n;
  const specs = collectBatch103ReplacementSpecsFromState(state).filter((spec) =>
    spec.effectId === 'empty-hand-draw-two-lose-life' && String(spec.sourceController) === String(playerId),
  );
  if (specs.length === 0) return n;
  n += specs.length;
  for (const spec of specs) {
    const lose = Number((spec.metadata as any)?.loseLife || (spec.instead as any)?.loseLife || 1);
    loseLife(state, playerId, lose);
  }
  return n;
}

export function collectBatch103DamageModifyEffects(
  state: any,
  input: {
    damageDealer: string;
    damageReceiver: string;
    damageSourcePermanentId?: string;
    isCombatDamage?: boolean;
    targetPermanentId?: string;
  },
): Array<{ type: 'double'; source: string; controllerId?: string }> {
  const out: Array<{ type: 'double'; source: string; controllerId?: string }> = [];
  if (input.isCombatDamage === true) return out;
  for (const spec of collectBatch103ReplacementSpecsFromState(state)) {
    if (spec.effectId !== 'delirium-double-noncombat') continue;
    const controller = String(spec.sourceController || '');
    if (!controller || String(input.damageDealer || '') !== controller) continue;
    if (!playerHasDelirium(state, controller)) continue;
    out.push({
      type: 'double',
      source: String(spec.sourceName || 'Delirium damage double'),
      controllerId: controller,
    });
  }
  return out;
}

export function applyBatch103DamageSideEffects(
  ctx: any,
  damageAmount: number,
  damageDealer: string,
  damageReceiver: string,
  damageSourcePermanentId?: string,
  targetPermanentId?: string,
  isCombatDamage?: boolean,
): { amount: number; modifiers: string[] } | null {
  if (!(Number(damageAmount) > 0)) return null;
  const state = ctx?.state || ctx;
  if (combatDamageCantBePreventedFor(state, { damageDealer, isCombatDamage, damageSourcePermanentId })) {
    return null;
  }
  const specs = collectBatch103ReplacementSpecsFromState(state);
  if (!specs.length) return null;
  const targetId = String(targetPermanentId || '').trim();
  const target = targetId ? findPerm(state, targetId) : undefined;

  for (const spec of specs) {
    if (spec.effectId === 'prevent-damage-controller-draws') {
      if (!targetId || String(spec.sourcePermanentId || '') !== targetId) continue;
      const dealerPerm = findPerm(state, String(damageSourcePermanentId || ''));
      const drawer = String(dealerPerm?.controller || damageDealer || '').trim();
      const drawn = drawer ? drawCardsOrLibrary(ctx, drawer, damageAmount) : 0;
      return {
        amount: 0,
        modifiers: [`${spec.sourceName}: prevented ${damageAmount} damage; ${drawer || 'the source\'s controller'} draws ${drawn}`],
      };
    }
    if (spec.effectId === 'prevent-damage-monarch-plus-counters') {
      if (!targetId || String(spec.sourcePermanentId || '') !== targetId || !target) continue;
      const monarch = String(state.monarch || state.monarchId || '').trim();
      if (!monarch || monarch !== String(spec.sourceController || '')) continue;
      target.counters = target.counters || {};
      target.counters['+1/+1'] = Math.max(0, Number(target.counters['+1/+1']) || 0) + damageAmount;
      return {
        amount: 0,
        modifiers: [`${spec.sourceName}: prevented ${damageAmount} damage and put ${damageAmount} +1/+1 counter(s) on it`],
      };
    }
    if (spec.effectId === 'damage-removes-p1p1-prevents') {
      if (!targetId || String(spec.sourcePermanentId || '') !== targetId || !target) continue;
      target.counters = target.counters || {};
      const have = Math.max(0, Number(target.counters['+1/+1']) || 0);
      if (have <= 0) continue;
      const prevent = Math.min(have, damageAmount);
      target.counters['+1/+1'] = have - prevent;
      return {
        amount: damageAmount - prevent,
        modifiers: [`${spec.sourceName}: removed ${prevent} +1/+1 counter(s) and prevented ${prevent} damage`],
      };
    }
  }
  void damageReceiver;
  return null;
}

export function filterPreventedDamageIfUnpreventable(
  state: any,
  result: { amount: number; modifiers: string[] },
  originalAmount: number,
  opts: { damageDealer?: string; isCombatDamage?: boolean; damageSourcePermanentId?: string },
): { amount: number; modifiers: string[] } {
  if (!combatDamageCantBePreventedFor(state, opts)) return result;
  if (result.amount >= originalAmount) return result;
  const modifiers = result.modifiers.filter((m) => !/prevent/i.test(String(m)));
  modifiers.push('Combat damage by creatures you control can\'t be prevented');
  return { amount: originalAmount, modifiers };
}
