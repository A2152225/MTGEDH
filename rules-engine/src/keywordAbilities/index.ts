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
export * from './indestructible';
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
  | import('./livingWeapon').LivingWeaponAbility;

/**
 * Helper function to check if an ability is a specific type
 */
export function isAbilityType<T extends KeywordAbility>(
  ability: KeywordAbility,
  type: T['type']
): ability is T {
  return ability.type === type;
}
