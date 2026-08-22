/**
 * triggers/combat.ts
 * 
 * Combat-related trigger detection and processing.
 * Includes beginning of combat, attack, end of combat, and combat damage triggers.
 * 
 * Combat phases:
 * - Beginning of Combat: detectBeginningOfCombatTriggers, getBeginningOfCombatTriggers
 * - Declare Attackers: detectAttackTriggers, getAttackTriggersForCreatures
 * - Combat Damage: detectCombatDamageTriggers, getCombatDamageTriggersForCreature
 * - End of Combat: detectEndOfCombatTriggers, getEndOfCombatTriggers
 */

import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import {
  findRegexMatchAcrossOracleLines,
  getOracleLines,
} from '../../../../../rules-engine/src/oracleLineRegexMatch.js';
import {
  KNOWN_COMBAT_DAMAGE_TRIGGERS,
  KNOWN_ATTACK_TRIGGERS,
  KNOWN_BEGINNING_COMBAT_TRIGGERS,
} from "./card-data-tables.js";
import type { BeginningOfCombatTrigger } from "./types.js";
import { escapeCardNameForRegex } from "./types.js";
import { debug, debugWarn, debugError } from "../../../utils/debug.js";
import { permanentHasCreatureType } from "../../../../../shared/src/creatureTypes.js";
import {
  extractQuotedAbilityTexts,
  parseAttachmentGrantedAbilityTextsFromOracle,
} from "../../../../../shared/src/attachmentAbilityGrants.js";
import { isInterveningIfSatisfied } from "./intervening-if.js";
import {
  inferCombatWhoseTurn,
  shouldQueuePhaseTriggerForActivePlayer,
} from "./phaseWhoseTurn.js";
import { detectKeywords } from "../keyword-detection.js";
import { getActualPowerToughness, normalizeCardNameForOracleText } from "../../utils.js";
import { hasTrainingKeyword } from "../../../../../rules-engine/src/keywordAbilities/training.js";

// ============================================================================
// Trigger Doubling (Roaming Throne, Isshin, Teysa Karlov, etc.)
// ============================================================================

/**
 * Interface for trigger doubler permanents
 */
/** Coarse event family used by existing call sites. */
type TriggerDoublerEvent = 'attack' | 'etb' | 'death' | 'any';

/**
 * Finer cause for "if X causes a triggered ability … to trigger" effects.
 * When set on a doubler, the runtime cause must match one of these.
 */
type TriggerDoublerCause =
  | 'attack'
  | 'etb'
  | 'death'
  | 'land_etb'
  | 'combat_damage_to_player'
  | 'draw'
  | 'face_up'
  | 'instant_sorcery_cast_or_copy'
  | 'damage_to_your_creature'
  | 'etb_or_ltb'
  | 'any';

interface TriggerDoubler {
  permanentId: string;
  cardName: string;
  controller: string;
  creatureTypeFilter?: string;  // For Roaming Throne - chosen creature type
  /** Source permanent must have one of these creature types (Harmonic Prodigy, Ally, Ninja, …). */
  sourceCreatureTypes?: string[];
  /** Harmonic Prodigy: Wizard matches only as "another" (exclude self). */
  sourceCreatureTypesExcludeSelf?: string[];
  sourceLegendaryCreatureOnly?: boolean;
  sourceAnyCreatureOnly?: boolean;
  sourceMaxPower?: number;
  sourceShrineOnly?: boolean;
  triggerTypeFilter?: TriggerDoublerEvent;
  causeFilters?: TriggerDoublerCause[];
  /** Entering/leaving permanent for cause-based ETB filters (Wizard, Bird, land, artifact/legendary). */
  causeEnteringCreatureTypes?: string[];
  causeEnteringMustBeLand?: boolean;
  causeEnteringMustBeArtifactOrLegendary?: boolean;
  affectsOthersOnly?: boolean;  // "another … you control"
  equippedCreatureOnly?: boolean;
  /**
   * Masamune: also double death triggers from emblems owned by the equipped
   * creature's controller (while the Equipment remains attached).
   */
  ownedEmblemAlso?: boolean;
  colorlessSourceOnly?: boolean;
  /** Cloud: only while this permanent is equipped; doubles self or attached Equipment triggers. */
  selfOrAttachedEquipmentOnly?: boolean;
  requiresSelfEquipped?: boolean;
  requiresSixShrines?: boolean;
  requiresFullParty?: boolean;
  /** Hama Pashar / Dungeon Delver — doubles dungeon room abilities, not stack triggers. */
  dungeonRoomAbilities?: boolean;
  /**
   * Fish Brewer: +1 copy per untapped Fish tapped this way.
   * Runtime taps those Fish when applying stack copies.
   */
  additionalCopiesPerUntappedCreatureType?: string;
  /** Entering permanent must not be the doubler itself ("another permanent"). */
  causeEnteringMustNotBeSelf?: boolean;
  /** Detected but not auto-applied (unknown templates). */
  unsupportedReason?: string;
}

export interface TriggerDoublerEventContext {
  cause?: TriggerDoublerCause;
  enteringPermanent?: any;
}

function triggerSourceIsColorless(source: any): boolean {
  if (!source) return false;
  const card = source.card || source;
  const colors = Array.isArray(card?.colors)
    ? card.colors
    : (Array.isArray(source?.colors) ? source.colors : null);
  if (Array.isArray(colors)) {
    return colors.length === 0;
  }
  // Fallback when colors array is missing: mana cost with no colored symbols + no color indicator words.
  const manaCost = String(card?.mana_cost || source?.mana_cost || '');
  if (manaCost && !/[WUBRG]/i.test(manaCost)) {
    return true;
  }
  const colorIdentity = Array.isArray(card?.color_identity) ? card.color_identity : [];
  if (Array.isArray(card?.color_identity)) {
    return colorIdentity.length === 0;
  }
  return false;
}

function stripQuotedGrantedAbilities(oracleText: string): string {
  return String(oracleText || '').replace(/["\u201C][^"\u201D]*["\u201D]/g, ' ');
}

function oracleHasDungeonRoomDoublerText(oracleText: string): boolean {
  return /room abilities of dungeons you own trigger an additional time/i.test(String(oracleText || ''));
}

/**
 * True when the player controls a permanent that doubles dungeon room abilities.
 * Backgrounds (e.g. Dungeon Delver) only grant while on the battlefield — not from
 * the command zone (CR: commander abilities don't function there unless they say so;
 * CLB notes: "If you control a Background that grants…").
 */
export function playerHasDungeonRoomAbilityDoubler(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  if (!pid) return false;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== pid) continue;
    const oracle = String(perm.card?.oracle_text || '');
    if (oracleHasDungeonRoomDoublerText(oracle)) return true;
    // Background must be controlled (on battlefield) for quoted commander grants
    for (const granted of parseAttachmentGrantedAbilityTextsFromOracle(oracle)) {
      if (oracleHasDungeonRoomDoublerText(granted)) return true;
    }
  }

  return false;
}

function countUntappedCreaturesOfType(
  battlefield: any[],
  controllerId: string,
  creatureType: string,
): any[] {
  const ctrl = String(controllerId || '');
  const type = String(creatureType || '').toLowerCase();
  return (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || String(p.controller || '') !== ctrl) return false;
    if (p.tapped === true) return false;
    return permanentHasCreatureType(p, type);
  });
}

function countShrinesControlled(battlefield: any[], controllerId: string): number {
  return (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || String(p.controller || '') !== String(controllerId || '')) return false;
    return String(p.card?.type_line || '').toLowerCase().includes('shrine');
  }).length;
}

function controllerHasFullParty(battlefield: any[], controllerId: string): boolean {
  const roles = ['cleric', 'rogue', 'warrior', 'wizard'];
  return roles.every((role) =>
    (Array.isArray(battlefield) ? battlefield : []).some((p: any) =>
      p
      && String(p.controller || '') === String(controllerId || '')
      && permanentHasCreatureType(p, role)
    )
  );
}

function permanentIsEquipped(battlefield: any[], permanent: any): boolean {
  if (!permanent) return false;
  if (Array.isArray(permanent.attachedEquipment) && permanent.attachedEquipment.length > 0) return true;
  const id = String(permanent.id || '');
  if (!id) return false;
  return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
    const typeLine = String(p?.card?.type_line || '').toLowerCase();
    return typeLine.includes('equipment') && String(p?.attachedTo || '') === id;
  });
}

function inferTriggerCauseFromStackItem(stackItem: any): TriggerDoublerCause {
  const triggerType = String(stackItem?.triggerType || '').toLowerCase();
  // Prefer explicit stack trigger family over effect-text heuristics (e.g. ETB that draws).
  if (triggerType.includes('landfall')) return 'land_etb';
  if (triggerType.includes('annihilator') || triggerType === 'attack' || triggerType.includes('attacks')) {
    return 'attack';
  }
  if (triggerType.includes('death') || triggerType.includes('dies')) return 'death';
  if (triggerType.includes('landfall') || triggerType === 'etb' || triggerType.includes('enters')) {
    return 'etb';
  }

  const raw = `${triggerType} ${stackItem?.description || ''} ${stackItem?.effect || ''}`.toLowerCase();
  if (raw.includes('landfall') || (/\bland\b/.test(raw) && /enter/.test(raw))) return 'land_etb';
  if (raw.includes('annihilator') || /\battacks?\b/.test(raw)) return 'attack';
  if (raw.includes('dies') || raw.includes('dying') || raw.includes('death') || raw.includes('graveyard from the battlefield')) {
    return 'death';
  }
  if (raw.includes('combat damage') && raw.includes('player')) return 'combat_damage_to_player';
  if (/\bdraw/.test(raw)) return 'draw';
  if (raw.includes('face up') || raw.includes('face-down') || raw.includes('turned face')) return 'face_up';
  if (raw.includes('instant') || raw.includes('sorcery')) return 'instant_sorcery_cast_or_copy';
  if (raw.includes('dealt damage') || raw.includes('is dealt damage') || raw.includes('being dealt damage')) {
    return 'damage_to_your_creature';
  }
  if (raw.includes('leaves') || raw.includes('ltb') || raw.includes('leaving')) return 'etb_or_ltb';
  if (raw.includes('etb') || raw.includes('enter')) return 'etb';
  return 'any';
}

/**
 * Detect trigger doublers on the battlefield.
 * Pattern-based coverage for paper "triggers an additional time" cards.
 */
