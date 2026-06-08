import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function buildCardObj(card: { name: string; oracle_text?: string; type_line?: string; card_faces?: { oracle_text?: string }[] }) {
  const oracle_text = card.card_faces
    ? card.card_faces.map((f) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  return { name: card.name, oracle_text, type_line: card.type_line };
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const samples = [
  'Pedantic Learning',
  'Kaya, Spirits\' Justice',
  'Necropolis of Azar',
  'Carpet of Flowers',
  'Stolen Uniform',
  'Vernal Bloom',
  'The Millennium Calendar',
  'Cunning',
];

for (const name of samples) {
  const c = cards.find((x: { name: string; oracle_id?: string }) =>
    name === 'Cunning' ? x.oracle_id === 'd5e48041-5f21-48e6-bd0c-000f02dfbe8a' : x.name === name,
  );
  if (!c) { console.log('missing', name); continue; }
  const cardObj = buildCardObj(c);
  const parsed = parseTriggeredAbilitiesFromText(cardObj.oracle_text, 'SRC', 'P1', c.name);
  console.log(`\n${c.name}:`);
  console.log(cardObj.oracle_text?.slice(0, 140));
  for (const t of parsed) {
    console.log(' ', serverDetectsTrigger(c, t), t.event, t.triggerFilter || t.condition);
  }
}
