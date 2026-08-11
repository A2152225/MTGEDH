/**
 * Trigger emission wiring audit.
 *
 * Complements `npm run trigger:coverage` (detection / IR effect gaps) by checking
 * whether known detector/emitter families are actually *called* from live game
 * paths — especially Oracle IR resolution paths.
 *
 * The Baral / Lullmage failure mode was: detector OK, emitter helper exists, but
 * IR counter resolution never called processSpellCounteredTriggers.
 *
 * Run:
 *   npm run trigger:emission
 *
 * Env:
 *   TRIGGER_EMISSION_ONLY_GAPS=1   (default: 1)
 *   TRIGGER_EMISSION_TOP=40
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(SERVER_ROOT, 'src');

const ONLY_GAPS = String(process.env.TRIGGER_EMISSION_ONLY_GAPS ?? '1').trim() !== '0';
const TOP = Math.max(1, Number(process.env.TRIGGER_EMISSION_TOP || 40) || 40);

export type PathBucket =
  | 'ir'
  | 'legacy_effect'
  | 'stack'
  | 'zones'
  | 'turn'
  | 'combat'
  | 'socket'
  | 'apply_event'
  | 'game_manager'
  | 'definition'
  | 'import_export'
  | 'other';

export type EmissionSeverity = 'ok' | 'warn' | 'gap';

export type EmissionStatus =
  | 'ok'
  | 'missing_ir_path'
  | 'no_live_emitter_calls'
  | 'detector_never_used'
  | 'no_emitter';

export interface TriggerEmissionFamily {
  readonly id: string;
  readonly label: string;
  readonly detectors: readonly string[];
  readonly emitters: readonly string[];
  /** When true, at least one live call must be classified as `ir` (or an IR proxy bucket). */
  readonly requiresIrPath: boolean;
  /**
   * Shared infrastructure buckets that IR already goes through (e.g. zones.drawCards →
   * processDrawTriggers). Presence here satisfies requiresIrPath even without a direct
   * oracleIr* call site.
   */
  readonly irProxyBuckets?: readonly PathBucket[];
  readonly exampleCards: readonly string[];
  readonly notes?: string;
}

export interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly bucket: PathBucket;
}

