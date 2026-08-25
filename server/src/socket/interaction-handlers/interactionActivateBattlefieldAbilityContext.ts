/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Shared context for tryHandleActivate* peels of the activateBattlefieldAbility
 * socket body. The parent prologue fills this object; each family returns true
 * when it handled (or rejected) the activation so the parent can return.
 *
 * Public entry symbols: ActivateBattlefieldAbilityContext.
 */
import type { Server, Socket } from "socket.io";

export type ActivateBattlefieldAbilityContext = {
  io: Server;
  socket: Socket;
  game: any;
  gameId: string;
  pid: string;
  permanentId: string;
  abilityId: string;
  selectedXValue: number | undefined;
  splitSecondLockActive: boolean;
  battlefield: any[];
  permIndex: number;
  permanent: any;
  card: any;
  cardName: string;
  oracleText: string;
  typeLine: string;
  scopedAbilityText: string;
  scopedAbilityFullText: string;
  isGenericActivatedAbilityId: boolean;
};
