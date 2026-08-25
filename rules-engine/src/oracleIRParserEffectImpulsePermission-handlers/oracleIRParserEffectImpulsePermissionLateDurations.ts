/**
 * Origin parent: oracleIRParserEffectImpulsePermission.ts
 * Cluster moved: parseEffectLevelImpulsePermissionClause late next-turn / until-end / remains-exiled if-chain
 * Public: tryParseImpulsePermissionLateDurationClauses
 */

export function tryParseImpulsePermissionLateDurationClauses(args: {
  lowerClause: string;
  objectRef: string;
  objectRefWithLimit: string;
  amongRef: string;
  exiledWithSourceRef: string;
}):
  | {
      readonly duration:
        | 'this_turn'
        | 'during_resolution'
        | 'during_next_turn'
        | 'until_end_of_next_turn'
        | 'until_exile_another'
        | 'until_next_turn'
        | 'until_next_upkeep'
        | 'until_next_end_step'
        | 'until_end_of_combat_on_next_turn'
        | 'as_long_as_remains_exiled'
        | 'as_long_as_control_source';
      readonly permission: 'play' | 'cast';
    }
  | undefined {
  const { lowerClause, objectRef, objectRefWithLimit, amongRef, exiledWithSourceRef } = args;
  let duration:
    | 'this_turn'
    | 'during_resolution'
    | 'during_next_turn'
    | 'until_end_of_next_turn'
    | 'until_exile_another'
    | 'until_next_turn'
    | 'until_next_upkeep'
    | 'until_next_end_step'
    | 'until_end_of_combat_on_next_turn'
    | 'as_long_as_remains_exiled'
    | 'as_long_as_control_source'
    | null = null;
  let permission: 'play' | 'cast' | null = null;

  // "During your next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^during your next turn,?\\s+you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'during_next_turn';
    }
  }

  // "You may play/cast that card during your next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} during your next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'during_next_turn';
    }
  }
  // "Until the end of your next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until the end of your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "Until end of turn, you may cast spells from among them/those cards"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "Until end of turn, you may cast a spell from among them/those cards"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "Until your next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_turn';
    }
  }

  // "Until your next turn, players may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next turn, players may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_turn';
    }
  }
  // "Until your next end step, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next end step, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_end_step';
    }
  }

  // "Until end of combat on your next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until (?:the )?end of combat on your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_combat_on_next_turn';
    }
  }

  // "You may play/cast that card until end of combat on your next turn"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may (play|cast) ${objectRefWithLimit} until (?:the )?end of combat on your next turn\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_combat_on_next_turn';
    }
  }

  // "Until the beginning of your next upkeep, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until the beginning of your next upkeep, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_upkeep';
    }
  }
  // "Until your next end step, each player may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until your next end step, each player may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_end_step';
    }
  }
  // "Until the end of next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until the end of next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "Until end of your next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of your next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "Until end of next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "Until end of the next turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of the next turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "Until the end of the turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until the end of the turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "Until the end of this turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until the end of this turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "Until the end of that turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until the end of that turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "Until the end of turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until the end of turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "Until end of turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "Until end of this turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of this turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "Until end of that turn, you may play/cast that card"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of that turn, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card until the end of your next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card until your next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until your next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_turn';
    }
  }
  // "You may play/cast that card until your next end step"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until your next end step\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_end_step';
    }
  }
  // "Each player may play/cast that card until your next end step"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^each player may (play|cast) ${objectRefWithLimit} until your next end step\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_next_end_step';
    }
  }
  // "You may play/cast that card until the end of next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card until end of your next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card until end of next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card until end of the next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of the next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card until end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card through end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through end of turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card through end of next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through end of next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card through the end of next turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through the end of next turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'until_end_of_next_turn';
    }
  }
  // "You may play/cast that card through end of this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through end of this turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card through the end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through the end of turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card through the end of this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} through the end of this turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card until end of this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of this turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }

  // "You may play/cast that card until end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card until end of that turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until end of that turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }

  // "You may play/cast that card until the end of the turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of the turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }

  // "You may play/cast that card until the end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card until the end of this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of this turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }
  // "You may play/cast that card until the end of that turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} until the end of that turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }

  // "For as long as that card remains exiled, you may play/cast it"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^for as long as ${objectRef} remain(?:s)? exiled, you may (play|cast) ${objectRefWithLimit}\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_remains_exiled';
    }
  }

  // "As long as that card remains exiled, you may play/cast it"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^as long as ${objectRef} remain(?:s)? exiled, you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_remains_exiled';
    }
  }

  // "You may play/cast that card for as long as it remains exiled"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may (play|cast) ${objectRefWithLimit} for as long as (?:it|they) remain(?:s)? exiled\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_remains_exiled';
    }
  }

  // "You may play/cast that card as long as it remains exiled"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may (play|cast) ${objectRefWithLimit} as long as (?:it|they) remain(?:s)? exiled\\s*$`, 'i')
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_remains_exiled';
    }
  }

  // "You may play/cast it for as long as you control <source>"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^you may (play|cast) ${objectRefWithLimit} (?:for as long as|as long as) you control (?:this (?:creature|artifact|enchantment|planeswalker|permanent)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢]+)\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_control_source';
    }
  }

  // "You may play/cast it until you exile another card with this <permanent type>."
  // Seen in templates like Furious Rise / Unstable Amulet / similar.
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^you may (play|cast) ${objectRefWithLimit} until you exile another card with this (?:creature|artifact|enchantment|planeswalker|permanent)\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = m[1] as any;
      duration = 'until_exile_another';
    }
  }

  // "You may play/cast it for/as long as this <permanent> remains on the battlefield"
  // Seen in real oracle text (e.g. Saga chapters).
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^you may (play|cast) ${objectRefWithLimit} (?:for as long as|as long as) this (?:creature|artifact|enchantment|planeswalker|permanent|saga) remains on the battlefield\s*$`,
        'i'
      )
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_control_source';
    }
  }

  if (!duration || !permission) return undefined;
  return { duration, permission };
}
