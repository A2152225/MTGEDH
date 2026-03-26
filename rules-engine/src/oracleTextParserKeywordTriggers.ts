import { AbilityType, type ParsedAbility } from './oracleTextParser';

function stripTrailingReminder(text: string): string {
  return String(text || '')
    .replace(/\s+\([^()]*\)\s*$/, '')
    .trim();
}

export function parseKeywordTriggeredAbility(text: string): ParsedAbility | null {
  const cleaned = stripTrailingReminder(text);
  const normalized = cleaned.toLowerCase();

  const annihilatorMatch = cleaned.match(/^annihilator\s+(\d+)$/i);
  if (annihilatorMatch) {
    const amount = Number.parseInt(String(annihilatorMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: `Defending player sacrifices ${amount === 1 ? 'a permanent' : `${amount} permanents`}.`,
        isOptional: false,
      };
    }
  }

  const mobilizeMatch = cleaned.match(/^mobilize\s+(\d+)$/i);
  if (mobilizeMatch) {
    const amount = Number.parseInt(String(mobilizeMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect:
          `Create ${amount === 1 ? 'a' : amount} 1/1 red Warrior creature token${amount === 1 ? '' : 's'}. Those tokens enter tapped and attacking. Sacrifice them at the beginning of the next end step.`,
        isOptional: false,
      };
    }
  }

  const afterlifeMatch = cleaned.match(/^afterlife\s+(\d+)$/i);
  if (afterlifeMatch) {
    const amount = Number.parseInt(String(afterlifeMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent dies',
        effect:
          `Create ${amount === 1 ? 'a' : amount} 1/1 white and black Spirit creature token${amount === 1 ? '' : 's'} with flying.`,
        isOptional: false,
      };
    }
  }

  const afflictMatch = cleaned.match(/^afflict\s+(\d+)$/i);
  if (afflictMatch) {
    const amount = Number.parseInt(String(afflictMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature becomes blocked',
        effect: `Defending player loses ${amount} life.`,
        isOptional: false,
      };
    }
  }

  const renownMatch = cleaned.match(/^renown\s+(\d+)$/i);
  if (renownMatch) {
    const amount = Number.parseInt(String(renownMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature deals combat damage to a player',
        interveningIf: "this creature isn't renowned",
        effect: `Put ${amount} +1/+1 counter${amount === 1 ? '' : 's'} on this creature. This creature becomes renowned.`,
        isOptional: false,
      };
    }
  }

  const poisonousMatch = cleaned.match(/^poisonous\s+(\d+)$/i);
  if (poisonousMatch) {
    const amount = Number.parseInt(String(poisonousMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature deals combat damage to a player',
        effect: `That player gets ${amount} poison counter${amount === 1 ? '' : 's'}.`,
        isOptional: false,
      };
    }
  }

  const fabricateMatch = cleaned.match(/^fabricate\s+(\d+)$/i);
  if (fabricateMatch) {
    const amount = Number.parseInt(String(fabricateMatch[1] || '0'), 10);
    if (Number.isFinite(amount) && amount > 0) {
      const counterText = amount === 1 ? 'a +1/+1 counter' : `${amount} +1/+1 counters`;
      const tokenText =
        amount === 1
          ? 'a 1/1 colorless Servo artifact creature token'
          : `${amount} 1/1 colorless Servo artifact creature tokens`;
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent enters the battlefield',
        effect: `You may put ${counterText} on it. If you don't, create ${tokenText}.`,
        isOptional: true,
      };
    }
  }

  if (normalized === 'training') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'whenever',
      triggerCondition: "this creature and at least one other creature with power greater than this creature's power attack",
      effect: 'Put a +1/+1 counter on this creature.',
      isOptional: false,
    };
  }

  if (normalized === 'mentor') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'whenever',
      triggerCondition: 'this creature attacks',
      effect: "Put a +1/+1 counter on target attacking creature with power less than this creature's power.",
      isOptional: false,
    };
  }

  if (normalized === 'battle cry') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'whenever',
      triggerCondition: 'this creature attacks',
      effect: 'Each other attacking creature gets +1/+0 until end of turn.',
      isOptional: false,
    };
  }

  if (normalized === 'evolve') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'whenever',
      triggerCondition: 'another creature enters the battlefield under your control',
      interveningIf: "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness",
      effect: 'Put a +1/+1 counter on this creature.',
      isOptional: false,
    };
  }

  if (normalized === 'exploit') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'when',
      triggerCondition: 'this permanent enters the battlefield',
      effect: 'You may sacrifice a creature.',
      isOptional: true,
    };
  }

  if (normalized === 'storm') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'when',
      triggerCondition: 'you cast this spell',
      effect: 'Copy this spell for each spell cast before it this turn. You may choose new targets for the copies.',
      isOptional: false,
    };
  }

  if (normalized === 'cascade') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'when',
      triggerCondition: 'you cast this spell',
      effect:
        "Exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.",
      isOptional: false,
    };
  }

  if (normalized === 'living weapon') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'when',
      triggerCondition: 'this equipment enters the battlefield',
      effect: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
      isOptional: false,
    };
  }

  if (normalized === 'rebound') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'at',
      triggerCondition: 'the beginning of your next upkeep',
      effect: 'You may cast this card from exile without paying its mana cost.',
      isOptional: false,
    };
  }

  if (normalized === 'for mirrodin!') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'when',
      triggerCondition: 'this equipment enters the battlefield',
      effect: 'Create a 2/2 red Rebel creature token, then attach this Equipment to it.',
      isOptional: false,
    };
  }

  if (normalized === 'job select') {
    return {
      type: AbilityType.TRIGGERED,
      text,
      triggerKeyword: 'when',
      triggerCondition: 'this equipment enters the battlefield',
      effect: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
      isOptional: false,
    };
  }

  switch (normalized) {
    case 'undying':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent dies',
        interveningIf: 'it had no +1/+1 counters on it',
        effect: "Return this card to the battlefield under its owner's control with a +1/+1 counter on it.",
        isOptional: false,
      };
    case 'persist':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'when',
        triggerCondition: 'this permanent dies',
        interveningIf: 'it had no -1/-1 counters on it',
        effect: "Return this card to the battlefield under its owner's control with a -1/-1 counter on it.",
        isOptional: false,
      };
    case 'ingest':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature deals combat damage to a player',
        effect: 'That player exiles the top card of their library.',
        isOptional: false,
      };
    case 'dethrone':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        interveningIf: 'defending player has the most life or is tied for the most life',
        effect: 'Put a +1/+1 counter on this creature.',
        isOptional: false,
      };
    case 'mentor':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: "Put a +1/+1 counter on target attacking creature with power less than this creature's power.",
        isOptional: false,
      };
    case 'melee':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect: 'This creature gets +X/+X until end of turn where X is the number of players being attacked.',
        isOptional: false,
      };
    case 'exalted':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'a creature you control attacks alone',
        effect: 'That creature gets +1/+1 until end of turn.',
        isOptional: false,
      };
    case 'myriad':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'this creature attacks',
        effect:
          "For each opponent other than defending player, create a token that's a copy of it. Those tokens enter tapped and attacking. Exile them at end of combat.",
        isOptional: false,
      };
    case 'prowess':
      return {
        type: AbilityType.TRIGGERED,
        text,
        triggerKeyword: 'whenever',
        triggerCondition: 'you cast a noncreature spell',
        effect: 'This creature gets +1/+1 until end of turn.',
        isOptional: false,
      };
    default:
      return null;
  }
}