const FAMILIES: readonly TriggerEmissionFamily[] = [
  {
    id: 'spell_countered',
    label: 'Spell countered / you countered a spell (Baral, Lullmage Mentor)',
    detectors: ['detectSpellCounteredTriggers'],
    emitters: ['processSpellCounteredTriggers'],
    requiresIrPath: true,
    exampleCards: ['Baral, Chief of Compliance', 'Lullmage Mentor', "Multani's Presence"],
    notes: 'IR counter_spell must emit; legacy CounterSpell / counterStackItem too.',
  },
  {
    id: 'spell_cast',
    label: 'You cast a spell',
    detectors: ['detectSpellCastTriggers'],
    emitters: ['processSpellCastTriggersForCast'],
    requiresIrPath: false,
    exampleCards: ['Guttersnipe', 'Archmage Emeritus'],
    notes: 'Emitted at cast time (socket), not at IR resolve.',
  },
  {
    id: 'opponent_spell_cast',
    label: 'Opponent casts a spell',
    detectors: ['detectOpponentSpellCastTriggers'],
    emitters: ['processOpponentSpellCastTriggersForCast'],
    requiresIrPath: false,
    exampleCards: ['Thalia, Guardian of Thraben', 'Harsh Mentor'],
  },
  {
    id: 'targeted',
    label: 'Becomes the target of a spell/ability',
    detectors: ['detectTargetedTriggers'],
    emitters: ['processTargetedTriggersForSpellTargets', 'processHeroicTriggersForTargets'],
    requiresIrPath: false,
    exampleCards: ['Cowardice', 'Agrus Kos, Eternal Soldier'],
  },
  {
    id: 'draw',
    label: 'Draw card(s)',
    detectors: ['detectCardDrawTriggers'],
    emitters: ['processDrawTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones', 'game_manager'],
    exampleCards: ['Smothering Tithe', 'The Locust God'],
    notes: 'IR draws should go through zones.drawCards → processDrawTriggers.',
  },
  {
    id: 'mill',
    label: 'Mill cards',
    detectors: ['detectMillTriggers'],
    emitters: ['processMillTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Syr Konrad, the Grim', 'Consuming Aberration'],
  },
  {
    id: 'damage_received',
    label: 'Permanent is dealt damage',
    detectors: ['detectDealtDamageTriggers'],
    emitters: ['processDamageReceivedTriggers', 'dispatchDamageReceivedTrigger'],
    requiresIrPath: true,
    exampleCards: ['Brash Taunter', 'Boros Reckoner'],
    notes: 'IR post-apply diffs damage marks and calls processDamageReceivedTriggers.',
  },
  {
    id: 'token_created',
    label: 'You create a token',
    detectors: ['detectTokenCreatedTriggers'],
    emitters: ['queueTokenCreatedTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Purphoros, God of the Forge', 'Impact Tremors'],
  },
  {
    id: 'life_gain',
    label: 'You gain life',
    detectors: ['detectGainedLifeTriggersFromOracle', 'detectLifegainTriggers'],
    emitters: ['queueLifegainTriggers'],
    requiresIrPath: true,
    exampleCards: ['Archangel of Thune', "Trostani, Selesnya's Voice"],
    notes: 'IR post-apply diffs life totals and calls queueLifegainTriggers.',
  },
  {
    id: 'life_loss',
    label: 'Player loses life',
    detectors: ['detectLifeLossTriggers'],
    emitters: ['queueLifeLossTriggers'],
    requiresIrPath: true,
    exampleCards: ['Blood Artist', 'Vito, Thorn of the Dusk Rose'],
    notes: 'IR post-apply diffs life totals and calls queueLifeLossTriggers.',
  },
  {
    id: 'pay_life',
    label: 'You pay life',
    detectors: ['detectPayLifeTriggers'],
    emitters: ['queuePayLifeTriggers', 'queueLifePaymentTriggers'],
    requiresIrPath: true,
    exampleCards: ["K'rrik, Son of Yawgmoth", 'Gray Merchant of Asphodel'],
    notes: 'IR optional life payment prompt emits queuePayLifeTriggers.',
  },
  {
    id: 'sacrifice',
    label: 'You sacrifice a permanent',
    detectors: ['detectSacrificeTriggers'],
    emitters: ['queueSacrificeTriggers'],
    requiresIrPath: true,
    exampleCards: ['Mayhem Devil', 'Judith, the Scourge Diva'],
    notes: 'IR post-apply emits for applied sacrifice steps; sacrificePermanent also queues.',
  },
  {
    id: 'counter_placed',
    label: 'Counter placed on a permanent',
    detectors: ['detectCounterPlacedTriggers'],
    emitters: ['queueCounterPlacedTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['The Ozolith', 'Hardened Scales'],
    notes: 'Satisfied if counters go through counters_tokens helpers used by IR.',
  },
  {
    id: 'counter_removed',
    label: 'Counter removed from a permanent',
    detectors: ['detectCounterRemovedTriggers'],
    emitters: ['queueCounterRemovedTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones', 'turn'],
    exampleCards: ['Vorinclex, Monstrous Raider'],
  },
  {
    id: 'exile_from_battlefield',
    label: 'Permanent exiled from battlefield',
    detectors: ['detectExiledFromBattlefieldTriggers'],
    emitters: ['queueExiledFromBattlefieldTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Reya Dawnbringer'],
  },
  {
    id: 'put_into_graveyard',
    label: 'Card put into a graveyard',
    detectors: ['detectPutIntoGraveyardTriggers'],
    emitters: ['queuePutIntoGraveyardTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Syr Konrad, the Grim'],
  },
  {
    id: 'left_graveyard',
    label: 'Card leaves a graveyard',
    detectors: ['detectLeftGraveyardTriggers'],
    emitters: ['queueLeftGraveyardTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Croaking Counterpart'],
  },
  {
    id: 'library_search',
    label: 'Player searches their library',
    detectors: ['detectLibrarySearchTriggers'],
    emitters: ['queueLibrarySearchTriggers'],
    requiresIrPath: true,
    exampleCards: ['Land Tax'],
    notes: 'IR post-apply emits when search_library steps apply.',
  },
  {
    id: 'library_shuffle',
    label: 'Player shuffles their library',
    detectors: ['detectLibraryShuffleTriggers'],
    emitters: ['queueLibraryShuffleTriggers'],
    requiresIrPath: true,
    exampleCards: ['Mirror of Fate'],
    notes: 'IR post-apply emits when shuffle_library steps apply.',
  },
  {
    id: 'becomes_tapped',
    label: 'Permanent becomes tapped',
    detectors: ['detectTapTriggers'],
    emitters: ['queueTapTriggersForTappedPermanents', 'queueTapTriggersForTappedPermanentsOnContext'],
    requiresIrPath: true,
    exampleCards: ['Opposition', 'Intruder Alarm'],
    notes: 'IR uses queueTapTriggersForTappedPermanentsOnContext after tap diffs.',
  },
  {
    id: 'becomes_untapped',
    label: 'Permanent becomes untapped',
    detectors: ['detectUntapTriggers'],
    emitters: ['queueBecomesUntappedTriggers'],
    requiresIrPath: true,
    exampleCards: ['Seedborn Muse'],
    notes: 'IR post-apply diffs tapped flags and calls queueBecomesUntappedTriggers.',
  },
  {
    id: 'etb',
    label: 'Permanent enters the battlefield',
    detectors: ['detectETBTriggers'],
    emitters: ['queueSelfETBTriggersForPermanent', 'queuePermanentEntersBattlefieldTriggerStackItems'],
    requiresIrPath: true,
    exampleCards: ['Elvish Visionary', 'Solemn Simulacrum'],
  },
  {
    id: 'discard',
    label: 'Player discards a card',
    detectors: ['detectDiscardTriggers'],
    emitters: ['queueDiscardTriggeredAbilities', 'getDiscardTriggers'],
    requiresIrPath: true,
    exampleCards: ['Waste Not', 'Bone Miser'],
    notes: 'Shared queueDiscardTriggeredAbilities in triggers/discard.ts; IR post-apply + socket resolution.',
  },
  {
    id: 'mutate',
    label: 'Creature mutates',
    detectors: ['detectMutateTriggers'],
    emitters: ['queueMutateTriggeredAbilities'],
    requiresIrPath: false,
    exampleCards: ['Auspicious Starrix', 'Migratory Greathorn'],
    notes: 'Cast-time keyword path (stack merge), not IR spell resolution.',
  },
  {
    id: 'landfall',
    label: 'Landfall / land enters',
    detectors: ['detectLandfallTriggers'],
    emitters: ['getLandfallTriggers', 'detectLandfallTriggers'],
    requiresIrPath: false,
    exampleCards: ['Scute Swarm', 'Omnath, Locus of Creation'],
    notes: 'Often emitted inline where lands enter; detector call sites count as emission.',
  },
  {
    id: 'attack',
    label: 'Creature attacks',
    detectors: ['detectAttackTriggers'],
    emitters: ['detectAttackTriggers', 'getAttackTriggersForCreatures'],
    requiresIrPath: false,
    exampleCards: ['Karfell Kennel-Master'],
  },
  {
    id: 'block',
    label: 'Creature blocks / becomes blocked',
    detectors: ['detectBlockTriggers'],
    emitters: ['detectBlockTriggers', 'getBlockTriggers'],
    requiresIrPath: false,
    exampleCards: ['Trapjaw Tyrant'],
  },
  {
    id: 'combat_damage',
    label: 'Combat damage dealt',
    detectors: ['detectCombatDamageTriggers'],
    emitters: ['detectCombatDamageTriggers', 'getCombatDamageTriggersForCreature'],
    requiresIrPath: false,
    exampleCards: ['Toski, Bearer of Secrets'],
  },
  {
    id: 'death',
    label: 'Creature dies / permanent dies',
    detectors: ['detectDeathTriggers'],
    emitters: ['detectDeathTriggers', 'getDeathTriggers', 'getDeathTriggersForCreature'],
    requiresIrPath: false,
    exampleCards: ['Zulaport Cutthroat'],
  },
  {
    id: 'ltb',
    label: 'Permanent leaves the battlefield',
    detectors: ['detectLTBTriggers'],
    emitters: ['processLTBTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Leaves the battlefield payoffs'],
    notes: 'Emitted from movePermanentToGraveyard / Hand / Library zone helpers (IR uses those or diffs).',
  },
  {
    id: 'upkeep',
    label: 'Beginning of upkeep',
    detectors: ['detectUpkeepTriggers'],
    emitters: ['detectUpkeepTriggers'],
    requiresIrPath: false,
    exampleCards: ['Court of Cunning'],
  },
  {
    id: 'end_step',
    label: 'Beginning of end step',
    detectors: ['detectEndStepTriggers'],
    emitters: ['detectEndStepTriggers'],
    requiresIrPath: false,
    exampleCards: ['Sower of Discord'],
  },
  {
    id: 'beginning_of_combat',
    label: 'Beginning of combat',
    detectors: ['detectBeginningOfCombatTriggers'],
    emitters: ['detectBeginningOfCombatTriggers', 'getBeginningOfCombatTriggers'],
    requiresIrPath: false,
    exampleCards: ['Combat Celebrant'],
  },
  {
    id: 'end_of_combat',
    label: 'End of combat',
    detectors: ['detectEndOfCombatTriggers'],
    emitters: ['detectEndOfCombatTriggers', 'getEndOfCombatTriggers'],
    requiresIrPath: false,
    exampleCards: ['End of combat payoffs'],
  },
  {
    id: 'room_unlock',
    label: 'Room door unlocked / enters',
    detectors: ['detectRoomUnlockDoorTriggers', 'detectRoomTriggers'],
    emitters: [
      'handleRoomDoorStateOnEnter',
      'unlockRoomDoorPermanent',
      'queueRoomUnlockDoorTriggersOnEnter',
    ],
    requiresIrPath: false,
    exampleCards: ['Room cards'],
    notes: 'Live path is handleRoomDoorStateOnEnter / unlockRoomDoorPermanent on Room ETB (not an IR spell step).',
  },
  {
    id: 'equipped',
    label: 'Equipment becomes attached',
    detectors: ['detectEquippedTriggers'],
    emitters: ['processEquippedTriggers'],
    requiresIrPath: false,
    exampleCards: ['Sword of Feast and Famine', 'Shadowspear'],
    notes: 'Emitted from attachEquipmentToCreature and applyEvent(equipPermanent).',
  },
  {
    id: 'returned_to_hand',
    label: 'Permanent returned to hand',
    detectors: ['detectReturnedToHandTriggers'],
    emitters: ['processReturnedToHandTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['zones'],
    exampleCards: ['Rescue', 'Capsize payoffs'],
    notes: 'Emitted from movePermanentToHand (zones helper used by IR bounce).',
  },
  {
    id: 'transform_trigger',
    label: 'Permanent transforms / flip triggers',
    detectors: ['detectTransformTriggers'],
    emitters: ['processTransformTriggers'],
    requiresIrPath: true,
    irProxyBuckets: ['other', 'apply_event', 'socket'],
    exampleCards: ['Westvale Abbey', 'Aclazotz, Deepest Betrayal'],
    notes: 'Emitted from transformPermanentToFace (shared helper used by IR bridge + applyEvent).',
  },
  {
    id: 'monstrous',
    label: 'Creature becomes monstrous',
    detectors: ['detectMonstrousTriggers'],
    emitters: ['processMonstrousTriggers'],
    requiresIrPath: true,
    exampleCards: ['Polukranos, World Eater'],
    notes: 'Emitted from resolveMonstrosityAbility and IR post-apply monstrosity diffs.',
  },
  {
    id: 'ability_activated',
    label: 'You activate an ability',
    detectors: ['detectAbilityActivatedTriggers'],
    emitters: ['triggerAbilityActivatedTriggers', 'processDetectedAbilityActivatedTriggers'],
    requiresIrPath: false,
    exampleCards: ['Pili-Pala', 'Training Grounds payoffs'],
    notes: 'Whitelist emitter + generic detectAbilityActivatedTriggers path.',
  },
];

export function classifyPathBucket(relPath: string): PathBucket {
  const normalized = relPath.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.includes('oracleir')
    || normalized.includes('triggeroracleir')
    || normalized.includes('/oracle-ir')
  ) {
    return 'ir';
  }
  if (normalized.includes('executespelleffect') || normalized.includes('stackresolve')) {
    return 'legacy_effect';
  }
  if (normalized.includes('stack-mechanics')) return 'stack';
  if (
    normalized.includes('/zones.ts')
    || normalized.includes('counters_tokens')
    || normalized.includes('turn-tracking')
  ) {
    return 'zones';
  }
  if (
    normalized.includes('/turn.ts')
    || normalized.includes('upkeep-triggers')
    || normalized.includes('phase')
    || normalized.includes('turn-phases')
  ) {
    return 'turn';
  }
  if (normalized.includes('/combat') || normalized.includes('triggers/combat')) return 'combat';
  if (normalized.includes('/socket/')) return 'socket';
  if (normalized.includes('applyevent')) return 'apply_event';
  if (normalized.includes('gamemanager')) return 'game_manager';
  return 'other';
}

function isImportOrExportLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(import|export)\b/.test(trimmed);
}

