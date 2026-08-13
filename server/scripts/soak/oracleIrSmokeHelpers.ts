/*
  Pure helpers for Oracle IR smoke / soak suites.
  Keep this module free of server/game imports so unit tests stay fast.
*/

export type SmokeCheck = {
  id: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
  note?: string;
};

export type SmokeCardResult = {
  name: string;
  found: boolean;
  typeLine?: string;
  oraclePreview?: string;
  abilityTypes: string[];
  spellStepKinds: string[];
  allStepKinds: string[];
  checks: SmokeCheck[];
  telemetryEvents: Array<{ kind: string; label: string }>;
  pass: boolean;
};

export type SmokeSoakResult = {
  id: string;
  session: string;
  title: string;
  cards: SmokeCardResult[];
  pass: boolean;
  passedChecks: number;
  failedChecks: number;
};

export type LiveSoakSetup = 'main' | 'combat' | 'vote_board';

export type LiveSoakConfig = {
  playerCount: number;
  setup: LiveSoakSetup;
  expectAnyQueue?: string[];
  expectPBudget?: number;
  perCard?: Record<string, { expectAnyQueue?: string[]; expectPBudget?: number }>;
};

export type SmokeCliArgs = {
  suite?: string;
  url: string;
  outDir?: string;
  list: boolean;
  help: boolean;
  live: boolean;
};

export function check(id: string, expected: unknown, actual: unknown, pass: boolean, note?: string): SmokeCheck {
  return { id, expected, actual, pass, ...(note ? { note } : {}) };
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}

export function kindsOf(steps: readonly any[] | undefined): string[] {
  return (steps || []).map((step) => String(step?.kind || 'unknown'));
}

export function walkSteps(steps: readonly any[] | undefined, visit: (step: any) => void): void {
  for (const step of steps || []) {
    visit(step);
    if (Array.isArray(step?.modes)) {
      for (const mode of step.modes) walkSteps(mode?.steps, visit);
    }
    if (Array.isArray(step?.thenSteps)) walkSteps(step.thenSteps, visit);
    if (Array.isArray(step?.elseSteps)) walkSteps(step.elseSteps, visit);
    if (Array.isArray(step?.steps)) walkSteps(step.steps, visit);
  }
}

export function hasKind(steps: readonly any[] | undefined, kind: string): boolean {
  let found = false;
  walkSteps(steps, (step) => {
    if (String(step?.kind) === kind) found = true;
  });
  return found;
}

export function unknownRaws(steps: readonly any[] | undefined): string[] {
  const raws: string[] = [];
  walkSteps(steps, (step) => {
    if (String(step?.kind) === 'unknown') raws.push(String(step?.raw || '').slice(0, 120));
  });
  return raws;
}

export function findStep(steps: readonly any[] | undefined, kind: string): any | undefined {
  let found: any;
  walkSteps(steps, (step) => {
    if (!found && String(step?.kind) === kind) found = step;
  });
  return found;
}

export function hasVoteTail(steps: readonly any[] | undefined): boolean {
  return kindsOf(steps).some((kind) => kind !== 'vote' && kind !== 'grant_static_ability');
}

export function scopedOmitsOtherEffects(scoped: string, selectedEffect: string, otherEffects: readonly string[]): boolean {
  const lines = scoped
    .split(/\n+/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  const selected = selectedEffect.trim().toLowerCase();
  if (!lines.some((line) => line === selected || line.includes(selected))) return false;
  return otherEffects.every((effect) => {
    const other = effect.trim().toLowerCase();
    if (!other || other === selected) return true;
    return !lines.includes(other);
  });
}

export function finishSoak(id: string, session: string, title: string, cards: SmokeCardResult[]): SmokeSoakResult {
  const passedChecks = cards.reduce((sum, card) => sum + card.checks.filter((entry) => entry.pass).length, 0);
  const failedChecks = cards.reduce((sum, card) => sum + card.checks.filter((entry) => !entry.pass).length, 0);
  return {
    id,
    session,
    title,
    cards,
    pass: cards.every((card) => card.pass),
    passedChecks,
    failedChecks,
  };
}

export function finishCard(result: SmokeCardResult): SmokeCardResult {
  result.pass = result.found && result.checks.every((entry) => entry.pass);
  return result;
}

export function defaultTelemetryUrl(): string {
  return `http://127.0.0.1:${process.env.PORT || 3001}/api/oracle-ir/telemetry`;
}

export function liveSoakBaseUrl(telemetryUrl: string): string {
  try {
    const parsed = new URL(telemetryUrl);
    return parsed.origin;
  } catch {
    return `http://127.0.0.1:${process.env.PORT || 3001}`;
  }
}

export function parseSmokeArgs(argv: readonly string[], defaults?: { suite?: string; url?: string }): SmokeCliArgs {
  const parsed: SmokeCliArgs = {
    suite: defaults?.suite,
    url: defaults?.url || defaultTelemetryUrl(),
    list: false,
    help: false,
    live: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--list') parsed.list = true;
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--live') parsed.live = true;
    else if (arg === '--suite' && argv[i + 1]) parsed.suite = argv[++i];
    else if (arg === '--url' && argv[i + 1]) parsed.url = argv[++i];
    else if (arg === '--out' && argv[i + 1]) parsed.outDir = argv[++i];
  }

  return parsed;
}

export function summarizeSoaks(soaks: readonly SmokeSoakResult[]): {
  soaksPassed: number;
  soaksTotal: number;
  cardsPassed: number;
  cardsTotal: number;
  checksPassed: number;
  checksFailed: number;
} {
  return {
    soaksPassed: soaks.filter((soak) => soak.pass).length,
    soaksTotal: soaks.length,
    cardsPassed: soaks.reduce((sum, soak) => sum + soak.cards.filter((card) => card.pass).length, 0),
    cardsTotal: soaks.reduce((sum, soak) => sum + soak.cards.length, 0),
    checksPassed: soaks.reduce((sum, soak) => sum + soak.passedChecks, 0),
    checksFailed: soaks.reduce((sum, soak) => sum + soak.failedChecks, 0),
  };
}
