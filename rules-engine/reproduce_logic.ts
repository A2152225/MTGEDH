function normalizeOracleText(text: string): string {
    return String(text || '')
      .replace(/Ã¢â‚¬â„¢/g, "'")
      .replace(/Ã¢â‚¬â€|Ã¢â‚¬â€œ/g, '-')
      .replace(/[\u2019]/g, "'")
      .replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .trim();
}

function reproduceLogic(raw: string) {
    const normalized = normalizeOracleText(raw)
      .replace(/^[()\s]+/, '')
      .replace(/[.)\s]+$/g, '')
      .trim();

    const re1 = /^choose any number of permanents and\/or players$/i;
    const re2 = /^to proliferate, choose any number of permanents and\/or players$/i;
    const re3 = /^(?:then\s+)?give each another counter of each kind already there(?:\. then do it again)?$/i;

    console.log(`Raw: "${raw}"`);
    console.log(`Normalized: "${normalized}"`);
    console.log(`RE1: ${re1.test(normalized)}`);
    console.log(`RE2: ${re2.test(normalized)}`);
    console.log(`RE3: ${re3.test(normalized)}`);
    console.log('---');
}

const inputs = [
    "(Choose any number of permanents and/or players",
    "then give each another counter of each kind already there.)"
];

inputs.forEach(reproduceLogic);
