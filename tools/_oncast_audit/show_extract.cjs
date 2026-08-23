const { resolveOnCastSpellTriggerDescription } = require('D:/Git/MTGEDH/server/dist/server/src/state/modules/onCastSpellTriggerUtils.js');
const samples = [
  { name:'Bearer of Silence', oracle_text:'When you cast this spell, you may pay {1}{C}. If you do, target opponent sacrifices a creature. ({C} represents colorless mana.)' },
  { name:'Artisan of Kozilek', oracle_text:'When you cast this spell, you may return target creature card from your graveyard to the battlefield.' },
  { name:'World Breaker', oracle_text:'When you cast this spell, exile target artifact, enchantment, or land.' },
  { name:'Elder Deep-Fiend', oracle_text:'When you cast this spell, tap up to four target permanents.' },
  { name:'Brass Knuckles', oracle_text:'When you cast this spell, copy it. (The copy becomes a token.)' },
  { name:'Ruin Processor', oracle_text:'When you cast this spell, you may put a card an opponent owns from exile into that player\'s graveyard. If you do, you gain 5 life.' },
  { name:'Ulamog, the Ceaseless Hunger', oracle_text:'When you cast this spell, exile two target permanents.' },
];
for (const c of samples) {
  const r = resolveOnCastSpellTriggerDescription(c);
  console.log('---', c.name);
  console.log(r && r.description);
}