function isDefinitionLine(line: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const def = new RegExp(
    `^(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b|^(?:export\\s+)?const\\s+${escaped}\\s*=`,
  );
  return def.test(line.trim());
}

export function isLiveCallSite(line: string, symbol: string): boolean {
  if (isImportOrExportLine(line)) return false;
  if (isDefinitionLine(line, symbol)) return false;
  // Re-export barrels / type-only mentions
  if (/\btype\b/.test(line) && line.includes(symbol)) return false;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Require an actual call or assignment usage, not a bare identifier in a comment.
  if (line.trim().startsWith('//') || line.trim().startsWith('*')) return false;
  return new RegExp(`\\b${escaped}\\s*\\(`).test(line);
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
      walkTsFiles(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function findSymbolCallSites(symbol: string, files: readonly string[]): CallSite[] {
  const sites: CallSite[] = [];
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mention = new RegExp(`\\b${escaped}\\b`);

  for (const file of files) {
    const rel = path.relative(SERVER_ROOT, file);
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i] ?? '';
      if (!mention.test(text)) continue;

      if (isDefinitionLine(text, symbol)) {
        sites.push({
          file: rel,
          line: i + 1,
          text: text.trim(),
          bucket: 'definition',
        });
        continue;
      }
      if (isImportOrExportLine(text)) {
        sites.push({
          file: rel,
          line: i + 1,
          text: text.trim(),
          bucket: 'import_export',
        });
        continue;
      }
      if (!isLiveCallSite(text, symbol)) continue;

      sites.push({
        file: rel,
        line: i + 1,
        text: text.trim().slice(0, 200),
        bucket: classifyPathBucket(rel),
      });
    }
  }
  return sites;
}

