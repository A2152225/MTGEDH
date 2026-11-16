// server/src/state/modules/replacementBatch97Collect.ts
// B97 replacement collectors: Edgar first-flip force, Archmage is already
// collected in B93 (counter filter removed so the census can see the spec).
// Public: collectBatch97ReplacementSpecsFromState, parseEdgarFirstFlipReplacement.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const EDGAR_RE = /the first time you flip (?:one or more|\d+ or more|one|a coin|coins) coins? each turn, those coins come up heads and you win those flips/i;
const CONTAINMENT_RE = /if a nontoken creature would enter(?: the battlefield)? and it wasn't? cast, exile it instead/i;
const PURSUIT_RE = /if you would draw a card, you may put an? (study|[a-z]+) counter on (?:this enchantment|this permanent|~) instead/i;
const FORBIDDEN_DRAW_RE = /if you would draw a card, return a card from your graveyard to your hand instead(?:\. if you can't, you lose the game)?/i;
const EON_HUB_RE = /players skip their upkeep steps/i;

export function parseEdgarFirstFlipReplacement(oracle: string): boolean {
  return EDGAR_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function collectBatch97ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  if (EDGAR_RE.test(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:first-coin-flips-heads-and-win`,
      event: 'coin-flip' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { playerIsSourceController: true, firstEventThisTurn: true },
      instead: { forceResult: 'heads', forceWin: true },
      effectId: 'first-coin-flips-heads-and-win',
      reason: 'first_coin_flips_heads_and_win',
    } as ReplacementEffectSpec);
  }
  if (CONTAINMENT_RE.test(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:nontoken-uncast-enter-exile`,
      event: 'zone-change' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { destinationZone: 'battlefield', isToken: false, wasCast: false, type: 'creature' },
      instead: { redirectZone: 'exile' },
      effectId: 'nontoken-uncast-enter-exile',
      reason: 'nontoken_uncast_enter_exile',
    } as ReplacementEffectSpec);
  }
  if (PURSUIT_RE.test(text)) {
    const m = text.match(PURSUIT_RE);
    specs.push({
      id: `${source.sourcePermanentId}:optional-draw-to-counter`,
      event: 'card-draw' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { drawingPlayerIsSourceController: true },
      instead: { choiceRequired: true, putCounter: String(m?.[1] || 'study') },
      effectId: 'optional-draw-to-counter',
      reason: 'optional_draw_to_counter',
    } as ReplacementEffectSpec);
  }
  if (FORBIDDEN_DRAW_RE.test(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:draw-to-graveyard-return-or-lose`,
      event: 'card-draw' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { drawingPlayerIsSourceController: true },
      instead: { redirectZone: 'hand', fromZone: 'graveyard', loseIfCant: /if you can't, you lose the game/i.test(text) },
      effectId: 'draw-to-graveyard-return-or-lose',
      reason: 'draw_to_graveyard_return_or_lose',
    } as ReplacementEffectSpec);
  }
  if (EON_HUB_RE.test(text)) {
    specs.push({
      id: `${source.sourcePermanentId}:players-skip-upkeep`,
      event: 'step-begin' as any,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { step: 'upkeep' },
      instead: { skipStep: true },
      effectId: 'players-skip-upkeep',
      reason: 'players_skip_upkeep',
    } as ReplacementEffectSpec);
  }
  return specs;
}

export function collectBatch97ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield: any[] = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || (perm as any).phasedOut === true || !(perm as any).card) continue;
    const sourcePermanentId = String((perm as any).id || '').trim();
    const sourceController = String((perm as any).controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch97ReplacementSpecs(readCardOracleText((perm as any).card), {
      sourcePermanentId, sourceController, sourceName: String((perm as any).card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
