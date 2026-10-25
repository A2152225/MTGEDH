/**
 * Round 15 trigger wordings: enchanted-player bindings ("attacks enchanted player",
 * "deals combat damage to enchanted player", "a land enchanted player controls enters"),
 * "attacks one of your opponents", "enters or dies" / "enters or becomes monstrous",
 * "this creature or equipped creature ...", "creature spell with power N or greater", and
 * delayed / player-level wordings left to their legacy runtime.
 * Origin parent: parseFamilies.ts parseTriggerEventSentence.
 * Public: parseRound15TriggerSentence.
 */

import type { TriggerConditionIR } from './types.js';

type Parsed = { condition: TriggerConditionIR; effect: string };
type Reparse = (sentence: string) => Parsed | null;

function withFields(base: Parsed | null, fields: Record<string, unknown>): Parsed | null {
  return base ? { ...base, condition: { ...base.condition, ...fields } as TriggerConditionIR } : null;
}

const LEGACY = { legacyRuntimeOnly: true };
const SUBJECT = '((?:a|an|another) [^,]+?)';

const LEGACY_ONLY: readonly RegExp[] = [
  /^when that (?:creature|token|permanent) (?:dies|leaves the battlefield),\s*(.+)$/,
  /^whenever a creature (?:dies|attacks|blocks) this turn,\s*(.+)$/,
  /^at the beginning of that combat,\s*(.+)$/,
  /^at this turn's next end of combat,\s*(.+)$/,
  /^whenever a player attacks one of your opponents,\s*(.+)$/,
  /^whenever one or more creatures attack one of your opponents,\s*(.+)$/,
];

export function parseRound15TriggerSentence(text: string, reparse: Reparse): Parsed | null {
  const attacksEnchanted = new RegExp('^whenever ' + SUBJECT + ' attacks enchanted player,\\s*(.+)$').exec(text);
  if (attacksEnchanted) {
    return withFields(reparse('whenever ' + attacksEnchanted[1] + ' attacks, ' + attacksEnchanted[2]), { attackedPlayer: 'enchanted', attackedTargetType: 'player' });
  }

  const attacksOpponent = new RegExp('^whenever ' + SUBJECT + ' attacks one of your opponents,\\s*(.+)$').exec(text);
  if (attacksOpponent) {
    return withFields(reparse('whenever ' + attacksOpponent[1] + ' attacks, ' + attacksOpponent[2]), { attackedPlayer: 'opponent', attackedTargetType: 'player' });
  }

  const damageEnchanted = new RegExp('^whenever ' + SUBJECT + ' deals combat damage to enchanted player,\\s*(.+)$').exec(text);
  if (damageEnchanted) {
    return withFields(reparse('whenever ' + damageEnchanted[1] + ' deals combat damage to a player, ' + damageEnchanted[2]), { damagedPlayer: 'enchanted' });
  }

  const damageOpponent = new RegExp('^whenever ' + SUBJECT + ' deals combat damage to one of your opponents,\\s*(.+)$').exec(text);
  if (damageOpponent) return reparse('whenever ' + damageOpponent[1] + ' deals combat damage to an opponent, ' + damageOpponent[2]);

  const enchantedControls = /^(whenever|when) (a|an|another) ([^,]+?) enchanted player controls ([a-z ]+?),\s*(.+)$/.exec(text);
  if (enchantedControls) {
    return withFields(reparse(enchantedControls[1] + ' ' + enchantedControls[2] + ' ' + enchantedControls[3] + ' ' + enchantedControls[4] + ', ' + enchantedControls[5]), { subjectControlledBy: 'enchanted_player' });
  }

  const entersOrDies = new RegExp('^(whenever|when) ' + SUBJECT + ' enters or dies,\\s*(.+)$').exec(text);
  if (entersOrDies) return withFields(reparse(entersOrDies[1] + ' ' + entersOrDies[2] + ' enters, ' + entersOrDies[3]), { pairedEvent: 'dies' });

  const monstrous = /^(whenever|when) (this creature|~) enters or becomes monstrous,\s*(.+)$/.exec(text);
  if (monstrous) return withFields(reparse(monstrous[1] + ' ' + monstrous[2] + ' enters, ' + monstrous[3]), { pairedEvent: 'becomes_monstrous' });

  const selfOrEquipped = /^(whenever|when) this creature or equipped creature ([^,]+),\s*(.+)$/.exec(text);
  if (selfOrEquipped) {
    const self = reparse(selfOrEquipped[1] + ' this creature ' + selfOrEquipped[2] + ', ' + selfOrEquipped[3]);
    const equipped = reparse(selfOrEquipped[1] + ' equipped creature ' + selfOrEquipped[2] + ', ' + selfOrEquipped[3]);
    if (!self || !equipped || self.condition.event !== equipped.condition.event) return null;
    return withFields(self, { alternatives: [...self.condition.alternatives, ...equipped.condition.alternatives] });
  }

  const power = /^(whenever you cast|whenever a player casts|whenever an opponent casts) (an? [a-z ]*?creature spell) with power (\d+) or (greater|less),\s*(.+)$/.exec(text);
  if (power) {
    const base = reparse(power[1] + ' ' + power[2] + ', ' + power[5]);
    if (!base) return null;
    const stat = { stat: 'power', op: power[4] === 'less' ? 'lte' : 'gte', value: Number(power[3]) };
    return withFields(base, {
      alternatives: base.condition.alternatives.map((alt: any) => ({ ...alt, subject: { ...alt.subject, stats: [...(alt.subject.stats || []), stat] } })),
    });
  }

  for (const re of LEGACY_ONLY) {
    const hit = re.exec(text);
    if (hit) return withFields(reparse('when this creature enters, ' + hit[1]), LEGACY);
  }
  return null;
}