export function detectTriggerDoublers(
  battlefield: any[],
  controllerId: string
): TriggerDoubler[] {
  const doublers: TriggerDoubler[] = [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controllerId) continue;
    
    const rawOracle = String(perm.card?.oracle_text || '');
    const oracleText = rawOracle.toLowerCase();
    // Ignore ability text granted in quotes on Equipment/Auras (e.g. The Masamune).
    const patternOracle = stripQuotedGrantedAbilities(oracleText);
    const cardName = perm.card?.name || 'Unknown';
    
    if (!oracleText.includes('triggers an additional time') && 
        !oracleText.includes('trigger an additional time')) {
      continue;
    }

    const push = (partial: Omit<TriggerDoubler, 'permanentId' | 'cardName' | 'controller'>) => {
      doublers.push({
        permanentId: perm.id,
        cardName,
        controller: perm.controller,
        ...partial,
      });
      debug(2, `[detectTriggerDoublers] ${cardName}: ${partial.unsupportedReason || partial.triggerTypeFilter || 'any'}${partial.causeFilters ? ` cause=${partial.causeFilters.join(',')}` : ''}`);
    };

    // Doubling only appears inside granted-ability quotes (Backgrounds / Equipment grants).
    if (!patternOracle.includes('triggers an additional time') &&
        !patternOracle.includes('trigger an additional time')) {
      const grantedAbilities = [
        ...parseAttachmentGrantedAbilityTextsFromOracle(rawOracle),
        ...extractQuotedAbilityTexts(rawOracle),
      ];
      let categorizedGranted = false;
      for (const granted of grantedAbilities) {
        const grantedLower = granted.toLowerCase();
        if (!grantedLower.includes('triggers an additional time') &&
            !grantedLower.includes('trigger an additional time')) {
          continue;
        }
        // Masamune: death-cause doubler on the equipped creature and/or emblems you own
        if (/if a creature dying causes a triggered ability/i.test(granted)) {
          push({
            triggerTypeFilter: 'death',
            causeFilters: ['death'],
            equippedCreatureOnly: /equipped creature has/i.test(oracleText),
            ownedEmblemAlso: /\bemblem you own\b/i.test(granted),
          });
          categorizedGranted = true;
          break;
        }
        // Dungeon Delver Background quote
        if (oracleHasDungeonRoomDoublerText(granted)) {
          push({ triggerTypeFilter: 'any', dungeonRoomAbilities: true });
          categorizedGranted = true;
          break;
        }
      }
      if (!categorizedGranted && oracleHasDungeonRoomDoublerText(oracleText)) {
        push({ triggerTypeFilter: 'any', dungeonRoomAbilities: true });
      } else if (!categorizedGranted) {
        push({
          triggerTypeFilter: 'any',
          unsupportedReason: 'unparsed_granted_additional_time',
        });
      }
      continue;
    }

    // Dungeon room abilities — applied when venturing, not via stack trigger copies.
    if (oracleHasDungeonRoomDoublerText(patternOracle) || oracleHasDungeonRoomDoublerText(oracleText)) {
      push({ triggerTypeFilter: 'any', dungeonRoomAbilities: true });
      continue;
    }

    // Fish Brewer: +1 per Fish tapped when another permanent's ETB causes a trigger.
    if (
      /if another permanent entering(?: the battlefield)? causes a triggered ability/i.test(patternOracle)
      && /additional time for each fish/i.test(patternOracle)
    ) {
      push({
        triggerTypeFilter: 'etb',
        causeFilters: ['etb', 'land_etb'],
        causeEnteringMustNotBeSelf: true,
        additionalCopiesPerUntappedCreatureType: 'fish',
      });
      continue;
    }

    // Other per-N multipliers not yet specialized.
    if (/triggers? an additional time for each\b/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', unsupportedReason: 'per_n_additional_times' });
      continue;
    }

    // Wizard's Staff: equipped creature's triggers
    if (/if a triggered ability of equipped creature triggers/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', equippedCreatureOnly: true });
      continue;
    }

    // Cloud: while equipped, Cloud or attached Equipment triggers
    if (
      /as long as .* is equipped/i.test(patternOracle)
      && /triggered ability of .* or an equipment attached to it triggers/i.test(patternOracle)
    ) {
      push({
        triggerTypeFilter: 'any',
        selfOrAttachedEquipmentOnly: true,
        requiresSelfEquipped: true,
      });
      continue;
    }

    // Roaming Throne: chosen creature type
    if (/if a triggered ability of another creature you control of the chosen type triggers/i.test(patternOracle)) {
      const chosenType = (perm as any).chosenCreatureType;
      if (chosenType) {
        push({
          triggerTypeFilter: 'any',
          creatureTypeFilter: chosenType,
          affectsOthersOnly: true,
        });
      }
      continue;
    }

    // Harmonic Prodigy: Shaman or another Wizard
    if (/if a triggered ability of a shaman or another wizard you control triggers/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        sourceCreatureTypes: ['shaman'],
        sourceCreatureTypesExcludeSelf: ['wizard'],
      });
      continue;
    }

    // Fixed tribal/source templates: "If a triggered ability of a(n) <Type> … triggers"
    const legendaryCreatureSource = /if a triggered ability of a legendary creature you control triggers/i.test(patternOracle);
    if (legendaryCreatureSource) {
      push({ triggerTypeFilter: 'any', sourceLegendaryCreatureOnly: true });
      continue;
    }

    // Doctor / Ally / Ninja / Elemental / Shrine source filters
    if (/if a triggered ability of a doctor you control triggers/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', sourceCreatureTypes: ['doctor'] });
      continue;
    }
    if (/if a triggered ability of an ally you control triggers/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', sourceCreatureTypes: ['ally'] });
      continue;
    }
    if (/if a triggered ability of a ninja creature you control triggers/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', sourceCreatureTypes: ['ninja'] });
      continue;
    }
    if (/if a triggered ability of another elemental you control triggers/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        sourceCreatureTypes: ['elemental'],
        affectsOthersOnly: true,
      });
      continue;
    }
    if (/if a triggered ability of another shrine you control triggers/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        sourceShrineOnly: true,
        affectsOthersOnly: true,
        requiresSixShrines: /six or more shrines/i.test(patternOracle),
      });
      continue;
    }

    // Delney: power 2 or less
    if (/if a triggered ability of a creature you control with power 2 or less triggers/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', sourceMaxPower: 2 });
      continue;
    }

    // Wizard from Beyond: full party → any creature you control
    if (/as long as you have a full party, if an ability of a creature you control triggers/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', requiresFullParty: true, sourceAnyCreatureOnly: true });
      continue;
    }

    // Cause-based: combat damage to a player (Felix)
    if (/if a creature you control dealing combat damage to a player causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        causeFilters: ['combat_damage_to_player'],
      });
      continue;
    }

    // Cause-based: damage to your creature (Wayta)
    if (/if a creature you control being dealt damage causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        causeFilters: ['damage_to_your_creature'],
      });
      continue;
    }

    // Cause-based: draw (Krang)
    if (/if a player drawing a card causes a triggered ability/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', causeFilters: ['draw'] });
      continue;
    }

    // Cause-based: face up (Panoptic Projektor)
    if (/if turning a face-down permanent face up causes a triggered ability/i.test(patternOracle)) {
      push({ triggerTypeFilter: 'any', causeFilters: ['face_up'] });
      continue;
    }

    // Cause-based: cast/copy instant or sorcery (Veyran)
    if (/if you casting or copying an instant or sorcery spell causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        causeFilters: ['instant_sorcery_cast_or_copy'],
      });
      continue;
    }

    // Cause-based: attack (Isshin / Wulfgar / Windcrag Siege)
    if (/if a creature(?: you control)? attacking causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'attack',
        causeFilters: ['attack'],
      });
      continue;
    }

    // Cause-based: death (Teysa / Drivnod)
    if (/if a creature dying causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'death',
        causeFilters: ['death'],
      });
      continue;
    }

    // Cause-based: land entering (Ancient Greenwarden)
    if (/if a land entering causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'etb',
        causeFilters: ['land_etb'],
        causeEnteringMustBeLand: true,
      });
      continue;
    }

    // Cause-based: land or Bird ETB (Traveling Chocobo)
    if (/if a land or bird you control entering(?: the battlefield)? causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'etb',
        causeFilters: ['land_etb', 'etb'],
        causeEnteringMustBeLand: true,
        causeEnteringCreatureTypes: ['bird'],
      });
      continue;
    }

    // Cause-based: Wizard ETB (Naban)
    if (/if a wizard you control entering causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'etb',
        causeFilters: ['etb'],
        causeEnteringCreatureTypes: ['wizard'],
      });
      continue;
    }

    // Cause-based: legendary permanent or artifact ETB/LTB (Gandalf the White)
    if (/if a legendary permanent or an artifact entering or leaving the battlefield causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        causeFilters: ['etb', 'etb_or_ltb'],
        causeEnteringMustBeArtifactOrLegendary: true,
      });
      continue;
    }

    // Panharmonicon / Elesh / Yarok / Starfield: permanent/artifact/creature ETB
    if (/if (?:an? )?(?:artifact or creature|permanent) entering(?: the battlefield)? causes a triggered ability/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'etb',
        causeFilters: ['etb', 'land_etb'],
      });
      continue;
    }

    // Echoes of Eternity: colorless spell / another colorless permanent
    if (/if a triggered ability of (?:a colorless spell you control or )?(?:another )?colorless permanent you control triggers/i.test(patternOracle)) {
      push({
        triggerTypeFilter: 'any',
        colorlessSourceOnly: true,
        affectsOthersOnly: /another colorless permanent/i.test(patternOracle),
      });
      continue;
    }

    // Generic fallback: still register so corpus audits don't miss the card.
    push({
      triggerTypeFilter: 'any',
      unsupportedReason: 'unparsed_additional_time_template',
    });
    debug(2, `[detectTriggerDoublers] Fallback categorization for ${cardName}`);
  }
  
  return doublers;
}

/**
 * Apply trigger doublers to a list of triggers
 * Returns the modified trigger list with doubled triggers added
 * 
 * @param triggers - Original triggers list
 * @param doublers - Active trigger doublers
 * @param triggerType - The type of trigger event ('attack', 'etb', 'death', etc.)
 * @param sourcePermanent - The permanent whose trigger is firing (for creature type checks)
 */
export function applyTriggerDoublers(
  triggers: CombatTriggeredAbility[],
  doublers: TriggerDoubler[],
  triggerType: TriggerDoublerEvent,
  sourcePermanent?: any,
  battlefield?: any[],
  eventContext?: TriggerDoublerEventContext,
): CombatTriggeredAbility[] {
  if (doublers.length === 0 || triggers.length === 0) {
    return triggers;
  }
  
  const result: CombatTriggeredAbility[] = [];
  const bf = Array.isArray(battlefield) ? battlefield : [];
  const cause = eventContext?.cause
    || (triggerType === 'any' ? 'any' : triggerType);
  const entering = eventContext?.enteringPermanent;
  
  for (const trigger of triggers) {
    // Always add the original trigger
    result.push(trigger);
    
    // Check each doubler to see if it applies
    for (const doubler of doublers) {
      if (doubler.unsupportedReason) continue;
      // Dungeon room doubling is handled in venture resolution, not stack copies.
      if (doubler.dungeonRoomAbilities) continue;

      // Check trigger type filter
      if (doubler.triggerTypeFilter && 
          doubler.triggerTypeFilter !== 'any' && 
          doubler.triggerTypeFilter !== triggerType) {
        continue;
      }

      if (Array.isArray(doubler.causeFilters) && doubler.causeFilters.length > 0) {
        if (cause === 'any') {
          // Unknown cause: only allow if filter includes 'any'
          if (!doubler.causeFilters.includes('any')) continue;
        } else if (!doubler.causeFilters.includes(cause) && !doubler.causeFilters.includes('any')) {
          // land_etb also satisfies broad etb doublers
          if (!(cause === 'land_etb' && doubler.causeFilters.includes('etb'))) {
            continue;
          }
        }
      }
      
      // Check if this doubler affects "another …" (not itself)
      if (doubler.affectsOthersOnly && trigger.permanentId === doubler.permanentId) {
        continue;
      }

      const source = sourcePermanent
        || bf.find((p: any) => String(p?.id || '') === String(trigger.permanentId || ''));

      if (doubler.requiresSelfEquipped) {
        const self = bf.find((p: any) => String(p?.id || '') === String(doubler.permanentId || ''));
        if (!permanentIsEquipped(bf, self)) continue;
      }

      if (doubler.requiresSixShrines) {
        if (countShrinesControlled(bf, doubler.controller) < 6) continue;
      }

      if (doubler.requiresFullParty) {
        if (!controllerHasFullParty(bf, doubler.controller)) continue;
      }

      // Equipment grants: equipped creature's triggers, and optionally owned emblems (Masamune)
      if (doubler.equippedCreatureOnly || doubler.ownedEmblemAlso) {
        const equipment = bf.find((p: any) => String(p?.id || '') === String(doubler.permanentId || ''));
        const attachedTo = String(equipment?.attachedTo || '');
        const sourceId = String(source?.id || trigger.permanentId || '');
        if (!equipment || !attachedTo) {
          continue;
        }

        const isEquippedHost = attachedTo === sourceId;
        let isOwnedEmblem = false;
        if (doubler.ownedEmblemAlso) {
          const host = bf.find((p: any) => String(p?.id || '') === attachedTo);
          const hostController = String(host?.controller || equipment.controller || doubler.controller || '');
          const sourceController = String(source?.controller || '');
          const looksLikeEmblem =
            source?.isEmblem === true
            || String(source?.card?.type_line || '').toLowerCase() === 'emblem'
            || String(trigger?.cardName || '').toLowerCase().includes('emblem');
          isOwnedEmblem = looksLikeEmblem && !!sourceController && sourceController === hostController;
        }

        if (!isEquippedHost && !isOwnedEmblem) {
          continue;
        }
      }

      // Cloud: source is Cloud itself or an Equipment attached to Cloud
      if (doubler.selfOrAttachedEquipmentOnly) {
        const selfId = String(doubler.permanentId || '');
        const sourceId = String(source?.id || trigger.permanentId || '');
        const isSelf = sourceId === selfId;
        const isAttachedEquipment = String(source?.attachedTo || '') === selfId
          && String(source?.card?.type_line || '').toLowerCase().includes('equipment');
        if (!isSelf && !isAttachedEquipment) continue;
      }

      // Echoes of Eternity: only colorless sources
      if (doubler.colorlessSourceOnly) {
        if (!triggerSourceIsColorless(source)) {
          continue;
        }
      }

      if (doubler.sourceAnyCreatureOnly) {
        if (!String(source?.card?.type_line || '').toLowerCase().includes('creature')) continue;
      }

      if (doubler.sourceLegendaryCreatureOnly) {
        const tl = String(source?.card?.type_line || '').toLowerCase();
        if (!tl.includes('legendary') || !tl.includes('creature')) continue;
      }

      if (doubler.sourceShrineOnly) {
        if (!String(source?.card?.type_line || '').toLowerCase().includes('shrine')) continue;
      }

      if (typeof doubler.sourceMaxPower === 'number' && source) {
        const { power } = getActualPowerToughness(source, { battlefield: bf });
        if (!(Number(power) <= doubler.sourceMaxPower)) continue;
      }
      
      // Check creature type filter (chosen type / fixed types)
      if (doubler.creatureTypeFilter && source) {
        if (!permanentHasCreatureType(source, doubler.creatureTypeFilter)) {
          continue;
        }
      }

      if (Array.isArray(doubler.sourceCreatureTypes) && doubler.sourceCreatureTypes.length > 0) {
        const matchesInclude = doubler.sourceCreatureTypes.some((t) => permanentHasCreatureType(source, t));
        const matchesExcludeSelf = Array.isArray(doubler.sourceCreatureTypesExcludeSelf)
          && doubler.sourceCreatureTypesExcludeSelf.some((t) =>
            permanentHasCreatureType(source, t)
            && String(source?.id || '') !== String(doubler.permanentId || '')
          );
        if (!matchesInclude && !matchesExcludeSelf) continue;
      } else if (Array.isArray(doubler.sourceCreatureTypesExcludeSelf) && doubler.sourceCreatureTypesExcludeSelf.length > 0) {
        const matchesExcludeSelf = doubler.sourceCreatureTypesExcludeSelf.some((t) =>
          permanentHasCreatureType(source, t)
          && String(source?.id || '') !== String(doubler.permanentId || '')
        );
        if (!matchesExcludeSelf) continue;
      }

      // Cause-entering filters (Naban / Chocobo / Gandalf / Greenwarden)
      if (doubler.causeEnteringMustBeLand || doubler.causeEnteringCreatureTypes || doubler.causeEnteringMustBeArtifactOrLegendary) {
        if (!entering) {
          // Without entering context, only allow when cause already encodes land_etb
          if (doubler.causeEnteringMustBeLand && cause === 'land_etb') {
            // ok
          } else if (doubler.causeEnteringCreatureTypes && cause === 'etb') {
            continue; // need entering permanent to verify Bird/Wizard
          } else if (doubler.causeEnteringMustBeArtifactOrLegendary) {
            continue;
          } else if (doubler.causeEnteringMustBeLand && cause !== 'land_etb') {
            continue;
          }
        } else {
          const enteringTl = String(entering?.card?.type_line || '').toLowerCase();
          const isLand = enteringTl.includes('land');
          const isArtifact = enteringTl.includes('artifact');
          const isLegendary = enteringTl.includes('legendary');
          const typeOk = Array.isArray(doubler.causeEnteringCreatureTypes)
            && doubler.causeEnteringCreatureTypes.some((t) => permanentHasCreatureType(entering, t));
          if (doubler.causeEnteringMustBeLand && doubler.causeEnteringCreatureTypes) {
            if (!isLand && !typeOk) continue;
          } else if (doubler.causeEnteringMustBeLand) {
            if (!isLand) continue;
          } else if (doubler.causeEnteringCreatureTypes) {
            if (!typeOk) continue;
          }
          if (doubler.causeEnteringMustBeArtifactOrLegendary) {
            if (!isArtifact && !isLegendary) continue;
          }
        }
      }

      if (doubler.causeEnteringMustNotBeSelf) {
        const enteringId = String(entering?.id || '');
        if (!enteringId || enteringId === String(doubler.permanentId || '')) {
          continue;
        }
      }

      let extraCopies = 1;
      if (doubler.additionalCopiesPerUntappedCreatureType) {
        const fish = countUntappedCreaturesOfType(
          bf,
          doubler.controller,
          doubler.additionalCopiesPerUntappedCreatureType,
        );
        extraCopies = fish.length;
        if (extraCopies <= 0) continue;
      }
      
      // This doubler applies - add copy/copies of the trigger
      for (let copyIndex = 0; copyIndex < extraCopies; copyIndex += 1) {
        const copiedTrigger: CombatTriggeredAbility = {
          ...trigger,
          description: `${trigger.description} (doubled by ${doubler.cardName})`,
          effect: trigger.effect || trigger.description,
        };
        result.push(copiedTrigger);
      }
      debug(2, `[applyTriggerDoublers] Doubled trigger '${trigger.description}' from ${trigger.cardName} due to ${doubler.cardName}${extraCopies > 1 ? ` x${extraCopies}` : ''}`);
    }
  }
  
  return result;
}

