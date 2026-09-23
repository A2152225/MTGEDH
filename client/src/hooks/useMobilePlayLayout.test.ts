import { describe, expect, it } from 'vitest';
import { getMobilePlayLayoutProfile } from './useMobilePlayLayout';
import { getViewportOrientation } from './useViewport';

describe('getViewportOrientation', () => {
  it('returns portrait when height exceeds width', () => {
    expect(getViewportOrientation(390, 844)).toBe('portrait');
  });

  it('returns landscape when width exceeds height', () => {
    expect(getViewportOrientation(844, 390)).toBe('landscape');
  });
});

describe('getMobilePlayLayoutProfile', () => {
  it('uses desktop sizing on non-touch viewports', () => {
    const profile = getMobilePlayLayoutProfile(false, 390, 844);
    expect(profile.mode).toBe('desktop');
    expect(profile.battlefieldTileWidth).toBe(135);
    expect(profile.showMobileChrome).toBe(false);
  });

  it('uses compact portrait sizing on touch phones', () => {
    const profile = getMobilePlayLayoutProfile(true, 390, 844);
    expect(profile.mode).toBe('mobile-portrait');
    expect(profile.battlefieldViewportRows).toBe(2);
    expect(profile.battlefieldGridCols).toBe(4);
    expect(profile.showMobileChrome).toBe(true);
    expect(profile.playAreaBottomInset).toBeGreaterThanOrEqual(168);
    expect(profile.handStripThumbWidth).toBeGreaterThanOrEqual(76);
  });

  it('uses wider landscape sizing on touch phones', () => {
    const profile = getMobilePlayLayoutProfile(true, 844, 390);
    expect(profile.mode).toBe('mobile-landscape');
    expect(profile.battlefieldViewportRows).toBe(3);
    expect(profile.battlefieldGridCols).toBe(6);
    expect(profile.showMobileChrome).toBe(true);
  });

  it('hides mobile chrome in landscape when width allows utility rail', () => {
    const profile = getMobilePlayLayoutProfile(true, 920, 412);
    expect(profile.mode).toBe('mobile-landscape');
    expect(profile.showMobileChrome).toBe(false);
    expect(profile.isMobilePlay).toBe(true);
  });
});
