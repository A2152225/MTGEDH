import { normalizeOracleForParsing, stripReminderParentheticals } from '../src/oracleReminderText.js';

const samples = [
  "Evoke {2}{U} (You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters.)",
  'Cleave {5}{W} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)',
  'Bushido 2 (Whenever this creature blocks or becomes blocked, it gets +2/+2 until end of turn.)',
  "Cascade, cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order. Then do it again.)",
  "Overload {4}{R}{R} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of \"target\" with \"each.\")",
  'Splice onto Arcane {1}{U} (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card\'s effects to that spell.)',
];

for (const s of samples) {
  console.log('IN :', s);
  console.log('STRIP:', stripReminderParentheticals(s));
  console.log('NORM :', normalizeOracleForParsing(s));
  console.log('---');
}
process.exit(0);