/**
 * Push additional stack copies when Roaming Throne / similar doublers apply.
 */
export function pushTriggerDoublerCopies(
  state: any,
  stackItem: any,
): void {
  if (!stackItem || stackItem.isDoubledTriggerCopy) return;

  const controllerId = String(stackItem.controller || stackItem.controllerId || '').trim();
  const sourcePermanentId = String(
    stackItem.permanentId || stackItem.source || stackItem.sourceId || '',
  ).trim();
  if (!controllerId || !sourcePermanentId) return;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const emblems = Array.isArray(state?.emblems) ? state.emblems : [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === sourcePermanentId);
  const sourceEmblem = !sourcePermanent
    ? emblems.find((emblem: any) => String(emblem?.id || '') === sourcePermanentId)
    : null;
  // Emblem triggers are not battlefield permanents; synthesize a source for filter checks.
  const sourceForDoublers = sourcePermanent || (sourceEmblem
    ? {
        id: String(sourceEmblem.id || sourcePermanentId),
        controller: String(sourceEmblem.controller || controllerId),
        isEmblem: true,
        card: {
          name: String(sourceEmblem.sourceName || 'Emblem') + (
            String(sourceEmblem.sourceName || '').toLowerCase().includes('emblem') ? '' : ' Emblem'
          ),
          type_line: 'Emblem',
          oracle_text: String(sourceEmblem.effect || ''),
        },
      }
    : null);
  if (!sourceForDoublers) return;

  const doublers = detectTriggerDoublers(battlefield, controllerId);
  if (doublers.length === 0) return;

  const triggerTypeRaw = String(stackItem.triggerType || 'any').toLowerCase();
  const triggerType: TriggerDoublerEvent =
    triggerTypeRaw.includes('attack') || triggerTypeRaw.includes('annihilator') ? 'attack'
      : triggerTypeRaw.includes('landfall') ? 'etb'
      : triggerTypeRaw.includes('etb') || triggerTypeRaw.includes('enters') ? 'etb'
        : triggerTypeRaw.includes('death') || triggerTypeRaw.includes('dies') ? 'death'
          : 'any';

  const mapped = [{
    permanentId: sourcePermanentId,
    cardName: String(
      stackItem.sourceName
      || sourceForDoublers?.card?.name
      || 'Unknown',
    ),
    controllerId,
    description: String(stackItem.description || stackItem.effect || ''),
    triggerType,
    mandatory: stackItem.mandatory !== false,
  }];

  const enteringPermanent =
    stackItem.interveningIfSubjectSnapshot
    || (stackItem.interveningIfSubjectPermanentId
      ? battlefield.find((p: any) => String(p?.id || '') === String(stackItem.interveningIfSubjectPermanentId))
      : undefined)
    || stackItem.enteringPermanent
    || stackItem.causePermanent;

  const cause = inferTriggerCauseFromStackItem(stackItem);
  const doubled = applyTriggerDoublers(
    mapped,
    doublers,
    triggerType,
    sourceForDoublers,
    battlefield,
    {
      cause,
      enteringPermanent,
    },
  );
  if (doubled.length <= mapped.length) return;

  // Fish Brewer: tap Fish that contributed additional copies (auto-max: all untapped Fish).
  const extraCopyCount = doubled.length - mapped.length;
  for (const doubler of doublers) {
    if (!doubler.additionalCopiesPerUntappedCreatureType || doubler.unsupportedReason) continue;
    if (doubler.triggerTypeFilter && doubler.triggerTypeFilter !== 'any' && doubler.triggerTypeFilter !== triggerType) {
      continue;
    }
    if (doubler.causeEnteringMustNotBeSelf) {
      const enteringId = String(enteringPermanent?.id || '');
      if (!enteringId || enteringId === String(doubler.permanentId || '')) continue;
    }
    if (Array.isArray(doubler.causeFilters) && doubler.causeFilters.length > 0) {
      if (cause !== 'any' && !doubler.causeFilters.includes(cause) && !(cause === 'land_etb' && doubler.causeFilters.includes('etb'))) {
        continue;
      }
    }
    const fish = countUntappedCreaturesOfType(
      battlefield,
      doubler.controller,
      doubler.additionalCopiesPerUntappedCreatureType,
    );
    if (fish.length <= 0 || extraCopyCount <= 0) continue;
    for (const permanent of fish) {
      permanent.tapped = true;
    }
    debug(2, `[pushTriggerDoublerCopies] ${doubler.cardName}: tapped ${fish.length} ${doubler.additionalCopiesPerUntappedCreatureType} for additional triggers`);
  }

  state.stack = state.stack || [];
  for (let i = mapped.length; i < doubled.length; i += 1) {
    const copy = doubled[i];
    state.stack.push({
      ...stackItem,
      id: `${String(stackItem.id || 'trigger')}_double_${i}`,
      description: copy.description,
      effect: String(stackItem.effect || stackItem.description || copy.description || '').trim(),
      isDoubledTriggerCopy: true,
    });
  }
}

// ============================================================================
// Local Type Definitions (compatible with types.ts but with additional fields)
// ============================================================================

/**
 * Combat trigger with additional fields for combat-specific processing
 */
export interface CombatTriggeredAbility {
  permanentId: string;
  cardName: string;
  controllerId?: string;
  triggerType?: string;
  description: string;
  effect?: string;
  value?: any;
  mandatory?: boolean;
  requiresTarget?: boolean;
  manaCost?: string;
  energyCost?: number;
  batched?: boolean;
  /** Creature type / color phrase for typed attack watchers (e.g. "Dragon", "white", "Samurai or Warrior"). */
  requiredTypePhrase?: string;
  /** Power threshold for "power N or less" attack watchers. */
  maxPower?: number;
}

export function isEnchantedByAuraYouControl(
  battlefield: readonly any[],
  creatureId: string,
  controllerId: string,
): boolean {
  const id = String(creatureId || '').trim();
  const ctrl = String(controllerId || '').trim();
  if (!id || !ctrl) return false;
  return (battlefield || []).some((perm: any) => {
    const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
    if (!/\baura\b/.test(typeLine)) return false;
    if (String(perm?.controller || '') !== ctrl) return false;
    const attachedTo = String(perm?.attachedTo || perm?.enchanting || '').trim();
    return attachedTo === id;
  });
}

/** Watcher types that fire from other permanents, not as self-attack abilities. */
const ATTACK_WATCHER_TRIGGER_TYPES = new Set([
  'creature_attacks',
  'typed_creature_attacks',
  'typed_subtype_attacks',
  'another_typed_creature_attacks',
  'another_creature_attacks',
  'opponent_creature_attacks',
  'any_creature_attacks',
  'any_creature_attacks_or_blocks',
  'creature_attacks_alone',
  'typed_attacks_alone',
  'modified_creature_attacks',
  'counter_creature_attacks',
  'low_power_creature_attacks',
  'equipped_creature_attacks',
  'nontoken_creature_attacks',
  'one_or_more_enchanted_by_aura_you_control_attack',
  'player_attacks_your_opponent',
  'enchanted_player_attacked',
  'curse_attack',
  'opponents_two_or_more_creatures_attack',
  'chosen_type_creature_etb_or_attack',
  'exalted',
  'you_attack_with_commander',
  'commander_attacks',
]);

function isAttackWatcherTriggerType(triggerType: string | undefined): boolean {
  return ATTACK_WATCHER_TRIGGER_TYPES.has(String(triggerType || ''));
}

function isTokenPermanent(permanent: any): boolean {
  if (permanent?.isToken === true || permanent?.token === true) return true;
  return /\btoken\b/i.test(String(permanent?.card?.type_line || ''));
}

function hasPlusOnePlusOneCounter(permanent: any): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object') return false;
  const n = Number((counters as any)['+1/+1'] ?? (counters as any).p1p1 ?? 0);
  return Number.isFinite(n) && n > 0;
}

function isCreatureEquipped(battlefield: readonly any[], creature: any): boolean {
  if (creature?.isEquipped === true) return true;
  if (Array.isArray(creature?.attachedEquipment) && creature.attachedEquipment.length > 0) return true;
  const id = String(creature?.id || '').trim();
  if (!id) return false;
  return (battlefield || []).some((perm: any) => {
    if (String(perm?.attachedTo || '').trim() !== id) return false;
    return /\bequipment\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
  });
}

function isAttackingCreatureModified(battlefield: readonly any[], creature: any): boolean {
  const counters = creature?.counters;
  if (counters && typeof counters === 'object') {
    for (const value of Object.values(counters)) {
      if (typeof value === 'number' && value > 0) return true;
    }
  }
  if (isCreatureEquipped(battlefield, creature)) return true;
  const id = String(creature?.id || '').trim();
  if (!id) return false;
  return (battlefield || []).some((perm: any) => {
    if (String(perm?.attachedTo || perm?.enchanting || '').trim() !== id) return false;
    return /\baura\b/i.test(String(perm?.card?.type_line || perm?.type_line || ''));
  });
}

const ATTACK_COLOR_NAMES = new Set(['white', 'blue', 'black', 'red', 'green']);
const ATTACK_COLOR_LETTER: Record<string, string> = {
  white: 'w',
  blue: 'u',
  black: 'b',
  red: 'r',
  green: 'g',
};

