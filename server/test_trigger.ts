import { detectSpellCastTriggers } from './src/state/modules/triggered-abilities.js';

const card = {
  name: 'Reflections of Littjara',
  oracle_text: 'As Reflections of Littjara enters the battlefield, choose a creature type. Whenever you cast a spell of the chosen type, copy that spell. (A copy of a permanent spell becomes a token.)'
};

const permanent = {
  id: 'perm-1',
  controller: 'player-1',
  chosenCreatureType: 'Wizard'
};

try {
  // @ts-ignore
  const { detectSpellCastTriggers } = await import('./src/state/modules/triggered-abilities.js');
  const triggers = detectSpellCastTriggers(card, permanent);
  console.log(JSON.stringify(triggers, null, 2));
} catch (e) {
  console.error(e);
  process.exit(1);
}
