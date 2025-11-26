/**
 * Keyword Abilities (Rule 702)
 * 
 * This module provides implementations of all keyword abilities from the MTG Comprehensive Rules.
 * 
 * Part 1 (Rules 702.2-702.20): Basic keyword abilities
 * - Deathtouch (702.2), Defender (702.3), Double Strike (702.4), First Strike (702.7)
 * - Flash (702.8), Flying (702.9), Haste (702.10), Hexproof (702.11)
 * - Indestructible (702.12), Lifelink (702.15), Reach (702.17), Trample (702.19), Vigilance (702.20)
 * 
 * Part 2 (Rules 702.21-702.37): Classic keyword abilities
 * - Ward (702.21), Banding (702.22), Rampage (702.23), Cumulative Upkeep (702.24)
 * - Flanking (702.25), Phasing (702.26), Buyback (702.27), Shadow (702.28)
 * - Cycling (702.29), Echo (702.30), Horsemanship (702.31), Fading (702.32)
 * - Kicker (702.33), Flashback (702.34), Madness (702.35), Fear (702.36), Morph (702.37)
 * 
 * Part 3 (Rules 702.38-702.55): Advanced keyword abilities
 * - Amplify (702.38), Provoke (702.39), Storm (702.40), Affinity (702.41)
 * - Entwine (702.42), Modular (702.43), Sunburst (702.44), Bushido (702.45)
 * - Soulshift (702.46), Splice (702.47), Offering (702.48), Ninjutsu (702.49)
 * - Epic (702.50), Convoke (702.51), Dredge (702.52), Transmute (702.53)
 * - Bloodthirst (702.54), Haunt (702.55)
 * 
 * Part 4 (Rules 702.56-702.73): Complex keyword abilities
 * - Replicate (702.56), Forecast (702.57), Graft (702.58), Recover (702.59)
 * - Ripple (702.60), Split Second (702.61), Suspend (702.62), Vanishing (702.63)
 * - Absorb (702.64), Aura Swap (702.65), Delve (702.66), Fortify (702.67)
 * - Frenzy (702.68), Gravestorm (702.69), Poisonous (702.70), Transfigure (702.71)
 * - Champion (702.72), Changeling (702.73)
 * 
 * Part 5 (Rules 702.74-702.92): Advanced mechanic keyword abilities
 * - Evoke (702.74), Hideaway (702.75), Prowl (702.76), Reinforce (702.77)
 * - Conspire (702.78), Persist (702.79), Wither (702.80), Retrace (702.81)
 * - Devour (702.82), Exalted (702.83), Unearth (702.84), Cascade (702.85)
 * - Annihilator (702.86), Level Up (702.87), Rebound (702.88), Umbra Armor (702.89)
 * - Infect (702.90), Battle Cry (702.91), Living Weapon (702.92)
 * 
 * Part 6 (Rules 702.93-702.111): RTR through DTK era keyword abilities
 * - Undying (702.93), Miracle (702.94), Soulbond (702.95), Overload (702.96)
 * - Scavenge (702.97), Unleash (702.98), Cipher (702.99), Evolve (702.100)
 * - Extort (702.101), Fuse (702.102), Bestow (702.103), Tribute (702.104)
 * - Dethrone (702.105), Hidden Agenda (702.106), Outlast (702.107), Prowess (702.108)
 * - Dash (702.109), Exploit (702.110), Menace (702.111)
 * 
 * Part 7 (Rules 702.112-702.129): BFZ through HOU era keyword abilities
 * - Renown (702.112), Awaken (702.113), Devoid (702.114), Ingest (702.115)
 * - Myriad (702.116), Surge (702.117), Skulk (702.118), Emerge (702.119)
 * - Escalate (702.120), Melee (702.121), Crew (702.122), Fabricate (702.123)
 * - Partner (702.124), Undaunted (702.125), Improvise (702.126), Aftermath (702.127)
 * - Embalm (702.128), Eternalize (702.129)
 * 
 * Part 8 (Rules 702.130-702.140): IXL through IKO era keyword abilities
 * - Afflict (702.130), Ascend (702.131), Assist (702.132), Jump-Start (702.133)
 * - Mentor (702.134), Afterlife (702.135), Riot (702.136), Spectacle (702.137)
 * - Escape (702.138), Companion (702.139), Mutate (702.140)
 * 
 * Part 9 (Rules 702.141-702.150): ZNR through VOW era keyword abilities
 * - Encore (702.141), Boast (702.142), Foretell (702.143), Demonstrate (702.144)
 * - Daybound/Nightbound (702.145), Disturb (702.146), Decayed (702.147), Cleave (702.148)
 * - Training (702.149), Compleated (702.150)
 * 
 * Part 10 (Rules 702.151-702.160): NEO through BRO era keyword abilities
 * - Reconfigure (702.151), Blitz (702.152), Casualty (702.153), Enlist (702.154)
 * - Read Ahead (702.155), Ravenous (702.156), Squad (702.157), Prototype (702.160)
 * 
 * Part 11 (Rules 702.161-702.169): ONE through OTJ era keyword abilities
 * - Living Metal (702.161), More Than Meets the Eye (702.162), For Mirrodin! (702.163)
 * - Toxic (702.164), Backup (702.165), Bargain (702.166), Craft (702.167)
 * - Disguise (702.168), Solved (702.169)
 * 
 * Part 12 (Rules 702.170-702.176): OTJ through BLB era keyword abilities
 * - Plot (702.170), Saddle (702.171), Spree (702.172), Freerunning (702.173)
 * - Gift (702.174), Offspring (702.175), Impending (702.176)
 * 
 * Part 13 (Rules 702.177-702.183): BRJOM through EMGS era keyword abilities
 * - Exhaust (702.177), Max Speed (702.178), Start Your Engines! (702.179)
 * - Harmonize (702.180), Mobilize (702.181), Job Select (702.182), Tiered (702.183)
 * 
 * Part 14 (Rules 702.184-702.189): Remaining keyword abilities
 * - Station (702.184), Warp (702.185), Infinity (702.186), Mayhem (702.187)
 * - Web-slinging (702.188), Firebending (702.189)
 */