function attackerHasColor(attacker: any, colorName: string): boolean {
  const color = String(colorName || '').trim().toLowerCase();
  if (!ATTACK_COLOR_NAMES.has(color)) return false;
  const card = attacker?.card || attacker || {};
  const colors = Array.isArray(card.colors)
    ? card.colors.map((entry: any) => String(entry || '').toLowerCase())
    : [];
  const letter = ATTACK_COLOR_LETTER[color];
  if (colors.includes(color) || (letter && colors.includes(letter))) return true;
  const identity = Array.isArray(card.color_identity)
    ? card.color_identity.map((entry: any) => String(entry || '').toLowerCase())
    : [];
  if (letter && identity.includes(letter)) return true;
  const manaCost = String(card.mana_cost || attacker?.mana_cost || '');
  if (letter && manaCost.toLowerCase().includes(`{${letter}}`)) return true;
  return false;
}

function attackerMatchesSingleTypeToken(attacker: any, token: string): boolean {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return false;
  if (ATTACK_COLOR_NAMES.has(t)) return attackerHasColor(attacker, t);
  if (t === 'token') return isTokenPermanent(attacker);
  if (t === 'nontoken') return !isTokenPermanent(attacker);
  const typeLine = String(attacker?.card?.type_line || '').toLowerCase();
  if (['artifact', 'enchantment', 'legendary', 'vehicle', 'creature'].includes(t)) {
    return typeLine.includes(t);
  }
  return permanentHasCreatureType(attacker, t);
}

function attackerMatchesTypePhrase(attacker: any, phrase: string): boolean {
  const parts = String(phrase || '')
    .split(/\s+or\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.some((part) => attackerMatchesSingleTypeToken(attacker, part));
}

type AttackWatcherQueuePlan =
  | { kind: 'skip' }
  | { kind: 'once' }
  | { kind: 'per_attacker'; attackers: any[] }
  | { kind: 'per_attacked_player'; playerIds: string[] };

function planAttackWatcherQueue(
  trigger: CombatTriggeredAbility,
  sourcePermanent: any,
  attackingCreatures: any[],
  attackingPlayer: string,
  attackedPlayerIds: string[],
  battlefield: readonly any[],
  resolveAttackedPlayerId: (attacker: any) => string,
): AttackWatcherQueuePlan {
  const triggerType = String(trigger.triggerType || '');
  const sourceController = String(trigger.controllerId || sourcePermanent?.controller || '');
  const sourceId = String(sourcePermanent?.id || '');
  const youControl = (attacker: any) => String(attacker?.controller || '') === sourceController;
  const notSource = (attacker: any) => String(attacker?.id || '') !== sourceId;
  const typePhrase = String(trigger.requiredTypePhrase || (trigger as any).value?.requiredTypePhrase || '');

  switch (triggerType) {
    case 'creature_attacks':
      return { kind: 'per_attacker', attackers: attackingCreatures.filter(youControl) };
    case 'another_creature_attacks':
      return { kind: 'per_attacker', attackers: attackingCreatures.filter((attacker) => youControl(attacker) && notSource(attacker)) };
    case 'typed_creature_attacks':
    case 'typed_subtype_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)),
      };
    case 'another_typed_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && notSource(attacker) && attackerMatchesTypePhrase(attacker, typePhrase)
        )),
      };
    case 'opponent_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => String(attacker?.controller || '') !== sourceController),
      };
    case 'any_creature_attacks':
    case 'any_creature_attacks_or_blocks':
      return { kind: 'per_attacker', attackers: attackingCreatures };
    case 'nontoken_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && !isTokenPermanent(attacker)),
      };
    case 'equipped_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && isCreatureEquipped(battlefield, attacker)),
      };
    case 'modified_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => youControl(attacker) && isAttackingCreatureModified(battlefield, attacker)),
      };
    case 'counter_creature_attacks':
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!hasPlusOnePlusOneCounter(attacker)) return false;
          if ((trigger as any).controlledOnly && !youControl(attacker)) return false;
          return true;
        }),
      };
    case 'low_power_creature_attacks': {
      const maxPower = Number(trigger.maxPower ?? (trigger as any).value?.maxPower);
      if (!Number.isFinite(maxPower)) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => {
          if (!youControl(attacker)) return false;
          const { power } = getActualPowerToughness(attacker, { battlefield });
          return Number(power) <= maxPower;
        }),
      };
    }
    case 'chosen_type_creature_etb_or_attack': {
      const chosenType = String(
        sourcePermanent?.chosenCreatureType || sourcePermanent?.card?.chosenCreatureType || '',
      ).trim();
      if (!chosenType) return { kind: 'skip' };
      return {
        kind: 'per_attacker',
        attackers: attackingCreatures.filter((attacker) => (
          youControl(attacker) && permanentHasCreatureType(attacker, chosenType)
        )),
      };
    }
    case 'creature_attacks_alone':
      if (attackingCreatures.length !== 1 || !youControl(attackingCreatures[0])) return { kind: 'skip' };
      return { kind: 'once' };
    case 'typed_attacks_alone':
      if (attackingCreatures.length !== 1 || !youControl(attackingCreatures[0])) return { kind: 'skip' };
      if (!attackerMatchesTypePhrase(attackingCreatures[0], typePhrase)) return { kind: 'skip' };
      return { kind: 'once' };
    case 'exalted':
      if (attackingCreatures.length !== 1 || sourceController !== attackingPlayer) return { kind: 'skip' };
      return { kind: 'once' };
    case 'you_attack_with_commander':
    case 'commander_attacks': {
      if (sourceController !== attackingPlayer) return { kind: 'skip' };
      const commanderAttacking = attackingCreatures.some((attacker: any) => {
        if (String(attacker?.controller || '') !== sourceController) return false;
        return attacker?.isCommander === true || attacker?.commander === true || attacker?.card?.isCommander === true;
      });
      return commanderAttacking ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'one_or_more_enchanted_by_aura_you_control_attack': {
      const anyEnchanted = attackingCreatures.some((attacker: any) =>
        isEnchantedByAuraYouControl(battlefield, String(attacker?.id || ''), sourceController),
      );
      return anyEnchanted ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'player_attacks_your_opponent': {
      const playerIds = attackedPlayerIds.filter((id) => Boolean(id) && id !== sourceController);
      return playerIds.length > 0 ? { kind: 'per_attacked_player', playerIds } : { kind: 'skip' };
    }
    case 'enchanted_player_attacked':
    case 'curse_attack': {
      const enchantedPlayer = String(sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '').trim();
      if (!enchantedPlayer) return { kind: 'skip' };
      const attackingEnchanted = attackingCreatures.some((attacker) => resolveAttackedPlayerId(attacker) === enchantedPlayer);
      return attackingEnchanted ? { kind: 'once' } : { kind: 'skip' };
    }
    case 'opponents_two_or_more_creatures_attack': {
      const opponentAttackers = attackingCreatures.filter((attacker) => String(attacker?.controller || '') !== sourceController);
      return opponentAttackers.length >= 2 ? { kind: 'once' } : { kind: 'skip' };
    }
    default:
      return { kind: 'skip' };
  }
}

function mergeCombatTriggerValue(existing: unknown, extra: Record<string, unknown>): Record<string, unknown> {
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>), ...extra };
  }
  if (typeof existing === 'number') {
    return { amount: existing, ...extra };
  }
  return extra;
}

function extractCommanderOwnedGrantedAbilityTexts(oracleText: string): string[] {
  const granted = parseAttachmentGrantedAbilityTextsFromOracle(oracleText);
  if (!/commander\s+creatures?\s+you\s+own\s+have/i.test(String(oracleText || ''))) {
    return [];
  }
  return granted.filter((text) => /whenever\s+(?:this creature|~)\s+attacks/i.test(text));
}

export interface AttachmentAttackTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  attachedToId: string;
  triggerType?: 'attack' | 'combat_damage' | 'damage_to_player';
  effect: string;
  mandatory: boolean;
  searchesLibrary?: boolean;
  searchType?: string;
  createsToken?: boolean;
}

const ATTACK_KEYWORD_REMINDER_LINE_PATTERN = /^(?:annihilator\s+\d+|firebending\s+\d+|melee|myriad|exalted|battle cry|dethrone|mentor|training)\b/i;
const BLOCK_KEYWORD_REMINDER_LINE_PATTERN = /^(?:afflict\s+\d+|bushido\s+\d+|flanking|rampage\s+\d+)\b/i;

/** Names used in oracle text (~, comma-short, or "Svyelun of Sea and Sky" -> "Svyelun"). */
function getCardNameVariantsForOracleMatching(cardName: string, oracleText?: string): string[] {
  const variants = new Set<string>();
  const full = String(cardName || '').trim();
  if (!full) return [];

  variants.add(full);

  const commaShort = normalizeCardNameForOracleText(full);
  if (commaShort) variants.add(commaShort);

  const ofPrefixMatch = full.match(/^([^\s,]+)\s+of\s+/i);
  if (ofPrefixMatch?.[1]) variants.add(ofPrefixMatch[1]);

  if (oracleText) {
    for (const line of getOracleLines(oracleText)) {
      const refMatch = line.match(/^Whenever\s+([A-Za-z][^\s,]+)(?:\s+enters(?:\s+the\s+battlefield)?\s+or)?\s+attacks\b/i);
      if (refMatch?.[1] && full.toLowerCase().startsWith(refMatch[1].toLowerCase())) {
        variants.add(refMatch[1]);
      }
    }
  }

  return Array.from(variants);
}

function normalizeOracleTextForInlineMatching(oracleText: string): string {
  return getOracleLines(oracleText).join(' ').replace(/\s+/g, ' ').trim();
}

function buildExertSelfReferencePattern(card: any): string {
  const variants = ['this creature', 'it'];
  const fullName = String(card?.name || '').trim();
  const oracleShortName = normalizeCardNameForOracleText(fullName);

  if (oracleShortName) {
    variants.push(escapeCardNameForRegex(oracleShortName));
  }
  if (fullName && fullName.toLowerCase() !== oracleShortName.toLowerCase()) {
    variants.push(escapeCardNameForRegex(fullName));
  }

  return `(?:${Array.from(new Set(variants)).join('|')})`;
}

function isSupportedExertAttackRewardDescription(description: string): boolean {
  const normalized = String(description || '').trim();
  if (!normalized) return false;
  if (/additional combat phase|extra combat phase/i.test(normalized)) return true;
  if (/untap all other creatures you control/i.test(normalized)) return true;
  if (/draw a card/i.test(normalized)) return true;
  if (/(?:other )?creatures you control get [+-]\d+\/[+-]\d+(?: and gains? .+?)? until end of turn/i.test(normalized)) return true;
  if (/put (?:a|an)(?: [\w,\s]+)? creature card from your hand onto the battlefield/i.test(normalized)) return true;
  if (/return target creature card(?: with mana value \d+ or less)? from your graveyard to the battlefield/i.test(normalized)) return true;
  if (/target creature gets \+X\/\+X(?: and gains .+?)? until end of turn, where X is the number of counters on permanents you control/i.test(normalized)) return true;
  if (/exile the top \w+ cards? of your library\. until the end of your next turn, you may play those cards/i.test(normalized)) return true;
  if (/deals? \d+ damage to target/i.test(normalized)) return true;
  if (/prevent all combat damage that would be dealt to (?:it|this creature|he|she) this turn/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) can't be blocked by creatures with power 2 or less this turn/i.test(normalized)) return true;
  if (/create a tapped and attacking token that's a copy of target creature you control\. sacrifice the token at the beginning of the next end step/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) can't be blocked this turn(?: and you scry \d+)?/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) gets [+-]\d+\/[+-]\d+(?: and gains? .+?)? until end of turn/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) gains .+? until end of turn/i.test(normalized)) return true;
  if (/target creature can't block this turn/i.test(normalized)) return true;
  return false;
}

export function canExertAsItAttacks(card: any): boolean {
  const normalizedOracle = normalizeOracleTextForInlineMatching(String(card?.oracle_text || ''));
  if (!normalizedOracle) return false;

  const selfReferencePattern = buildExertSelfReferencePattern(card);

  return new RegExp(`(?:if [^.]+,\\s*)?you may exert ${selfReferencePattern} as (?:it|he|she) attacks\\.`, 'i').test(normalizedOracle);
}

