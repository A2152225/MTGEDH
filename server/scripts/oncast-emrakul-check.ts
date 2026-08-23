import { resolveOnCastSpellTriggerDescriptions } from '../src/state/modules/onCastSpellTriggerUtils.ts';
const e = resolveOnCastSpellTriggerDescriptions({
  name: 'Emrakul, the Aeons Torn',
  oracle_text:
    "This spell can't be countered.\nFlying, protection from spells that have colored mana symbols in their mana costs, annihilator 6.\nWhen Emrakul, the Aeons Torn is put into a graveyard from anywhere, its owner shuffles it into their library.\nTake an extra turn after this one.",
});
console.log(JSON.stringify(e, null, 2));
