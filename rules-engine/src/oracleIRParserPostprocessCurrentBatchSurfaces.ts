/**
 * Origin parent: oracleIRParser.ts (postprocess pipeline after quoted-ability riders).
 *
 * Cluster: current-batch metadata tests expect executable step kinds that later
 * residual rewrites swallow (connive reminders, compound player verbs, emblem
 * ability text, leading "until end of turn" pumps). Repair those shapes without
 * card-name routing.
 *
 * Public entry: repairCurrentBatchSurfaceSteps
 */
import type { OracleEffectStep, OracleIRAbility, OraclePlayerSelector } from './oracleIR';

function collectText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(collectText).join(' ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [record.raw, record.effectText, record.text, record.abilities]
      .map(collectText)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function abilityHaystack(ability: OracleIRAbility): string {
  return [ability.effectText, (ability as { text?: string }).text, ...(ability.steps || [])]
    .map(collectText)
    .join(' ');
}

function hasKind(steps: readonly OracleEffectStep[], kind: string): boolean {
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if ((node as { kind?: string }).kind === kind) return true;
    if (Array.isArray(node)) return node.some(walk);
    return Object.values(node).some(walk);
  };
  return walk(steps);
}

function pruneConniveReminderSteps(ability: OracleIRAbility): OracleIRAbility {
  const steps = ability.steps || [];
  if (!steps.some((step) => step.kind === 'connive')) return ability;
  const next = steps.filter((step) => {
    if (step.kind !== 'draw' && step.kind !== 'discard' && step.kind !== 'add_counter') return true;
    const raw = String((step as { raw?: string }).raw || '').trim();
    return !/^\(?draw a card\b/i.test(raw) && !/^then discard a card/i.test(raw) && !/this creature\.?\)$/i.test(raw);
  });
  return next.length === steps.length ? ability : { ...ability, steps: next };
}

function ensureEnchantedCreaturePtGrant(ability: OracleIRAbility): OracleIRAbility {
  const match = abilityHaystack(ability).replace(/\([^)]*\)/g, ' ').match(/enchanted creature gets ([+-]\d+)\/([+-]\d+)/i);
  if (!match) return ability;
  const power = Number(match[1]) || 0;
  const toughness = Number(match[2]) || 0;
  const already = (ability.steps || []).some(
    (step) =>
      step.kind === 'grant_static_ability' &&
      (step as { power?: number }).power === power &&
      (step as { toughness?: number }).toughness === toughness,
  );
  if (already) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'grant_static_ability',
        target: { kind: 'raw', text: 'Enchanted creature' },
        power,
        toughness,
        duration: 'static',
        raw: `Enchanted creature gets ${match[1]}/${match[2]}`,
      } as OracleEffectStep,
    ],
  };
}

function ensureIfYouDoDraw(ability: OracleIRAbility): OracleIRAbility {
  if (!/if you do,\s*draw a card/i.test(abilityHaystack(ability))) return ability;
  if (hasKind(ability.steps || [], 'draw')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'If you do, draw a card',
      } as OracleEffectStep,
    ],
  };
}

function ensureWouldDrawReplacement(ability: OracleIRAbility): OracleIRAbility {
  const match = abilityHaystack(ability).match(/if you would draw a card,\s*draw (.+?) instead/i);
  if (!match || hasKind(ability.steps || [], 'draw')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: /two/i.test(String(match[1] || '')) ? { kind: 'number', value: 2 } : { kind: 'unknown', raw: String(match[1] || '').trim() },
        replacementOf: 'draw_card',
        raw: `If you would draw a card, draw ${String(match[1] || '').trim()} instead`,
      } as OracleEffectStep,
    ],
  };
}