export function getSupportedExertAttackReward(card: any): string | null {
  const normalizedOracle = normalizeOracleTextForInlineMatching(String(card?.oracle_text || ''));
  if (!normalizedOracle) return null;

  const selfReferencePattern = buildExertSelfReferencePattern(card);

  const exertRewardMatch = normalizedOracle.match(
    new RegExp(`(?:if [^.]+,\\s*)?you may exert ${selfReferencePattern} as (?:it|he|she) attacks\\. when you do, (.+?)(?:\\s*\\(an exerted creature won't untap during your next untap step\\.?\\))?$`, 'i'),
  );
  const rewardDescription = String(exertRewardMatch?.[1] || '')
    .replace(/\s*\(an exerted creature won't untap during your next untap step\.?\)\s*/ig, ' ')
    .replace(/\s*\{[WUBRGC\dP/\d]+\}(?:\{[WUBRGC\dP/\d]+\})*:\s*[\s\S]*$/i, '')
    .trim();
  if (!isSupportedExertAttackRewardDescription(rewardDescription)) {
    return null;
  }

  return rewardDescription;
}

function findGenericAttackTriggerLine(oracleText: string, cardName: string): RegExpMatchArray | null {
  const cardNameVariants = getCardNameVariantsForOracleMatching(cardName, oracleText)
    .map((value) => escapeCardNameForRegex(value));
  const attacksPattern = new RegExp(
    `whenever\\s+(?:~|this (?:creature(?:\\s+or\\s+equipped creature)?|vehicle|artifact|permanent)|${cardNameVariants.join('|')})\\s+(?:enters(?: the battlefield)?\\s+or\\s+)?attacks,?\\s*(.+)$`,
    'i'
  );

  return findRegexMatchAcrossOracleLines(
    oracleText,
    (line) => ATTACK_KEYWORD_REMINDER_LINE_PATTERN.test(line),
    (line) => line.match(attacksPattern),
  );
}

function findGenericAttacksOrBlocksLine(oracleText: string, cardName: string): RegExpMatchArray | null {
  const cardNameVariants = getCardNameVariantsForOracleMatching(cardName, oracleText)
    .map((value) => escapeCardNameForRegex(value));
  const attacksOrBlocksPattern = new RegExp(
    `whenever\\s+(?:~|this (?:creature|vehicle|artifact|permanent)|${cardNameVariants.join('|')})\\s+attacks or blocks,?\\s*(.+)$`,
    'i',
  );

  return findRegexMatchAcrossOracleLines(
    oracleText,
    (line) => ATTACK_KEYWORD_REMINDER_LINE_PATTERN.test(line),
    (line) => line.match(attacksOrBlocksPattern),
  );
}

function findGenericBlockTriggerLine(oracleText: string, cardName: string): RegExpMatchArray | null {
  const cardNameVariants = getCardNameVariantsForOracleMatching(cardName, oracleText)
    .map((value) => escapeCardNameForRegex(value));
  const blocksPattern = new RegExp(
    `whenever\\s+(?:~|this creature|${cardNameVariants.join('|')})\\s+blocks(?:\\s+a\\s+creature)?,?\\s*(.+)$`,
    'i'
  );

  return findRegexMatchAcrossOracleLines(
    oracleText,
    (line) => BLOCK_KEYWORD_REMINDER_LINE_PATTERN.test(line),
    (line) => line.match(blocksPattern),
  );
}

function countEnergySymbols(cost: string): number {
  return (String(cost || '').match(/\{e\}/gi) || []).length;
}

// Re-export types from types.ts for consumers
export type { BeginningOfCombatTrigger };
export type { EndOfCombatTrigger } from './end-combat.js';

// ============================================================================
// Combat Damage Triggers
// ============================================================================

/**
 * Detect combat damage triggers from a permanent's abilities.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_COMBAT_DAMAGE_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * Patterns detected:
 * - "Whenever ~ deals combat damage to a player, [effect]"
 * - "Whenever one or more creatures you control deal combat damage to a player, [effect]"
 * - "Whenever ~ deals damage to a player, [effect]" (includes non-combat)
 */
export function detectCombatDamageTriggers(card: any, permanent: any): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // Use shared utility function for regex escaping
  const cardNameEscaped = escapeCardNameForRegex(cardName);
  const legendaryShort = escapeCardNameForRegex(String(cardName.split(',')[0] || '').trim());
  const firstWord = escapeCardNameForRegex(String(cardName.trim().split(/\s+/)[0] || '').trim());
  const combatNameAlts = [...new Set([cardNameEscaped, legendaryShort, firstWord].filter(Boolean))].join('|');
  
  // "Whenever ~ deals combat damage to a player" detection
  const combatDamagePattern = new RegExp(`whenever\\s+(?:~|this creature|${combatNameAlts})\\s+(?:enters(?: the battlefield)?\\s+or\\s+)?deals\\s+combat\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i');
  const combatDamagePlayerMatch = oracleText.match(combatDamagePattern);
  if (combatDamagePlayerMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage',
      description: timingTriggerEffect(oracleText, combatDamagePlayerMatch),
      effect: timingTriggerEffect(oracleText, combatDamagePlayerMatch),
      mandatory: true,
    });
  }
  
  // "Whenever one or more creatures you control deal combat damage to a player" (batched trigger)
  const batchedCombatDamageMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (batchedCombatDamageMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_batched',
      description: timingTriggerEffect(oracleText, batchedCombatDamageMatch),
      effect: timingTriggerEffect(oracleText, batchedCombatDamageMatch),
      mandatory: true,
      batched: true,
    });
  }

  // "When/Whenever you're dealt combat damage"
  const youAreDealtCombatDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+combat\s+damage,?\s*([^.]+)/i);
  if (youAreDealtCombatDamageMatch && !triggers.some(t => t.triggerType === 'you_are_dealt_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_are_dealt_combat_damage',
      description: timingTriggerEffect(oracleText, youAreDealtCombatDamageMatch),
      effect: timingTriggerEffect(oracleText, youAreDealtCombatDamageMatch),
      mandatory: true,
    });
  }

  const youAreDealtDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+damage,?\s*([^.]+)/i);
  if (youAreDealtDamageMatch && !triggers.some(t => t.triggerType === 'you_are_dealt_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_are_dealt_damage',
      description: timingTriggerEffect(oracleText, youAreDealtDamageMatch),
      effect: timingTriggerEffect(oracleText, youAreDealtDamageMatch),
      mandatory: true,
    });
  }

  // "Whenever one or more creatures deal combat damage to you"
  const creaturesDealCombatDamageToYouMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+deal\s+combat\s+damage\s+to\s+you,?\s*([^.]+)/i);
  if (creaturesDealCombatDamageToYouMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_to_you_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_to_you_batched',
      description: timingTriggerEffect(oracleText, creaturesDealCombatDamageToYouMatch),
      effect: timingTriggerEffect(oracleText, creaturesDealCombatDamageToYouMatch),
      mandatory: true,
      batched: true,
    });
  }
  
  // "Whenever ~ deals damage to a player" (includes combat and non-combat)
  const damagePlayerPattern = new RegExp(`whenever\\s+(?:~|this creature|${cardNameEscaped})\\s+deals\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i');
  const damagePlayerMatch = oracleText.match(damagePlayerPattern);
  if (damagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: timingTriggerEffect(oracleText, damagePlayerMatch),
      effect: timingTriggerEffect(oracleText, damagePlayerMatch),
      mandatory: true,
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases and provide enhanced metadata
  // Only add if not already detected dynamically
  for (const [knownName, info] of Object.entries(KNOWN_COMBAT_DAMAGE_TRIGGERS)) {
    if (lowerName.includes(knownName) && !triggers.some(t => t.triggerType === 'deals_combat_damage')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'deals_combat_damage',
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get combat damage triggers for creatures that dealt damage
 */
export function getCombatDamageTriggersForCreature(
  ctx: GameContext,
  attackingPermanent: any,
  damageDealt: number,
  damagedPlayerId: string
): CombatTriggeredAbility[] {
  if (damageDealt <= 0) return [];
  
  return detectCombatDamageTriggers(attackingPermanent.card, attackingPermanent);
}

// ============================================================================
// Attack Triggers
// ============================================================================

/**
 * Detect attack triggers from a permanent's abilities.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_ATTACK_TRIGGERS table serves as an optimization
 * fallback for special handling and enhanced metadata (token creation, etc.).
 * 
 * Patterns detected:
 * - "Whenever ~ attacks, [effect]" (self attack trigger)
 * - "Whenever a creature you control attacks, [effect]"
 * - Keyword abilities: Annihilator N, Melee, Myriad, Exalted, Battle Cry, Firebending N
 * - Token creation patterns with count-based values
 * - Optional mana payment triggers
 */
export function detectAttackTriggers(card: any, permanent: any): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const supportedExertReward = getSupportedExertAttackReward(card);

  const optionalPaymentPattern = /you may pay ((?:\{[^}]+\})+)\.\s*(?:if|when) you do,?\s*(.+)/i;
  
  // Also check granted and temporary abilities on the permanent.
  // These are abilities granted by other cards (e.g., "gains firebending 4 until end of turn").
  const grantedAbilities = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  const temporaryAbilities = Array.isArray(permanent?.temporaryAbilities)
    ? permanent.temporaryAbilities
        .map((entry: any) => (typeof entry === 'string' ? entry : entry?.ability))
        .filter((ability: any) => typeof ability === 'string' && ability.trim().length > 0)
    : [];
  const supplementalAbilityText = [...grantedAbilities, ...temporaryAbilities].map((ability) => String(ability || '')).join('\n').toLowerCase();
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // Annihilator N (keyword ability)
  const annihilatorMatch = oracleText.match(/annihilator\s+(\d+)/i);
  if (annihilatorMatch) {
    const n = parseInt(annihilatorMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'annihilator',
      description: `Defending player sacrifices ${n} permanent${n > 1 ? 's' : ''}`,
      value: n,
      mandatory: true,
      requiresTarget: false,
    });
  }
  
  // Firebending N - Avatar set mechanic.
  // Check native text plus granted/temporary abilities, and allow multiple instances to stack.
  const firebendingMatches = [
    ...oracleText.matchAll(/firebending\s+(\d+)/gi),
    ...supplementalAbilityText.matchAll(/firebending\s+(\d+)/gi),
  ];
  for (const firebendingMatch of firebendingMatches) {
    const n = parseInt(String(firebendingMatch[1] || '0'), 10);
    if (!(n > 0)) continue;
    const effectText = `Add ${'{R}'.repeat(n)}. This mana lasts until end of combat.`;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'firebending',
      description: effectText,
      effect: effectText,
      value: { amount: n },
      mandatory: true,
      requiresTarget: false,
    });
  }
  
  // Melee keyword ability
  if (lowerOracle.includes("melee")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'melee',
      description: "+1/+1 for each opponent you attacked this combat",
      mandatory: true,
    });
  }
  
  // Myriad keyword ability
  if (lowerOracle.includes("myriad")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'myriad',
      description: "Create token copies attacking each other opponent",
      mandatory: true,
    });
  }
  
  // Exalted keyword ability
  if (lowerOracle.includes("exalted")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exalted',
      description: "+1/+1 to attacking creature (when attacking alone)",
      mandatory: true,
    });
  }

  // Dethrone keyword ability
  if (lowerOracle.includes("dethrone")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dethrone',
      description: 'Put a +1/+1 counter on this creature if attacking the player with the most life',
      mandatory: true,
    });
  }
  
  // Battle Cry keyword ability
  if (lowerOracle.includes("battle cry")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'battle_cry',
      description: "Each other attacking creature gets +1/+0 until end of turn",
      effect: 'battle_cry_buff',
      mandatory: true,
    });
  }

  // Mentor keyword ability
  if (lowerOracle.includes("mentor")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'mentor',
      description: 'Put a +1/+1 counter on target attacking creature with lesser power',
      mandatory: true,
    });
  }

  // Training keyword ability
  if (hasTrainingKeyword(card)) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'training',
      description: 'Put a +1/+1 counter on this creature if attacking with another creature with greater power',
      mandatory: true,
    });
  }

  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Prefer table metadata before generic line parsing so multi-line oracle cards
  // (e.g. Myrel static + attack trigger) never get a wrong generic match first.
  for (const [knownName, info] of Object.entries(KNOWN_ATTACK_TRIGGERS)) {
    if (lowerName.includes(knownName) && !triggers.some(t => t.triggerType === 'attacks')) {
      if (supportedExertReward && /^exert\b/i.test(String(info.effect || ''))) {
        continue;
      }

      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: info.effect,
        effect: info.effect,
        value: info.value || info.createTokensBasedOnCount || info.createTokens,
        mandatory: true,
      });
    }
  }
  
  const attacksOrBlocksMatch = findGenericAttacksOrBlocksLine(oracleText, cardName);
  if (attacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  // Generic "whenever ~ attacks" - match ~, this creature, Tanuki-style
  // "this creature or equipped creature", or the actual card name
  // Capture the full ability line (including periods) so patterns like
  // "you may pay {1}{G}. If you do, ..." can be recognized.
  const attacksMatch = findGenericAttackTriggerLine(oracleText, cardName);
  const genericAttackEffect = attacksMatch ? String(attacksMatch[1] || '').trim() : '';
  if (
    attacksMatch
    && !/^or blocks\b/i.test(genericAttackEffect)
    && !triggers.some((t) => t.triggerType === 'attacks' || t.triggerType === 'attacks_or_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, attacksMatch);
    
    // Check for optional mana or energy payment trigger
    const mayPayMatch = effectText.match(optionalPaymentPattern);
    
    if (mayPayMatch) {
      const paymentCost = String(mayPayMatch[1] || '').trim();
      const energyCost = countEnergySymbols(paymentCost);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: timingTriggerEffect(oracleText, mayPayMatch, 2),
        ...(energyCost > 0 ? { energyCost } : { manaCost: paymentCost }),
        mandatory: false,
      });
    } else {
      // Check for count-based token creation (Myrel, etc.)
      // Pattern: "create X [P/T] [type] tokens, where X is the number of [countType] you control"
      const countTokenMatch = effectText.match(/create\s+X\s+(\d+)\/(\d+)\s+([^,]+?)\s+(?:creature\s+)?tokens?,?\s+where\s+X\s+is\s+the\s+number\s+of\s+(\w+)(?:s)?\s+you\s+control/i);
      
      if (countTokenMatch) {
        const power = parseInt(countTokenMatch[1], 10);
        const toughness = parseInt(countTokenMatch[2], 10);
        const tokenDesc = countTokenMatch[3].trim();
        const countType = countTokenMatch[4].trim();
        
        // Parse token description for color and type
        const parts = tokenDesc.split(/\s+/);
        let color = 'colorless';
        let type = 'Token';
        let isArtifact = false;
        
        const colorMap: Record<string, string> = {
          'white': 'white', 'blue': 'blue', 'black': 'black', 'red': 'red', 'green': 'green', 'colorless': 'colorless'
        };
        
        for (const part of parts) {
          const lowerPart = part.toLowerCase();
          if (colorMap[lowerPart]) {
            color = lowerPart;
          } else if (lowerPart === 'artifact') {
            isArtifact = true;
          } else if (lowerPart !== 'creature' && lowerPart !== 'token' && lowerPart !== 'tokens') {
            type = part.charAt(0).toUpperCase() + part.slice(1);
          }
        }
        
        triggers.push({
          permanentId,
          cardName,
          triggerType: 'attacks',
          description: effectText,
          effect: effectText,
          mandatory: true,
          value: {
            countType: countType.toLowerCase(),
            power,
            toughness,
            type,
            color,
            isArtifact,
          },
        });
      } else {
        // Check for fixed-count token creation
        // Pattern: "create a X/Y [color] [type] creature token tapped and attacking"
        const fixedTokenMatch = effectText.match(/create\s+(?:a\s+)?(\d+)\/(\d+)\s+(\w+)\s+([\w\s]+?)\s+(?:creature\s+)?token/i);
        
        if (fixedTokenMatch) {
          const power = parseInt(fixedTokenMatch[1], 10);
          const toughness = parseInt(fixedTokenMatch[2], 10);
          const color = fixedTokenMatch[3].toLowerCase();
          const type = fixedTokenMatch[4].trim();
          
          triggers.push({
            permanentId,
            cardName,
            triggerType: 'attacks',
            description: effectText,
            effect: effectText,
            mandatory: true,
            value: {
              createTokens: {
                count: 1,
                power,
                toughness,
                type,
                color,
              }
            },
          });
        } else {
          // Regular attack trigger without special parsing
          triggers.push({
            permanentId,
            cardName,
            triggerType: 'attacks',
            description: effectText,
            effect: effectText,
            mandatory: true,
          });
        }
      }
    }
  }
  
  // W'Kabi / similar: "Whenever you attack with your commander, ..."
  const youAttackWithCommanderMatch = oracleText.match(
    /whenever you attack with your commander,?\s*([^.]+)/i,
  );
  if (youAttackWithCommanderMatch && !triggers.some((t) => t.triggerType === 'you_attack_with_commander')) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithCommanderMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'you_attack_with_commander',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  // "Whenever your commander attacks"
  const yourCommanderAttacksMatch = oracleText.match(
    /whenever your commander attacks,?\s*([^.]+)/i,
  );
  if (yourCommanderAttacksMatch && !triggers.some((t) => t.triggerType === 'commander_attacks' || t.triggerType === 'you_attack_with_commander')) {
    const effectText = timingTriggerEffect(oracleText, yourCommanderAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'commander_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  // "Whenever a creature you control attacks" (not alone / this turn / or blocks)
  const creatureAttacksMatch = oracleText.match(
    /whenever a creature you control attacks(?! alone)(?! this turn)(?! or blocks),?\s*([^.]+)/i,
  );
  if (creatureAttacksMatch && !triggers.some((t) => t.triggerType === 'creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const creatureAttacksAloneMatch = oracleText.match(
    /whenever a creature you control attacks alone,?\s*([^.]+)/i,
  );
  if (creatureAttacksAloneMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_alone')) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksAloneMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'creature_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const anotherCreatureAttacksMatch = oracleText.match(
    /whenever another creature you control attacks,?\s*([^.]+)/i,
  );
  if (anotherCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'another_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'another_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const anotherTypedCreatureAttacksMatch = oracleText.match(
    /whenever another ([\w]+(?: or [\w]+)*) you control attacks,?\s*([^.]+)/i,
  );
  if (anotherTypedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'another_typed_creature_attacks')) {
    const typedSubject = String(anotherTypedCreatureAttacksMatch[1] || '').trim();
    const typedSubjectLower = typedSubject.toLowerCase();
    if (!['creature', 'vehicle', 'permanent', 'modified'].includes(typedSubjectLower)) {
      const effectText = timingTriggerEffect(oracleText, anotherTypedCreatureAttacksMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId: String(permanent?.controller || ''),
        triggerType: 'another_typed_creature_attacks',
        description: effectText,
        effect: effectText,
        mandatory: !/\byou may\b/i.test(effectText),
        requiredTypePhrase: typedSubject,
      });
    }
  }

  const typedAttacksAloneMatch = oracleText.match(
    /whenever an? ([\w]+(?: or [\w]+)*) you control attacks alone,?\s*([^.]+)/i,
  );
  if (typedAttacksAloneMatch && !triggers.some((t) => t.triggerType === 'typed_attacks_alone')) {
    const typedSubject = String(typedAttacksAloneMatch[1] || '').trim();
    if (typedSubject.toLowerCase() !== 'creature') {
      const effectText = timingTriggerEffect(oracleText, typedAttacksAloneMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId: String(permanent?.controller || ''),
        triggerType: 'typed_attacks_alone',
        description: effectText,
        effect: effectText,
        mandatory: !/\byou may\b/i.test(effectText),
        requiredTypePhrase: typedSubject,
      });
    }
  }

  const typedSubtypeExcluded = new Set([
    'creature',
    'nontoken',
    'modified',
    'permanent',
    'vehicle',
    'land',
    'player',
    'spell',
    'token',
  ]);
  const typedSubtypeAttacksMatch = oracleText.match(
    /whenever an? ([\w]+(?: or [\w]+)*) you control attacks(?! alone)(?! this turn)(?! or blocks),?\s*([^.]+)/i,
  );
  if (
    typedSubtypeAttacksMatch
    && !typedSubtypeExcluded.has(String(typedSubtypeAttacksMatch[1] || '').trim().toLowerCase())
    && !/\bcreature\b/i.test(String(typedSubtypeAttacksMatch[1] || ''))
    && !triggers.some((t) => t.triggerType === 'typed_subtype_attacks' || t.triggerType === 'typed_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedSubtypeAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'typed_subtype_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      requiredTypePhrase: String(typedSubtypeAttacksMatch[1] || '').trim(),
    });
  }

  const typedCreatureAttacksMatch = oracleText.match(
    /whenever an? ((?:[\w]+\s+)+)creature you control attacks(?! alone)(?! this turn)(?! or blocks),?\s*([^.]+)/i,
  );
  if (typedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'typed_creature_attacks')) {
    const qualifier = String(typedCreatureAttacksMatch[1] || '').trim();
    const qualifierLower = qualifier.toLowerCase();
    if (!['modified', 'nontoken', 'equipped', 'another', 'enchanted'].includes(qualifierLower)) {
      const effectText = timingTriggerEffect(oracleText, typedCreatureAttacksMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId: String(permanent?.controller || ''),
        triggerType: 'typed_creature_attacks',
        description: effectText,
        effect: effectText,
        mandatory: !/\byou may\b/i.test(effectText),
        requiredTypePhrase: qualifier,
      });
    }
  }

  const modifiedCreatureAttacksMatch = oracleText.match(
    /whenever a modified creature you control attacks,?\s*([^.]+)/i,
  );
  if (modifiedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'modified_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, modifiedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'modified_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  // Soulblade Corrupter: "Whenever a creature with a +1/+1 counter on it attacks one of your opponents"
  // Also covers "a creature you control with a +1/+1 counter on it attacks"
  const counterCreatureAttacksMatch = oracleText.match(
    /whenever a creature(?: you control)? with a \+1\/\+1 counter on it attacks(?:\s+(?:one of your opponents|an opponent|a player))?,?\s*([^.]+)/i,
  );
  if (counterCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'counter_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureAttacksMatch);
    const matchText = String(counterCreatureAttacksMatch[0] || '');
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'counter_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      controlledOnly: /\ba creature you control\b/i.test(matchText),
      requiresOpponentDefender: /\battacks(?:\s+one of your opponents|\s+an opponent)/i.test(matchText),
    } as any);
  }

  const lowPowerCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with power (\d+) or less attacks,?\s*([^.]+)/i,
  );
  if (lowPowerCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'low_power_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, lowPowerCreatureAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'low_power_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      maxPower: parseInt(String(lowPowerCreatureAttacksMatch[1] || '0'), 10),
    });
  }

  const equippedCreatureAttacksMatch = oracleText.match(
    /whenever an equipped creature you control attacks,?\s*([^.]+)/i,
  );
  if (equippedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'equipped_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'equipped_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const nontokenCreatureAttacksMatch = oracleText.match(
    /whenever a nontoken creature you control attacks,?\s*([^.]+)/i,
  );
  if (nontokenCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'nontoken_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, nontokenCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'nontoken_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const opponentCreatureAttacksMatch = oracleText.match(
    /whenever a creature an opponent controls attacks,?\s*([^.]+)/i,
  );
  if (opponentCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'opponent_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'opponent_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const anyCreatureAttacksOrBlocksMatch = oracleText.match(
    /whenever a creature attacks or blocks,?\s*([^.]+)/i,
  );
  if (anyCreatureAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'any_creature_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'any_creature_attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const anyCreatureAttacksMatch = oracleText.match(
    /whenever a creature attacks(?! this turn)(?! or blocks),?\s*([^.]+)/i,
  );
  if (
    anyCreatureAttacksMatch
    && !triggers.some((t) => (
      t.triggerType === 'any_creature_attacks'
      || t.triggerType === 'creature_attacks'
      || t.triggerType === 'any_creature_attacks_or_blocks'
    ))
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'any_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const opponentsTwoOrMoreAttackMatch = oracleText.match(
    /whenever two or more creatures your opponents control attack,?\s*([^.]+)/i,
  );
  if (opponentsTwoOrMoreAttackMatch && !triggers.some((t) => t.triggerType === 'opponents_two_or_more_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, opponentsTwoOrMoreAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'opponents_two_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const enchantedPlayerAttackedMatch = oracleText.match(
    /whenever enchanted player is attacked,?\s*([^.]+)/i,
  );
  if (enchantedPlayerAttackedMatch && !triggers.some((t) => t.triggerType === 'enchanted_player_attacked')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerAttackedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'enchanted_player_attacked',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  const curseAttackMatch = oracleText.match(
    /whenever a player attacks enchanted player with one or more creatures,?\s*([^.]+)/i,
  );
  if (curseAttackMatch && !triggers.some((t) => t.triggerType === 'curse_attack')) {
    const effectText = timingTriggerEffect(oracleText, curseAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'curse_attack',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      batched: true,
    });
  }

  const chosenTypeAttackMatch = oracleText.match(
    /whenever a creature you control of the chosen type (?:enters or )?attacks,?\s*([^.]+)/i,
  );
  if (chosenTypeAttackMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'chosen_type_creature_etb_or_attack',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }

  // Killian / similar: "Whenever one or more creatures that are enchanted by an Aura you control attack"
  const enchantedByAuraAttackMatch = oracleText.match(
    /whenever one or more creatures that are enchanted by an aura you control attack,?\s*([^.]+)/i,
  );
  if (enchantedByAuraAttackMatch) {
    const effectText = timingTriggerEffect(oracleText, enchantedByAuraAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_enchanted_by_aura_you_control_attack',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      batched: true,
    });
  }
  
  // Join Forces attack trigger
  if (lowerOracle.includes('join forces') && 
      lowerOracle.includes('whenever') && 
      lowerOracle.includes('attacks')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'join_forces_attack',
      description: 'Join forces - each player may pay any amount of mana',
      effect: oracleText,
      mandatory: true,
      value: { isJoinForces: true },
    });
  }

  // Combat Calligrapher / Ellie, Brick Master:
  // "Whenever a player attacks one of your opponents, that attacking player creates..."
  const playerAttacksYourOpponentMatch = oracleText.match(
    /whenever a player attacks one of your opponents,?\s*([^.]+)/i,
  );
  if (
    playerAttacksYourOpponentMatch
    && !triggers.some((trigger) => trigger.triggerType === 'player_attacks_your_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksYourOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId: String(permanent?.controller || ''),
      triggerType: 'player_attacks_your_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
    });
  }
  
  return triggers;
}

/**
 * Process attack triggers when creatures attack
 */
export function getAttackTriggersForCreatures(
  ctx: GameContext,
  attackingCreatures: any[],
  attackingPlayer: string,
  defendingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const playerIds = Array.isArray((ctx as any).state?.players)
    ? (ctx as any).state.players.map((player: any) => String(player?.id || '')).filter(Boolean)
    : [];

  const resolveAttackedPlayerId = (attacker: any): string => {
    const attacking = typeof attacker?.attacking === 'string' ? String(attacker.attacking) : '';
    if (attacking && playerIds.includes(attacking)) return attacking;
    if (attacking) {
      const attackedPermanent = battlefield.find((perm: any) => String(perm?.id || '') === attacking);
      const controller = String(attackedPermanent?.controller || '');
      if (controller && playerIds.includes(controller)) return controller;
    }
    return String(defendingPlayer || '');
  };

  const attackedPlayerIds = Array.from(new Set(
    attackingCreatures.map((attacker) => resolveAttackedPlayerId(attacker)).filter(Boolean),
  ));
  if (attackedPlayerIds.length === 0 && defendingPlayer) {
    attackedPlayerIds.push(String(defendingPlayer));
  }

  // Stamp commander identity on attackers for watcher planning (W'Kabi, etc.).
  for (const attacker of attackingCreatures) {
    if (!attacker || attacker.isCommander === true) continue;
    const owner = String(attacker?.owner || attacker?.controller || attackingPlayer || '');
    const zone = (ctx.state as any)?.commandZone?.[owner];
    const commanderIds = Array.isArray(zone?.commanderIds) ? zone.commanderIds : [];
    const commanderNames = Array.isArray(zone?.commanderNames) ? zone.commanderNames.map((n: any) => String(n || '').toLowerCase()) : [];
    const cardId = String(attacker?.card?.id || attacker?.id || '');
    const cardName = String(attacker?.card?.name || '').toLowerCase();
    if ((cardId && commanderIds.includes(cardId)) || (cardName && commanderNames.includes(cardName))) {
      attacker.isCommander = true;
    }
  }

  // Self-attack abilities on the attacking creatures (keywords, "whenever this attacks", Join Forces).
  // Watcher types are queued once below so an attacking source is not double-counted.
  for (const attacker of attackingCreatures) {
    const attackerTriggers = detectAttackTriggers(attacker.card, attacker);
    const defendingPlayerId = resolveAttackedPlayerId(attacker);
    triggers.push(
      ...attackerTriggers
        .filter((trigger) => !isAttackWatcherTriggerType(trigger.triggerType))
        .map((trigger) => ({
          ...trigger,
          controllerId: String((trigger as any).controllerId || attacker?.controller || attackingPlayer || ''),
          value: mergeCombatTriggerValue((trigger as any).value, {
            defendingPlayerId,
            defendingPlayer: defendingPlayerId,
            attackingCreatureId: attacker.id,
          }),
        }))
    );
  }

  // Watchers on any battlefield permanent: typed/another/any/opponent/alone/modified/curse/exalted/...
  for (const permanent of battlefield) {
    if (!permanent) continue;
    const permTriggers = detectAttackTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      if (!isAttackWatcherTriggerType(trigger.triggerType)) continue;
      const sourceController = String((trigger as any).controllerId || permanent.controller || '');
      const plan = planAttackWatcherQueue(
        { ...trigger, controllerId: sourceController },
        permanent,
        attackingCreatures,
        attackingPlayer,
        attackedPlayerIds,
        battlefield,
        resolveAttackedPlayerId,
      );
      if (plan.kind === 'skip') continue;
      if (plan.kind === 'per_attacked_player') {
        for (const attackedId of plan.playerIds) {
          triggers.push({
            ...trigger,
            controllerId: sourceController,
            value: mergeCombatTriggerValue((trigger as any).value, {
              defendingPlayerId: attackedId,
              defendingPlayer: attackedId,
              attackingPlayerId: attackingPlayer,
            }),
          });
        }
        continue;
      }
      if (plan.kind === 'once') {
        triggers.push({
          ...trigger,
          controllerId: sourceController,
        });
        continue;
      }
      for (const attacker of plan.attackers) {
        const defendingPlayerId = resolveAttackedPlayerId(attacker);
        triggers.push({
          ...trigger,
          controllerId: sourceController,
          value: mergeCombatTriggerValue((trigger as any).value, {
            defendingPlayerId,
            defendingPlayer: defendingPlayerId,
            attackingCreatureId: attacker.id,
            attackingPlayerId: attackingPlayer,
          }),
        });
      }
    }
  }
  
  // Check for equipment/aura attack triggers on each attacking creature
  for (const attacker of attackingCreatures) {
    const attachmentTriggers = getAttachmentAttackTriggers(ctx, attacker, attackingPlayer);
    for (const attachTrigger of attachmentTriggers) {
      triggers.push({
        permanentId: attachTrigger.permanentId,
        cardName: attachTrigger.cardName,
        controllerId: String(attachTrigger.controllerId || ''),
        description: attachTrigger.effect,
        triggerType: 'equipment_attack',
        mandatory: attachTrigger.mandatory,
        value: {
          attachedToId: attachTrigger.attachedToId,
          searchesLibrary: attachTrigger.searchesLibrary,
          searchType: attachTrigger.searchType,
          createsToken: attachTrigger.createsToken,
        },
      });
    }
  }
  
  // Quoted "Commander creatures you own have 'Whenever this creature attacks…'" grants
  // (Backgrounds and any other permanent using that template).
  for (const attacker of attackingCreatures) {
    const attackerOwner = String(attacker?.owner || attackingPlayer);
    const ownerCommandZone = (ctx.state as any).commandZone?.[attackerOwner];
    const ownerCommanderIds = ownerCommandZone?.commanderIds || [];
    const ownerCommanderNames = ownerCommandZone?.commanderNames || [];
    const isOwnedByAttackingPlayer = attackerOwner === attackingPlayer;
    const isCommander =
      attacker?.isCommander === true ||
      ownerCommanderIds.includes(attacker.card?.id) ||
      (attacker.card?.name && ownerCommanderNames.includes(attacker.card.name));

    if (!isOwnedByAttackingPlayer || !isCommander) continue;

    for (const permanent of battlefield) {
      if (!permanent || String(permanent.controller || '') !== attackingPlayer) continue;
      const grantedAbilities = extractCommanderOwnedGrantedAbilityTexts(String(permanent.card?.oracle_text || ''));
      for (const grantedAbility of grantedAbilities) {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Commander',
          controllerId: String(attacker?.controller || attackingPlayer || ''),
          description: grantedAbility,
          triggerType: 'attacks',
          mandatory: !/\byou may\b/i.test(grantedAbility),
          value: {
            grantedBy: permanent.id,
            grantedByName: permanent.card?.name,
            defendingPlayer,
            defendingPlayerId: resolveAttackedPlayerId(attacker),
          },
        });
        debug(2, `[getAttackTriggersForCreatures] ${permanent.card?.name} granted attack trigger to commander ${attacker.card?.name} (defending ${defendingPlayer})`);
      }
    }
  }
  
  // ===== Apply trigger doublers (Roaming Throne, Isshin, etc.) =====
  // Check for trigger doublers controlled by the attacking player
  const doublers = detectTriggerDoublers(battlefield, attackingPlayer);
  
  if (doublers.length > 0) {
    debug(2, `[getAttackTriggersForCreatures] Found ${doublers.length} trigger doubler(s)`);
    
    // For each attacking creature, apply doublers to its triggers
    const doubledTriggers: CombatTriggeredAbility[] = [];
    
    for (const trigger of triggers) {
      // Find the source permanent for creature type checks
      const sourcePerm = battlefield.find((p: any) => p?.id === trigger.permanentId);
      
      // Apply doublers with attack trigger type
      const resultTriggers = applyTriggerDoublers(
        [trigger],
        doublers,
        'attack',
        sourcePerm,
        battlefield,
        { cause: 'attack' },
      );
      doubledTriggers.push(...resultTriggers);
    }
    
    return doubledTriggers;
  }
  
  return triggers;
}

