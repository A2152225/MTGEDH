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
          { name: "World Shaper", commanders: ["Hearthhull, the Worldseed", "Szarel, Genesis Shepherd"], colorIdentity: "BRG", decklistUrl: "https://moxfield.com/decks/z4iIQoHd4ECI0GNv5H1u3g" },
          { name: "Counter Intelligence", commanders: ["Inspirit, Flagship Vessel", "Kilo, Apogee Mind"], colorIdentity: "URW", decklistUrl: "https://moxfield.com/decks/K_R2ARDl_0W6Bs-mVi-vCA" }
        ]
      },
      {
        name: "Final Fantasy",
        code: "FIN",
        decks: [
          { name: "Revival Trance", commanders: ["Terra, Herald of Hope"], colorIdentity: "RWB", decklistUrl: "https://moxfield.com/decks/TdOsPBP3302BdskyLVzU-A" },
          { name: "Limit Break", commanders: ["Cloud, Ex-SOLDIER"], colorIdentity: "RGW", decklistUrl: "https://moxfield.com/decks/xNhT2XmIrkOu2lXb4-vjhg" },
          { name: "Counter Blitz", commanders: ["Tidus, Yuna's Guardian"], colorIdentity: "GWU", decklistUrl: "https://moxfield.com/decks/lrrdWuKxM0KM9uE9-x4LJw" },
          { name: "Scions & Spellcraft", commanders: ["Y'shtola, Night's Blessed"], colorIdentity: "WUB", decklistUrl: "https://moxfield.com/decks/3s_W4MAiukee07B9aAs5EQ" }
        ]
      },
      {
        name: "Tarkir: Dragonstorm",
        code: "TDC",
        decks: [
          { name: "Abzan Armor", commanders: ["Felothar the Steadfast"], colorIdentity: "WBG", decklistUrl: "https://moxfield.com/decks/HRkJg22HtkC8VhQ49cHIMg" },
          { name: "Jeskai Striker", commanders: ["Shiko and Narset, Unified"], colorIdentity: "URW", decklistUrl: "https://moxfield.com/decks/90IaIz_OaUyg1oE7a2OQsw" },
          { name: "Sultai Arisen", commanders: ["Kotis, Sibsig Champion"], colorIdentity: "BGU", decklistUrl: "https://moxfield.com/decks/ckpy_1FNIEiFMXqyA6NbYQ" },
          { name: "Mardu Surge", commanders: ["Neriv, Crackling Vanguard"], colorIdentity: "RWB", decklistUrl: "https://moxfield.com/decks/8KaWrDZ65k6x_VvjwJclGg" },
          { name: "Temur Roar", commanders: ["Eshki, Temur's Roar"], colorIdentity: "GUR", decklistUrl: "https://moxfield.com/decks/dp8QKvCr3EqGF9-qu5Zzfg" }
        ]
      },
      {
        name: "Aetherdrift",
        code: "ADC",
        decks: [
          { name: "Eternal Might", commanders: ["Temmet, Naktamun's Will"], colorIdentity: "WUB", decklistUrl: "https://moxfield.com/decks/XrG-Ct9Mx0SZxXKayAp09w" },
          { name: "Living Energy", commanders: ["Saheeli, Radiant Creator"], colorIdentity: "URG", decklistUrl: "https://moxfield.com/decks/jWSmSfkdGEijTfTX_d8qNQ" }
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
          { name: "Death Toll", commanders: ["Zimone, All-Questioning"], colorIdentity: "BUG", decklistUrl: "https://www.moxfield.com/decks/pdTbH1kXzUuDht7kgBm-1g" },
          { name: "Jump Scare!", commanders: ["Valgavoth, Harrower of Souls"], colorIdentity: "RBU", decklistUrl: "https://www.moxfield.com/decks/caQw6W6nwkSjBJkBED-0-Q" },
          { name: "Miracle Worker", commanders: ["Winter, Cynical Opportunist"], colorIdentity: "WB", decklistUrl: "https://www.moxfield.com/decks/dL6gcTQ7hUq6nQq7fijzUA" },
          { name: "Endless Punishment", commanders: ["Toby, Beastie Befriender"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/pnGkUqRJ5EyzT3J7OSlWeg" }
        ]
      },
      {
        name: "Bloomburrow",
        code: "BLC",
        decks: [
          { name: "Animated Army", commanders: ["Bello, Bard of the Brambles"], colorIdentity: "RG", decklistUrl: "https://www.moxfield.com/decks/GAnCfVPj7EGXBf4ftLgn-A" },
          { name: "Family Matters", commanders: ["Zinnia, Matriarch of Seeds"], colorIdentity: "WUG", decklistUrl: "https://www.moxfield.com/decks/PzY-rAZ3SEiLi_fuR2XBhQ" },
          { name: "Peace Offering", commanders: ["Clement, the Worrywort"], colorIdentity: "GW", decklistUrl: "https://www.moxfield.com/decks/bTMR5Ab1PU-5UzXaQ_OsgQ" },
          { name: "Squirreled Away", commanders: ["Hazel of the Rootbloom"], colorIdentity: "BG", decklistUrl: "https://www.moxfield.com/decks/sxWCdd1NJ0q5JytH2RJyuA" }
        ]
      },
      {
        name: "Modern Horizons 3",
        code: "M3C",
        decks: [
          { name: "Creative Energy", commanders: ["Satya, Aetherflux Genius"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/IDfskZ7CAE2kBVwbWv3cpQ" },
          { name: "Eldrazi Incursion", commanders: ["Ulalek, Fused Atrocity"], colorIdentity: "C", decklistUrl: "https://www.moxfield.com/decks/guLGf5HBmUyrqbttAnng-A" },
          { name: "Graveyard Overdrive", commanders: ["Disa the Restless"], colorIdentity: "BRG", decklistUrl: "https://www.moxfield.com/decks/p9lI8QQGH0eEeJmaPX0KVQ" },
          { name: "Tricky Terrain", commanders: ["Omo, Queen of Vesuva"], colorIdentity: "GU", decklistUrl: "https://www.moxfield.com/decks/GBX3VBGJH0ezo5sOEy53aQ" }
        ]
      },
      {
        name: "Outlaws of Thunder Junction",
        code: "OTC",
        decks: [
          { name: "Desert Bloom", commanders: ["Yuma, Proud Protector"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/5MXFLs15ck6nh85X5VEjyQ" },
          { name: "Grand Larceny", commanders: ["Gonti, Canny Acquisitor"], colorIdentity: "BUG", decklistUrl: "https://www.moxfield.com/decks/kwiSILSLR0ic9U38G00JZQ" },
          { name: "Most Wanted", commanders: ["Olivia, Opulent Outlaw"], colorIdentity: "RWB", decklistUrl: "https://www.moxfield.com/decks/V766u1HzgUCREUUSgsnfFA" },
          { name: "Quick Draw", commanders: ["Stella Lee, Wild Card"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/wpucJrNlHUSL8zosshILkQ" }
        ]
      },
      {
        name: "Fallout",
        code: "PIP",
        decks: [
          { name: "Hail, Caesar", commanders: ["Caesar, Legion's Emperor"], colorIdentity: "RWB", decklistUrl: "https://www.moxfield.com/decks/d4lz50OUpUiGp3o-4kgX4g" },
          { name: "Mutant Menace", commanders: ["The Wise Mothman"], colorIdentity: "BUG", decklistUrl: "https://www.moxfield.com/decks/EE44WgAwhUOI0XRfFQqolQ" },
          { name: "Scrappy Survivors", commanders: ["Dogmeat, Ever Loyal"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/Z2KWcwO1u0GvQC4gbVjPZw" },
          { name: "Science!", commanders: ["Dr. Madison Li"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/BA1a99vfi0W0YLlGC97t-A" }
        ]
      },
      {
        name: "Murders at Karlov Manor",
        code: "MKC",
        decks: [
          { name: "Blame Game", commanders: ["Nelly Borca, Impulsive Accuser"], colorIdentity: "RW", decklistUrl: "https://www.moxfield.com/decks/BPBVD7NsT0SznrmdG4l3Tw" },
          { name: "Deep Clue Sea", commanders: ["Morska, Undersea Sleuth"], colorIdentity: "WU", decklistUrl: "https://www.moxfield.com/decks/kudcIOMGwkuN0hi99q10MQ" },
          { name: "Deadly Disguise", commanders: ["Kaust, Eyes of the Glade"], colorIdentity: "BG", decklistUrl: "https://www.moxfield.com/decks/c9xQjfvGwkCMFmQWcdOKVw" },
          { name: "Revenant Recon", commanders: ["Mirko, Obsessive Theorist"], colorIdentity: "UB", decklistUrl: "https://www.moxfield.com/decks/iGDLYBkYqEGQOinzm-807g" }
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
          { name: "Ahoy Mateys", commanders: ["Admiral Brass, Unsinkable"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/JvChR5Ti-0WW5QE3PD29hA" },
          { name: "Blood Rites", commanders: ["Clavileño, First of the Blessed"], colorIdentity: "WB", decklistUrl: "https://www.moxfield.com/decks/OpCAH5tOAk6UznEeBm2y2Q" },
          { name: "Explorers of the Deep", commanders: ["Hakbal of the Surging Soul"], colorIdentity: "GU", decklistUrl: "https://www.moxfield.com/decks/lnTvk7dGp0KzsvxIMxPDJg" },
          { name: "Veloci-Ramp-Tor", commanders: ["Pantlaza, Sun-Favored"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/viXU1nCwOkmTU5FGQu8MFw" }
        ]
      },
      {
        name: "Doctor Who",
        code: "WHO",
        decks: [
          { name: "Blast from the Past", commanders: ["The Fourth Doctor", "Sarah Jane Smith"], colorIdentity: "GW", decklistUrl: "https://www.moxfield.com/decks/EDdBpyjUFUOBH2ZoOzAkxA" },
          { name: "Masters of Evil", commanders: ["Davros, Dalek Creator", "The Dalek Emperor"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/4gxofFdLD0OQleQer2rVbg" },
          { name: "Paradox Power", commanders: ["The Thirteenth Doctor", "Yasmin Khan"], colorIdentity: "WUG", decklistUrl: "https://www.moxfield.com/decks/l-e7-HDtsk2hXy5HK7ASuQ" },
          { name: "Timey-Wimey", commanders: ["The Tenth Doctor", "Rose Tyler"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/fj8Av0UofkOhiyBAPSOwJw" }
        ]
      },
      {
        name: "Wilds of Eldraine",
        code: "WOC",
        decks: [
          { name: "Fae Dominion", commanders: ["Tegwyll, Duke of Splendor"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/ozDFoD58AkeKWefQLjSo0A" },
          { name: "Virtue and Valor", commanders: ["Ellivere of the Wild Court"], colorIdentity: "GW", decklistUrl: "https://www.moxfield.com/decks/KnMheGE4ykelGVpKNvopNw" }
        ]
      },
      {
        name: "Commander Masters",
        code: "CMM",
        decks: [
          { name: "Eldrazi Unbound", commanders: ["Zhulodok, Void Gorger"], colorIdentity: "C", decklistUrl: "https://www.moxfield.com/decks/KjThzhPw-UCQBu3v3CipMA" },
          { name: "Enduring Enchantments", commanders: ["Anikthea, Hand of Erebos"], colorIdentity: "WBG", decklistUrl: "https://www.moxfield.com/decks/c6yH4J1x7kGNjygB_L_yow" },
          { name: "Planeswalker Party", commanders: ["Commodore Guff"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/8eidLxMRBkqRWg9yIN8nyA" },
          { name: "Sliver Swarm", commanders: ["Sliver Gravemother"], colorIdentity: "WUBRG", decklistUrl: "https://www.moxfield.com/decks/VgocEf5MwUC9SxeIj4iXzQ" }
        ]
      },
      {
        name: "The Lord of the Rings: Tales of Middle-earth",
        code: "LTC",
        decks: [
          { name: "Elven Council", commanders: ["Galadriel, Elven-Queen"], colorIdentity: "GU", decklistUrl: "https://www.moxfield.com/decks/4aKNkLrXmU-zsytziZ6JnQ" },
          { name: "Food and Fellowship", commanders: ["Frodo, Adventurous Hobbit"], colorIdentity: "WBG", decklistUrl: "https://www.moxfield.com/decks/S3X49Miklk6zsQk9VSrt2Q" },
          { name: "Riders of Rohan", commanders: ["Éowyn, Shieldmaiden"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/wWL4dez0i0euOvWSpmQ7UQ" },
          { name: "The Hosts of Mordor", commanders: ["Sauron, Lord of the Rings"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/Z4cD-XEZRUuH4W9jB_SvuA" }
        ]
      },
      {
        name: "March of the Machine",
        code: "MOC",
        decks: [
          { name: "Cavalry Charge", commanders: ["Sidar Jabari of Zhalfir"], colorIdentity: "WB", decklistUrl: "https://www.moxfield.com/decks/PrHvjllh3kuzVuSV2wyhCQ" },
          { name: "Call for Backup", commanders: ["Bright-Palm, Soul Awakener"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/9jXNLpQrv0CQN-d5sJeHFA" },
          { name: "Divine Convocation", commanders: ["Kasla, the Broken Halo"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/SfNm_azRAUGtkhIuesdBIw" },
          { name: "Growing Threat", commanders: ["Brimaz, Blight of Oreskos"], colorIdentity: "WBG", decklistUrl: "https://www.moxfield.com/decks/Rwg0cZ0Yqk2ujq_GXIQA2g" },
          { name: "Tinker Time", commanders: ["Gimbal, Gremlin Prodigy"], colorIdentity: "GUR", decklistUrl: "https://www.moxfield.com/decks/-QW0UquytEiCFJE72zE59w" }
        ]
      },
      {
        name: "Phyrexia: All Will Be One",
        code: "ONC",
        decks: [
          { name: "Corrupting Influence", commanders: ["Ixhel, Scion of Atraxa"], colorIdentity: "WBG", decklistUrl: "https://www.moxfield.com/decks/PvZAYgl5MUWsWFdKKdyIww" },
          { name: "Rebellion Rising", commanders: ["Neyali, Suns' Vanguard"], colorIdentity: "RW", decklistUrl: "https://www.moxfield.com/decks/RHTNEgHYMUigpM8XFwqUeQ" }
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
          { name: "Mishra's Burnished Banner", commanders: ["Mishra, Eminent One"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/2SN7rtbtuEy6rydE2U55gA" },
          { name: "Urza's Iron Alliance", commanders: ["Urza, Chief Artificer"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/yvrb9gEkuUSVBT0ulhjxfA" }
        ]
      },
      {
        name: "Warhammer 40,000",
        code: "40K",
        decks: [
          { name: "Forces of the Imperium", commanders: ["Inquisitor Greyfax"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/pkvfXrVXCkyG5L3OzShe2Q" },
          { name: "Necron Dynasties", commanders: ["Szarekh, the Silent King"], colorIdentity: "B", decklistUrl: "https://www.moxfield.com/decks/8ufvofa2ZkWCvXRR1lCFKQ" },
          { name: "The Ruinous Powers", commanders: ["Abaddon the Despoiler"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/Co8GiCNRIUqzCJBzpdRaAg" },
          { name: "Tyranid Swarm", commanders: ["The Swarmlord"], colorIdentity: "GUR", decklistUrl: "https://www.moxfield.com/decks/IXssBxzerEmQEWWklVWQtA" }
        ]
      },
      {
        name: "Dominaria United",
        code: "DMC",
        decks: [
          { name: "Legends' Legacy", commanders: ["Dihada, Binder of Wills"], colorIdentity: "RWB", decklistUrl: "https://www.moxfield.com/decks/9J-00z816kymdi6vRN_zog" },
          { name: "Painbow", commanders: ["Jared Carthalion"], colorIdentity: "WUBRG", decklistUrl: "https://www.moxfield.com/decks/VI61h_QqUEKf5tLvM5Pdcg" }
        ]
      },
      {
        name: "Baldur's Gate",
        code: "CLB",
        decks: [
          { name: "Draconic Dissent", commanders: ["Firkraag, Cunning Instigator"], colorIdentity: "RU", decklistUrl: "https://www.moxfield.com/decks/ZZIUxi1olEGLv284mGcMzw" },
          { name: "Exit from Exile", commanders: ["Faldorn, Dread Wolf Herald"], colorIdentity: "RG", decklistUrl: "https://www.moxfield.com/decks/std5mk-aL0W4JDzG3IOwbg" },
          { name: "Mind Flayarrrs", commanders: ["Captain N'ghathrod"], colorIdentity: "UB", decklistUrl: "https://www.moxfield.com/decks/Xv5AslbsKE-9-FPK3E3IHQ" },
          { name: "Party Time", commanders: ["Nalia de'Arnise"], colorIdentity: "WB", decklistUrl: "https://www.moxfield.com/decks/h1KFxvzBG0-tkfZVfBJg1A" }
        ]
      },
      {
        name: "Streets of New Capenna",
        code: "NCC",
        decks: [
          { name: "Bedecked Brokers", commanders: ["Perrie, the Pulverizer"], colorIdentity: "WUG", decklistUrl: "https://www.moxfield.com/decks/LMu_N7hy3UWNP-HBkaw_xQ" },
          { name: "Cabaretti Cacophony", commanders: ["Kitt Kanto, Mayhem Diva"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/ONFl58ai-U-S3u539zDJQg" },
          { name: "Maestros Massacre", commanders: ["Anhelo, the Painter"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/flLw5YvIOE2tBprZ_GTsmQ" },
          { name: "Obscura Operation", commanders: ["Kamiz, Obscura Oculus"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/flG8SlpN50qt-L-rQ6VftQ" },
          { name: "Riveteers Rampage", commanders: ["Henzie 'Toolbox' Torre"], colorIdentity: "BRG", decklistUrl: "https://www.moxfield.com/decks/fTgFMxk5cESAhOVIks00kA" }
        ]
      },
      {
        name: "Kamigawa: Neon Dynasty",
        code: "NEC",
        decks: [
          { name: "Buckle Up", commanders: ["Kotori, Pilot Prodigy"], colorIdentity: "WU", decklistUrl: "https://www.moxfield.com/decks/QTZDODqtBUOQGIoEbEDbCQ" },
          { name: "Upgrades Unleashed", commanders: ["Chishiro, the Shattered Blade"], colorIdentity: "RG", decklistUrl: "https://www.moxfield.com/decks/_r0Tk4XqbEOws8IjeFPDlw" }
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
          { name: "Spirit Squadron", commanders: ["Millicent, Restless Revenant"], colorIdentity: "WU", decklistUrl: "https://www.moxfield.com/decks/zoNqxklcjEyz2NZ9MI6jpA" },
          { name: "Vampiric Bloodline", commanders: ["Strefan, Maurer Progenitor"], colorIdentity: "RB", decklistUrl: "https://www.moxfield.com/decks/lava2X1Op0aSeUHhPC5cfQ" }
        ]
      },
      {
        name: "Innistrad: Midnight Hunt",
        code: "MIC",
        decks: [
          { name: "Coven Counters", commanders: ["Leinore, Autumn Sovereign"], colorIdentity: "GW", decklistUrl: "https://www.moxfield.com/decks/dj8xqpaSZUat_G4t1vXcSg" },
          { name: "Undead Unleashed", commanders: ["Wilhelt, the Rotcleaver"], colorIdentity: "UB", decklistUrl: "https://www.moxfield.com/decks/DzZRd4RZDEWK4FwRJdSccw" }
        ]
      },
      {
        name: "Adventures in the Forgotten Realms",
        code: "AFC",
        decks: [
          { name: "Aura of Courage", commanders: ["Galea, Kindler of Hope"], colorIdentity: "WUG", decklistUrl: "https://www.moxfield.com/decks/C-kanWXqiE2nxFWMEouhAw" },
          { name: "Dungeons of Death", commanders: ["Sefris of the Hidden Ways"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/Ym001xPF0E2HZl91qKhcwQ" },
          { name: "Draconic Rage", commanders: ["Vrondiss, Rage of Ancients"], colorIdentity: "RG", decklistUrl: "https://www.moxfield.com/decks/Z0Cz_IU2mkC5Qp9y8Nxgog" },
          { name: "Planar Portal", commanders: ["Prosper, Tome-Bound"], colorIdentity: "RB", decklistUrl: "https://www.moxfield.com/decks/3JwMHo6ANUeV4t-0eNLA5A" }
        ]
      },
      {
        name: "Strixhaven",
        code: "C21",
        decks: [
          { name: "Lorehold Legacies", commanders: ["Osgir, the Reconstructor"], colorIdentity: "RW", decklistUrl: "https://www.moxfield.com/decks/Vgzv5-wfcUqwUbd77Flqhw" },
          { name: "Prismari Performance", commanders: ["Zaffai, Thunder Conductor"], colorIdentity: "RU", decklistUrl: "https://www.moxfield.com/decks/aPbAlXnx1kKMj7EYicfvsg" },
          { name: "Quantum Quandrix", commanders: ["Adrix and Nev, Twincasters"], colorIdentity: "GU", decklistUrl: "https://www.moxfield.com/decks/hNhQ07wNf0e7423P6S1P1g" },
          { name: "Silverquill Statement", commanders: ["Breena, the Demagogue"], colorIdentity: "WB", decklistUrl: "https://www.moxfield.com/decks/_dM2RHtVoUqDHjMko8X4pQ" },
          { name: "Witherbloom Witchcraft", commanders: ["Willowdusk, Essence Seer"], colorIdentity: "BG", decklistUrl: "https://www.moxfield.com/decks/6WeWU_rriEaCGPmJ2l1e1g" }
        ]
      },
      {
        name: "Kaldheim",
        code: "KHC",
        decks: [
          { name: "Elven Empire", commanders: ["Lathril, Blade of the Elves"], colorIdentity: "BG", decklistUrl: "https://www.moxfield.com/decks/diwSjxSEw0O9MDyJU9EYkg" },
          { name: "Phantom Premonition", commanders: ["Ranar the Ever-Watchful"], colorIdentity: "WU", decklistUrl: "https://www.moxfield.com/decks/Go1B3kYCPk6ckaI7hPdShw" }
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
          { name: "Arm for Battle", commanders: ["Wyleth, Soul of Steel"], colorIdentity: "RW", decklistUrl: "https://www.moxfield.com/decks/B5nugPBRnkWIookZqo9N4g" },
          { name: "Reap the Tides", commanders: ["Aesi, Tyrant of Gyre Strait"], colorIdentity: "GU", decklistUrl: "https://www.moxfield.com/decks/K3C1rLmFKE-14OeUeHxdYQ" }
        ]
      },
      {
        name: "Zendikar Rising",
        code: "ZNC",
        decks: [
          { name: "Land's Wrath", commanders: ["Obuun, Mul Daya Ancestor"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/hxxwZ5fXHEWBIKbY3HEpxQ" },
          { name: "Sneak Attack", commanders: ["Anowon, the Ruin Thief"], colorIdentity: "UB", decklistUrl: "https://www.moxfield.com/decks/xaAqhJektkCFh_HAR8cBMg" }
        ]
      },
      {
        name: "Ikoria: Lair of Behemoths",
        code: "C20",
        decks: [
          { name: "Arcane Maelstrom", commanders: ["Kalamax, the Stormsire"], colorIdentity: "GUR", decklistUrl: "https://www.moxfield.com/decks/tNJbhqMb_U-azRDNGIBooA" },
          { name: "Enhanced Evolution", commanders: ["Otrimi, the Ever-Playful"], colorIdentity: "BUG", decklistUrl: "https://www.moxfield.com/decks/LWso_KepWEGAF8XjYQuH9Q" },
          { name: "Ruthless Regiment", commanders: ["Jirina Kudro"], colorIdentity: "RWB", decklistUrl: "https://www.moxfield.com/decks/7a4bmlDVbEeIlvXYrlTIIA" },
          { name: "Symbiotic Swarm", commanders: ["Kathril, Aspect Warper"], colorIdentity: "WBG", decklistUrl: "https://www.moxfield.com/decks/VdxcZ7n6skOrhuElFAa5bg" },
          { name: "Timeless Wisdom", commanders: ["Gavi, Nest Warden"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/FoYllHo-K0WwAeO4uX5uLg" }
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
          { name: "Faceless Menace", commanders: ["Kadena, Slinking Sorcerer"], colorIdentity: "BUG", decklistUrl: "https://www.moxfield.com/decks/gBEKby17r0OMidKZzGZfYQ" },
          { name: "Merciless Rage", commanders: ["Anje Falkenrath"], colorIdentity: "RB", decklistUrl: "https://www.moxfield.com/decks/z_LC4U8zVE6k4Z7EoxPV0g" },
          { name: "Mystic Intellect", commanders: ["Sevinne, the Chronoclasm"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/HQVV0USd-ECJa_7kyXdsnw" },
          { name: "Primal Genesis", commanders: ["Ghired, Conclave Exile"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/647BlyGrEUCXfNB-PTvCxQ" }
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
          { name: "Adaptive Enchantment", commanders: ["Estrid, the Masked"], colorIdentity: "WUG", decklistUrl: "https://www.moxfield.com/decks/fVwQLD6CyU6YhEzQfQWzJw" },
          { name: "Exquisite Invention", commanders: ["Saheeli, the Gifted"], colorIdentity: "RU", decklistUrl: "https://www.moxfield.com/decks/1fVIkyMjc0-PJiofqQgxBQ" },
          { name: "Nature's Vengeance", commanders: ["Lord Windgrace"], colorIdentity: "BRG", decklistUrl: "https://www.moxfield.com/decks/m2GByoxwLU-kOIAWK3nFkw" },
          { name: "Subjective Reality", commanders: ["Aminatou, the Fateshifter"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/7Eph6jxhJkekY-as0pl7XA" }
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
          { name: "Arcane Wizardry", commanders: ["Inalla, Archmage Ritualist"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/8c7doWGiAE6zVNPRbPryDw" },
          { name: "Draconic Domination", commanders: ["The Ur-Dragon"], colorIdentity: "WUBRG", decklistUrl: "https://www.moxfield.com/decks/HoXmEZkVqEi0kybdMDAeIw" },
          { name: "Feline Ferocity", commanders: ["Arahbo, Roar of the World"], colorIdentity: "GW", decklistUrl: "https://www.moxfield.com/decks/fKnrv6xYNky-tT7oz45nmw" },
          { name: "Vampiric Bloodlust", commanders: ["Edgar Markov"], colorIdentity: "RWB", decklistUrl: "https://www.moxfield.com/decks/dne9B6FNGk2I86ppJ3iK5Q" }
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
          { name: "Breed Lethality", commanders: ["Atraxa, Praetors' Voice"], colorIdentity: "WUBG", decklistUrl: "https://www.moxfield.com/decks/VxCoYahRlUa2PjWX9fb53A" },
          { name: "Entropic Uprising", commanders: ["Yidris, Maelstrom Wielder"], colorIdentity: "UBRG", decklistUrl: "https://www.moxfield.com/decks/LZNyKWehuEqouICSnbziFA" },
          { name: "Invent Superiority", commanders: ["Breya, Etherium Shaper"], colorIdentity: "WUBR", decklistUrl: "https://www.moxfield.com/decks/jU5ihzvK8ES7TOlRlw87og" },
          { name: "Open Hostility", commanders: ["Saskia the Unyielding"], colorIdentity: "WBRG", decklistUrl: "https://www.moxfield.com/decks/eX6IyOAU70CFfkW0G6TYyw" },
          { name: "Stalwart Unity", commanders: ["Kynaios and Tiro of Meletis"], colorIdentity: "WURG", decklistUrl: "https://www.moxfield.com/decks/F1sBofALcku8lucubWf4oQ" }
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
          { name: "Call the Spirits", commanders: ["Daxos the Returned"], colorIdentity: "WB", decklistUrl: "https://www.moxfield.com/decks/qmDIgeU_VUijh2qAsWEe1g" },
          { name: "Plunder the Graves", commanders: ["Meren of Clan Nel Toth"], colorIdentity: "BG", decklistUrl: "https://www.moxfield.com/decks/q30rAFH1j0aXV_UyLgUsDg" },
          { name: "Seize Control", commanders: ["Mizzix of the Izmagnus"], colorIdentity: "RU", decklistUrl: "https://www.moxfield.com/decks/qfOr1nvopUeSE7VOvrWx-A" },
          { name: "Swell the Host", commanders: ["Ezuri, Claw of Progress"], colorIdentity: "GU", decklistUrl: "https://www.moxfield.com/decks/m0KtPnA--U2IjyoF_oPP8Q" },
          { name: "Wade into Battle", commanders: ["Kalemne, Disciple of Iroas"], colorIdentity: "RW", decklistUrl: "https://www.moxfield.com/decks/xVx32XM5BkWiriossGKFww" }
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
          { name: "Built from Scratch", commanders: ["Daretti, Scrap Savant"], colorIdentity: "R", decklistUrl: "https://www.moxfield.com/decks/UMBPmBxxhUy3a4gK1vKUXQ" },
          { name: "Forged in Stone", commanders: ["Nahiri, the Lithomancer"], colorIdentity: "W", decklistUrl: "https://www.moxfield.com/decks/VCpZU-l9Ykqx91BzMxKB5A" },
          { name: "Guided by Nature", commanders: ["Freyalise, Llanowar's Fury"], colorIdentity: "G", decklistUrl: "https://www.moxfield.com/decks/s-PLN5Vul0OF8a7xbff0RA" },
          { name: "Peer through Time", commanders: ["Teferi, Temporal Archmage"], colorIdentity: "U", decklistUrl: "https://www.moxfield.com/decks/eI5qvS1WQUqLpM4s4OcFXQ" },
          { name: "Sworn to Darkness", commanders: ["Ob Nixilis of the Black Oath"], colorIdentity: "B", decklistUrl: "https://www.moxfield.com/decks/Ta08Su5JcEGKM4IO9xQLXA" }
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
          { name: "Evasive Maneuvers", commanders: ["Derevi, Empyrial Tactician"], colorIdentity: "WUG", decklistUrl: "https://www.moxfield.com/decks/Vn4nmThMX0W_rpxojp34gw" },
          { name: "Eternal Bargain", commanders: ["Oloro, Ageless Ascetic"], colorIdentity: "WUB", decklistUrl: "https://www.moxfield.com/decks/S2lFhE-IPUe6etycgIBVow" },
          { name: "Mind Seize", commanders: ["Jeleva, Nephalia's Scourge"], colorIdentity: "RUB", decklistUrl: "https://www.moxfield.com/decks/caPxDQM6Zk6R7MNuhVVXqA" },
          { name: "Nature of the Beast", commanders: ["Marath, Will of the Wild"], colorIdentity: "RGW", decklistUrl: "https://www.moxfield.com/decks/qd28JYqCYUKhJtheTNKx6A" },
          { name: "Power Hungry", commanders: ["Prossh, Skyraider of Kher"], colorIdentity: "BRG", decklistUrl: "https://www.moxfield.com/decks/O3zgKgwidEaOkEc0KeyRow" }
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
          { name: "Counterpunch", commanders: ["Ghave, Guru of Spores"], colorIdentity: "WBG", decklistUrl: "https://www.moxfield.com/decks/cQBv30b2bE6sgTM_YaeNQQ" },
          { name: "Devour for Power", commanders: ["The Mimeoplasm"], colorIdentity: "BUG", decklistUrl: "https://www.moxfield.com/decks/ZGQevjc2q0aMZ0IkiwOSIQ" },
          { name: "Heavenly Inferno", commanders: ["Kaalia of the Vast"], colorIdentity: "RWB", decklistUrl: "https://www.moxfield.com/decks/RjnJ0tpS-UyYyu6jVUmR7g" },
          { name: "Mirror Mastery", commanders: ["Riku of Two Reflections"], colorIdentity: "GUR", decklistUrl: "https://www.moxfield.com/decks/70auYSm75E-Iwf4Oc0g7Lg" },
          { name: "Political Puppets", commanders: ["Zedruu the Greathearted"], colorIdentity: "WUR", decklistUrl: "https://www.moxfield.com/decks/Hq90LxdWMUCbrG9fdU3HaQ" }
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
