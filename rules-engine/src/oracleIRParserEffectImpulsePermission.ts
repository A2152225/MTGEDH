import {
  type ImpulsePermissionCondition,
  normalizeImpulsePermissionClause,
  parseLeadingImpulsePermissionCondition,
} from './oracleIRParserImpulseClauseUtils';

export function parseEffectLevelImpulsePermissionClause(
  clause: string
):
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
      readonly condition?:
        | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
        | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
        | { readonly kind: 'attacked_with'; readonly raw: string };
    }
  | null {
  // Second clause: permission window for playing/casting the exiled card(s).
  // We only emit an impulse step if we can confidently determine the duration.
  let clauseToParse = normalizeImpulsePermissionClause(clause, {
    normalizeExplicitSubject: true,
    stripThirdPersonSpendManaRider: true,
  });

  const objectRef =
    '(?:that card|those cards|them|it|the exiled card|the exiled cards|that spell|those spells|the exiled spell|the exiled spells|(?:the )?card exiled this way|(?:the )?cards exiled this way|(?:the )?spell exiled this way|(?:the )?spells exiled this way|(?:the )?card they exiled this way|(?:the )?cards they exiled this way)';
  const objectRefWithLimit = `(?:up to (?:a|an|\d+|x|[a-z]+) of |one of )?${objectRef}`;

  const exiledWithSourceRef =
    "(?:the )?(?:cards?|spells?) exiled with (?:this (?:creature|artifact|enchantment|planeswalker|permanent|class|saga)|(?!(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten)\\b)[a-z0-9][a-z0-9\\s\\-\\.',ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¾Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢]+)";

  let condition: ImpulsePermissionCondition | undefined;
  {
    const parsedCondition = parseLeadingImpulsePermissionCondition(clauseToParse);
    clauseToParse = parsedCondition.clause;
    condition = parsedCondition.condition;
  }

  const lowerClause = clauseToParse.toLowerCase();
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

  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^during any turn you attacked with ([^,]+), you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i')
    );
    if (m) {
      condition = { kind: 'attacked_with', raw: String(m[1] || '').trim() };
      permission = m[2] as any;
      duration = 'as_long_as_remains_exiled';
    }
  }

  // "During each player's turn, that player may play a land or cast a spell from among cards exiled with this <permanent>"
  // Seen in real oracle text for effects that continuously seed exile-top.
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^during each player's turn, that player may play a land or cast a spell from among ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = 'play';
      duration = 'as_long_as_control_source';
    }
  }

  // "(Once during each of your turns, ...) you may play a land or cast a spell from among cards exiled with this <permanent>"
  // Seen in real oracle text for continuous exile-from-top engines. We ignore the once-per-turn limiter.
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^(?:once during each of your turns,?\\s*)?you may play a land or cast a spell from among ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = 'play';
      duration = 'as_long_as_control_source';
    }
  }

  // "(During your turn, ...) you may play/cast cards exiled with this <permanent>"
  // Seen in real oracle text for "exile top card" engines.
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^(?:during your turn,?\\s*)?(?:(?:for as long as|as long as) (?![^,]*remain(?:s)? exiled)[^,]+,\\s*)?you may (play|cast) ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = m[1] as any;
      duration = 'as_long_as_control_source';
    }
  }

  // "(During your turn, if <condition>, ...) you may play lands and cast spells from among cards exiled with this <permanent>"
  // Seen in real oracle text for continuous exile-from-top engines. We don't model the condition.
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^(?:during your turn,?\\s*(?:if\\b[^,]+,\\s*)?)?you may play lands and cast spells from among ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = 'play';
      duration = 'as_long_as_control_source';
    }
  }

  // "Until end of turn, you may play/cast cards exiled with this <permanent>"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^until (?:the )?end of (?:this )?turn, you may (play|cast) ${exiledWithSourceRef}\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }

  // "You may play/cast that card this turn"
  {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit} this turn\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'this_turn';
    }
  }

  // "You may play/cast that card"
  // Some oracle text grants the permission without an explicit duration. In practice this means
  // the action can be taken during the resolution of this ability/spell.
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may (play|cast) ${objectRefWithLimit}\\s*$`, 'i'));
    if (m) {
      permission = m[1] as any;
      duration = 'during_resolution';
    }
  }
  const amongRef =
    '(?:them|those (?:exiled )?cards(?: exiled this way)?|the exiled cards|(?:the )?cards exiled this way)';
  const restrictedSpellRef =
    '(?:(?:an?\\s+)?(?:artifact|creature|noncreature|enchantment|planeswalker|instant (?:or|and|and/or) sorcery|instant|sorcery|permanent)\\s+)?spells?';
  const colorWordRef = '(white|blue|black|red|green)';

  // "You may play lands and cast spells from among them/those cards ..."
  // We treat this as equivalent to a broad "play" permission.
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} this turn\\s*$`, 'i'));
    if (m) {
      permission = 'play';
      duration = 'this_turn';
    }
  }

  // "You may play lands and cast spells from among ... through (the) end of (this) turn"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may play lands and cast spells from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'this_turn';
    }
  }
  // "Through (the) end of (this) turn, you may play lands and cast spells from among ..."
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^through (?:the )?end of (?:this )?turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'this_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may play lands and cast spells from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'this_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until (?:the )?end of (?:this )?turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'this_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until the end of your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until end of your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next turn, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'play';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until your next end step, you may play lands and cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'until_next_end_step';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may play lands and cast spells from among ${amongRef} until the end of your next turn\\s*$`, 'i')
    );
    if (m) {
      permission = 'play';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'play';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'play';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may play lands and cast spells from among ${amongRef} until your next end step\\s*$`, 'i'));
    if (m) {
      permission = 'play';
      duration = 'until_next_end_step';
    }
  }

  // "You may cast spells from among them/those cards this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} this turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }

  // "You may cast spells from among them/those cards for as long as they remain exiled"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(
        `^you may cast spells from among ${amongRef} (?:for as long as|as long as) (?:it|they) remain(?:s)? exiled\\s*$`,
        'i'
      )
    );
    if (m) {
      permission = 'cast';
      duration = 'as_long_as_remains_exiled';
    }
  }

  // "You may cast red/blue/... spells from among them/those cards this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${colorWordRef} spells from among ${amongRef} this turn\\s*$`, 'i'));
    if (m) {
      const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const c = colorMap[String(m[1] || '').trim().toLowerCase()];
      if (c) condition = { kind: 'color', color: c };
      permission = 'cast';
      duration = 'this_turn';
    }
  }

  // "You may cast spells from among them/those cards"
  // No explicit duration implies the permission is usable during the resolution of this effect.
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'during_resolution';
    }
  }

  // "You may cast red/blue/... spells from among them/those cards"
  // No explicit duration implies the permission is usable during the resolution of this effect.
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${colorWordRef} spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
        white: 'W',
        blue: 'U',
        black: 'B',
        red: 'R',
        green: 'G',
      };
      const c = colorMap[String(m[1] || '').trim().toLowerCase()];
      if (c) condition = { kind: 'color', color: c };
      permission = 'cast';
      duration = 'during_resolution';
    }
  }

  // "You may cast an artifact/creature/... spell from among them/those cards this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} this turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }

  // "You may cast an artifact/creature/... spell from among them/those cards"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'during_resolution';
    }
  }

  // "You may cast spells from among ... through (the) end of (this) turn"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may cast spells from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "Through (the) end of (this) turn, you may cast spells from among ..."
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^through (?:the )?end of (?:this )?turn, you may cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "You may cast a spell from among them/those cards this turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} this turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }

  // "Until end of turn, you may cast noncreature/creature/... spells from among them/those cards"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until (?:the )?end of (?:this )?turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }

  // "You may cast a spell from among ... through (the) end of (this) turn"
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^you may cast a spell from among ${amongRef} through (?:the )?end of (?:this )?turn\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "Through (the) end of (this) turn, you may cast a spell from among ..."
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^through (?:the )?end of (?:this )?turn, you may cast a spell from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "You may cast spells from among them/those cards until end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }
  // "You may cast a spell from among them/those cards until end of turn"
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until (?:the )?end of (?:this )?turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'this_turn';
    }
  }

  // Next-turn durations for "cast (a) spell(s) from among ..."
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until the end of your next turn, you may cast spells from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until the end of your next turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(
      new RegExp(`^until the end of your next turn, you may cast a spell from among ${amongRef}\\s*$`, 'i')
    );
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of your next turn, you may cast spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of your next turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until end of your next turn, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until the end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until the end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until the end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until end of your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_end_of_next_turn';
    }
  }

  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next turn, you may cast spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next turn, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next turn, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_turn';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until your next turn\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_turn';
    }
  }

  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next end step, you may cast spells from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_end_step';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next end step, you may cast ${restrictedSpellRef} from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_end_step';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^until your next end step, you may cast a spell from among ${amongRef}\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_end_step';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast spells from among ${amongRef} until your next end step\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_end_step';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast ${restrictedSpellRef} from among ${amongRef} until your next end step\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_end_step';
    }
  }
  if (!duration) {
    const m = lowerClause.match(new RegExp(`^you may cast a spell from among ${amongRef} until your next end step\\s*$`, 'i'));
    if (m) {
      permission = 'cast';
      duration = 'until_next_end_step';
    }
  }

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

  if (!duration) return null;
  if (!permission) return null;

  return { duration, permission, ...(condition ? { condition } : {}) };
}
