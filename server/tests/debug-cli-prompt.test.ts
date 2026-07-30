import { afterEach, describe, expect, it, vi } from 'vitest';

describe('interactive CLI debug logging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.DEBUG_STATE;
  });

  it('clears the prompt before a log and redraws it afterward', async () => {
    process.env.DEBUG_STATE = '2';
    vi.resetModules();

    const events: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      events.push(`log:${args.join(' ')}`);
    });

    const cliState = await import('../src/utils/cliConsoleState.js');
    cliState.setInteractiveCliActive(true);
    cliState.registerCliPromptClear(() => events.push('clear'));
    cliState.registerCliPromptRedraw(() => events.push('redraw'));

    const { debug } = await import('../src/utils/debug.js');
    debug(2, 'Socket connected: test');

    expect(events).toEqual([
      'clear',
      'log:Socket connected: test',
      'redraw',
    ]);
  });
});