function uniqueBuckets(sites: readonly CallSite[]): PathBucket[] {
  return [...new Set(sites.map((site) => site.bucket))].sort();
}

function liveSites(sites: readonly CallSite[]): CallSite[] {
  return sites.filter((site) => site.bucket !== 'definition' && site.bucket !== 'import_export');
}

export function evaluateFamily(
  family: TriggerEmissionFamily,
  detectorSitesBySymbol: ReadonlyMap<string, CallSite[]>,
  emitterSitesBySymbol: ReadonlyMap<string, CallSite[]>,
): {
  status: EmissionStatus;
  severity: EmissionSeverity;
  liveEmitterBuckets: PathBucket[];
  liveDetectorBuckets: PathBucket[];
  liveEmitterSites: CallSite[];
  liveDetectorSites: CallSite[];
  reasons: string[];
} {
  const liveEmitterSites = family.emitters.flatMap((symbol) => liveSites(emitterSitesBySymbol.get(symbol) || []));
  const liveDetectorSites = family.detectors.flatMap((symbol) => liveSites(detectorSitesBySymbol.get(symbol) || []));
  const liveEmitterBuckets = uniqueBuckets(liveEmitterSites);
  const liveDetectorBuckets = uniqueBuckets(liveDetectorSites);
  const reasons: string[] = [];

  if (family.emitters.length === 0) {
    reasons.push('No dedicated emitter registered for this detector family');
    return {
      status: 'no_emitter',
      severity: 'gap',
      liveEmitterBuckets,
      liveDetectorBuckets,
      liveEmitterSites,
      liveDetectorSites,
      reasons,
    };
  }

  if (liveEmitterSites.length === 0) {
    reasons.push('Emitter(s) never called outside definition/import');
    return {
      status: 'no_live_emitter_calls',
      severity: 'gap',
      liveEmitterBuckets,
      liveDetectorBuckets,
      liveEmitterSites,
      liveDetectorSites,
      reasons,
    };
  }

  if (family.requiresIrPath) {
    const proxyBuckets = new Set<PathBucket>(family.irProxyBuckets || []);
    const hasDirectIr = liveEmitterBuckets.includes('ir');
    const hasProxyIr = liveEmitterBuckets.some((bucket) => proxyBuckets.has(bucket));
    if (!hasDirectIr && !hasProxyIr) {
      reasons.push('Emitter has live calls but none on Oracle IR paths (oracleIr*) or configured IR proxy buckets');
      const detectorUnused = family.detectors.length > 0 && liveDetectorSites.length === 0;
      if (detectorUnused) {
        reasons.push('Registered detector(s) also appear unused outside definition/import');
      }
      return {
        status: 'missing_ir_path',
        severity: 'gap',
        liveEmitterBuckets,
        liveDetectorBuckets,
        liveEmitterSites,
        liveDetectorSites,
        reasons,
      };
    }
  }

  if (family.detectors.length > 0 && liveDetectorSites.length === 0) {
    reasons.push('Detector(s) unused (emission may use alternate parser/inline path)');
    return {
      status: 'detector_never_used',
      severity: 'warn',
      liveEmitterBuckets,
      liveDetectorBuckets,
      liveEmitterSites,
      liveDetectorSites,
      reasons,
    };
  }

  return {
    status: 'ok',
    severity: 'ok',
    liveEmitterBuckets,
    liveDetectorBuckets,
    liveEmitterSites,
    liveDetectorSites,
    reasons,
  };
}

