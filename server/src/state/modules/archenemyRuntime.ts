/**
 * Archenemy runtime (CR 904): set a scheme in motion / abandon ongoing schemes.
 * Deck UI comes later — callers seed schemeDeck + archenemyPlayerId when
 * houseRules.enableArchenemy is on.
 *
 * Public: isArchenemyEnabled, isOngoingScheme, setSchemeInMotion, abandonScheme,
 * getArchenemyPlayerId.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { detectAbilityActivatedTriggers } from './triggers/ability-activated-detection.js';
import { queueGenericTriggeredAbility } from './triggerEmissionFamilyUtils.js';
import { appendEvent } from '../../db/index.js';
import { asCommandZoneAbilitySource } from './commandZoneAbilitySources.js';
import {
  isOngoingSchemeTypeLine,
  isSchemeTypeLine,
  normalizePlanechaseOracleText,
} from './planechaseOracleNormalize.js';

export function isArchenemyEnabled(state: any): boolean {
  return state?.houseRules?.enableArchenemy === true;
}

export function getArchenemyPlayerId(state: any): string {
  return String(state?.archenemyPlayerId || state?.archenemyPlayer || '').trim();
}

export function isOngoingScheme(card: any): boolean {
  if (card?.is_ongoing === true || card?.ongoing === true) return true;
  const typeLine = String(card?.type_line || card?.typeLine || '');
  if (isOngoingSchemeTypeLine(typeLine)) return true;
  // Reminder / body: "An ongoing scheme remains face up until it's abandoned."
  const oracle = String(card?.oracle_text || card?.text || '');
  return /\bongoing scheme\b/i.test(oracle) || /\babandon this scheme\b/i.test(oracle);
}

function ensureSchemeZones(state: any): void {
  if (!Array.isArray(state.schemeDeck)) state.schemeDeck = [];
  if (!Array.isArray(state.ongoingSchemes)) state.ongoingSchemes = [];
  if (!Array.isArray(state.activeSchemes)) state.activeSchemes = state.ongoingSchemes;
  if (!Array.isArray(state.schemeGraveyard)) state.schemeGraveyard = [];
}

function syncOngoingAliases(state: any): void {
  state.activeSchemes = state.ongoingSchemes;
}

function queueSchemeInMotionTriggers(ctx: GameContext, schemeSource: any): any[] {
  const state = (ctx as any)?.state;
  const card = {
    ...schemeSource.card,
    oracle_text: normalizePlanechaseOracleText(schemeSource.card?.oracle_text || ''),
  };
  const triggers = detectAbilityActivatedTriggers(card, schemeSource, state)
    .filter((t) => t.triggerType === 'scheme_in_motion');
  const queued: any[] = [];
  for (const trigger of triggers) {
    const item = queueGenericTriggeredAbility(
      ctx,
      {
        permanentId: String(schemeSource.id || ''),
        controllerId: String(schemeSource.controller || '') as PlayerID,
        cardName: String(schemeSource.card?.name || 'Scheme'),
        effect: trigger.effect,
        description: trigger.effect,
        mandatory: !/^you may\b/i.test(String(trigger.effect || '')),
        _sourceSnapshot: schemeSource,
      },
      'scheme_in_motion',
      { schemeInMotion: true, schemeId: schemeSource.id },
    );
    if (item) queued.push(item);
  }
  if (queued.length === 0) {
    const oracle = String(card.oracle_text || '');
    const match = oracle.match(/when you set this scheme in motion,?\s*(.+)/is);
    if (match) {
      let effect = String(match[1] || '').trim();
      // Drop ongoing static lines that follow the set-in-motion sentence.
      effect = effect.split(/\n(?=creatures |spells |at the |whenever )/i)[0].trim();
      const item = queueGenericTriggeredAbility(
        ctx,
        {
          permanentId: String(schemeSource.id || ''),
          controllerId: String(schemeSource.controller || '') as PlayerID,
          cardName: String(schemeSource.card?.name || 'Scheme'),
          effect,
          description: effect,
          mandatory: !/^you may\b/i.test(effect),
          _sourceSnapshot: schemeSource,
        },
        'scheme_in_motion',
        { schemeInMotion: true, schemeId: schemeSource.id },
      );
      if (item) queued.push(item);
    }
  }
  return queued;
}

/**
 * CR 904.4: set the top scheme of the scheme deck in motion.
 */
