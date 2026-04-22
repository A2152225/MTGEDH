
>   it('prunes Read Ahead reminder text while keeping saga chapters', () => {
      const ir = parseOracleTextToIR(
        "Read ahead (Choose a chapter and start with that many lore counters. 
Add one after your draw step. Skipped chapters don't trigger. Sacrifice after 
III.)\nI — Target opponent reveals their hand. You choose a creature or 
planeswalker card from it. That player discards that card.\nII — Search your 
library for a card, put that card into your hand, then shuffle. You lose 3 
life.\nIII — Put target creature card from a graveyard onto the battlefield 
under your control.",
        'The Cruelty of Gix'
      );
  
      expect(
        ir.abilities.some((ability) => /read ahead/i.test(String(ability.text 
|| ability.effectText || '')))
      ).toBe(false);
  
      const stepRaws = ir.abilities.flatMap((ability) => 
ability.steps.map((step) => String(step.raw || '')));
      expect(stepRaws.some((raw) => /add one after your draw 
step/i.test(raw))).toBe(false);
      expect(stepRaws.some((raw) => /skipped chapters do(?:n't| not) 
trigger/i.test(raw))).toBe(false);
      expect(stepRaws.some((raw) => /sacrifice after 
iii/i.test(raw))).toBe(false);
      expect(stepRaws.some((raw) => /target opponent reveals their 
hand/i.test(raw))).toBe(true);
      expect(stepRaws.some((raw) => /search your library for a 
card/i.test(raw))).toBe(true);
      expect(stepRaws.some((raw) => /put target creature card from a graveyard 
onto the battlefield under your control/i.test(raw))).toBe(true);
    });
  
    it('merges copy-ability retarget tails onto the primary unknown step', () 
=> {
      const ir = parseOracleTextToIR(