/**
 * Detect attachment attack triggers
 */
export function detectAttachmentAttackTriggers(card: any, permanent: any): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const oracleText = card?.oracle_text || "";
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedToId = permanent?.attachedTo || "";
  
  if (!attachedToId) return triggers;

  const equipAttackMatch = oracleText.match(/whenever (?:this creature or )?equipped creature attacks,?\s*([^\n]+)/i);
  if (equipAttackMatch) {
    const effectText = timingTriggerEffect(oracleText, equipAttackMatch);
    const lowerEffect = effectText.toLowerCase();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'attack',
      effect: effectText,
      mandatory: !lowerEffect.includes('you may'),
      searchesLibrary: lowerEffect.includes('search') && lowerEffect.includes('library'),
      searchType: lowerEffect.includes('basic land') ? 'basic land' : lowerEffect.includes('land') ? 'land' : undefined,
      createsToken: /\bcreate\b.*\btoken\b/i.test(effectText),
    });
  }
  
  // Sword of X and Y style - "Whenever equipped creature deals combat damage to a player"
  if (lowerOracle.includes('whenever equipped creature deals combat damage to a player')) {
    const effectMatch = oracleText.match(/whenever equipped creature deals combat damage to a player,?\s*([^.]+)/i);
    if (effectMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        attachedToId,
        effect: timingTriggerEffect(oracleText, effectMatch),
        mandatory: true,
        searchesLibrary: lowerOracle.includes('search'),
        searchType: lowerOracle.includes('basic land') ? 'basic land' : undefined,
      });
    }
  }
  
  // "Whenever enchanted creature attacks"
    if (lowerOracle.includes('whenever enchanted creature attacks') || lowerOracle.includes('whenever this creature attacks')) {
      const effectMatch = oracleText.match(/whenever (?:enchanted creature|this creature) attacks,?\s*([^.]+)/i);
    if (effectMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        attachedToId,
        effect: timingTriggerEffect(oracleText, effectMatch),
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get attachment attack triggers for an attacking creature
 */
export function getAttachmentAttackTriggers(
  ctx: GameContext,
  attacker: any,
  attackingPlayer: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all attachments on this creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.attachedTo !== attacker.id) continue;
    
    const attachTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    triggers.push(...attachTriggers);
  }
  
  return triggers;
}