export function setSchemeInMotion(
  ctx: GameContext,
  playerId?: string,
): {
  ok: boolean;
  scheme: any | null;
  ongoing: boolean;
  queued: any[];
  reason?: string;
} {
  const state = (ctx as any)?.state;
  if (!state) return { ok: false, scheme: null, ongoing: false, queued: [], reason: 'no state' };
  if (!isArchenemyEnabled(state)) {
    return { ok: false, scheme: null, ongoing: false, queued: [], reason: 'archenemy disabled' };
  }

  ensureSchemeZones(state);
  const archenemy = String(playerId || getArchenemyPlayerId(state) || '').trim();
  if (!archenemy) {
    return { ok: false, scheme: null, ongoing: false, queued: [], reason: 'no archenemy player' };
  }

  if (state.schemeDeck.length === 0) {
    return { ok: false, scheme: null, ongoing: false, queued: [], reason: 'empty scheme deck' };
  }

  const scheme = state.schemeDeck.shift();
  const ongoing = isOngoingScheme(scheme);
  const stamped = {
    ...scheme,
    id: String(scheme?.id || `scheme_${uidLike()}`),
    controller: archenemy,
    owner: archenemy,
    is_ongoing: ongoing,
    type_line: String(scheme?.type_line || (ongoing ? 'Ongoing Scheme' : 'Scheme')),
    oracle_text: normalizePlanechaseOracleText(scheme?.oracle_text || scheme?.text || ''),
    zone: 'command',
  };

  if (ongoing) {
    state.ongoingSchemes.push(stamped);
    syncOngoingAliases(state);
  } else {
    // Non-ongoing schemes are abandoned after their set-in-motion ability resolves
    // (CR 904.7 → bottom of scheme deck). Park on lastSchemeInMotion for "that scheme"
    // references while the ability is resolving.
    state.lastSchemeInMotion = stamped;
    state.schemeDeck.push(stamped);
  }

  const source = asCommandZoneAbilitySource(stamped, archenemy, 'scheme');

  // Save the snapshot BEFORE queueing the "when you set this scheme in motion" trigger. A reload
  // keeps a pending trigger on the stack only when the last logged event is its pushTriggeredAbility
  // (replay-prompt-cleanup.ts), so the snapshot must precede the push.
  const gameId = String((ctx as any)?.gameId || '').trim();
  if (gameId && !(ctx as any)?.isReplaying) {
    try {
      appendEvent(gameId, Number(state.seq ?? (ctx as any).seq?.value ?? 0), 'setSchemeInMotion', {
        playerId: archenemy,
        scheme: stamped,
        ongoing,
        schemeDeck: Array.isArray(state.schemeDeck) ? [...state.schemeDeck] : [],
        ongoingSchemes: Array.isArray(state.ongoingSchemes) ? [...state.ongoingSchemes] : [],
        schemeGraveyard: Array.isArray(state.schemeGraveyard) ? [...state.schemeGraveyard] : [],
        lastSchemeInMotion: state.lastSchemeInMotion || null,
        oracleIrReplayMutation: true,
      });
    } catch (err) {
      debugWarn(1, '[setSchemeInMotion] appendEvent failed:', err);
    }
  }

  const queued = queueSchemeInMotionTriggers(ctx, source);

  debug(1, `[setSchemeInMotion] ${stamped.name} (ongoing=${ongoing}, triggers=${queued.length})`);
  return { ok: true, scheme: stamped, ongoing, queued };
}

function uidLike(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * CR 904.7: abandon an ongoing scheme — move it to the scheme graveyard.
 */
export function abandonScheme(
  ctx: GameContext,
  schemeIdOrName: string,
): { ok: boolean; scheme: any | null; reason?: string } {
  const state = (ctx as any)?.state;
  if (!state) return { ok: false, scheme: null, reason: 'no state' };
  ensureSchemeZones(state);
  const needle = String(schemeIdOrName || '').trim().toLowerCase();
  if (!needle) return { ok: false, scheme: null, reason: 'no scheme id' };

  const index = state.ongoingSchemes.findIndex((scheme: any) => {
    const ids = [
      String(scheme?.id || ''),
      String(scheme?.name || ''),
      String(scheme?.card?.id || ''),
      String(scheme?.card?.name || ''),
    ].map((s) => s.trim().toLowerCase()).filter(Boolean);
    return ids.includes(needle);
  });
  if (index < 0) return { ok: false, scheme: null, reason: 'scheme not ongoing' };

  const [scheme] = state.ongoingSchemes.splice(index, 1);
  // CR 904.7: abandoned schemes go to the bottom of the scheme deck.
  state.schemeDeck.push(scheme);
  syncOngoingAliases(state);

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (gameId && !(ctx as any)?.isReplaying) {
    try {
      appendEvent(gameId, Number(state.seq ?? (ctx as any).seq?.value ?? 0), 'abandonScheme', {
        schemeId: scheme?.id,
        schemeName: scheme?.name,
        scheme,
        schemeDeck: Array.isArray(state.schemeDeck) ? [...state.schemeDeck] : [],
        ongoingSchemes: Array.isArray(state.ongoingSchemes) ? [...state.ongoingSchemes] : [],
        schemeGraveyard: Array.isArray(state.schemeGraveyard) ? [...state.schemeGraveyard] : [],
        oracleIrReplayMutation: true,
      });
    } catch (err) {
      debugWarn(1, '[abandonScheme] appendEvent failed:', err);
    }
  }

  debug(1, `[abandonScheme] ${scheme?.name || schemeIdOrName}`);
  return { ok: true, scheme };
}

export function schemeCardLooksValid(card: any): boolean {
  const typeLine = String(card?.type_line || card?.typeLine || '');
  return isSchemeTypeLine(typeLine) || isOngoingSchemeTypeLine(typeLine) || Boolean(card?.is_ongoing);
}
