import { beforeAll, expect, it } from 'vitest';
import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';
import '../src/state/modules/priority.js';
const OJER = "Vigilance\nIf one or more creature tokens would be created under your control, three times that many of those tokens are created instead.\nWhen Ojer Taq dies, return it to the battlefield tapped and transformed under its owner's control.";
beforeAll(async () => { await initDb(); initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {} } as any); });
it('issue #77: Ojer Taq dies trigger (short legendary name) returns it tapped and transformed', async () => {
  const gameId = 'issue77_ojer_taq'; await resetIntegrationGame(gameId); createGameIfNotExists(gameId, 'commander', 40);
  const game: any = ensureGame(gameId); const p = 'p1';
  game.state.players = [{ id: p, name: 'P1', spectator: false, life: 40 }]; game.state.turnPlayer = p; game.state.priority = p; game.state.turnNumber = 27;
  game.state.battlefield = [{ id: 'ojer', controller: p, owner: p, tapped: false, counters: {}, basePower: 6, baseToughness: 6,
    card: { id: 'ojer_c', name: 'Ojer Taq, Deepest Foundation // Temple of Civilization', layout: 'transform', type_line: 'Legendary Creature â€” God // Land', oracle_text: OJER, power: '6', toughness: '6', zone: 'battlefield',
      card_faces: [ { name: 'Ojer Taq, Deepest Foundation', type_line: 'Legendary Creature â€” God', oracle_text: OJER, power: '6', toughness: '6', mana_cost: '{4}{W}{W}' },
                    { name: 'Temple of Civilization', type_line: 'Land', oracle_text: '({T}: Add {W}.)\n{2}{W}, {T}: Transform Temple of Civilization. Activate only if you attacked with three or more creatures this turn and only as a sorcery.' } ] } }];
  game.state.zones = { [p]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 } };
  movePermanentToGraveyard(game, 'ojer');
  expect(game.state.stack.length).toBe(1);
  game.resolveTopOfStack();
  const back = game.state.battlefield.find((x: any) => x.card?.name === 'Temple of Civilization');
  expect(back).toBeTruthy();
  expect(back.tapped).toBe(true);
  expect(back.transformed).toBe(true);
  expect(back.card.type_line).toBe('Land');
  expect(game.state.zones[p].graveyard.length).toBe(0);
  await resetIntegrationGame(gameId);
});