/**
 * Get attachment combat damage triggers
 */
export function getAttachmentCombatDamageTriggers(
  ctx: GameContext,
  attacker: any,
  attackingPlayer: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.attachedTo !== attacker.id) continue;
    
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const cardName = permanent.card?.name || "Unknown";
    
    // "Whenever equipped creature deals combat damage to a player"
    if (oracleText.includes('whenever equipped creature deals combat damage to a player')) {
      const effectMatch = oracleText.match(/whenever equipped creature deals combat damage to a player,?\s*([^.]+)/i);
      if (effectMatch) {
        triggers.push({
          permanentId: permanent.id,
          cardName,
          controllerId: permanent.controller,
          attachedToId: attacker.id,
          effect: timingTriggerEffect(oracleText, effectMatch),
          mandatory: true,
          searchesLibrary: oracleText.includes('search'),
        });
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Beginning of Combat Triggers
// ============================================================================

/**
 * Detect beginning of combat triggers.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_BEGINNING_COMBAT_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * Patterns detected:
 * - "At the beginning of combat on your turn, [effect]"
 * - "At the beginning of each combat, [effect]"
 */
export function detectBeginningOfCombatTriggers(card: any, permanent: any): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // "At the beginning of combat on your turn" pattern
  const beginCombatMatch = oracleText.match(/at the beginning of combat on your turn,?\s*([^.]+)/i);
  if (beginCombatMatch) {
    const effectText = timingTriggerEffect(oracleText, beginCombatMatch);
    const requiresChoice = /\bchoose\b/i.test(effectText) || /\byou may\b/i.test(effectText);
    const createsToken = /\bcreate\b.*\btoken\b/i.test(effectText);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
      requiresChoice,
      createsToken,
      triggerType: 'your_combat_step',
    });
  }
  
  const nextCombatPhaseMatch = oracleText.match(
    /at the beginning of the next combat(?: phase)?(?: this turn)?,?\s*([^.]+)/i,
  );
  if (nextCombatPhaseMatch && !triggers.some((t) => (t as any).triggerType === 'next_combat_phase')) {
    const effectText = timingTriggerEffect(oracleText, nextCombatPhaseMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'next_combat_phase' as any,
    } as BeginningOfCombatTrigger);
  }

  // "At the beginning of each combat" - triggers on all players' combats
  const eachCombatMatch = oracleText.match(/at the beginning of each combat,?\s*([^.]+)/i);
  if (eachCombatMatch && triggers.length === 0) {
    const effectText = timingTriggerEffect(oracleText, eachCombatMatch);
    const requiresChoice = /\bchoose\b/i.test(effectText) || /\byou may\b/i.test(effectText);
    const createsToken = /\bcreate\b.*\btoken\b/i.test(effectText);

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
      requiresChoice,
      createsToken,
      triggerType: 'each_player_turn_combat',
    });
  }

  const thatCombatMatch = oracleText.match(/at the beginning of that combat,?\s*([^.]+)/i);
  if (thatCombatMatch && !triggers.some((t) => (t as any).triggerType === 'that_combat')) {
    const effectText = timingTriggerEffect(oracleText, thatCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'that_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const opponentCombatMatch = oracleText.match(
    /at the beginning of combat on each opponent's turn,?\s*([^.]+)/i,
  );
  if (opponentCombatMatch && !triggers.some((t) => (t as any).triggerType === 'opponent_turn_combat')) {
    const effectText = timingTriggerEffect(oracleText, opponentCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'opponent_turn_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const enchantedOpponentCombatMatch = oracleText.match(
    /at the beginning of combat on enchanted opponent's turn,?\s*([^.]+)/i,
  );
  if (
    enchantedOpponentCombatMatch &&
    !triggers.some((t) => (t as any).triggerType === 'enchanted_opponent_turn_combat')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedOpponentCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_opponent_turn_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const eachPlayerCombatMatch = oracleText.match(
    /at the beginning of combat on each player's turn,?\s*([^.]+)/i,
  );
  if (eachPlayerCombatMatch && !triggers.some((t) => (t as any).triggerType === 'each_player_turn_combat')) {
    const effectText = timingTriggerEffect(oracleText, eachPlayerCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'each_player_turn_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const combatThisTurnMatch = oracleText.match(/at the beginning of combat this turn,?\s*([^.]+)/i);
  if (combatThisTurnMatch && !triggers.some((t) => (t as any).triggerType === 'combat_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, combatThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'combat_this_turn' as any,
    } as BeginningOfCombatTrigger);
  }

  const combatStepMatch = oracleText.match(/at the beginning of your combat step,?\s*([^.]+)/i);
  if (combatStepMatch && !triggers.some((t) => (t as any).triggerType === 'your_combat_step')) {
    const effectText = timingTriggerEffect(oracleText, combatStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'your_combat_step' as any,
    } as BeginningOfCombatTrigger);
  }

  // KNOWN table fallback only when oracle regex did not match (legacy shorthand / odd wording)
  if (triggers.length === 0) {
    for (const [knownName, info] of Object.entries(KNOWN_BEGINNING_COMBAT_TRIGGERS)) {
      if (lowerName.includes(knownName)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: info.effect,
          effect: info.effect,
          mandatory: true,
          requiresChoice: info.requiresChoice,
          createsToken: info.createsToken,
        });
      }
    }
  }

  return triggers;
}