function summarizeSites(sites: readonly CallSite[], limit = 8) {
  return sites.slice(0, limit).map((site) => ({
    file: site.file,
    line: site.line,
    bucket: site.bucket,
    text: site.text,
  }));
}

function main(): void {
  const files = walkTsFiles(SRC_ROOT);
  const allSymbols = new Set<string>();
  for (const family of FAMILIES) {
    for (const symbol of family.detectors) allSymbols.add(symbol);
    for (const symbol of family.emitters) allSymbols.add(symbol);
  }

  const sitesBySymbol = new Map<string, CallSite[]>();
  for (const symbol of allSymbols) {
    sitesBySymbol.set(symbol, findSymbolCallSites(symbol, files));
  }

  const results = FAMILIES.map((family) => {
    const evaluation = evaluateFamily(family, sitesBySymbol, sitesBySymbol);
    return {
      id: family.id,
      label: family.label,
      status: evaluation.status,
      severity: evaluation.severity,
      requiresIrPath: family.requiresIrPath,
      irProxyBuckets: family.irProxyBuckets || [],
      detectors: family.detectors,
      emitters: family.emitters,
      exampleCards: family.exampleCards,
      notes: family.notes || null,
      reasons: evaluation.reasons,
      liveEmitterBuckets: evaluation.liveEmitterBuckets,
      liveDetectorBuckets: evaluation.liveDetectorBuckets,
      liveEmitterCallCount: evaluation.liveEmitterSites.length,
      liveDetectorCallCount: evaluation.liveDetectorSites.length,
      sampleEmitterCalls: summarizeSites(evaluation.liveEmitterSites),
      sampleDetectorCalls: summarizeSites(evaluation.liveDetectorSites),
    };
  });

  const gaps = results.filter((row) => row.severity === 'gap');
  const warns = results.filter((row) => row.severity === 'warn');
  const oks = results.filter((row) => row.severity === 'ok');

  const ranked = [...results].sort((a, b) => {
    const rank = (severity: EmissionSeverity) => (severity === 'gap' ? 0 : severity === 'warn' ? 1 : 2);
    const statusRank = (status: EmissionStatus) => {
      switch (status) {
        case 'no_emitter': return 0;
        case 'no_live_emitter_calls': return 1;
        case 'missing_ir_path': return 2;
        case 'detector_never_used': return 3;
        default: return 4;
      }
    };
    return rank(a.severity) - rank(b.severity)
      || statusRank(a.status) - statusRank(b.status)
      || a.id.localeCompare(b.id);
  });

  const reportRows = (ONLY_GAPS ? ranked.filter((row) => row.severity !== 'ok') : ranked).slice(0, TOP);

  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'trigger-emission-audit.json');
  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      srcRoot: SRC_ROOT,
      filesScanned: files.length,
      familyCount: FAMILIES.length,
      onlyGaps: ONLY_GAPS,
      top: TOP,
      note: 'Static call-site audit. Complements trigger:coverage (detection). missing_ir_path is the Baral/Lullmage class of bug.',
    },
    stats: {
      ok: oks.length,
      warn: warns.length,
      gap: gaps.length,
      byStatus: ranked.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
      }, {}),
    },
    families: ranked,
  };
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Trigger emission audit — scanned ${files.length} files, ${FAMILIES.length} families`);
  console.log(`  ok=${oks.length}  warn=${warns.length}  gap=${gaps.length}`);
  console.log('');
  console.log('Top emission gaps / warnings:');
  for (const row of reportRows) {
    const mark = row.severity === 'gap' ? 'GAP' : row.severity === 'warn' ? 'WARN' : 'OK';
    console.log(`  [${mark}] ${row.status}  ${row.id}`);
    console.log(`    ${row.label}`);
    if (row.reasons.length) console.log(`    why: ${row.reasons.join('; ')}`);
    if (row.liveEmitterBuckets.length) {
      console.log(`    emitter buckets: ${row.liveEmitterBuckets.join(', ')} (${row.liveEmitterCallCount} calls)`);
    } else if (row.emitters.length) {
      console.log(`    emitters: ${row.emitters.join(', ')} (no live calls)`);
    } else {
      console.log(`    emitters: (none registered)`);
    }
    if (row.exampleCards.length) {
      console.log(`    e.g. ${row.exampleCards.slice(0, 3).join(', ')}`);
    }
  }
  console.log('');
  console.log(`Wrote report: ${outPath}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
