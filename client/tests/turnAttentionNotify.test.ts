import { describe, expect, it } from 'vitest';

import { isPageUnfocused, YOUR_TURN_ALERT_TITLE } from '../src/utils/turnAttentionNotify';

describe('isPageUnfocused', () => {
  it('is focused when the document is visible and hasFocus', () => {
    expect(isPageUnfocused({ hidden: false, focused: true })).toBe(false);
  });

  it('is unfocused when the tab is hidden', () => {
    expect(isPageUnfocused({ hidden: true, focused: true })).toBe(true);
  });

  it('is unfocused when another window has focus', () => {
    expect(isPageUnfocused({ hidden: false, focused: false })).toBe(true);
  });
});

describe('YOUR_TURN_ALERT_TITLE', () => {
  it('names the tab flash so it is visible in the title bar', () => {
    expect(YOUR_TURN_ALERT_TITLE).toContain('Your turn');
  });
});
