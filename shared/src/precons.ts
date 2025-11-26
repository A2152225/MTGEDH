/**
 * Commander Precon Deck Data
 * Organized by Year -> Set -> Deck
 * Each deck includes name, commanders, and color identity
 */

export interface PreconDeck {
  name: string;
  commanders: string[];
  colorIdentity: string; // e.g., "WUB", "RG", "WUBRG"
  /** Optional Moxfield/Archidekt URL for deck list */
  decklistUrl?: string;
}

export interface PreconSet {
  name: string;
  code: string;
  decks: PreconDeck[];
}

export interface PreconYear {
  year: number;
  sets: PreconSet[];
}

// Color identity display helper
export function formatColorIdentity(colors: string): string {
  const colorMap: Record<string, string> = {
    'W': '⚪',
    'U': '🔵',
    'B': '⚫',
    'R': '🔴',
    'G': '🟢',
    'C': '◇'
  };
  if (!colors || colors === 'C') return '◇';
  return colors.split('').map(c => colorMap[c] || c).join('');
}

export const COMMANDER_PRECONS: PreconYear[] = [
  {
    year: 2025,
    sets: [
      {
        name: "Edge of Eternities",
        code: "EOE",
        decks: [
          { name: "World Shaper", commanders: ["Hearthhull, the Worldseed", "Szarel, Genesis Shepherd"], colorIdentity: "BRG" },
          { name: "Counter Intelligence", commanders: ["Inspirit, Flagship Vessel", "Kilo, Apogee Mind"], colorIdentity: "URW" }
        ]
      },
      {
        name: "Final Fantasy",
        code: "FIN",
        decks: [
          { name: "Revival Trance", commanders: ["Terra, Herald of Hope"], colorIdentity: "RWB" },
          { name: "Limit Break", commanders: ["Cloud, Ex-SOLDIER"], colorIdentity: "RGW" },
          { name: "Counter Blitz", commanders: ["Tidus, Yuna's Guardian"], colorIdentity: "GWU" },
          { name: "Scions & Spellcraft", commanders: ["Y'shtola, Night's Blessed"], colorIdentity: "WUB" }
        ]
      },
      {
        name: "Tarkir: Dragonstorm",
        code: "TDC",
        decks: [
          { name: "Abzan Armor", commanders: ["Felothar the Steadfast"], colorIdentity: "WBG" },
          { name: "Jeskai Striker", commanders: ["Shiko and Narset, Unified"], colorIdentity: "URW" },
          { name: "Sultai Arisen", commanders: ["Kotis, Sibsig Champion"], colorIdentity: "BGU" },
          { name: "Mardu Surge", commanders: ["Neriv, Crackling Vanguard"], colorIdentity: "RWB" },
          { name: "Temur Roar", commanders: ["Eshki, Temur's Roar"], colorIdentity: "GUR" }
        ]
      },
      {
        name: "Aetherdrift",
        code: "ADC",
        decks: [
          { name: "Eternal Might", commanders: ["Temmet, Naktamun's Will"], colorIdentity: "WUB" },
          { name: "Living Energy", commanders: ["Saheeli, Radiant Creator"], colorIdentity: "URG" }
        ]
      }
    ]
  },
  {
    year: 2024,
    sets: [
      {
        name: "Duskmourn: House of Horror",
        code: "DSC",
        decks: [
          { name: "Death Toll", commanders: ["Zimone, All-Questioning"], colorIdentity: "BUG" },
          { name: "Jump Scare!", commanders: ["Valgavoth, Harrower of Souls"], colorIdentity: "RBU" },
          { name: "Miracle Worker", commanders: ["Winter, Cynical Opportunist"], colorIdentity: "WB" },
          { name: "Endless Punishment", commanders: ["Toby, Beastie Befriender"], colorIdentity: "RGW" }
        ]
      },
      {
        name: "Bloomburrow",
        code: "BLC",
        decks: [
          { name: "Animated Army", commanders: ["Bello, Bard of the Brambles"], colorIdentity: "RG" },
          { name: "Family Matters", commanders: ["Zinnia, Matriarch of Seeds"], colorIdentity: "WUG" },
          { name: "Peace Offering", commanders: ["Clement, the Worrywort"], colorIdentity: "GW" },
          { name: "Squirreled Away", commanders: ["Hazel of the Rootbloom"], colorIdentity: "BG" }
        ]
      },
      {
        name: "Modern Horizons 3",
        code: "M3C",
        decks: [
          { name: "Creative Energy", commanders: ["Satya, Aetherflux Genius"], colorIdentity: "WUR" },
          { name: "Eldrazi Incursion", commanders: ["Ulalek, Fused Atrocity"], colorIdentity: "C" },
          { name: "Graveyard Overdrive", commanders: ["Disa the Restless"], colorIdentity: "BRG" },
          { name: "Tricky Terrain", commanders: ["Omo, Queen of Vesuva"], colorIdentity: "GU" }
        ]
      },
      {
        name: "Outlaws of Thunder Junction",
        code: "OTC",
        decks: [
          { name: "Desert Bloom", commanders: ["Yuma, Proud Protector"], colorIdentity: "RGW" },
          { name: "Grand Larceny", commanders: ["Gonti, Canny Acquisitor"], colorIdentity: "BUG" },
          { name: "Most Wanted", commanders: ["Olivia, Opulent Outlaw"], colorIdentity: "RWB" },
          { name: "Quick Draw", commanders: ["Stella Lee, Wild Card"], colorIdentity: "WUR" }
        ]
      },
      {
        name: "Fallout",
        code: "PIP",
        decks: [
          { name: "Hail, Caesar", commanders: ["Caesar, Legion's Emperor"], colorIdentity: "RWB" },
          { name: "Mutant Menace", commanders: ["The Wise Mothman"], colorIdentity: "BUG" },
          { name: "Scrappy Survivors", commanders: ["Dogmeat, Ever Loyal"], colorIdentity: "RGW" },
          { name: "Science!", commanders: ["Dr. Madison Li"], colorIdentity: "WUR" }
        ]
      },
      {
        name: "Murders at Karlov Manor",
        code: "MKC",
        decks: [
          { name: "Blame Game", commanders: ["Nelly Borca, Impulsive Accuser"], colorIdentity: "RW" },
          { name: "Deep Clue Sea", commanders: ["Morska, Undersea Sleuth"], colorIdentity: "WU" },
          { name: "Deadly Disguise", commanders: ["Kaust, Eyes of the Glade"], colorIdentity: "BG" },
          { name: "Revenant Recon", commanders: ["Mirko, Obsessive Theorist"], colorIdentity: "UB" }
        ]
      }
    ]
  },
  {
    year: 2023,
    sets: [
      {
        name: "The Lost Caverns of Ixalan",
        code: "LCC",
        decks: [
          { name: "Ahoy Mateys", commanders: ["Admiral Brass, Unsinkable"], colorIdentity: "RUB" },
          { name: "Blood Rites", commanders: ["Clavileño, First of the Blessed"], colorIdentity: "WB" },
          { name: "Explorers of the Deep", commanders: ["Hakbal of the Surging Soul"], colorIdentity: "GU" },
          { name: "Veloci-Ramp-Tor", commanders: ["Pantlaza, Sun-Favored"], colorIdentity: "RGW" }
        ]
      },
      {
        name: "Doctor Who",
        code: "WHO",
        decks: [
          { name: "Blast from the Past", commanders: ["The Fourth Doctor", "Sarah Jane Smith"], colorIdentity: "GW" },
          { name: "Masters of Evil", commanders: ["Davros, Dalek Creator", "The Dalek Emperor"], colorIdentity: "RUB" },
          { name: "Paradox Power", commanders: ["The Thirteenth Doctor", "Yasmin Khan"], colorIdentity: "WUG" },
          { name: "Timey-Wimey", commanders: ["The Tenth Doctor", "Rose Tyler"], colorIdentity: "WUR" }
        ]
      },
      {
        name: "Wilds of Eldraine",
        code: "WOC",
        decks: [
          { name: "Fae Dominion", commanders: ["Tegwyll, Duke of Splendor"], colorIdentity: "WUB" },
          { name: "Virtue and Valor", commanders: ["Ellivere of the Wild Court"], colorIdentity: "GW" }
        ]
      },
      {
        name: "Commander Masters",
        code: "CMM",
        decks: [
          { name: "Eldrazi Unbound", commanders: ["Zhulodok, Void Gorger"], colorIdentity: "C" },
          { name: "Enduring Enchantments", commanders: ["Anikthea, Hand of Erebos"], colorIdentity: "WBG" },
          { name: "Planeswalker Party", commanders: ["Commodore Guff"], colorIdentity: "WUR" },
          { name: "Sliver Swarm", commanders: ["Sliver Gravemother"], colorIdentity: "WUBRG" }
        ]
      },
      {
        name: "The Lord of the Rings: Tales of Middle-earth",
        code: "LTC",
        decks: [
          { name: "Elven Council", commanders: ["Galadriel, Elven-Queen"], colorIdentity: "GU" },
          { name: "Food and Fellowship", commanders: ["Frodo, Adventurous Hobbit"], colorIdentity: "WBG" },
          { name: "Riders of Rohan", commanders: ["Éowyn, Shieldmaiden"], colorIdentity: "WUR" },
          { name: "The Hosts of Mordor", commanders: ["Sauron, Lord of the Rings"], colorIdentity: "RUB" }
        ]
      },
      {
        name: "March of the Machine",
        code: "MOC",
        decks: [
          { name: "Cavalry Charge", commanders: ["Sidar Jabari of Zhalfir"], colorIdentity: "WB" },
          { name: "Call for Backup", commanders: ["Bright-Palm, Soul Awakener"], colorIdentity: "RGW" },
          { name: "Divine Convocation", commanders: ["Kasla, the Broken Halo"], colorIdentity: "WUR" },
          { name: "Growing Threat", commanders: ["Brimaz, Blight of Oreskos"], colorIdentity: "WBG" },
          { name: "Tinker Time", commanders: ["Gimbal, Gremlin Prodigy"], colorIdentity: "GUR" }
        ]
      },
      {
        name: "Phyrexia: All Will Be One",
        code: "ONC",
        decks: [
          { name: "Corrupting Influence", commanders: ["Ixhel, Scion of Atraxa"], colorIdentity: "WBG" },
          { name: "Rebellion Rising", commanders: ["Neyali, Suns' Vanguard"], colorIdentity: "RW" }
        ]
      }
    ]
  },
  {
    year: 2022,
    sets: [
      {
        name: "The Brothers' War",
        code: "BRC",
        decks: [
          { name: "Mishra's Burnished Banner", commanders: ["Mishra, Eminent One"], colorIdentity: "RUB" },
          { name: "Urza's Iron Alliance", commanders: ["Urza, Chief Artificer"], colorIdentity: "WUB" }
        ]
      },
      {
        name: "Warhammer 40,000",
        code: "40K",
        decks: [
          { name: "Forces of the Imperium", commanders: ["Inquisitor Greyfax"], colorIdentity: "WUB" },
          { name: "Necron Dynasties", commanders: ["Szarekh, the Silent King"], colorIdentity: "B" },
          { name: "The Ruinous Powers", commanders: ["Abaddon the Despoiler"], colorIdentity: "RUB" },
          { name: "Tyranid Swarm", commanders: ["The Swarmlord"], colorIdentity: "GUR" }
        ]
      },
      {
        name: "Dominaria United",
        code: "DMC",
        decks: [
          { name: "Legends' Legacy", commanders: ["Dihada, Binder of Wills"], colorIdentity: "RWB" },
          { name: "Painbow", commanders: ["Jared Carthalion"], colorIdentity: "WUBRG" }
        ]
      },
      {
        name: "Baldur's Gate",
        code: "CLB",
        decks: [
          { name: "Draconic Dissent", commanders: ["Firkraag, Cunning Instigator"], colorIdentity: "RU" },
          { name: "Exit from Exile", commanders: ["Faldorn, Dread Wolf Herald"], colorIdentity: "RG" },
          { name: "Mind Flayarrrs", commanders: ["Captain N'ghathrod"], colorIdentity: "UB" },
          { name: "Party Time", commanders: ["Nalia de'Arnise"], colorIdentity: "WB" }
        ]
      },
      {
        name: "Streets of New Capenna",
        code: "NCC",
        decks: [
          { name: "Bedecked Brokers", commanders: ["Perrie, the Pulverizer"], colorIdentity: "WUG" },
          { name: "Cabaretti Cacophony", commanders: ["Kitt Kanto, Mayhem Diva"], colorIdentity: "RGW" },
          { name: "Maestros Massacre", commanders: ["Anhelo, the Painter"], colorIdentity: "RUB" },
          { name: "Obscura Operation", commanders: ["Kamiz, Obscura Oculus"], colorIdentity: "WUB" },
          { name: "Riveteers Rampage", commanders: ["Henzie 'Toolbox' Torre"], colorIdentity: "BRG" }
        ]
      },
      {
        name: "Kamigawa: Neon Dynasty",
        code: "NEC",
        decks: [
          { name: "Buckle Up", commanders: ["Kotori, Pilot Prodigy"], colorIdentity: "WU" },
          { name: "Upgrades Unleashed", commanders: ["Chishiro, the Shattered Blade"], colorIdentity: "RG" }
        ]
      }
    ]
  },
  {
    year: 2021,
    sets: [
      {
        name: "Innistrad: Crimson Vow",
        code: "VOC",
        decks: [
          { name: "Spirit Squadron", commanders: ["Millicent, Restless Revenant"], colorIdentity: "WU" },
          { name: "Vampiric Bloodline", commanders: ["Strefan, Maurer Progenitor"], colorIdentity: "RB" }
        ]
      },
      {
        name: "Innistrad: Midnight Hunt",
        code: "MIC",
        decks: [
          { name: "Coven Counters", commanders: ["Leinore, Autumn Sovereign"], colorIdentity: "GW" },
          { name: "Undead Unleashed", commanders: ["Wilhelt, the Rotcleaver"], colorIdentity: "UB" }
        ]
      },
      {
        name: "Adventures in the Forgotten Realms",
        code: "AFC",
        decks: [
          { name: "Aura of Courage", commanders: ["Galea, Kindler of Hope"], colorIdentity: "WUG" },
          { name: "Dungeons of Death", commanders: ["Sefris of the Hidden Ways"], colorIdentity: "WUB" },
          { name: "Draconic Rage", commanders: ["Vrondiss, Rage of Ancients"], colorIdentity: "RG" },
          { name: "Planar Portal", commanders: ["Prosper, Tome-Bound"], colorIdentity: "RB" }
        ]
      },
      {
        name: "Strixhaven",
        code: "C21",
        decks: [
          { name: "Lorehold Legacies", commanders: ["Osgir, the Reconstructor"], colorIdentity: "RW" },
          { name: "Prismari Performance", commanders: ["Zaffai, Thunder Conductor"], colorIdentity: "RU" },
          { name: "Quantum Quandrix", commanders: ["Adrix and Nev, Twincasters"], colorIdentity: "GU" },
          { name: "Silverquill Statement", commanders: ["Breena, the Demagogue"], colorIdentity: "WB" },
          { name: "Witherbloom Witchcraft", commanders: ["Willowdusk, Essence Seer"], colorIdentity: "BG" }
        ]
      },
      {
        name: "Kaldheim",
        code: "KHC",
        decks: [
          { name: "Elven Empire", commanders: ["Lathril, Blade of the Elves"], colorIdentity: "BG" },
          { name: "Phantom Premonition", commanders: ["Ranar the Ever-Watchful"], colorIdentity: "WU" }
        ]
      }
    ]
  },
  {
    year: 2020,
    sets: [
      {
        name: "Commander Legends",
        code: "CMR",
        decks: [
          { name: "Arm for Battle", commanders: ["Wyleth, Soul of Steel"], colorIdentity: "RW" },
          { name: "Reap the Tides", commanders: ["Aesi, Tyrant of Gyre Strait"], colorIdentity: "GU" }
        ]
      },
      {
        name: "Zendikar Rising",
        code: "ZNC",
        decks: [
          { name: "Land's Wrath", commanders: ["Obuun, Mul Daya Ancestor"], colorIdentity: "RGW" },
          { name: "Sneak Attack", commanders: ["Anowon, the Ruin Thief"], colorIdentity: "UB" }
        ]
      },
      {
        name: "Ikoria: Lair of Behemoths",
        code: "C20",
        decks: [
          { name: "Arcane Maelstrom", commanders: ["Kalamax, the Stormsire"], colorIdentity: "GUR" },
          { name: "Enhanced Evolution", commanders: ["Otrimi, the Ever-Playful"], colorIdentity: "BUG" },
          { name: "Ruthless Regiment", commanders: ["Jirina Kudro"], colorIdentity: "RWB" },
          { name: "Symbiotic Swarm", commanders: ["Kathril, Aspect Warper"], colorIdentity: "WBG" },
          { name: "Timeless Wisdom", commanders: ["Gavi, Nest Warden"], colorIdentity: "WUR" }
        ]
      }
    ]
  },
  {
    year: 2019,
    sets: [
      {
        name: "Commander 2019",
        code: "C19",
        decks: [
          { name: "Faceless Menace", commanders: ["Kadena, Slinking Sorcerer"], colorIdentity: "BUG" },
          { name: "Merciless Rage", commanders: ["Anje Falkenrath"], colorIdentity: "RB" },
          { name: "Mystic Intellect", commanders: ["Sevinne, the Chronoclasm"], colorIdentity: "WUR" },
          { name: "Primal Genesis", commanders: ["Ghired, Conclave Exile"], colorIdentity: "RGW" }
        ]
      }
    ]
  },
  {
    year: 2018,
    sets: [
      {
        name: "Commander 2018",
        code: "C18",
        decks: [
          { name: "Adaptive Enchantment", commanders: ["Estrid, the Masked"], colorIdentity: "WUG" },
          { name: "Exquisite Invention", commanders: ["Saheeli, the Gifted"], colorIdentity: "RU" },
          { name: "Nature's Vengeance", commanders: ["Lord Windgrace"], colorIdentity: "BRG" },
          { name: "Subjective Reality", commanders: ["Aminatou, the Fateshifter"], colorIdentity: "WUB" }
        ]
      }
    ]
  },
  {
    year: 2017,
    sets: [
      {
        name: "Commander 2017",
        code: "C17",
        decks: [
          { name: "Arcane Wizardry", commanders: ["Inalla, Archmage Ritualist"], colorIdentity: "RUB" },
          { name: "Draconic Domination", commanders: ["The Ur-Dragon"], colorIdentity: "WUBRG" },
          { name: "Feline Ferocity", commanders: ["Arahbo, Roar of the World"], colorIdentity: "GW" },
          { name: "Vampiric Bloodlust", commanders: ["Edgar Markov"], colorIdentity: "RWB" }
        ]
      }
    ]
  },
  {
    year: 2016,
    sets: [
      {
        name: "Commander 2016",
        code: "C16",
        decks: [
          { name: "Breed Lethality", commanders: ["Atraxa, Praetors' Voice"], colorIdentity: "WUBG" },
          { name: "Entropic Uprising", commanders: ["Yidris, Maelstrom Wielder"], colorIdentity: "UBRG" },
          { name: "Invent Superiority", commanders: ["Breya, Etherium Shaper"], colorIdentity: "WUBR" },
          { name: "Open Hostility", commanders: ["Saskia the Unyielding"], colorIdentity: "WBRG" },
          { name: "Stalwart Unity", commanders: ["Kynaios and Tiro of Meletis"], colorIdentity: "WURG" }
        ]
      }
    ]
  },
  {
    year: 2015,
    sets: [
      {
        name: "Commander 2015",
        code: "C15",
        decks: [
          { name: "Call the Spirits", commanders: ["Daxos the Returned"], colorIdentity: "WB" },
          { name: "Plunder the Graves", commanders: ["Meren of Clan Nel Toth"], colorIdentity: "BG" },
          { name: "Seize Control", commanders: ["Mizzix of the Izmagnus"], colorIdentity: "RU" },
          { name: "Swell the Host", commanders: ["Ezuri, Claw of Progress"], colorIdentity: "GU" },
          { name: "Wade into Battle", commanders: ["Kalemne, Disciple of Iroas"], colorIdentity: "RW" }
        ]
      }
    ]
  },
  {
    year: 2014,
    sets: [
      {
        name: "Commander 2014",
        code: "C14",
        decks: [
          { name: "Built from Scratch", commanders: ["Daretti, Scrap Savant"], colorIdentity: "R" },
          { name: "Forged in Stone", commanders: ["Nahiri, the Lithomancer"], colorIdentity: "W" },
          { name: "Guided by Nature", commanders: ["Freyalise, Llanowar's Fury"], colorIdentity: "G" },
          { name: "Peer through Time", commanders: ["Teferi, Temporal Archmage"], colorIdentity: "U" },
          { name: "Sworn to Darkness", commanders: ["Ob Nixilis of the Black Oath"], colorIdentity: "B" }
        ]
      }
    ]
  },
  {
    year: 2013,
    sets: [
      {
        name: "Commander 2013",
        code: "C13",
        decks: [
          { name: "Evasive Maneuvers", commanders: ["Derevi, Empyrial Tactician"], colorIdentity: "WUG" },
          { name: "Eternal Bargain", commanders: ["Oloro, Ageless Ascetic"], colorIdentity: "WUB" },
          { name: "Mind Seize", commanders: ["Jeleva, Nephalia's Scourge"], colorIdentity: "RUB" },
          { name: "Nature of the Beast", commanders: ["Marath, Will of the Wild"], colorIdentity: "RGW" },
          { name: "Power Hungry", commanders: ["Prossh, Skyraider of Kher"], colorIdentity: "BRG" }
        ]
      }
    ]
  },
  {
    year: 2011,
    sets: [
      {
        name: "Commander",
        code: "CMD",
        decks: [
          { name: "Counterpunch", commanders: ["Ghave, Guru of Spores"], colorIdentity: "WBG" },
          { name: "Devour for Power", commanders: ["The Mimeoplasm"], colorIdentity: "BUG" },
          { name: "Heavenly Inferno", commanders: ["Kaalia of the Vast"], colorIdentity: "RWB" },
          { name: "Mirror Mastery", commanders: ["Riku of Two Reflections"], colorIdentity: "GUR" },
          { name: "Political Puppets", commanders: ["Zedruu the Greathearted"], colorIdentity: "WUR" }
        ]
      }
    ]
  }
];