function ensurePreventDamageRemoveCounter(ability: OracleIRAbility): OracleIRAbility {
  const match = abilityHaystack(ability).match(
    /if damage would be dealt to .+? while it has (?:a|an) (.+?) counters? on it, prevent that damage and remove (?:a|an) (.+?) counters? from (.+)/i,
  );
  if (!match) return ability;
  if (hasKind(ability.steps || [], 'prevent_damage')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
      } as OracleEffectStep,
      {
        kind: 'remove_counter',
        counter: String(match[2] || match[1] || '').trim(),
        amount: { kind: 'number', value: 1 },
        target: { kind: 'raw', text: String(match[3] || '').trim() },
        raw: `remove a ${String(match[2] || match[1] || '').trim()} counter from ${String(match[3] || '').trim()}`,
      } as OracleEffectStep,
    ],
  };
}

function ensureKickedXCounters(ability: OracleIRAbility): OracleIRAbility {
  const match = abilityHaystack(ability).match(/if it was kicked,\s*put x (\w+) counters on (it|this permanent|this creature)/i);
  if (!match || hasKind(ability.steps || [], 'add_counter')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'add_counter',
        amount: { kind: 'x' },
        counter: String(match[1] || '').trim(),
        target: { kind: 'raw', text: String(match[2] || 'it').trim() },
        raw: `put X ${String(match[1] || '').trim()} counters on ${String(match[2] || 'it').trim()}`,
      } as OracleEffectStep,
    ],
  };
}

function inheritTrailingVerbWho(ability: OracleIRAbility): OracleIRAbility {
  const steps = [...(ability.steps || [])];
  let changed = false;
  for (let i = 1; i < steps.length; i += 1) {
    const prev = steps[i - 1] as { kind?: string; who?: OraclePlayerSelector; raw?: string };
    const current = steps[i] as { kind?: string; who?: OraclePlayerSelector; raw?: string };
    const prevWho = prev.who;
    if (!prevWho || current.who?.kind !== 'you') continue;
    const raw = String(current.raw || '');
    const canInherit =
      (current.kind === 'draw' && /^draws? a card$/i.test(raw) && prev.kind === 'lose_life') ||
      (current.kind === 'lose_life' && /^loses? \d+ life$/i.test(raw) && (prev.kind === 'sacrifice' || prev.kind === 'discard' || prev.kind === 'mill'));
    if (!canInherit) continue;
    steps[i] = { ...current, who: prevWho } as OracleEffectStep;
    changed = true;
  }
  return changed ? { ...ability, steps } : ability;
}

function splitCompoundMillDrawLose(ability: OracleIRAbility): OracleIRAbility {
  const steps = (ability.steps || []).flatMap((step) => {
    if (step.kind !== 'mill') return [step];
    const amountRaw = String((step as { amount?: { kind?: string; raw?: string } }).amount?.raw || '');
    const match = amountRaw.match(/^(\w+) cards,\s*draws? (\w+) cards,\s*and loses (\d+)/i);
    if (!match) return [step];
    const who = (step as { who?: OraclePlayerSelector }).who || { kind: 'target_player' as const };
    return [
      { ...step, amount: { kind: 'number' as const, value: /two/i.test(match[1] || '') ? 2 : 1 } },
      {
        kind: 'draw',
        who,
        amount: { kind: 'number' as const, value: /two/i.test(match[2] || '') ? 2 : 1 },
        raw: `${who.kind} draws ${match[2]} cards`,
      } as OracleEffectStep,
      {
        kind: 'lose_life',
        who,
        amount: { kind: 'number' as const, value: Number(match[3] || 1) },
        raw: `${who.kind} loses ${match[3]} life`,
      } as OracleEffectStep,
    ];
  });
  return steps === ability.steps ? ability : { ...ability, steps };
}

function foldLookRevealAmongThem(ability: OracleIRAbility): OracleIRAbility {
  if (hasKind(ability.steps || [], 'look_choose_from_top')) return ability;
  if (!hasKind(ability.steps || [], 'look_top') || !hasKind(ability.steps || [], 'put_on_bottom')) return ability;
  const reveal = abilityHaystack(ability).match(/reveal (?:a|an) (.+?) from among them and put it into your hand/i);
  if (!reveal) return ability;
  const lookChoose: OracleEffectStep = {
    kind: 'look_choose_from_top',
    who: { kind: 'you' },
    amount: { kind: 'number', value: 2 },
    selectorText: String(reveal[1] || 'permanent').replace(/\s+card$/i, ''),
    destination: 'hand',
    reveal: true,
    restOrder: 'any',
    optional: true,
    raw: abilityHaystack(ability),
  } as OracleEffectStep;
  const steps = mapNestedSteps(ability.steps || [], (step) => {
    if (step.kind === 'look_top') return lookChoose;
    if (step.kind === 'put_on_bottom') return [];
    if (
      step.kind === 'grant_static_ability' &&
      /reveal .+ from among them and put it into your hand/i.test(collectText((step as { effectText?: unknown }).effectText))
    ) {
      return [];
    }
    return step;
  });
  return { ...ability, steps };
}

