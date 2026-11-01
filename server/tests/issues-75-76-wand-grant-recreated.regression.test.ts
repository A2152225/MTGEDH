import { beforeAll, expect, it } from 'vitest';
import { spellHasConvokeForCast } from '../src/state/modules/casting-modifiers.js';
// Issues #75/#76: Wand of the Worldsoul's lingering grant effect was re-harvested on every later
// Oracle IR resolution, recreating "next spell has convoke" live and again on reload/replay.
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';
const p1='p1', p2='p2';
const S1 = { id: 's1', name: 'Spell One', type_line: 'Sorcery', oracle_text: 'You gain 1 life.', mana_cost: '{1}{W}', cmc: 2, colors: ['W'] };
const S2 = { id: 's2', name: 'Spell Two', type_line: 'Sorcery', oracle_text: 'You gain 1 life.', mana_cost: '{1}{W}', cmc: 2, colors: ['W'] };
beforeAll(async()=>{ await initDb(); initializePriorityResolutionHandler({ to: () => ({ emit: () => {} }), emit: () => {}, sockets: { sockets: new Map() } } as any); });
it('one Wand activation grants convoke to exactly one spell, live and after reload', async () => {
  const gameId='wand_grant_issue_76'; ResolutionQueueManager.removeQueue(gameId); games.delete(gameId as any); await deleteGame(gameId);
  createGameIfNotExists(gameId,'commander',40);
  const game:any = ensureGame(gameId); const s=game.state;
  s.players=[{id:p1,name:'P1',spectator:false,life:40},{id:p2,name:'P2',spectator:false,life:40}];
  s.life={[p1]:40,[p2]:40}; s.phase='precombatMain'; s.step='MAIN1'; s.turnPlayer=p1; s.priority=p1; s.turnNumber=24; s.turn=24;
  s.battlefield=[{id:'wand',controller:p1,owner:p1,tapped:false,counters:{},card:{id:'wandc',name:'Wand of the Worldsoul',type_line:'Artifact',oracle_text:'This artifact enters tapped.\n{T}: Add {W}.\n{T}: The next spell you cast this turn has convoke.',mana_cost:'{2}{W}'}},
   ...[0,1,2,3].map(i=>({id:'sol'+i,controller:p1,owner:p1,tapped:false,counters:{},isToken:true,card:{id:'solc'+i,name:'Soldier',type_line:'Token Creature - Soldier',oracle_text:'',colors:['W'],power:'1',toughness:'1'}}))];
  s.zones={[p1]:{hand:[{...S1},{...S2}],handCount:2,library:[],libraryCount:0,graveyard:[],graveyardCount:0,exile:[],exileCount:0},[p2]:{hand:[],handCount:0,library:[],libraryCount:0,graveyard:[],graveyardCount:0,exile:[],exileCount:0}};
  s.manaPool={[p1]:{white:0,blue:0,black:0,red:0,green:0,colorless:0}}; s.stack=[];
  const handlers:Record<string,Function>={}; const errors:any[]=[];
  const socket:any={data:{playerId:p1,spectator:false,gameId},rooms:new Set([gameId]),on:(e:string,f:Function)=>{handlers[e]=f;},emit:(ev:string,pl:any)=>{if(ev==='error')errors.push(pl);}};
  const io:any={to:()=>({emit:()=>{}}),emit:()=>{},sockets:{sockets:new Map([['s0',socket]])}};
  registerInteractionHandlers(io,socket); registerResolutionHandlers(io,socket); registerGameActions(io,socket);
  await handlers['activateBattlefieldAbility']({gameId,permanentId:'wand',abilityId:'wand-ability-1'});

  await handlers['passPriority']?.({gameId}); const h2:Record<string,Function>={}; const sock2:any={data:{playerId:p2,spectator:false,gameId},rooms:new Set([gameId]),on:(e:string,f:Function)=>{h2[e]=f;},emit:(ev:string,pl:any)=>{if(ev==='error')errors.push(pl);}}; io.sockets.sockets.set('s1',sock2); registerResolutionHandlers(io,sock2); registerGameActions(io,sock2); await h2['passPriority']({gameId});

  expect(spellHasConvokeForCast(game.state,p1 as any,S1,'hand')).toBe(true);

  await handlers['castSpellFromHand']({gameId,cardId:'s1',convokeTappedCreatures:['sol0','sol1']});
  expect(errors).toEqual([]); expect(spellHasConvokeForCast(game.state,p1 as any,S2,'hand')).toBe(false);
  await handlers['passPriority']({gameId}); await h2['passPriority']({gameId}); expect(game.state.life[p1]).toBe(41); expect(spellHasConvokeForCast(game.state,p1 as any,S2,'hand')).toBe(false); expect(game.state.convokeGrants).toHaveLength(1);
  games.delete(gameId as any); ResolutionQueueManager.removeQueue(gameId);
  const g2:any = ensureGame(gameId);
  expect(spellHasConvokeForCast(g2.state,p1 as any,S2,'hand')).toBe(false); expect(g2.state.convokeGrants).toHaveLength(1); await deleteGame(gameId); games.delete(gameId as any);
});
