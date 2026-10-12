import { describe, expect, it } from 'vitest';
import { getClassLevelView } from '../src/components/ClassLevelBadge';

describe('Class level view for battlefield badge / preview', () => {
  const full = 'Tokens get +1/+0.\n{W}: Level 2\nDraw on token ETB.\n{3}{W}: Level 3\nCreature tokens you control get +2/+2.';
  it('shows current level and dims inactive sections', () => {
    const view = getClassLevelView({ classFullOracleText: full, classLevel: 1, oracle_text: 'Tokens get +1/+0.\n{W}: Level 2' });
    expect(view).toMatchObject({ level: 1, maxLevel: 3 });
    expect(view!.sections.map((s) => s.active)).toEqual([true, false, false]);
    expect(getClassLevelView({ classFullOracleText: full }, 3)!.sections.every((s) => s.active)).toBe(true);
  });
  it('non-Class cards have no view', () => {
    expect(getClassLevelView({ oracle_text: 'Flying' })).toBeNull();
  });
});