// Part 1: Export all keyword ability modules
export * from './deathtouch';
export * from './defender';
export * from './doubleStrike';
export * from './firstStrike';
export * from './flash';
export * from './flying';
export * from './haste';
export * from './hexproof';
// Indestructible - exclude canBeDestroyed (conflicts with types/cardTypes)
export {
  IndestructibleAbility,
  indestructible,
  destroyedByLethalDamage,
  hasRedundantIndestructible,
} from './indestructible';
export * from './lifelink';
export * from './reach';
export * from './trample';
export * from './vigilance';

// Part 2: Export classic keyword abilities
export * from './ward';
export * from './banding';
export * from './rampage';
export * from './cumulativeUpkeep';
export * from './flanking';
export * from './phasing';
export * from './buyback';
export * from './shadow';
export * from './cycling';
export * from './echo';
export * from './horsemanship';
export * from './fading';
export * from './kicker';
export * from './flashback';
export * from './madness';
export * from './fear';
export * from './morph';

// Part 3: Export advanced keyword abilities
export * from './amplify';
export * from './provoke';
export * from './storm';
export * from './affinity';
export * from './entwine';
export * from './modular';
export * from './sunburst';
export * from './bushido';
export * from './soulshift';
export * from './splice';
export * from './offering';
export * from './ninjutsu';
export * from './epic';
export * from './convoke';
export * from './dredge';
export * from './transmute';
export * from './bloodthirst';
export * from './haunt';

// Part 4: Export complex keyword abilities
export * from './replicate';
export * from './forecast';
export * from './graft';
export * from './recover';
export * from './ripple';
export * from './splitSecond';
export * from './suspend';
export * from './vanishing';
export * from './absorb';
export * from './auraSwap';
export * from './delve';
export * from './fortify';
export * from './frenzy';
export * from './gravestorm';
export * from './poisonous';
export * from './transfigure';
export * from './champion';
export * from './changeling';

