import { detectCastTrigger } from './rules-engine/src/cards/castTriggers.ts';
import { inferTriggeredAbilityTargetMetadata } from './server/src/state/modules/inferTriggeredAbilityTargetMetadata.ts';
import { inferGenericTriggeredAbilityTargetMetadata } from './server/src/state/modules/triggers/target-metadata.ts';

const oracle = 'When you cast this spell, you may return target creature card from your graveyard to the battlefield.\nAnnihilator 2 (Whenever this creature attacks, defending player sacrifices two permanents.)';
const cast = detectCastTrigger(oracle, 'Creature — Eldrazi');
console.log('CAST', JSON.stringify(cast, null, 2));
const desc = `When you cast this spell, ${cast.effect}`;
console.log('DESC', desc);
console.log('RICH', JSON.stringify(inferTriggeredAbilityTargetMetadata(desc), null, 2));
console.log('GENERIC', JSON.stringify(inferGenericTriggeredAbilityTargetMetadata(desc), null, 2));
console.log('MANDATORY_SHOULD_BE', !desc.toLowerCase().includes('you may'));
