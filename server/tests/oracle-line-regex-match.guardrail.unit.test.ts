import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

function readServerSource(relativePath: string): string {
  return fs.readFileSync(path.join(serverRoot, relativePath), 'utf8');
}

describe('oracle line regex match guardrails', () => {
  it('combat generic attack/block detection uses globalized line matching', () => {
    const source = readServerSource('src/state/modules/triggers/combat.ts');
    expect(source).toContain('findRegexMatchAcrossOracleLines');
    expect(source).not.toMatch(
      /for \(const line of getOracleLines\([\s\S]{0,400}?timingTriggerEffect\(/,
    );
  });

  it('triggered-abilities generic attack/block detection uses shared globalized helpers', () => {
    const source = readServerSource('src/state/modules/triggered-abilities.ts');
    expect(source).toContain('findFirstRegexMatchAcrossOracleLines');
    expect(source).not.toMatch(
      /globalMatch\.index = lineStart \+ match\.index/,
    );
    expect(source).not.toMatch(
      /for \(const line of oracleLines\)[\s\S]{0,500}?if \(match\) return match;/,
    );
  });

  it('timing effect extraction re-exports oracle line regex helpers', () => {
    const source = readServerSource('src/state/modules/triggers/timing-effect-extraction.ts');
    expect(source).toContain('findFirstRegexMatchAcrossOracleLines');
    expect(source).toContain('resolveGlobalTimingMatchIndex');
  });

  it('trigger effect extraction repairs line-local match indices', () => {
    const source = fs.readFileSync(
      path.resolve(serverRoot, '..', 'rules-engine', 'src', 'triggerEffectTextExtraction.ts'),
      'utf8',
    );
    expect(source).toContain('resolveGlobalTimingMatchIndex');
  });
});