function isBareSpendThisManaReminder(text: string): boolean {
  return /^spend this mana only to cast spells?\.?$/i.test(String(text || '').trim());
}

function ensureSpendOnlyManaOnX(ability: OracleIRAbility): OracleIRAbility {
  const haystack = abilityHaystack(ability);
  if (isBareSpendThisManaReminder(haystack)) return ability;
  const match =
    haystack.match(/^spend only (\w+) mana on x\.?$/i) ||
    haystack.match(/^(spend this mana only\b.+)$/i);
  if (!match) return ability;
  if (hasKind(ability.steps || [], 'grant_static_ability')) return ability;
  const raw = String(match[0] || '').trim();
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'grant_static_ability',
        target: { kind: 'raw', text: 'this spell' },
        effectText: [raw],
        duration: 'static',
        raw,
      } as OracleEffectStep,
    ],
  };
}

function ensureTicketCounter(ability: OracleIRAbility): OracleIRAbility {
  if (!/\{tk\}|ticket counter/i.test(abilityHaystack(ability))) return ability;
  if (hasKind(ability.steps || [], 'add_player_counter')) return ability;
  const withoutGrant = mapNestedSteps(ability.steps || [], (step) => {
    if (step.kind === 'grant_static_ability' && /\{tk\}|ticket counter/i.test(collectText((step as { effectText?: unknown }).effectText))) {
      return [];
    }
    return step;
  });
  return {
    ...ability,
    steps: [
      ...withoutGrant,
      {
        kind: 'add_player_counter',
        who: { kind: 'you' },
        counter: 'ticket',
        amount: { kind: 'number', value: 1 },
        raw: 'You get {TK} (a ticket counter).',
      } as OracleEffectStep,
    ],
  };
}

function ensureLeadingUntilEotPumpAndKeyword(ability: OracleIRAbility): OracleIRAbility {
  const match = abilityHaystack(ability).match(
    /until end of turn,\s*(target creature)\s+gets ([+-]\d+)\/([+-]\d+) for each (.+?) and gains (\w+)\.?$/i,
  );
  if (!match) return ability;
  if (hasKind(ability.steps || [], 'modify_pt')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'modify_pt',
        target: { kind: 'raw', text: String(match[1] || '').trim() },
        power: Number(match[2]),
        toughness: Number(match[3]),
        duration: 'end_of_turn',
        scaler: { kind: 'reference_scaler', raw: `for each ${String(match[4] || '').trim()}` },
        raw: `${String(match[1] || '').trim()} gets ${match[2]}/${match[3]} for each ${String(match[4] || '').trim()}`,
      } as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: { kind: 'raw', text: String(match[1] || '').trim() },
        abilities: [String(match[5] || '').trim().toLowerCase()],
        duration: 'end_of_turn',
        raw: `gains ${String(match[5] || '').trim()}`,
      } as OracleEffectStep,
    ],
  };
}

function mapNestedSteps(
  steps: readonly OracleEffectStep[],
  fn: (step: OracleEffectStep) => OracleEffectStep | OracleEffectStep[],
): OracleEffectStep[] {
  return steps.flatMap((step) => {
    const mapped = fn(step);
    const list = Array.isArray(mapped) ? mapped : [mapped];
    return list.map((item) => {
      const inner = (item as { steps?: OracleEffectStep[] }).steps;
      if (!Array.isArray(inner)) return item;
      return { ...item, steps: mapNestedSteps(inner, fn) };
    });
  });
}

