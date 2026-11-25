/**
 * socket/interaction-handlers/interactionGraveyardExileStackAbility.ts
 *
 * Steering (c): graveyard activated abilities whose cost exiles the card itself and whose effect is
 * not "return this card" (Ghoulcaller's Accomplice: "{3}{B}, Exile this card from your graveyard:
 * Create a 2/2 black Zombie creature token."; renew on Sagu Pummeler: "Put two +1/+1 counters and a
 * reach counter on target creature."). The generic graveyard branch treated every such ability as a
 * return-to-hand and the exile-to-add-counters branch only knew "each <type> you control", so the
 * effect never happened. Here the cost is paid (mana + exile self, CR 602.2) and the effect goes on
 * the stack as an activated ability (CR 113.7a: it resolves independently of the exiled card).
 *
 * A targeted effect queues TARGET_SELECTION (`graveyardExileAbilityTargetSelection`) first and pays
 * the cost once targets are chosen (CR 602.2b). "Return another target creature card from your
 * graveyard" (Theoretical Necromancer, Eerie Soultender, Bonebind Orator) targets graveyard cards,
 * never the exiled source itself.
 *
 * Public entry symbols: parseGraveyardExileSelfAbility, activateGraveyardExileStackAbility,
 * handleGraveyardExileAbilityTargetSelection, GRAVEYARD_EXILE_STACK_ABILITY_ID.
 */
import { appendEvent } from "../../db";
import { reportHookFailure } from "../../../../shared/src/hookFailureReporter.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  emitToPlayer,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateManaPayment,
} from "../util";
import { enforceSorcerySpeedGraveyardAbility, markCardLeftGraveyardLive } from "./interactionGraveyardCastCostAndTimingRules.js";
import { persistQueuedGraveyardAbilityStepActivation } from "./interactionActivationEventPersistence.js";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { permanentMatchesTargetTypeEntry } from "../permanentTargetTypeFilter.js";

export const GRAVEYARD_EXILE_STACK_ABILITY_ID = 'graveyard-exile-stack-ability';

const EXILE_SELF_RE = /\bexile\s+(?:this card|this creature card|~|it)\s+from\s+your\s+graveyard\b/i;
const SORCERY_RE = /\s*activate(?:\s+this ability)?\s+only\s+(?:as a sorcery|any time you could cast a sorcery)\.?\s*$/i;

export type GraveyardExileSelfAbility = {
  abilityText: string;
  costText: string;
  effectText: string;
  manaCost?: string;
  sorcerySpeed: boolean;
};

function normalizeSelfName(text: string, cardName: string): string {
  let out = String(text || '');
  const full = String(cardName || '').trim();
  const names = [full, full.split(',')[0].trim()].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  for (const name of names) out = out.split(name).join('~');
  return out;
}

/** Find a "<mana>, Exile this card from your graveyard: <effect>" line whose effect isn't a self-return. */
export function parseGraveyardExileSelfAbility(card: any): GraveyardExileSelfAbility | null {
  const cardName = String(card?.name || '');
  const lines = String(card?.oracle_text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const rawLine of lines) {
    // Ability word / keyword prefix ("Renew — {4}{G}, Exile ...").
    const line = rawLine.replace(/^[A-Za-z' ]+\s+[—–-]\s+(?=\{|exile)/i, '');
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const costText = normalizeSelfName(line.slice(0, colon).trim(), cardName);
    if (!EXILE_SELF_RE.test(costText)) continue;
    const leftover = costText.replace(EXILE_SELF_RE, '').replace(/\{[^}]+\}/g, '').replace(/[,\s]+/g, '');
    if (leftover) continue; // other cost components (discard, sacrifice, tap) are handled elsewhere
    const rawEffect = line.slice(colon + 1).trim();
    const sorcerySpeed = SORCERY_RE.test(rawEffect);
    const effectText = rawEffect.replace(SORCERY_RE, '').trim();
    if (!effectText) continue;
    if (/\breturn\s+(?:this card|~|it)\b/i.test(normalizeSelfName(effectText, cardName))) continue;
    const mana = costText.match(/(\{[^}]+\}(?:[,\s]*\{[^}]+\})*)/);
    return {
      abilityText: line,
      costText,
      effectText,
      ...(mana ? { manaCost: mana[1].replace(/[,\s]/g, '') } : {}),
      sorcerySpeed,
    };
  }
  return null;
}

