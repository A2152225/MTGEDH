/**
 * Origin: server/src/state/modules/triggers/combat.ts
 * Cluster: trigger doublers (detect/apply/push + dungeon-room helper)
 * Public: detectTriggerDoublers, applyTriggerDoublers, pushTriggerDoublerCopies,
 *   playerHasDungeonRoomAbilityDoubler, TriggerDoublerEventContext
 */

import { permanentHasCreatureType } from "../../../../../shared/src/creatureTypes.js";
import {
  extractQuotedAbilityTexts,
  parseAttachmentGrantedAbilityTextsFromOracle,
} from "../../../../../shared/src/attachmentAbilityGrants.js";
import { debug } from "../../../utils/debug.js";
import { getCurrentPowerToughnessForRules } from "../currentPowerToughness.js";
import type { CombatTriggeredAbility } from "./combat-triggered-ability.js";

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
  /** Full game state, for current-P/T checks (anthems, pumps). Falls back to { battlefield }. */
  gameState?: any;
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
        // Current power (anthems, equipment, pumps, counters).
        const { power } = getCurrentPowerToughnessForRules(source, eventContext?.gameState ?? { battlefield: bf });
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
      gameState: state,
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