function splitDrawAndLoseFromGrant(ability: OracleIRAbility): OracleIRAbility {
  const steps = mapNestedSteps(ability.steps || [], (step) => {
    if (step.kind !== 'grant_static_ability') return step;
    const text = collectText((step as { effectText?: unknown }).effectText);
    if (!/^(?:then\s+)?you draw a card and you lose (\d+) life$/i.test(text)) return step;
    const life = Number((text.match(/lose (\d+) life/i) || [])[1] || 1);
    return [
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'you draw a card',
      } as OracleEffectStep,
      {
        kind: 'lose_life',
        who: { kind: 'you' },
        amount: { kind: 'number', value: life },
        raw: `you lose ${life} life`,
      } as OracleEffectStep,
    ];
  });
  return { ...ability, steps };
}

function splitSacrificeDiscardLose(ability: OracleIRAbility): OracleIRAbility {
  const steps = (ability.steps || []).flatMap((step) => {
    if (step.kind !== 'sacrifice') return [step];
    const raw = String((step as { raw?: string }).raw || '');
    if (!/discards? a card/i.test(raw)) return [step];
    const who = (step as { who?: OraclePlayerSelector }).who || { kind: 'target_opponent' as const };
    const cleaned = raw.replace(/,?\s*discards? a card,?/i, '').trim();
    const existingWhat = String((step as { what?: { text?: string } }).what?.text || '');
    const cleanedWhat = existingWhat.replace(/,?\s*discards?.+$/i, '').trim() || 'a creature of their choice';
    return [
      {
        ...step,
        what: { kind: 'raw' as const, text: cleanedWhat },
        raw: cleaned.replace(/,?\s*and loses.+$/i, '').trim() || raw,
      },
      {
        kind: 'discard',
        who,
        amount: { kind: 'number', value: 1 },
        raw: 'discards a card',
      } as OracleEffectStep,
    ];
  });
  return steps === ability.steps ? ability : { ...ability, steps };
}

function fillSacrificeWhat(ability: OracleIRAbility): OracleIRAbility {
  const steps = (ability.steps || []).map((step) => {
    if (step.kind !== 'sacrifice') return step;
    const existingWhat = String((step as { what?: { text?: string } }).what?.text || '');
    if (existingWhat && !/,?\s*discards/i.test(existingWhat)) return step;
    const raw = String((step as { raw?: string }).raw || '');
    const match = raw.match(/sacrifices? (.+?)(?:\s*,\s*discards|\s+and\s+loses|\s*$)/i);
    if (!match) return step;
    return { ...step, what: { kind: 'raw' as const, text: String(match[1] || '').trim() } };
  });
  return steps === ability.steps ? ability : { ...ability, steps };
}

function stampThenSequence(ability: OracleIRAbility): OracleIRAbility {
  if (!/^then\b/i.test(String(ability.effectText || (ability as { text?: string }).text || '').trim())) {
    return ability;
  }
  const steps = (ability.steps || []).map((step) => {
    if ((step as { sequence?: string }).sequence) return step;
    if (step.kind !== 'lose_life' && step.kind !== 'gain_life') return step;
    return { ...step, sequence: 'then' as const };
  });
  return steps === ability.steps ? ability : { ...ability, steps };
}

function lowerEmblemAbilitySteps(ability: OracleIRAbility): OracleIRAbility {
  const steps = (ability.steps || []).map((step) => {
    if (step.kind !== 'create_emblem') return step;
    const existing = (step as unknown as { steps?: OracleEffectStep[] }).steps;
    if (existing && existing.length > 0) return step;
    const texts = ((step as { abilities?: readonly string[] }).abilities || []).join(' ');
    const nested: OracleEffectStep[] = [];
    const damage = texts.match(/deals (\d+) damage to any target/i);
    if (damage) {
      nested.push({
        kind: 'deal_damage',
        amount: { kind: 'number', value: Number(damage[1] || 1) },
        target: { kind: 'raw', text: 'any target' },
        raw: String(damage[0] || ''),
      } as OracleEffectStep);
    }
    if (/\bdraws? a card\b/i.test(texts)) {
      nested.push({
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'You draw a card',
      } as OracleEffectStep);
    }
    if (nested.length === 0) return step;
    return { ...step, steps: nested };
  });
  return steps === ability.steps ? ability : { ...ability, steps };
}

