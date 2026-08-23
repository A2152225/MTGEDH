import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';

const cards: Record<string, string> = {
  'Echo Storm': `When you cast this spell, copy it for each time you've cast your commander from the command zone this game. You may choose new targets for the copies.
Create a token that's a copy of target artifact.`,
  'Fury Storm': `When you cast this spell, copy it for each time you've cast your commander from the command zone this game. You may choose new targets for the copies.
Copy target instant or sorcery spell. You may choose new targets for the copy.`,
  'Genesis Storm': `When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
Reveal cards from the top of your library until you reveal a nonland permanent card. You may put that card onto the battlefield. Then put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order.`,
  'Empyrial Storm': `When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
Create a 4/4 white Angel creature token with flying.`,
  'Skull Storm': `When you cast this spell, copy it for each time you've cast your commander from the command zone this game.
Each opponent sacrifices a creature of their choice. Each opponent who can't loses half their life, rounded up.`,
  'Depth Defiler': `Devoid (This card has no color.)
Kicker {C} (You may pay an additional {C} as you cast this spell.)
When you cast this spell, choose one. If it was kicked, choose both instead.
• Return target creature to its owner's hand.
• Target player draws two cards, then discards a card.`,
  'Distended Mindbender': `Emerge {5}{B}{B} (You may cast this spell by sacrificing a creature and paying the emerge cost reduced by that creature's mana value.)
When you cast this spell, target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.`,
  'Mana Vortex': `When you cast this spell, counter it unless you sacrifice a land.
At the beginning of each player's upkeep, that player sacrifices a land of their choice.
When there are no lands on the battlefield, sacrifice this enchantment.`,
};

for (const [name, text] of Object.entries(cards)) {
  const ir: any = parseOracleTextToIR(text, name);
  const abl = (ir.abilities || []).map((a: any) => ({
    kind: a.kind,
    event: a.event,
    interveningIf: a.interveningIf,
    steps: (a.effect?.steps || a.steps || []).map((s: any) => ({
      kind: s.kind,
      subject: s.subject,
      copies: s.copies,
      modes: s.modes ? s.modes.length : undefined,
      choose: s.choose,
      ifKicked: s.ifKicked || s.kicked,
      raw: String(s.raw || '').slice(0, 100),
      targets: s.targets,
      filters: s.filters,
    })),
  }));
  console.log('====', name, '====');
  console.log(JSON.stringify({ keywords: ir.keywords, abl }, null, 2).slice(0, 3500));
  console.log('---');
}
