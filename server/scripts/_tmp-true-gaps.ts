import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { detectAttackTriggers, detectCombatDamageTriggers, detectDeathTriggers, detectLTBTriggers, detectTargetedTriggers, detectETBTriggers, detectSpellCastTriggers, detectAbilityActivatedTriggers, detectBlockTriggers, detectDealtDamageTriggers, detectTapTriggers, detectDiscardTriggers, detectTransformTriggers, detectMonstrousTriggers, detectSpellCounteredTriggers, detectMutateTriggers, detectBeginningOfCombatTriggers, detectEndOfCombatTriggers, detectUntapTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectEndStepTriggers, detectDrawStepTriggers, detectPostcombatMainTriggers, detectPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';
import { detectPutIntoGraveyardTriggers, detectExiledFromBattlefieldTriggers, detectLeftGraveyardTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectMillTriggers } from '../src/state/modules/triggers/mill.js';
import { detectCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectTokenCreatedTriggers } from '../src/state/modules/triggers/tokens.js';
import { detectPayLifeTriggers } from '../src/state/modules/triggers/pay-life.js';

const P = { id: 'P1', controller: 'P1' };
const cards = JSON.parse(readFileSync(JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8')).meta.oraclePath, 'utf8'));

const allDetectors = (c: any) => (
  detectOpponentSpellCastTriggers(c, P).length +
  detectSpellCastTriggers(c, P).length +
  detectTargetedTriggers(c, P).length +
  detectTapTriggers(c, P).length +
  detectDeathTriggers(c, P).length +
  detectETBTriggers(c, P).length +
  detectSacrificeTriggers(c, P).length +
  detectDealtDamageTriggers(c, P).length +
  detectBlockTriggers(c, P).length +
  detectCombatDamageTriggers(c, P).length +
  detectAttackTriggers(c, P).length +
  detectLTBTriggers(c, P).length +
  detectTransformTriggers(c, P).length +
  detectLifeLossTriggers(c, P).length +
  detectGainedLifeTriggersFromOracle(c, P).length +
  detectCardDrawTriggers(c, P).length +
  detectPutIntoGraveyardTriggers(c, P).length +
  detectUpkeepTriggers(c, P).length +
  detectMillTriggers(c, P).length +
  detectExiledFromBattlefieldTriggers(c, P).length +
  detectAbilityActivatedTriggers(c, P).length +
  detectCounterPlacedTriggers(c, P).length +
  detectMonstrousTriggers(c, P).length +
  detectTokenCreatedTriggers(c, P).length +
  detectPayLifeTriggers(c, P).length +
  detectBeginningOfCombatTriggers(c, P).length +
  detectEndOfCombatTriggers(c, P).length +
  detectUntapTriggers(c, P).length +
  detectDiscardTriggers(c, P).length +
  detectSpellCounteredTriggers(c, P).length +
  detectMutateTriggers(c, P).length +
  detectEndStepTriggers(c, P).length +
  detectDrawStepTriggers(c, P).length +
  detectPostcombatMainTriggers(c, P).length +
  detectPrecombatMainTriggers(c, P).length +
  detectLeftGraveyardTriggers(c, P).length
);

const clauseRe = /(?:^|\n)\s*((?:when|whenever|at)\b[^.\n]+)/gi;
const clusters = new Map<string, { count: number; samples: string[] }>();

for (const card of cards) {
  const oracle = String(card.oracle_text || '');
  if (!/\bwhen(?:ever)?\b/i.test(oracle) && !/\bat the beginning\b/i.test(oracle)) continue;
  const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', String(card.name));
  if (parsed.length === 0) continue;
  const c = { name: card.name, oracle_text: oracle, type_line: card.type_line };
  if (allDetectors(c) > 0) continue;

  let m: RegExpExecArray | null;
  clauseRe.lastIndex = 0;
  while ((m = clauseRe.exec(oracle)) !== null) {
    const clause = m[1].trim().slice(0, 90).toLowerCase();
    const key = clause.replace(/\{[^}]+\}/g, '{m}').replace(/\d+/g, 'N').slice(0, 70);
    const entry = clusters.get(key) || { count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 2) entry.samples.push(`${card.name}: ${m[1].trim().slice(0, 100)}`);
    clusters.set(key, entry);
    break;
  }
}

const sorted = [...clusters.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`clusters with parsed triggers but zero detector hits: ${sorted.length}`);
for (const [key, v] of sorted.slice(0, 35)) {
  console.log(`\n[${v.count}] ${key}`);
  for (const s of v.samples) console.log(`  ${s}`);
}