// Part 5: Export advanced mechanic keyword abilities
export * from './evoke';
export * from './hideaway';
export * from './prowl';
export * from './reinforce';
export * from './conspire';
export * from './persist';
export * from './wither';
export * from './retrace';
export * from './devour';
export * from './exalted';
export * from './unearth';
export * from './cascade';
export * from './annihilator';
export * from './levelUp';
export * from './rebound';
export * from './umbraArmor';
export * from './infect';
export * from './battleCry';
export * from './livingWeapon';

// Part 6: Export RTR through DTK era keyword abilities
export * from './undying';
export * from './miracle';
export * from './soulbond';
export * from './overload';
export * from './scavenge';
export * from './unleash';
export * from './cipher';
export * from './evolve';
export * from './extort';
export * from './fuse';
export * from './bestow';
export * from './tribute';
export * from './dethrone';
export * from './hiddenAgenda';
export * from './outlast';
export * from './prowess';
export * from './dash';
export * from './exploit';
export * from './menace';

// Part 7: Export BFZ through HOU era keyword abilities
export * from './renown';
export * from './awaken';
// Devoid - exclude isColorless (conflicts with types/colors)
export {
  DevoidAbility,
  devoid,
  hasRedundantDevoid,
} from './devoid';
export * from './ingest';
export * from './myriad';
export * from './surge';
export * from './skulk';
export * from './emerge';
export * from './escalate';
export * from './melee';
export * from './crew';
export * from './fabricate';
export * from './partner';
export * from './undaunted';
export * from './improvise';
export * from './aftermath';
export * from './embalm';
export * from './eternalize';

// Part 8: Export IXL through IKO era keyword abilities
export * from './afflict';
export * from './ascend';
export * from './assist';
export * from './jumpStart';
export * from './mentor';
export * from './afterlife';
export * from './riot';
export * from './spectacle';
export * from './escape';
export * from './companion';
export * from './mutate';

// Part 9: Export ZNR through VOW era keyword abilities
export * from './encore';
export * from './boast';
export * from './foretell';
export * from './demonstrate';
export * from './dayboundNightbound';
export * from './disturb';
export * from './decayed';
export * from './cleave';
export * from './training';
export * from './compleated';

// Part 10: Export NEO through BRO era keyword abilities
export * from './reconfigure';
export * from './blitz';
export * from './casualty';
export * from './enlist';
export * from './readAhead';
export * from './ravenous';
export * from './squad';
export * from './prototype';

// Part 11: Export ONE through OTJ era keyword abilities
export * from './livingMetal';
export * from './moreThanMeetsTheEye';
export * from './forMirrodin';
export * from './toxic';
export * from './backup';
export * from './bargain';
export * from './craft';
export * from './disguise';
export * from './solved';

// Part 12: Export OTJ through BLB era keyword abilities
export * from './plot';
export * from './saddle';
export * from './spree';
export * from './freerunning';
export * from './gift';
export * from './offspring';
export * from './impending';

// Part 13: Export BRJOM through EMGS era keyword abilities
export * from './exhaust';
export * from './maxSpeed';
export * from './startYourEngines';
export * from './harmonize';
export * from './mobilize';
export * from './jobSelect';
export * from './tiered';

// Part 14: Export remaining keyword abilities
export * from './station';
export * from './warp';
export * from './infinity';
export * from './mayhem';
export * from './webSlinging';
export * from './firebending';

/**
 * Union type of all keyword ability types
 */