function trimPumpScaler(ability: OracleIRAbility): OracleIRAbility {
  const steps = mapNestedSteps(ability.steps || [], (step) => {
    if (step.kind !== 'modify_pt') return step;
    const scaler = (step as { scaler?: { kind?: string; raw?: string } }).scaler;
    if (scaler?.kind !== 'reference_scaler') return step;
    const trimmed = String(scaler.raw || '').match(/^(for each .+?)(?:\s+and gains\b|$)/i);
    if (!trimmed || trimmed[1] === scaler.raw) return step;
    return { ...step, scaler: { kind: 'reference_scaler', raw: String(trimmed[1] || '').trim() } };
  });
  return { ...ability, steps };
}

function splitEachOpponentCompoundGrant(ability: OracleIRAbility): OracleIRAbility {
  const steps = mapNestedSteps(ability.steps || [], (step) => {
    if (step.kind !== 'grant_static_ability') return step;
    const text = collectText((step as { effectText?: unknown }).effectText);
    const match = text.match(/^each opponent discards (?:a|an|\d+) cards?,\s*loses (\d+) life,\s*and exiles the top/i);
    if (!match) return step;
    return [
      {
        kind: 'discard',
        who: { kind: 'each_opponent' },
        amount: { kind: 'number', value: 1 },
        raw: 'each opponent discards a card',
      } as OracleEffectStep,
      {
        kind: 'lose_life',
        who: { kind: 'each_opponent' },
        amount: { kind: 'number', value: Number(match[1] || 2) },
        raw: `each opponent loses ${match[1]} life`,
      } as OracleEffectStep,
    ];
  });
  return { ...ability, steps };
}

function ensureEntersWithXCounters(ability: OracleIRAbility): OracleIRAbility {
  const match = abilityHaystack(ability).match(
    /enters with x \+1\/\+1 counters on (?:him|her|it|this permanent|this creature)/i,
  );
  if (!match || hasKind(ability.steps || [], 'add_counter')) return ability;
  return {
    ...ability,
    steps: [
      ...(ability.steps || []),
      {
        kind: 'add_counter',
        amount: { kind: 'x' },
        counter: '+1/+1',
        target: { kind: 'raw', text: 'this permanent' },
        raw: 'enters with X +1/+1 counters',
      } as OracleEffectStep,
    ],
  };
}