type EmitError = (payload: { code: string; message: string }) => void;

type GraveyardAbilityTargetSpec = {
  kind: 'permanent' | 'player' | 'graveyard_card';
  typeEntry: string;
  controller: 'any' | 'you' | 'opponent';
  minTargets: number;
  description: string;
};

const TARGET_RE = /\b(up to one )?target ((?:(?:non-?[a-z]+|white|blue|black|red|green|colorless|multicolored|other)\s+)*)(creature|permanent|artifact|enchantment|land|planeswalker|player|opponent)\b( you control| an opponent controls| you don't control)?/i;

const GRAVEYARD_CARD_TARGET_RE = /\b(up to one )?(?:another |other )?target ((?:[a-z-]+\s+)*?)cards? from (your|a|an opponent's) graveyard\b/i;

function parseGraveyardAbilityTarget(effectText: string): GraveyardAbilityTargetSpec | null {
  const gy = String(effectText || '').match(GRAVEYARD_CARD_TARGET_RE);
  if (gy) {
    const scope = gy[3].toLowerCase();
    return {
      kind: 'graveyard_card',
      typeEntry: String(gy[2] || '').trim().toLowerCase(),
      controller: scope === 'your' ? 'you' : scope === 'a' ? 'any' : 'opponent',
      minTargets: gy[1] ? 0 : 1,
      description: gy[0].replace(/^up to one /i, '').trim(),
    };
  }
  const m = String(effectText || '').match(TARGET_RE);
  if (!m) return null;
  const noun = m[3].toLowerCase();
  const qualifier = String(m[4] || '').trim().toLowerCase();
  const kind = noun === 'player' || noun === 'opponent' ? 'player' : 'permanent';
  return {
    kind,
    typeEntry: `${String(m[2] || '').replace(/\bother\s+/i, '')}${noun}`.trim(),
    controller: noun === 'opponent' || qualifier === 'an opponent controls' || qualifier === "you don't control"
      ? 'opponent'
      : qualifier === 'you control' ? 'you' : 'any',
    minTargets: m[1] ? 0 : 1,
    description: m[0].replace(/^up to one /i, '').trim(),
  };
}

function buildGraveyardAbilityValidTargets(game: any, pid: string, spec: GraveyardAbilityTargetSpec, sourceCardId?: string): any[] {
  const state = game.state || {};
  if (spec.kind === 'graveyard_card') {
    const players: any[] = Array.isArray(state.players) ? state.players : [];
    const ownerIds = players.map((p: any) => String(p?.id || '')).filter((id: string) => id
      && (spec.controller === 'any' || (spec.controller === 'you') === (id === String(pid))));
    return ownerIds.flatMap((ownerId: string) => {
      const graveyard: any[] = Array.isArray(state.zones?.[ownerId]?.graveyard) ? state.zones[ownerId].graveyard : [];
      return graveyard
        // The source is exiled as a cost, so it is never a legal target ("another target").
        .filter((c: any) => c?.id && String(c.id) !== String(sourceCardId || '') && permanentMatchesTargetTypeEntry({ card: c }, spec.typeEntry))
        .map((c: any) => ({
          id: String(c.id),
          label: c.name || 'Card',
          description: c.type_line || 'Card',
          imageUrl: c.image_uris?.small || c.image_uris?.normal,
          type: 'graveyard_card',
          zone: 'graveyard',
          controller: ownerId,
          isOpponent: ownerId !== String(pid),
          typeLine: c.type_line,
        }));
    });
  }
  if (spec.kind === 'player') {
    const players: any[] = Array.isArray(state.players) ? state.players : [];
    return players
      .filter((p: any) => p && !p.hasLost && (spec.controller !== 'opponent' || String(p.id) !== String(pid)))
      .map((p: any) => ({ id: String(p.id), label: p.name || String(p.id), type: 'player', isOpponent: String(p.id) !== String(pid) }));
  }
  const battlefield: any[] = Array.isArray(state.battlefield) ? state.battlefield : [];
  return battlefield
    .filter((perm: any) => {
      if (!perm?.id || !perm?.card) return false;
      if (spec.controller === 'you' && String(perm.controller) !== String(pid)) return false;
      if (spec.controller === 'opponent' && String(perm.controller) === String(pid)) return false;
      if (!permanentMatchesTargetTypeEntry(perm, spec.typeEntry)) return false;
      return canPermanentBeTargetedByPlayer(perm as any, state as any, pid as any);
    })
    .map((perm: any) => ({
      id: String(perm.id),
      label: perm.card?.name || 'Permanent',
      description: perm.card?.type_line || 'Permanent',
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      type: 'permanent',
      controller: String(perm.controller || ''),
      isOpponent: String(perm.controller || '') !== String(pid),
      typeLine: perm.card?.type_line,
    }));
}

function manaCostError(game: any, pid: string, manaCost?: string): string | null {
  if (!manaCost) return null;
  const parsedCost = parseManaCost(manaCost);
  const pool = getOrInitManaPool(game.state, pid);
  const validationError = validateManaPayment(calculateTotalAvailableMana(pool, []), parsedCost.colors, parsedCost.generic);
  return validationError ? `Cannot pay ${manaCost}: ${validationError}` : null;
}

/** Pay mana + exile the card, then put the effect on the stack. */
function payAndPushGraveyardExileAbility(args: {
  io: any; game: any; gameId: string; pid: string; card: any; cardId: string;
  ability: GraveyardExileSelfAbility; targets?: string[]; emitError: EmitError;
}): boolean {
  const { io, game, gameId, pid, card, cardId, ability, targets, emitError } = args;
  const cardName = String(card?.name || 'Card');
  const zones = game.state?.zones?.[pid];
  const graveyard: any[] = Array.isArray(zones?.graveyard) ? zones.graveyard : [];
  const index = graveyard.findIndex((entry: any) => entry && String(entry.id) === String(cardId));
  if (index === -1) {
    emitError({ code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
    return false;
  }
  const costError = manaCostError(game, pid, ability.manaCost);
  if (costError) {
    emitError({ code: 'INSUFFICIENT_MANA', message: costError });
    return false;
  }
  if (ability.manaCost) {
    const parsedCost = parseManaCost(ability.manaCost);
    consumeManaFromPool(getOrInitManaPool(game.state, pid), parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
  }

  const [exiledCard] = graveyard.splice(index, 1);
  zones.graveyardCount = graveyard.length;
  markCardLeftGraveyardLive(game, pid, exiledCard);
  zones.exile = Array.isArray(zones.exile) ? zones.exile : [];
  zones.exile.push({ ...exiledCard, zone: 'exile' });
  zones.exileCount = zones.exile.length;

  const sourceLastKnown = {
    id: String(cardId),
    controller: String(pid),
    owner: String(pid),
    zone: 'graveyard',
    card: { ...exiledCard, zone: 'graveyard' },
  };
  const stackItem = {
    id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'ability' as const,
    controller: String(pid),
    source: String(cardId),
    sourceName: cardName,
    sourceZone: 'graveyard',
    description: ability.effectText,
    activatedAbilityText: ability.abilityText,
    sourceLastKnown,
    lastSacrificedPermanents: [sourceLastKnown],
    ...(targets && targets.length > 0 ? { targets: [...targets] } : null),
  } as any;
  game.state.stack = Array.isArray(game.state.stack) ? game.state.stack : [];
  game.state.stack.push(stackItem);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'activateGraveyardAbility', {
      playerId: pid,
      cardId,
      abilityId: GRAVEYARD_EXILE_STACK_ABILITY_ID,
      manaCost: ability.manaCost,
      stackItem,
    });
  } catch (err) {
    reportHookFailure('graveyard.exileStackAbility.persist', err, { cardName, cardId: String(cardId), gameId, playerId: String(pid) });
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} exiled ${cardName} from their graveyard to activate: ${ability.effectText}`,
    ts: Date.now(),
  });
  broadcastGame(io, game, gameId);
  return true;
}

/** Entry from activateGraveyardAbility. Always handles the request (errors are emitted). */
export function activateGraveyardExileStackAbility(args: {
  io: any; socket: any; game: any; gameId: string; pid: string;
  card: any; cardId: string; zones: any; ability: GraveyardExileSelfAbility;
}): boolean {
  const { io, socket, game, gameId, pid, card, cardId, ability } = args;
  const cardName = String(card?.name || 'Card');
  const emitError: EmitError = (payload) => socket.emit('error', payload);
  if (ability.sorcerySpeed && !enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), cardName)) return true;
  const costError = manaCostError(game, pid, ability.manaCost);
  if (costError) {
    emitError({ code: 'INSUFFICIENT_MANA', message: costError });
    return true;
  }

  const targetSpec = parseGraveyardAbilityTarget(ability.effectText);
  if (!targetSpec) {
    payAndPushGraveyardExileAbility({ io, game, gameId, pid, card, cardId, ability, emitError });
    return true;
  }

  const validTargets = buildGraveyardAbilityValidTargets(game, pid, targetSpec, cardId);
  if (validTargets.length < targetSpec.minTargets) {
    emitError({ code: 'NO_VALID_TARGETS', message: `${cardName}'s ability has no legal ${targetSpec.description}.` });
    return true;
  }
  const queuedStep = {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: pid,
    sourceId: cardId,
    sourceName: cardName,
    sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
    description: `Choose ${targetSpec.description} for ${cardName}`,
    mandatory: targetSpec.minTargets > 0,
    validTargets,
    targetTypes: [targetSpec.kind === 'player' ? 'player' : targetSpec.kind === 'graveyard_card' ? `graveyard_${targetSpec.typeEntry || 'card'}` : targetSpec.typeEntry],
    minTargets: targetSpec.minTargets,
    maxTargets: 1,
    targetDescription: targetSpec.description,
    graveyardExileAbilityTargetSelection: true,
    cardId,
    cardName,
    graveyardExileAbility: ability,
  };
  const step = ResolutionQueueManager.addStep(gameId, queuedStep as any);
  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  persistQueuedGraveyardAbilityStepActivation({
    gameId,
    game,
    playerId: String(pid),
    cardId: String(cardId),
    abilityId: GRAVEYARD_EXILE_STACK_ABILITY_ID,
    queuedStep: { ...queuedStep, id: String((step as any)?.id || '') },
  });
  broadcastGame(io, game, gameId);
  return true;
}

/** TARGET_SELECTION with `graveyardExileAbilityTargetSelection`: pay the cost and put it on the stack. */
export function handleGraveyardExileAbilityTargetSelection(io: any, game: any, gameId: string, step: any, response: any): void {
  const pid = String(step?.playerId || response?.playerId || '');
  const emitError: EmitError = (payload) => emitToPlayer(io, pid as any, 'error', payload);
  const ability = step?.graveyardExileAbility as GraveyardExileSelfAbility | undefined;
  const cardId = String(step?.cardId || step?.sourceId || '');
  const zones = game.state?.zones?.[pid];
  const card = (Array.isArray(zones?.graveyard) ? zones.graveyard : []).find((c: any) => c && String(c.id) === cardId);
  if (!ability || !card) {
    emitError({ code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
    return;
  }
  const raw = response?.selections;
  const selections = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((v: any) => String(v)).filter(Boolean);
  const min = Number(step?.minTargets ?? 1);
  const max = Number(step?.maxTargets ?? 1);
  if (selections.length < min || selections.length > max) {
    emitError({ code: 'INVALID_TARGET_COUNT', message: `Select ${min === max ? min : `${min}-${max}`} target(s).` });
    return;
  }
  const validIds = new Set((Array.isArray(step?.validTargets) ? step.validTargets : []).map((t: any) => String(t?.id || '')));
  if (selections.some((id: string) => !validIds.has(id))) {
    emitError({ code: 'INVALID_TARGET', message: 'Invalid target selection' });
    return;
  }
  payAndPushGraveyardExileAbility({ io, game, gameId, pid, card, cardId, ability, targets: selections, emitError });
}
