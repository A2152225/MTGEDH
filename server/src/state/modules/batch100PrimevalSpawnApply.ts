// server/src/state/modules/batch100PrimevalSpawnApply.ts
// Primeval Spawn: "If this creature would enter and it wasn't cast or no mana
// was spent to cast it, exile it instead." Self-only. Public:
// parsePrimevalSpawnSelfExile, wouldPrimevalSpawnExileEntry,
// applyPrimevalSpawnExileIfNeeded.

function normalize(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
}

export const PRIMEVAL_SPAWN_EFFECT_ID = 'self-uncast-or-no-mana-enter-exile';

const PRIMEVAL_RE = /if this creature would enter and it wasn'?t cast or no mana was spent to cast it, exile it instead/i;

export function parsePrimevalSpawnSelfExile(oracle: string): boolean {
  return PRIMEVAL_RE.test(normalize(oracle));
}

function typeLineOf(cardOrPerm: any): string {
  return String(
    cardOrPerm?.type_line
    || cardOrPerm?.typeLine
    || cardOrPerm?.card?.type_line
    || cardOrPerm?.card?.typeLine
    || '',
  ).toLowerCase();
}

function oracleOf(cardOrPerm: any): string {
  return normalize(
    cardOrPerm?.oracle_text
    || cardOrPerm?.oracleText
    || cardOrPerm?.card?.oracle_text
    || cardOrPerm?.card?.oracleText
    || '',
  );
}

function wasCastEntry(cardOrPerm: any, extra?: { wasCast?: boolean; enteredFromCast?: boolean; enteredFromZone?: string }): boolean {
  if (extra?.wasCast === true || extra?.enteredFromCast === true) return true;
  if (cardOrPerm?.enteredFromCast === true || cardOrPerm?.wasCast === true) return true;
  if (cardOrPerm?.card?.enteredFromCast === true || cardOrPerm?.card?.wasCast === true) return true;
  const fromZone = String(
    extra?.enteredFromZone
    || cardOrPerm?.enteredFromZone
    || cardOrPerm?.card?.enteredFromZone
    || '',
  ).toLowerCase();
  return fromZone === 'stack';
}

function noManaSpentToCast(cardOrPerm: any, extra?: { noManaSpent?: boolean; manaSpentToCast?: number; castWithoutPayingManaCost?: boolean }): boolean {
  if (extra?.noManaSpent === true || extra?.castWithoutPayingManaCost === true) return true;
  if (extra?.manaSpentToCast === 0) return true;
  if (cardOrPerm?.noManaSpent === true || cardOrPerm?.castWithoutPayingManaCost === true) return true;
  if (cardOrPerm?.manaSpentToCast === 0 || cardOrPerm?.card?.manaSpentToCast === 0) return true;
  if (cardOrPerm?.card?.noManaSpent === true || cardOrPerm?.card?.castWithoutPayingManaCost === true) return true;
  return false;
}

function hasPrimevalText(cardOrPerm: any): boolean {
  return parsePrimevalSpawnSelfExile(oracleOf(cardOrPerm));
}

export function wouldPrimevalSpawnExileEntry(args: {
  state: any;
  card?: any;
  permanent?: any;
  wasCast?: boolean;
  enteredFromCast?: boolean;
  enteredFromZone?: string;
  noManaSpent?: boolean;
  manaSpentToCast?: number;
  castWithoutPayingManaCost?: boolean;
}): boolean {
  const subject = args.permanent || args.card;
  if (!subject) return false;
  if (!hasPrimevalText(subject) && !hasPrimevalText(args.card) && !hasPrimevalText(args.permanent)) return false;
  const extra = {
    wasCast: args.wasCast,
    enteredFromCast: args.enteredFromCast,
    enteredFromZone: args.enteredFromZone,
    noManaSpent: args.noManaSpent,
    manaSpentToCast: args.manaSpentToCast,
    castWithoutPayingManaCost: args.castWithoutPayingManaCost,
  };
  const cast = wasCastEntry(subject, extra) || wasCastEntry(args.card, extra);
  const unpaid = noManaSpentToCast(subject, extra) || noManaSpentToCast(args.card, extra);
  return !cast || unpaid;
}

export function applyPrimevalSpawnExileIfNeeded(args: {
  state: any;
  card?: any;
  permanent?: any;
  wasCast?: boolean;
  enteredFromCast?: boolean;
  enteredFromZone?: string;
  noManaSpent?: boolean;
  manaSpentToCast?: number;
  castWithoutPayingManaCost?: boolean;
}): { applied: boolean; redirectedTo?: 'exile'; permanentId?: string } {
  if (!wouldPrimevalSpawnExileEntry(args)) return { applied: false };
  const state = args.state;
  const permanent = args.permanent || args.card;
  const permanentId = String(permanent?.id || args.card?.id || '').trim();
  const ownerId = String(
    permanent?.owner
    || permanent?.ownerId
    || args.card?.owner
    || args.card?.ownerId
    || permanent?.controller
    || '',
  ).trim();

  if (Array.isArray(state?.battlefield) && permanentId) {
    const idx = state.battlefield.findIndex((entry: any) => String(entry?.id || '') === permanentId);
    if (idx >= 0) state.battlefield.splice(idx, 1);
  }

  if (ownerId && state) {
    state.zones = state.zones || {};
    const zones = state.zones[ownerId] || (state.zones[ownerId] = { exile: [], exileCount: 0 });
    const exile: any[] = Array.isArray(zones.exile) ? zones.exile : (zones.exile = []);
    const card = { ...(args.card || permanent?.card || permanent || {}), zone: 'exile' };
    if (permanentId && !card.id) card.id = permanentId;
    exile.push(card);
    zones.exileCount = exile.length;
  }

  if (permanent && typeof permanent === 'object') {
    (permanent as any).zone = 'exile';
    (permanent as any).redirectedByPrimevalSpawn = true;
  }

  return { applied: true, redirectedTo: 'exile', permanentId: permanentId || undefined };
}

export function collectPrimevalSpawnReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): Array<{ id: string; effectId: string; event: string; sourcePermanentId: string; sourceController: string; sourceName: string; reason: string }> {
  if (!parsePrimevalSpawnSelfExile(oracle)) return [];
  return [{
    id: `${source.sourcePermanentId}:${PRIMEVAL_SPAWN_EFFECT_ID}`,
    effectId: PRIMEVAL_SPAWN_EFFECT_ID,
    event: 'zone-change',
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    reason: 'primeval_spawn_self_exile',
  }];
}
