import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../oracle-cards.json'), 'utf8'),
) as Array<{ name: string; set?: string; legalities?: Record<string, string> }>;

const userList = [
  'Ambassador Blorpityblorpboop',
  'Captain Rex Nebula',
  'Comet, Stellar Pup',
  'Dee Kay, Finder of the Lost',
  'Magar of the Magic Strings',
  'Monoxa, Midway Manager',
  'Myra the Magnificent',
  'Roxi, Publicist to the Stars',
  'Space Beleren',
  'Spinnerette, Arachnobat',
  'The Most Dangerous Gamer',
  'The Space Family Goblinson',
  'Tusk and Whiskers',
  'Clown Car',
  'Saw in Half',
  'Embiggen',
  'Exchange of Words',
  'Starlight Spectacular',
  'Celebr-8000',
  'Attempted Murder',
  'Ferris Wheel',
  'Haunted House',
  'Tunnel of Love',
  'Swinging Ship',
  'Roller Coaster',
  'Bumper Cars',
];

async function main(): Promise<void> {
  await loadEffectIrParser();
  const byName = new Map(cards.map((c) => [c.name, c]));

  for (const name of userList) {
    const card = byName.get(name);
    if (!card) {
      console.log(`MISSING ${name}`);
      continue;
    }
    const triggers = parseTriggeredAbilitiesFromText(
      getCombinedOracleText(card),
      'PROBE',
      'P1',
      card.name,
    );
    const gaps: string[] = [];
    for (const t of triggers) {
      gaps.push(...hasUnknownIRSteps(t.effect, card.name));
    }
    const ignorable = isIgnorableCardForIrGap(card);
    const cmdLegal = isCommanderLegalCard(card);
    if (gaps.length || triggers.length) {
      console.log(
        `${name}: triggers=${triggers.length} gaps=${gaps.length} cmdLegal=${cmdLegal} ignorable=${ignorable}`,
        gaps.length ? `-> ${gaps[0].slice(0, 80)}` : '',
      );
    }
  }

  const unfEternalGaps = cards.filter(
    (c) => c.set === 'unf' && isEligible(c) && isCommanderLegalCard(c),
  );
  let gapCount = 0;
  for (const card of unfEternalGaps) {
    const triggers = parseTriggeredAbilitiesFromText(
      getCombinedOracleText(card),
      'PROBE',
      'P1',
      card.name,
    );
    for (const t of triggers) {
      if (hasUnknownIRSteps(t.effect, card.name).length) gapCount += 1;
    }
  }
  console.log(`\nUNF commander-legal cards scanned: ${unfEternalGaps.length}`);
  console.log(`UNF commander-legal triggers with gaps: ${gapCount}`);
}

main();