export type KeywordAbility =
  // Part 1
  | import('./deathtouch').DeathtouchAbility
  | import('./defender').DefenderAbility
  | import('./doubleStrike').DoubleStrikeAbility
  | import('./firstStrike').FirstStrikeAbility
  | import('./flash').FlashAbility
  | import('./flying').FlyingAbility
  | import('./haste').HasteAbility
  | import('./hexproof').HexproofAbility
  | import('./indestructible').IndestructibleAbility
  | import('./lifelink').LifelinkAbility
  | import('./reach').ReachAbility
  | import('./trample').TrampleAbility
  | import('./vigilance').VigilanceAbility
  // Part 2
  | import('./ward').WardAbility
  | import('./banding').BandingAbility
  | import('./rampage').RampageAbility
  | import('./cumulativeUpkeep').CumulativeUpkeepAbility
  | import('./flanking').FlankingAbility
  | import('./phasing').PhasingAbility
  | import('./buyback').BuybackAbility
  | import('./shadow').ShadowAbility
  | import('./cycling').CyclingAbility
  | import('./cycling').TypecyclingAbility
  | import('./echo').EchoAbility
  | import('./horsemanship').HorsemanshipAbility
  | import('./fading').FadingAbility
  | import('./kicker').KickerAbility
  | import('./kicker').MultikickerAbility
  | import('./flashback').FlashbackAbility
  | import('./madness').MadnessAbility
  | import('./fear').FearAbility
  | import('./morph').MorphAbility
  | import('./morph').MegamorphAbility
  // Part 3
  | import('./amplify').AmplifyAbility
  | import('./provoke').ProvokeAbility
  | import('./storm').StormAbility
  | import('./affinity').AffinityAbility
  | import('./entwine').EntwineAbility
  | import('./modular').ModularAbility
  | import('./sunburst').SunburstAbility
  | import('./bushido').BushidoAbility
  | import('./soulshift').SoulshiftAbility
  | import('./splice').SpliceAbility
  | import('./offering').OfferingAbility
  | import('./ninjutsu').NinjutsuAbility
  | import('./epic').EpicAbility
  | import('./convoke').ConvokeAbility
  | import('./dredge').DredgeAbility
  | import('./transmute').TransmuteAbility
  | import('./bloodthirst').BloodthirstAbility
  | import('./haunt').HauntAbility
  // Part 4
  | import('./replicate').ReplicateAbility
  | import('./forecast').ForecastAbility
  | import('./graft').GraftAbility
  | import('./recover').RecoverAbility
  | import('./ripple').RippleAbility
  | import('./splitSecond').SplitSecondAbility
  | import('./suspend').SuspendAbility
  | import('./vanishing').VanishingAbility
  | import('./absorb').AbsorbAbility
  | import('./auraSwap').AuraSwapAbility
  | import('./delve').DelveAbility
  | import('./fortify').FortifyAbility
  | import('./frenzy').FrenzyAbility
  | import('./gravestorm').GravestormAbility
  | import('./poisonous').PoisonousAbility
  | import('./transfigure').TransfigureAbility
  | import('./champion').ChampionAbility
  | import('./changeling').ChangelingAbility
  // Part 5
  | import('./evoke').EvokeAbility
  | import('./hideaway').HideawayAbility
  | import('./prowl').ProwlAbility
  | import('./reinforce').ReinforceAbility
  | import('./conspire').ConspireAbility
  | import('./persist').PersistAbility
  | import('./wither').WitherAbility
  | import('./retrace').RetraceAbility
  | import('./devour').DevourAbility
  | import('./exalted').ExaltedAbility
  | import('./unearth').UnearthAbility
  | import('./cascade').CascadeAbility
  | import('./annihilator').AnnihilatorAbility
  | import('./levelUp').LevelUpAbility
  | import('./rebound').ReboundAbility
  | import('./umbraArmor').UmbraArmorAbility
  | import('./infect').InfectAbility
  | import('./battleCry').BattleCryAbility
  | import('./livingWeapon').LivingWeaponAbility
  // Part 6
  | import('./undying').UndyingAbility
  | import('./miracle').MiracleAbility
  | import('./soulbond').SoulbondAbility
  | import('./overload').OverloadAbility
  | import('./scavenge').ScavengeAbility
  | import('./unleash').UnleashAbility
  | import('./cipher').CipherAbility
  | import('./evolve').EvolveAbility
  | import('./extort').ExtortAbility
  | import('./fuse').FuseAbility
  | import('./bestow').BestowAbility
  | import('./tribute').TributeAbility
  | import('./dethrone').DethroneAbility
  | import('./hiddenAgenda').HiddenAgendaAbility
  | import('./outlast').OutlastAbility
  | import('./prowess').ProwessAbility
  | import('./dash').DashAbility
  | import('./exploit').ExploitAbility
  | import('./menace').MenaceAbility
  // Part 7
  | import('./renown').RenownAbility
  | import('./awaken').AwakenAbility
  | import('./devoid').DevoidAbility
  | import('./ingest').IngestAbility
  | import('./myriad').MyriadAbility
  | import('./surge').SurgeAbility
  | import('./skulk').SkulkAbility
  | import('./emerge').EmergeAbility
  | import('./escalate').EscalateAbility
  | import('./melee').MeleeAbility
  | import('./crew').CrewAbility
  | import('./fabricate').FabricateAbility
  | import('./partner').PartnerAbility
  | import('./undaunted').UndauntedAbility
  | import('./improvise').ImproviseAbility
  | import('./aftermath').AftermathAbility
  | import('./embalm').EmbalmAbility
  | import('./eternalize').EternalizeAbility
  // Part 8
  | import('./afflict').AfflictAbility
  | import('./ascend').AscendAbility
  | import('./assist').AssistAbility
  | import('./jumpStart').JumpStartAbility
  | import('./mentor').MentorAbility
  | import('./afterlife').AfterlifeAbility
  | import('./riot').RiotAbility
  | import('./spectacle').SpectacleAbility
  | import('./escape').EscapeAbility
  | import('./companion').CompanionAbility
  | import('./mutate').MutateAbility
  // Part 9
  | import('./encore').EncoreAbility
  | import('./boast').BoastAbility
  | import('./foretell').ForetellAbility
  | import('./demonstrate').DemonstrateAbility
  | import('./dayboundNightbound').DayboundAbility
  | import('./dayboundNightbound').NightboundAbility
  | import('./disturb').DisturbAbility
  | import('./decayed').DecayedAbility
  | import('./cleave').CleaveAbility
  | import('./training').TrainingAbility
  | import('./compleated').CompleatedAbility
  // Part 10
  | import('./reconfigure').ReconfigureAbility
  | import('./blitz').BlitzAbility
  | import('./casualty').CasualtyAbility
  | import('./enlist').EnlistAbility
  | import('./readAhead').ReadAheadAbility
  | import('./ravenous').RavenousAbility
  | import('./squad').SquadAbility
  | import('./prototype').PrototypeAbility
  // Part 11
  | import('./livingMetal').LivingMetalAbility
  | import('./moreThanMeetsTheEye').MoreThanMeetsTheEyeAbility
  | import('./forMirrodin').ForMirrodinAbility
  | import('./toxic').ToxicAbility
  | import('./backup').BackupAbility
  | import('./bargain').BargainAbility
  | import('./craft').CraftAbility
  | import('./disguise').DisguiseAbility
  | import('./solved').SolvedAbility
  // Part 12
  | import('./plot').PlotAbility
  | import('./saddle').SaddleAbility
  | import('./spree').SpreeAbility
  | import('./freerunning').FreerunningAbility
  | import('./gift').GiftAbility
  | import('./offspring').OffspringAbility
  | import('./impending').ImpendingAbility
  // Part 13
  | import('./exhaust').ExhaustAbility
  | import('./maxSpeed').MaxSpeedAbility
  | import('./startYourEngines').StartYourEnginesAbility
  | import('./harmonize').HarmonizeAbility
  | import('./mobilize').MobilizeAbility
  | import('./jobSelect').JobSelectAbility
  | import('./tiered').TieredAbility
  // Part 14
  | import('./station').StationAbility
  | import('./warp').WarpAbility
  | import('./infinity').InfinityAbility
  | import('./mayhem').MayhemAbility
  | import('./webSlinging').WebSlingingAbility
  | import('./firebending').FirebendingAbility;

/**
 * Helper function to check if an ability is a specific type
 */
export function isAbilityType<T extends KeywordAbility>(
  ability: KeywordAbility,
  type: T['type']
): ability is T {
  return ability.type === type;
}
