import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.ts';
import {
  detectAttackTriggers,
  detectTargetedTriggers,
  detectDeathTriggers,
  detectCombatDamageTriggers,
  detectDealtDamageTriggers,
  detectBlockTriggers,
  detectETBTriggers,
  detectLTBTriggers,
  detectAbilityActivatedTriggers,
  detectTapTriggers,
} from '../src/state/modules/triggered-abilities.ts';
import { detectExiledFromBattlefieldTriggers } from '../src/state/modules/triggers/zone-change.ts';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const permanent = { id: 'P', controller: 'P1' };

const wants = [
  'Extraplanar Lens',
  'Search the City',
  'Phage the Untouchable',
  'Don & Raph, Hard Science',
  'Jareth, Leonine Titan',
  'Nyssa of Traken',
];

function oracleOf(card: { oracle_text?: string; card_faces?: Array<{ oracle_text?: string }> }): string {
  const faces = card.card_faces;
  return Array.isArray(faces) && faces.length
    ? faces.map((f) => f.oracle_text || '').filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

for (const want of wants) {
  const card = cards.find(
    (c: { name: string; layout?: string }) =>
      (c.name === want || c.name.startsWith(want)) && c.layout !== 'art_series',
  );
  if (!card) {
    console.log(`MISSING ${want}`);
    continue;
  }
  const oracle = oracleOf(card);
  const cardObj = { name: card.name, oracle_text: oracle };
  const parsed = parseTriggeredAbilitiesFromText(oracle, 'SRC', 'P1', card.name);
  console.log(`\n=== ${card.name} ===`);
  for (const t of parsed.filter((x) => x.event)) {
    console.log(`  ${t.event} | ${t.condition || t.triggerFilter || '(empty)'}`);
  }
  console.log({
    targeted: detectTargetedTriggers(cardObj, permanent).length,
    attack: detectAttackTriggers(cardObj, permanent).length,
    block: detectBlockTriggers(cardObj, permanent).length,
    death: detectDeathTriggers(cardObj, permanent).length,
    combatDmg: detectCombatDamageTriggers(cardObj, permanent).length,
    exiled: detectExiledFromBattlefieldTriggers(cardObj, permanent).length,
    tap: detectTapTriggers(cardObj, permanent).length,
    ability: detectAbilityActivatedTriggers(cardObj, permanent).length,
    sacrifice: detectSacrificeTriggers(cardObj, permanent).length,
  });
}
