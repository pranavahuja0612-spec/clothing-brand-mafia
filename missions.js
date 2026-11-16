// Missions: one is active at a time, in this order. All mission text lives
// here. Targets and rewards are numbers, so they live in config.js under
// `missions`, keyed by the same id. "{amount}" in a title is replaced with
// the target from config.js.
//
// goal.type:
//   gain   - raise a counter by `amount` while this mission is active
//   reach  - get a number up to `amount` (any time)
//   unlock - reach the unlock with this id (see `unlocks` in config.js)
//   zone   - open the shop zone with this id (see `zones` in config.js)
// goal.stat: which saved number to watch (ordersShipped, totalSales, cash,
//   reputation, level, or a counter in state.stats such as shippedSmall,
//   shippedBulk, upgradesBought, shipped_dtg, shipped_embroidery, shipped_kpda)
// goal.money: true shows the progress as money

const MISSION_TEXT = {
  label: "Mission {n} of {total}",
  progress: "{current} / {target}",
  reward: "Reward: {cash} + {xp} XP",
  completed: "Mission complete: {title}. +{cash}, +{xp} XP",
  allDoneTitle: "All missions complete",
  allDoneBody: "You went from a first order to your first bulk deal. Keep growing your brand.",
};

const MISSIONS = [
  {
    id: "first-order",
    title: "Ship your first order",
    description: "Take one order through all four steps: buy blanks, print, pack, ship.",
    goal: { type: "gain", stat: "ordersShipped" },
  },
  {
    id: "small-run",
    title: "Ship a small order",
    description: "Ship an order below the minimum order quantity and watch what the surcharge does to your profit.",
    goal: { type: "gain", stat: "shippedSmall" },
  },
  {
    id: "steady-hands",
    title: "Ship {amount} more orders",
    description: "Keep the shop moving. On each order, find the cost line that eats the most money.",
    goal: { type: "gain", stat: "ordersShipped" },
  },
  {
    id: "first-upgrade",
    title: "Buy your first upgrade",
    description: "Faster or cheaper production means more profit from every hour.",
    goal: { type: "gain", stat: "upgradesBought" },
  },
  {
    id: "price-for-profit",
    title: "Make {amount} in sales",
    description: "Sales are not profit. Check the profit line on each order as the money comes in.",
    goal: { type: "gain", stat: "totalSales", money: true },
  },
  {
    id: "go-digital",
    title: "Unlock DTG printing",
    description: "Ship enough orders to add full-colour DTG printing to your shop.",
    goal: { type: "unlock", id: "dtg" },
  },
  {
    id: "test-run",
    title: "Ship a DTG order",
    description: "DTG suits small, colourful runs. It is a cheap way to test a design before a big print run.",
    goal: { type: "gain", stat: "shipped_dtg" },
  },
  {
    id: "packing-room",
    title: "Open the Packing Room",
    description: "Level up to unlock the Packing Room and its upgrades.",
    goal: { type: "zone", id: "packing" },
  },
  {
    id: "cash-cushion",
    title: "Hold {amount} in cash",
    description: "Keep a cash cushion so one big order cannot leave you unable to pay for the next.",
    goal: { type: "reach", stat: "cash", money: true },
  },
  {
    id: "needle-and-thread",
    title: "Unlock embroidery",
    description: "Grow your total sales to add embroidery to your shop.",
    goal: { type: "unlock", id: "embroidery" },
  },
  {
    id: "first-stitch",
    title: "Ship an embroidery order",
    description: "Embroidery sells at a premium, but it is slow. Plan your deadlines around it.",
    goal: { type: "gain", stat: "shipped_embroidery" },
  },
  {
    id: "go-big",
    title: "Ship a bulk order",
    description: "Ship an order big enough to earn a bulk discount from your supplier.",
    goal: { type: "gain", stat: "shippedBulk" },
  },
  {
    id: "win-the-partner",
    title: "Win over Kpda Karkhana",
    description: "Kpda Karkhana, a bulk client, only works with shops it trusts. Build your reputation by shipping on time.",
    goal: { type: "unlock", id: "kpda" },
  },
  {
    id: "bulk-desk",
    title: "Open the Kpda Karkhana Bulk Desk",
    description: "Level up to open a desk for bulk clients, with upgrades for big orders.",
    goal: { type: "zone", id: "bulkDesk" },
  },
  {
    id: "first-bulk-deal",
    title: "Ship your first Kpda Karkhana bulk order",
    description: "Your first bulk deal with a partner. Big volume, a higher minimum, and a better price.",
    goal: { type: "gain", stat: "shipped_kpda" },
  },
];