/**
 * Get all precon years for the tree view
 */
export function getPreconYears(): number[] {
  return COMMANDER_PRECONS.map(y => y.year);
}

/**
 * Get sets for a specific year
 */
export function getPreconSetsForYear(year: number): PreconSet[] {
  const yearData = COMMANDER_PRECONS.find(y => y.year === year);
  return yearData?.sets || [];
}

/**
 * Get a specific deck by year, set code, and deck name
 */
export function getPreconDeck(year: number, setCode: string, deckName: string): PreconDeck | undefined {
  const yearData = COMMANDER_PRECONS.find(y => y.year === year);
  if (!yearData) return undefined;
  const set = yearData.sets.find(s => s.code === setCode);
  if (!set) return undefined;
  return set.decks.find(d => d.name === deckName);
}

/**
 * Search precons by name or commander
 */
export function searchPrecons(query: string): Array<{ year: number; set: PreconSet; deck: PreconDeck }> {
  const q = query.toLowerCase();
  const results: Array<{ year: number; set: PreconSet; deck: PreconDeck }> = [];
  
  for (const yearData of COMMANDER_PRECONS) {
    for (const set of yearData.sets) {
      for (const deck of set.decks) {
        if (
          deck.name.toLowerCase().includes(q) ||
          deck.commanders.some(c => c.toLowerCase().includes(q))
        ) {
          results.push({ year: yearData.year, set, deck });
        }
      }
    }
  }
  
  return results;
}
