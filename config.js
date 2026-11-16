// All game numbers live here. Balance the game by editing this file only.
// Money is in dollars. Game seconds are compressed: one game second stands
// in for a good chunk of real shop time.
const CONFIG = {
  saveKey: "clothingBrandMafia.save.v1",   // kept so older saves still load
  saveVersion: 2,                          // 2 = Week 2 (missions, level, zones, rebrand)

  // The B2B page every lesson card links to. PLACEHOLDER: replace with the
  // real address before launch (example.com is a reserved demo domain).
  b2bPageUrl: "https://example.com/replace-with-b2b-page",

  // First-load screen where the player names their brand.
  brand: {
    maxLength: 24,
    promptTitle: "Name your brand",
    promptText: "Every clothing brand starts with a name. Pick yours. It goes on your result card.",
    placeholder: "e.g. Midnight Threads",
    startButton: "Start my brand",
    emptyError: "Please type a brand name first.",
  },

  // Result card, shown once when the player reaches the milestone.
  // It can be downloaded as a PNG drawn on a canvas.
  resultCard: {
    milestone: { stat: "totalSales", min: 10000 },   // stat names are saved numbers: totalSales, ordersShipped, reputation
    size: 1080,                                      // PNG is size x size pixels
    heading: "Milestone reached!",
    gameName: "Clothing Brand Mafia",
    cashLabel: "Cash earned",
    ordersLabel: "Orders shipped",
    footer: "Run your own clothing brand. Free to play.",
    linkText: "Learn how to run a real clothing brand",
    viewButton: "View my result card",
    downloadButton: "Download PNG",
    closeButton: "Close",
    fileSuffix: "result-card",
    colors: { background: "#15161a", accent: "#2f6fed", text: "#f2f2f2", muted: "#9aa0ad", panel: "#22242b" },
  },

  // Event tracking. Events are always counted in this browser's localStorage.
  // To also send them to GoatCounter (free for reasonable public use), create
  // a free site at goatcounter.com and put its code here, e.g. "mybrand"
  // for mybrand.goatcounter.com. Leave it empty to keep tracking local only.
  tracking: {
    storageKey: "clothingBrandMafia.events.v1",
    goatcounterCode: "",
  },

  startingCash: 300,

  // Small trickle of income, earned every second (also while away).
  // Doubles as a safety net so the player can never be stuck with no cash.
  baseIncomePerSecond: 0.2,

  tickMs: 100,            // how often the game loop runs
  autosaveMs: 5000,       // how often progress is saved
  maxTickSeconds: 5,      // a longer gap between ticks (sleep) counts as time away

  offlineCapHours: 8,     // offline earnings stop after this long
  offlineMinSeconds: 60,  // shorter absences show no welcome-back message

  reputation: {
    start: 5,
    max: 10,
    gainPerShippedOrder: 0.5,   // every order shipped on time earns this
    lossPerMissedDeadline: 1,
  },

  // Shown when the player has no orders and not enough cash for the
  // cheapest one: a supplier tops the cash up to that amount.
  rescue: {
    message: "A friendly supplier gave you credit to get going again:",
  },

  ui: {
    urgentDeadlineShare: 0.25,  // deadline turns red when this share of it is left
  },

  // ---------------------------------------------------------------------
  // THE ECONOMY
  //
  // Target: a "standard" order (standardQuantity tees) at the base price
  // earns a profit of about 30% of the sale price (profit / revenue).
  //
  // Standard order, 50 tees, per-tee cost:
  //   blank      5.00  a plain mid-weight cotton tee bought wholesale.
  //                    It is the biggest cost, about 60% of the total,
  //                    which is how it really is in screen printing.
  //   ink        0.80  plastisol ink for one front print.
  //   screen     0.50  a $25 screen (burning the stencil) shared over
  //                    50 tees. It is a one-off per order, so small
  //                    orders pay much more per tee.
  //   labour     1.50  about 6 minutes of handling per tee at $15 / hour.
  //   packaging  0.60  folding, polybag and a label.
  //   -------------------
  //   total      8.40
  //
  // Sale price $12.00 per tee -> profit 3.60 per tee = 30.0% of price.
  // ---------------------------------------------------------------------
  economy: {
    standardQuantity: 50,
    targetMargin: 0.30,
  },

  orders: {
    firstOrderDelaySec: 3,   // wait before the very first order
    arrivalMinSec: 15,       // next order arrives after a random wait
    arrivalMaxSec: 30,       // between these two numbers
    maxOpen: 3,              // orders waiting at once
    quantities: [10, 20, 25, 50, 100, 200],
    // Customers only send orders you can plausibly fund: an order is
    // offered only if its total cost is at most (cash not already needed
    // by open orders) x this number. Bigger orders therefore appear as the
    // shop grows, and you are never offered more work than you can pay for.
    offerCostLimitMultiple: 1.5,
    pricePerTee: 12,         // what the customer pays per tee (see above)
    // Deadline = base + perTee * quantity. For 50 tees the steps take
    // about 47s, so the deadline of 120s leaves room to juggle orders.
    deadlineBaseSec: 45,
    deadlineSecPerTee: 1.5,
  },

  costs: {
    blankPerTee: 5.0,
    inkPerTee: 0.8,
    screenPerOrder: 25,
    labourPerTee: 1.5,
    packagingPerTee: 0.6,
  },

  // MINIMUM ORDER QUANTITY (MOQ). Orders are never declined. Below the MOQ
  // the blank supplier adds a small-order surcharge to the blank price,
  // and the order card tells the player so. Together with the fixed screen
  // fee this makes tiny orders close to break-even: 10 tees earn about
  // 3% margin against 30% at 50.
  moq: {
    quantity: 25,
    blankSurchargeRate: 0.25,   // +25% on the blank price below the MOQ
  },

  // BULK DISCOUNTS. The supplier takes this share off the listed parts
  // once an order reaches a quantity break. The best break reached wins.
  bulkDiscount: {
    appliesTo: ["blank", "ink"],
    breaks: [
      { minQuantity: 100, rate: 0.05 },
      { minQuantity: 200, rate: 0.10 },
      { minQuantity: 400, rate: 0.15 },
    ],
  },

  // The four steps, in order. `costs` lists which cost parts are paid when
  // the step starts. Time = baseSec + secPerTee * quantity.
  steps: [
    { id: "buy",   label: "Buy blanks", costs: ["blank"],               baseSec: 4, secPerTee: 0 },
    { id: "print", label: "Print",      costs: ["ink", "screen"],       baseSec: 3, secPerTee: 0.4 },
    { id: "pack",  label: "Pack",       costs: ["labour", "packaging"], baseSec: 2, secPerTee: 0.3 },
    { id: "ship",  label: "Ship",       costs: [],                      baseSec: 3, secPerTee: 0 },
  ],

  // ---------------------------------------------------------------------
  // UPGRADES. Buying level n+1 costs baseCost * costGrowth ^ n (rounded).
  // The effect grows by `perLevel` (a share, 0.12 = 12%) every level, but
  // a single upgrade never cuts a time or cost below `upgradeMinMultiplier`
  // of its base. Different upgrades stack, so the total can go lower.
  //   stepTime: shortens a step (step: a step id, or "all")
  //   partCost: cuts one cost part (part: blank, ink, screen, labour, packaging)
  //   orderPay: raises what orders pay, by +perLevel per level (no cap)
  // Add `orderType` to an effect to make it apply to that order type only.
  // `zone` is the shop zone the upgrade sits in (see `zones` below); it can
  // only be bought once that zone is open.
  // Time upgrades apply when a step starts. Cost and pay upgrades apply when
  // an order arrives, so an order already on screen keeps its price.
  // ---------------------------------------------------------------------
  upgradeMinMultiplier: 0.25,
  upgrades: [
    // Print Floor (open from the start)
    { id: "press", name: "Press", zone: "printFloor", maxLevel: 5, baseCost: 120, costGrowth: 1.7,
      effect: { type: "stepTime", step: "print", perLevel: 0.12 } },
    { id: "dryer", name: "Dryer", zone: "printFloor", maxLevel: 5, baseCost: 100, costGrowth: 1.7,
      effect: { type: "stepTime", step: "pack", perLevel: 0.12 } },
    { id: "flash", name: "Flash cure", zone: "printFloor", maxLevel: 5, baseCost: 140, costGrowth: 1.8,
      effect: { type: "partCost", part: "ink", perLevel: 0.05 } },   // fewer misprints and wasted ink
    { id: "staff", name: "Staff", zone: "printFloor", maxLevel: 5, baseCost: 200, costGrowth: 1.8,
      effect: { type: "stepTime", step: "all", perLevel: 0.06 } },

    // Cut & Sew: making blanks in-house is cheaper than buying them in.
    { id: "cuttingTable", name: "Cutting table", zone: "cutSew", maxLevel: 5, baseCost: 300, costGrowth: 1.8,
      effect: { type: "partCost", part: "blank", perLevel: 0.04 } },

    // Packing Room: a proper station and packaging bought in bulk.
    { id: "packingStation", name: "Packing station", zone: "packing", maxLevel: 5, baseCost: 250, costGrowth: 1.7,
      effect: { type: "stepTime", step: "pack", perLevel: 0.10 } },
    { id: "bulkPackaging", name: "Bulk packaging", zone: "packing", maxLevel: 5, baseCost: 200, costGrowth: 1.7,
      effect: { type: "partCost", part: "packaging", perLevel: 0.08 } },

    // Embroidery Corner: a multi-head machine stitches several pieces at once.
    { id: "multiHead", name: "Multi-head machine", zone: "embroideryCorner", maxLevel: 5, baseCost: 400, costGrowth: 1.8,
      effect: { type: "stepTime", step: "print", orderType: "embroidery", perLevel: 0.15 } },

    // Kpda Karkhana Bulk Desk: an account manager wins better bulk rates.
    { id: "accountManager", name: "Account manager", zone: "bulkDesk", maxLevel: 5, baseCost: 600, costGrowth: 1.8,
      effect: { type: "orderPay", orderType: "kpda", perLevel: 0.03 } },
  ],

  // ---------------------------------------------------------------------
  // SHOP ZONES. Each zone is padlocked until the player reaches a level
  // or holds a cash amount (whichever `requires` names), then it opens by
  // itself and its upgrades can be bought. A zone with no `requires` is
  // open from the start.
  // ---------------------------------------------------------------------
  zones: [
    { id: "printFloor", name: "Print Floor",
      description: "Where every order gets printed." },
    { id: "cutSew", name: "Cut & Sew", requires: { cash: 2000 },
      description: "Cut and sew your own blanks instead of buying them in." },
    { id: "packing", name: "Packing Room", requires: { level: 3 },
      description: "A proper room for folding, bagging and labelling." },
    { id: "embroideryCorner", name: "Embroidery Corner", requires: { level: 5 },
      description: "Space for embroidery machines." },
    { id: "bulkDesk", name: "Kpda Karkhana Bulk Desk", requires: { level: 6 },
      description: "A desk for bulk clients like Kpda Karkhana, our partner." },
  ],

  // ---------------------------------------------------------------------
  // ORDER TYPES. "screen" is the default and uses the numbers above. Other
  // types start from the same numbers and override what differs, but only
  // appear once the unlock with the same id (below) has happened.
  //   weight: how often it arrives next to the others
  //   costs / pricePerTee / quantities / moq: overrides
  //   partLabels / stepLabels: wording for that kind of work
  //   stepTimeMultiplier: slower or faster steps, e.g. { print: 1.5 }
  // ---------------------------------------------------------------------
  orderTypes: {
    screen: { label: "Screen print", weight: 6 },

    // Full-colour direct-to-garment: no screen, small runs, pricey ink, slow.
    // At 20 tees: cost 10.90 vs price 16 -> about 32% margin.
    dtg: {
      label: "DTG print", weight: 2,
      note: "Full-colour small run. No screen fee, but the ink is expensive and printing is slower.",
      pricePerTee: 16,
      quantities: [5, 10, 20, 30],
      moq: { quantity: 10, blankSurchargeRate: 0.10 },
      costs: { inkPerTee: 3.5, screenPerOrder: 0, labourPerTee: 1.8 },
      stepTimeMultiplier: { print: 1.5 },
    },

    // Embroidery: slow, labour heavy, a digitising fee instead of a screen.
    // At 20 tees: cost 13.30 vs price 20 -> about 33% margin.
    embroidery: {
      label: "Embroidery", weight: 2,
      note: "Stitched logos. A one-off digitising fee, lots of labour, and slow machines.",
      pricePerTee: 20,
      quantities: [10, 20, 30],
      moq: { quantity: 20, blankSurchargeRate: 0.15 },
      costs: { inkPerTee: 1.2, screenPerOrder: 40, labourPerTee: 4.5 },
      partLabels: { ink: "Thread", screen: "Digitising" },
      stepLabels: { print: "Embroider" },
      stepTimeMultiplier: { print: 2 },
    },

    // Kpda Karkhana is a partner and bulk client. It sends big orders with a
    // higher MOQ and pays a better price per tee than normal customers.
    // At 100 tees: cost 7.86 vs price 13 -> about 40% margin.
    kpda: {
      label: "Kpda Karkhana (bulk client)", weight: 2,
      note: "Bulk client and partner. Big orders, a higher minimum, and a better price per tee.",
      pricePerTee: 13,
      quantities: [100, 200, 400],
      moq: { quantity: 100, blankSurchargeRate: 0.25 },
    },
  },

  // ---------------------------------------------------------------------
  // UNLOCKS. Each id matches an order type. `requires.stat` is a number in
  // the save (ordersShipped, totalSales = lifetime money from shipped
  // orders, reputation) and `min` is the value needed. Once unlocked, always
  // unlocked.
  // ---------------------------------------------------------------------
  unlocks: {
    dtg: {
      name: "DTG printing",
      description: "DTG orders now arrive: small full-colour runs that pay well.",
      requires: { stat: "ordersShipped", min: 5, label: "orders shipped" },
    },
    embroidery: {
      name: "Embroidery",
      description: "Embroidery orders now arrive: stitched logos at a premium price.",
      requires: { stat: "totalSales", min: 3000, label: "total sales ($)" },
    },
    kpda: {
      name: "Kpda Karkhana, bulk client",
      description: "Our partner Kpda Karkhana now sends big bulk orders with a higher minimum and a better price.",
      requires: { stat: "reputation", min: 8, label: "reputation" },
    },
  },

  // ---------------------------------------------------------------------
  // PLAYER LEVEL. XP comes from missions (see below) and from every order
  // shipped: perOrder + perTee x tees. Going from level n to n+1 takes
  // firstLevelXp x growth^(n-1) XP, so levels get slowly harder:
  // level 2 at 60 XP, 3 at 144, 4 at 262, 5 at 427, 6 at 658, 7 at 981.
  // ---------------------------------------------------------------------
  level: {
    xpPerOrder: 10,
    xpPerTee: 0.2,
    firstLevelXp: 60,
    growth: 1.4,
    max: 50,
  },

  // ---------------------------------------------------------------------
  // REBRAND (prestige). Opens once this brand has made `minRunSales` in
  // sales since the last rebrand. Rebranding gives Brand Value points:
  //   points = floor((sales this brand / pointDivisor) ^ pointExponent)
  // e.g. $15,000 -> 3 points, $40,000 -> 6 points, $100,000 -> 10 points.
  // Each point makes every order pay `payBonusPerPoint` more, for good.
  // ---------------------------------------------------------------------
  rebrand: {
    minRunSales: 15000,
    pointDivisor: 1000,
    pointExponent: 0.5,
    payBonusPerPoint: 0.05,
    title: "Rebrand",
    intro: "Rebranding starts your shop again under a new name. You lose your cash and machines, " +
      "but the name you built is worth something: you keep Brand Value points that make every order pay more, for good.",
    resetsTitle: "What resets",
    resets: [
      "Cash (back to {startingCash})",
      "All upgrades",
      "Open orders",
      "Sales counted toward the next rebrand",
    ],
    keepsTitle: "What stays",
    keeps: [
      "Level and XP",
      "Lessons you have seen",
      "Missions",
      "Unlocks: DTG, embroidery, Kpda Karkhana",
      "Shop zones you have opened",
      "Reputation",
      "Brand Value points ({bonusPerPoint} more order pay each)",
    ],
    locked: "Rebrand opens once this brand has made {target} in sales ({current} so far).",
    ready: "Rebrand now to gain {points} Brand Value points. Orders will then pay {totalBonus} more.",
    nameLabel: "New brand name (leave empty to keep \"{name}\")",
    button: "Rebrand now",
    confirm: "Rebrand as \"{name}\"?\n\nCash, upgrades and open orders reset. You gain {points} Brand Value points.",
    done: "Rebranded as {name}: +{points} Brand Value points. Orders now pay {totalBonus} more.",
    brandValueLine: "Brand Value {points}: orders pay {totalBonus} more",
  },

  // ---------------------------------------------------------------------
  // MISSIONS. Text and order are in missions.js. Here: the target
  // (`amount`, used by gain and reach goals) and the reward for each one.
  // Rewards grow as the missions get harder.
  // ---------------------------------------------------------------------
  missions: {
    "first-order":       { amount: 1,    cash: 50,  xp: 30 },
    "small-run":         { amount: 1,    cash: 60,  xp: 30 },
    "steady-hands":      { amount: 3,    cash: 80,  xp: 40 },
    "first-upgrade":     { amount: 1,    cash: 100, xp: 40 },
    "price-for-profit":  { amount: 1500, cash: 150, xp: 60 },
    "go-digital":        {               cash: 150, xp: 60 },
    "test-run":          { amount: 1,    cash: 200, xp: 80 },
    "packing-room":      {               cash: 200, xp: 80 },
    "cash-cushion":      { amount: 1500, cash: 250, xp: 100 },
    "needle-and-thread": {               cash: 250, xp: 100 },
    "first-stitch":      { amount: 1,    cash: 300, xp: 120 },
    "go-big":            { amount: 1,    cash: 350, xp: 140 },
    "win-the-partner":   {               cash: 400, xp: 160 },
    "bulk-desk":         {               cash: 400, xp: 160 },
    "first-bulk-deal":   { amount: 1,    cash: 500, xp: 200 },
  },

  // Quantities shown in the debug table (open index.html?debug=1).
  debug: {
    quantities: [10, 50, 200],
  },
};