/**
 * Get all beginning of combat triggers for the active player's combat step
 */
export function getBeginningOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const MAX_TRIGGERS_PER_STEP = 100;
  let triggerCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    if (triggerCount >= MAX_TRIGGERS_PER_STEP) {
      debugError(1, `[getBeginningOfCombatTriggers] SAFETY LIMIT: Stopped after ${MAX_TRIGGERS_PER_STEP} triggers`);
      break;
    }
    
    const permTriggers = detectBeginningOfCombatTriggers(permanent.card, permanent);
    const oracleText = String(permanent.card.oracle_text || '');
    
    for (const trigger of permTriggers) {
      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferCombatWhoseTurn(trigger, oracleText),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: ctx.state,
      })) {
        continue;
      }

      const raw = String(trigger.effect || trigger.description || '').trim();
      let interveningText = raw;
      if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
        interveningText = `At the beginning of combat, ${interveningText}`;
      }
      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText) || /\btheir\b/i.test(interveningText);
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        interveningText,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: activePlayerId,
              referencedPlayerId: activePlayerId,
              theirPlayerId: activePlayerId,
            }
          : undefined
      );
      if (ok !== false) {
        triggers.push(trigger);
        triggerCount++;
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// End of Combat Triggers (canonical implementation in end-combat.ts)
// ============================================================================

export {
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
} from './end-combat.js';

// ============================================================================
// Damage Received Triggers
// ============================================================================

/**
 * Information about a damage received trigger that needs to be queued for resolution
 */
export interface DamageReceivedTriggerInfo {
  triggerId: string;
  sourceId: string;
  sourceName: string;
  controller: string;
  damageAmount: number;
  targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'each_opponent' | 'controller' | 'opponent_or_planeswalker';
  targetRestriction?: string;
}

/**
 * Check if a permanent has a "whenever this creature is dealt damage" trigger
 * and return the trigger information if it does.
 * 
 * This supports cards like:
 * - Brash Taunter: "Whenever Brash Taunter is dealt damage, it deals that much damage to target opponent."
 * - Boros Reckoner: "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
 * - Stuffy Doll: "Whenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player."
 */
export function checkDamageReceivedTrigger(
  permanent: any,
  damageAmount: number
): DamageReceivedTriggerInfo | null {
  if (!permanent || damageAmount <= 0) return null;
  
  const card = permanent.card;
  if (!card) return null;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  const creatureName = card.name || "Unknown";
  const lowerName = creatureName.toLowerCase();
  
  // Check if this card has a damage received trigger
  // Pattern 1: "Whenever this creature is dealt damage"
  // Pattern 2: "Whenever [CardName] is dealt damage"
  const hasTrigger = 
    oracleText.includes("whenever this creature is dealt damage") ||
    oracleText.includes("whenever this creature is dealt combat damage") ||
    oracleText.includes(`whenever ${lowerName} is dealt damage`) ||
    oracleText.includes(`whenever ${lowerName} is dealt combat damage`);
  
  if (!hasTrigger) return null;
  
  // Determine target type from oracle text
  let targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'each_opponent' | 'controller' | 'opponent_or_planeswalker' = 'any';
  let targetRestriction = '';
  
  if (oracleText.includes("target opponent or planeswalker")) {
    targetType = 'opponent_or_planeswalker';
    targetRestriction = 'opponent or planeswalker';
  } else if (oracleText.includes("target opponent")) {
    targetType = 'opponent';
    targetRestriction = 'opponent';
  } else if (oracleText.includes("any target that isn't a dragon")) {
    targetType = 'any_non_dragon';
    targetRestriction = "that isn't a Dragon";
  } else if (oracleText.includes("the chosen player")) {
    targetType = 'chosen_player';
    targetRestriction = 'chosen player';
  } else if (oracleText.includes("each opponent")) {
    targetType = 'each_opponent';
    targetRestriction = 'each opponent';
  } else if (oracleText.includes("any target")) {
    targetType = 'any';
  }
  
  const triggerId = `damage_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  return {
    triggerId,
    sourceId: permanent.id,
    sourceName: creatureName,
    controller: permanent.controller,
    damageAmount,
    targetType,
    targetRestriction,
  };
}

// ============================================================================
// Block Triggers
// ============================================================================

/**
 * Block trigger interface for "whenever ~ blocks" abilities
 */
export interface BlockTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  blockedCreatureId?: string;
  createTokens?: {
    count: number;
    power: number;
    toughness: number;
    type: string;
    color: string;
    abilities?: string[];
  };
}

/**
 * Detect block triggers from a permanent's abilities
 * Patterns:
 * - "Whenever ~ blocks a creature, create a 1/1 white Cat Soldier creature token..."
 * - "Whenever ~ blocks, ..."
 */
export function detectBlockTriggers(card: any, permanent: any): BlockTrigger[] {
  const triggers: BlockTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Brimaz, King of Oreskos: "Whenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature."
  if (lowerName.includes("brimaz")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      effect: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      mandatory: true,
      createTokens: {
        count: 1,
        power: 1,
        toughness: 1,
        type: "Cat Soldier",
        color: "white",
        abilities: ["vigilance"],
      },
    });
  }
  
  // Generic "whenever ~ blocks" detection
  // Use consistent regex escaping approach
  const blocksMatch = findGenericBlockTriggerLine(oracleText, cardName);
  
  if (blocksMatch && !triggers.some(t => t.permanentId === permanentId)) {
    const effectText = timingTriggerEffect(oracleText, blocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get block triggers for creatures that are blocking
 * @param ctx - Game context
 * @param blockingCreatures - Array of creatures that are blocking
 * @param blockingPlayer - Player who is declaring blockers
 * @returns Array of triggered abilities
 */
export function getBlockTriggersForCreatures(
  ctx: GameContext,
  blockingCreatures: any[],
  blockingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check each blocking creature for block triggers
  for (const blocker of blockingCreatures) {
    const blockerTriggers = detectBlockTriggers(blocker.card, blocker);
    const keywordText = String(blocker?.card?.oracle_text || '') ||
      (Array.isArray(blocker?.card?.keywords) ? (blocker?.card?.keywords || []).join('\n') : '');
    const blockKeywordTriggers = detectKeywords(keywordText, blocker?.card?.name || 'Unknown').keywords
      .filter((keyword) => keyword.timing === 'blocks' && keyword.keyword === 'bushido');
    
    for (const trigger of blockerTriggers) {
      triggers.push({
        permanentId: trigger.permanentId,
        cardName: trigger.cardName,
        controllerId: trigger.controllerId,
        triggerType: 'blocks',
        description: trigger.description,
        effect: trigger.effect,
        mandatory: trigger.mandatory,
        value: {
          blockedCreatureId: blocker.blocking?.[0], // The attacker being blocked
          createTokens: trigger.createTokens,
        },
      });
    }

    for (const keyword of blockKeywordTriggers) {
      triggers.push({
        permanentId: blocker.id,
        cardName: blocker.card?.name || 'Unknown',
        controllerId: blocker.controller,
        triggerType: keyword.keyword,
        description: keyword.effect,
        effect: keyword.effect,
        mandatory: keyword.mandatory,
        value: {
          blockedCreatureId: blocker.blocking?.[0],
        },
      });
    }
  }
  
  return triggers;
}

function permanentHasKeyword(permanent: any, keywordName: string): boolean {
  const normalizedKeyword = String(keywordName || '').trim().toLowerCase();
  if (!normalizedKeyword) return false;

  const cardKeywords = Array.isArray(permanent?.card?.keywords)
    ? permanent.card.keywords
    : [];
  if (cardKeywords.some((entry: any) => String(entry || '').trim().toLowerCase() === normalizedKeyword)) {
    return true;
  }

  const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
  return oracleText.includes(normalizedKeyword);
}

/**
 * Get block triggers for attacking creatures that became blocked.
 * Covers keyword abilities like afflict, flanking, bushido, and rampage that trigger on the attacker.
 */
export function getBlockedTriggersForCreatures(
  ctx: GameContext,
  blockedCreatures: any[],
  defendingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const attacker of blockedCreatures) {
    if (!attacker) continue;

    const keywordText = String(attacker?.card?.oracle_text || '') ||
      (Array.isArray(attacker?.card?.keywords) ? (attacker?.card?.keywords || []).join('\n') : '');
    const blockKeywords = detectKeywords(keywordText, attacker?.card?.name || 'Unknown').keywords
      .filter((keyword) => keyword.timing === 'blocks');
    if (blockKeywords.length === 0) continue;

    const blockedByIds = Array.isArray(attacker?.blockedBy)
      ? attacker.blockedBy.map((value: any) => String(value || '').trim()).filter(Boolean)
      : (attacker?.blockedBy ? [String(attacker.blockedBy).trim()] : []);
    const blockingCreatures = blockedByIds
      .map((blockingCreatureId) => battlefield.find((perm: any) => perm && String(perm.id || '') === blockingCreatureId))
      .filter(Boolean);

    for (const keyword of blockKeywords) {
      if (keyword.keyword === 'afflict') {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Unknown',
          controllerId: attacker.controller,
          triggerType: 'afflict',
          description: keyword.effect,
          effect: keyword.effect,
          mandatory: keyword.mandatory,
          value: {
            blockingCreatureIds: blockedByIds,
            defendingPlayer,
          },
        });
      } else if (keyword.keyword === 'flanking') {
        for (const blockingCreature of blockingCreatures) {
          if (permanentHasKeyword(blockingCreature, 'flanking')) continue;
          triggers.push({
            permanentId: attacker.id,
            cardName: attacker.card?.name || 'Unknown',
            controllerId: attacker.controller,
            triggerType: 'flanking',
            description: keyword.effect,
            effect: keyword.effect,
            mandatory: keyword.mandatory,
            value: {
              blockingCreatureIds: [String(blockingCreature.id || '')],
              defendingPlayer,
            },
          });
        }
      } else if (keyword.keyword === 'bushido') {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Unknown',
          controllerId: attacker.controller,
          triggerType: 'bushido',
          description: keyword.effect,
          effect: keyword.effect,
          mandatory: keyword.mandatory,
          value: {
            blockingCreatureIds: blockedByIds,
            defendingPlayer,
          },
        });
      } else if (keyword.keyword === 'rampage') {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Unknown',
          controllerId: attacker.controller,
          triggerType: 'rampage',
          description: keyword.effect,
          effect: keyword.effect,
          mandatory: keyword.mandatory,
          value: {
            blockingCreatureIds: blockedByIds,
            defendingPlayer,
          },
        });
      }
    }
  }

  return triggers;
}