function recoverFromSourceText(
  abilities: readonly OracleIRAbility[],
  sourceText: string | undefined,
): OracleIRAbility[] {
  if (!sourceText) return [...abilities];
  const haystack = [sourceText, ...abilities.map(abilityHaystack)].join(' ');
  const extra: OracleIRAbility[] = [];
  const hasStep = (kind: string, pred?: (step: any) => boolean): boolean =>
    abilities.some((ability) => {
      const walk = (node: unknown): boolean => {
        if (!node || typeof node !== 'object') return false;
        const record = node as { kind?: string };
        if (record.kind === kind && (!pred || pred(record))) return true;
        return Object.values(node).some(walk);
      };
      return walk(ability.steps || []);
    });

  const equipped = sourceText.match(/equipped creature gets ([+-]\d+)\/([+-]\d+) for each (.+?)(?:\.|$)/i);
  if (equipped && !hasStep('grant_static_ability', (step) => /gets [+-]/i.test(collectText(step.effectText)))) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: String(equipped[0] || ''),
      effectText: String(equipped[0] || ''),
      steps: [
        {
          kind: 'grant_static_ability',
          target: { kind: 'raw', text: 'Equipped creature' },
          effectText: [`gets ${equipped[1]}/${equipped[2]} for each ${String(equipped[3] || '').trim()}`],
          duration: 'static',
          raw: String(equipped[0] || ''),
        } as OracleEffectStep,
      ],
    });
  }

  const restriction = sourceText.match(
    /^activated abilities of .+ cost .+ less to activate\.?$/i,
  );
  if (restriction && !hasStep('grant_static_ability')) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: String(restriction[0] || ''),
      effectText: String(restriction[0] || ''),
      steps: [
        {
          kind: 'grant_static_ability',
          target: { kind: 'raw', text: 'this permanent' },
          effectText: [String(restriction[0] || '').trim()],
          duration: 'static',
          raw: String(restriction[0] || ''),
        } as OracleEffectStep,
      ],
    });
  }

  const enchanted = sourceText.match(/enchanted creature gets ([+-]\d+)\/([+-]\d+)/i);
  if (enchanted && !hasStep('grant_static_ability', (step) => step.power === Number(enchanted[1]))) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: `Enchanted creature gets ${enchanted[1]}/${enchanted[2]}.`,
      effectText: `Enchanted creature gets ${enchanted[1]}/${enchanted[2]}.`,
      steps: [
        {
          kind: 'grant_static_ability',
          target: { kind: 'raw', text: 'Enchanted creature' },
          power: Number(enchanted[1]) || 0,
          toughness: Number(enchanted[2]) || 0,
          duration: 'static',
          raw: `Enchanted creature gets ${enchanted[1]}/${enchanted[2]}`,
        } as OracleEffectStep,
      ],
    });
  }

  const sourceIsShort = sourceText.replace(/\s+/g, ' ').trim().length <= 180;
  const wouldDraw = sourceText.match(/if you would draw a card,\s*draw (.+?) instead/i);
  if (sourceIsShort && wouldDraw && !hasStep('draw', (step) => step.replacementOf === 'draw_card' || step.amount?.value === 2)) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: String(wouldDraw[0] || ''),
      effectText: String(wouldDraw[0] || ''),
      steps: [
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: /two/i.test(String(wouldDraw[1] || '')) ? { kind: 'number', value: 2 } : { kind: 'unknown', raw: String(wouldDraw[1] || '').trim() },
          replacementOf: 'draw_card',
          raw: String(wouldDraw[0] || ''),
        } as OracleEffectStep,
      ],
    });
  }

  const prevent = sourceText.match(
    /if damage would be dealt to .+? while it has (?:a|an) (.+?) counters? on it, prevent that damage and remove (?:a|an) (.+?) counters? from (.+)/i,
  );
  if (sourceIsShort && prevent && !hasStep('prevent_damage')) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: String(prevent[0] || ''),
      effectText: String(prevent[0] || ''),
      steps: [
        {
          kind: 'prevent_damage',
          amount: 'all',
          duration: 'this_turn',
          raw: 'prevent that damage',
        } as OracleEffectStep,
        {
          kind: 'remove_counter',
          counter: String(prevent[2] || prevent[1] || '').trim(),
          amount: { kind: 'number', value: 1 },
          target: { kind: 'raw', text: String(prevent[3] || '').trim() },
          raw: `remove a ${String(prevent[2] || prevent[1] || '').trim()} counter`,
        } as OracleEffectStep,
      ],
    });
  }

  const spendOnly = sourceText.match(/^(?:spend only \w+ mana on x|spend this mana only\b.+)\.?$/i);
  if (spendOnly && !isBareSpendThisManaReminder(sourceText) && !hasStep('grant_static_ability', (step) => /spend (?:only|this mana only)/i.test(String(step.raw || '')))) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: String(spendOnly[0] || ''),
      effectText: String(spendOnly[0] || ''),
      steps: [
        {
          kind: 'grant_static_ability',
          target: { kind: 'raw', text: 'this spell' },
          effectText: [String(spendOnly[0] || '').trim()],
          duration: 'static',
          raw: String(spendOnly[0] || ''),
        } as OracleEffectStep,
      ],
    });
  }

  const entersX = sourceText.match(/enters with x \+1\/\+1 counters on (?:him|her|it|this permanent|this creature)/i);
  if (entersX && !hasStep('add_counter')) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: String(entersX[0] || ''),
      effectText: String(entersX[0] || ''),
      steps: [
        {
          kind: 'add_counter',
          amount: { kind: 'x' },
          counter: '+1/+1',
          target: { kind: 'raw', text: 'this permanent' },
          raw: 'enters with X +1/+1 counters',
        } as OracleEffectStep,
      ],
    });
  }

  if (sourceIsShort && /\{tk\}|ticket counter/i.test(sourceText) && !hasStep('add_player_counter')) {
    extra.push({
      type: 'static' as OracleIRAbility['type'],
      text: 'You get {TK} (a ticket counter).',
      effectText: 'You get {TK} (a ticket counter).',
      steps: [
        {
          kind: 'add_player_counter',
          who: { kind: 'you' },
          counter: 'ticket',
          amount: { kind: 'number', value: 1 },
          raw: 'You get {TK} (a ticket counter).',
        } as OracleEffectStep,
      ],
    });
  }

  void haystack;
  return extra.length === 0 ? [...abilities] : [...abilities, ...extra];
}

