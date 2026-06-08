import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.ts';
import {
  detectAttackTriggers,
  detectTargetedTriggers,
  detectDeathTriggers,
  detectCombatDamageTriggers,
  detectBlockTriggers,
  detectAbilityActivatedTriggers,
  detectETBTriggers,
} from '../src/state/modules/triggered-abilities.ts';
import { detectCounterRemovedTriggers } from '../src/state/modules/triggers/counters.ts';
import { detectTapTriggers } from '../src/state/modules/triggered-abilities.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8')) as Array<{
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}>;
const permanent = { id: 'P', controller: 'P1' };

const wants = [
  'Scalelord Reckoner',
  'Cloud Cover',
  "Heliod's Emissary",
  'Magma Pummeler',
  'Noble Stand',
  'Kitsune Ace',
  'Scald',
  'Turntimber Sower',
  'Skeletonize',
  'Tomik, Wielder of Law',
  "Delif's Cube",
  'Rakish Heir',
  'Gravity Well',
];

function oracleOf(card: (typeof cards)[0]): string {
  const faces = card.card_faces;
  return Array.isArray(faces) && faces.length
    ? faces.map((f) => f.oracle_text || '').filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

for (const want of wants) {
  const card = cards.find((c) => c.name === want || c.name.startsWith(want));
  if (!card) {
    console.log(`MISSING ${want}`);
    continue;
  }
  const oracle = oracleOf(card);
  const cardObj = { name: card.name, oracle_text: oracle };
  const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', card.name);
  console.log(`\n=== ${card.name} ===`);
  for (const line of oracle.split('\n').filter((l) => /when(?:ever)?|at the beginning/i.test(l))) {
    console.log('>', line.replace(/\s+/g, ' ').slice(0, 150));
  }
  for (const t of parsed.filter((x) => x.event)) {
    console.log(`  ${t.event} | ${t.condition || t.triggerFilter || '(empty)'}`);
  }
  console.log({
    targeted: detectTargetedTriggers(cardObj, permanent).length,
    attack: detectAttackTriggers(cardObj, permanent).length,
    block: detectBlockTriggers(cardObj, permanent).length,
    death: detectDeathTriggers(cardObj, permanent).length,
    combatDmg: detectCombatDamageTriggers(cardObj, permanent).length,
    counterRemoved: detectCounterRemovedTriggers(cardObj, permanent).length,
    tap: detectTapTriggers(cardObj, permanent).length,
    etb: detectETBTriggers(cardObj, permanent).length,
    ability: detectAbilityActivatedTriggers(cardObj, permanent).length,
  });
}