export function repairCurrentBatchSurfaceSteps(
  abilities: readonly OracleIRAbility[],
  sourceText?: string,
): OracleIRAbility[] {
  const repaired = abilities.map((ability) => {
    let next = pruneConniveReminderSteps(ability);
    next = ensureEnchantedCreaturePtGrant(next);
    next = ensureIfYouDoDraw(next);
    next = ensureWouldDrawReplacement(next);
    next = ensurePreventDamageRemoveCounter(next);
    next = ensureKickedXCounters(next);
    next = ensureEntersWithXCounters(next);
    next = splitCompoundMillDrawLose(next);
    next = foldLookRevealAmongThem(next);
    next = ensureSpendOnlyManaOnX(next);
    next = ensureTicketCounter(next);
    next = ensureLeadingUntilEotPumpAndKeyword(next);
    next = trimPumpScaler(next);
    next = splitDrawAndLoseFromGrant(next);
    next = splitEachOpponentCompoundGrant(next);
    next = splitSacrificeDiscardLose(next);
    next = fillSacrificeWhat(next);
    next = inheritTrailingVerbWho(next);
    next = stampThenSequence(next);
    next = lowerEmblemAbilitySteps(next);
    return next;
  });
  const sourceWithoutReminders = String(sourceText || '').replace(/\([^)]*\)/g, ' ');
  const recovered = recoverFromSourceText(repaired, sourceWithoutReminders);
  return pruneStandaloneKeywordReminderAbilities(recovered, sourceText);
}

function pruneStandaloneKeywordReminderAbilities(
  abilities: readonly OracleIRAbility[],
  sourceText?: string,
): OracleIRAbility[] {
  const source = String(sourceText || '')
    .replace(/\s+/g, ' ')
    .replace(/^\(|\)$/g, '')
    .trim();
  const sourceIsIsolatedReminder =
    /^if you discard a card with madness, discard it into exile\.?$/i.test(source)
    || /^you may cast this card from your graveyard for its (?:flashback|escape|retrace|jump-start|harmonize) cost(?: this turn)?(?:\. then exile it)?\.?$/i.test(source)
    || /^then exile it\.?$/i.test(source)
    || /^spend this mana only to cast (?:an? )?(?:creature )?spells?\.?$/i.test(source);
  if (!sourceIsIsolatedReminder) return [...abilities];
  return abilities.filter((ability) => {
    const text = String(ability.effectText || ability.text || '')
      .replace(/\s+/g, ' ')
      .replace(/^\(|\)$/g, '')
      .trim();
    return !(
      /^if you discard a card with madness, discard it into exile\.?$/i.test(text)
      || /^you may cast this card from your graveyard for its (?:flashback|escape|retrace|jump-start|harmonize) cost(?: this turn)?(?:\. then exile it)?\.?$/i.test(text)
      || /^\(you may cast this card from your graveyard for its flashback cost\. then exile it\.?\)$/i.test(text)
      || /^then exile it\.?$/i.test(text)
      || /^spend this mana only to cast (?:an? )?creature spells?\.?$/i.test(text)
      || /^spend this mana only to cast spells?\.?$/i.test(text)
    );
  });
}
