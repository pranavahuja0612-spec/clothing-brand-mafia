// Game state, loop, orders, upgrades, unlocks, save/load and UI.
// Numbers come from config.js.

const COST_PARTS = [
  ["blank", "Blank tee"],
  ["ink", "Ink"],
  ["screen", "Screen"],
  ["labour", "Labour"],
  ["packaging", "Packaging"],
];

let state = newState();
let unlockMessages = [];   // shown in the banner until the player dismisses it

function newState() {
  return {
    version: CONFIG.saveVersion,
    cash: CONFIG.startingCash,
    reputation: CONFIG.reputation.start,
    ordersShipped: 0,
    totalSales: 0,
    brandName: "",     // chosen by the player on first load
    upgrades: {},      // upgrade id -> level
    unlocked: [],      // unlock ids reached so far
    flags: {},         // one-off things the player has seen (used by lesson triggers)
    lessonsSeen: [],   // lesson card ids already shown
    milestoneReached: false,
    orders: [],
    nextOrderId: 1,
    nextOrderIn: CONFIG.orders.firstOrderDelaySec,
    lastSeen: Date.now(),
  };
}

// ---------- Helpers ----------

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function formatMoney(n) {
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatMoneyExact(n) {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(rate) {
  return Math.round(rate * 100) + "%";
}

function formatNumber(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatDuration(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function setFlag(name) {
  state.flags[name] = true;
}

function partLabel(part) {
  return COST_PARTS.find(([p]) => p === part)[1];
}

// ---------- Upgrades ----------

function upgradeLevel(id) {
  return state.upgrades[id] || 0;
}

function upgradeCost(upgrade) {
  return Math.round(upgrade.baseCost * Math.pow(upgrade.costGrowth, upgradeLevel(upgrade.id)));
}

// Multiplier on a time or cost after `level` levels (1 = no change).
function effectMultiplier(upgrade, level) {
  return Math.max(CONFIG.upgradeMinMultiplier, 1 - upgrade.effect.perLevel * level);
}

function upgradeEffectsOfType(type) {
  return CONFIG.upgrades.filter((u) => u.effect.type === type);
}

function timeMultiplier(stepId) {
  return upgradeEffectsOfType("stepTime")
    .filter((u) => u.effect.step === stepId || u.effect.step === "all")
    .reduce((m, u) => m * effectMultiplier(u, upgradeLevel(u.id)), 1);
}

function partCostMultiplier(part) {
  return upgradeEffectsOfType("partCost")
    .filter((u) => u.effect.part === part)
    .reduce((m, u) => m * effectMultiplier(u, upgradeLevel(u.id)), 1);
}

function describeEffect(upgrade, level) {
  if (level === 0) return "no bonus yet";
  const cut = formatPercent(1 - effectMultiplier(upgrade, level));
  const e = upgrade.effect;
  if (e.type === "stepTime") {
    const what = e.step === "all" ? "Every step" : CONFIG.steps.find((s) => s.id === e.step).label;
    return `${what} takes ${cut} less time`;
  }
  return `${partLabel(e.part)} costs ${cut} less`;
}

function buyUpgrade(id) {
  const upgrade = CONFIG.upgrades.find((u) => u.id === id);
  const level = upgradeLevel(id);
  const cost = upgradeCost(upgrade);
  if (level >= upgrade.maxLevel || state.cash < cost) return;
  state.cash -= cost;
  state.upgrades[id] = level + 1;
  saveGame();
  render();
}

// ---------- Economy ----------

function incomePerSecond() {
  return CONFIG.baseIncomePerSecond;
}

// Earnings for time spent away, capped at CONFIG.offlineCapHours.
function calcOfflineEarnings(awayMs) {
  const capMs = CONFIG.offlineCapHours * 3600 * 1000;
  const countedMs = Math.min(Math.max(awayMs, 0), capMs);
  return {
    seconds: countedMs / 1000,
    earned: (countedMs / 1000) * incomePerSecond(),
    capped: awayMs > capMs,
  };
}

// An order type's settings: the base numbers plus that type's overrides.
function orderType(typeId) {
  const known = CONFIG.orderTypes[typeId] ? typeId : "screen";
  const t = CONFIG.orderTypes[known];
  return {
    id: known,
    label: t.label,
    note: t.note || "",
    weight: t.weight,
    pricePerTee: t.pricePerTee ?? CONFIG.orders.pricePerTee,
    quantities: t.quantities || CONFIG.orders.quantities,
    costs: { ...CONFIG.costs, ...(t.costs || {}) },
    moq: t.moq || CONFIG.moq,
    partLabels: t.partLabels || {},
    stepLabels: t.stepLabels || {},
    stepTimeMultiplier: t.stepTimeMultiplier || {},
  };
}

function isTypeAvailable(typeId) {
  return !CONFIG.unlocks[typeId] || state.unlocked.includes(typeId);
}

// Best bulk discount rate reached at this quantity (0 if none).
function bulkDiscountRate(quantity) {
  return CONFIG.bulkDiscount.breaks
    .filter((b) => quantity >= b.minQuantity)
    .reduce((best, b) => Math.max(best, b.rate), 0);
}

// The next quantity break above this quantity, or null.
function nextBulkBreak(quantity) {
  const higher = CONFIG.bulkDiscount.breaks.filter((b) => b.minQuantity > quantity);
  return higher.sort((a, b) => a.minQuantity - b.minQuantity)[0] || null;
}

// Everything the economy says about an order of this size and type: cost of
// each part, discounts and surcharges, revenue, profit and margin.
// Set withUpgrades to false to see the base numbers.
function calcOrderEconomics(quantity, typeId = "screen", withUpgrades = true) {
  const type = orderType(typeId);
  const c = type.costs;
  const costs = {
    blank: c.blankPerTee * quantity,
    ink: c.inkPerTee * quantity,
    screen: c.screenPerOrder,
    labour: c.labourPerTee * quantity,
    packaging: c.packagingPerTee * quantity,
  };

  const discountRate = bulkDiscountRate(quantity);
  for (const part of CONFIG.bulkDiscount.appliesTo) costs[part] *= 1 - discountRate;

  const belowMoq = quantity < type.moq.quantity;
  const surchargeRate = belowMoq ? type.moq.blankSurchargeRate : 0;
  costs.blank *= 1 + surchargeRate;

  if (withUpgrades) {
    for (const part of Object.keys(costs)) costs[part] *= partCostMultiplier(part);
  }

  const totalCost = sumCosts(costs, Object.keys(costs));
  const revenue = type.pricePerTee * quantity;
  return {
    quantity, typeId: type.id, costs, totalCost, revenue,
    profit: revenue - totalCost,
    margin: (revenue - totalCost) / revenue,
    discountRate, surchargeRate, belowMoq,
  };
}

function sumCosts(costs, parts) {
  return parts.reduce((sum, part) => sum + costs[part], 0);
}

function stepCost(order, step) {
  return sumCosts(order.costs, step.costs);
}

function stepSeconds(order, step) {
  const type = orderType(order.typeId);
  const base = step.baseSec + step.secPerTee * order.quantity;
  const typeFactor = type.stepTimeMultiplier[step.id] ?? 1;
  return base * typeFactor * timeMultiplier(step.id);
}

function stepLabel(order, step) {
  return orderType(order.typeId).stepLabels[step.id] || step.label;
}

// ---------- Orders ----------

// Money the open orders still need for steps not yet paid for.
function committedCosts() {
  let total = 0;
  for (const order of state.orders) {
    const firstUnpaid = order.running ? order.stepIndex + 1 : order.stepIndex;
    CONFIG.steps.slice(firstUnpaid).forEach((step) => { total += stepCost(order, step); });
  }
  return total;
}

// Sizes of this type the player could plausibly pay for, after setting
// aside the money already promised to open orders.
function affordableQuantities(typeId) {
  const available = Math.max(0, state.cash - committedCosts());
  const limit = available * CONFIG.orders.offerCostLimitMultiple;
  return orderType(typeId).quantities.filter(
    (q) => calcOrderEconomics(q, typeId).totalCost <= limit
  );
}

// Choose an unlocked type (weighted) that has a size the player can afford.
// Returns null when nothing is affordable, so no order arrives.
function pickTypeAndQuantity() {
  const candidates = Object.keys(CONFIG.orderTypes).filter(
    (id) => isTypeAvailable(id) && affordableQuantities(id).length > 0
  );
  if (candidates.length === 0) return null;
  const totalWeight = candidates.reduce((sum, id) => sum + orderType(id).weight, 0);
  let roll = Math.random() * totalWeight;
  const typeId = candidates.find((id) => (roll -= orderType(id).weight) < 0) || candidates[0];
  return { typeId, quantity: pickRandom(affordableQuantities(typeId)) };
}

function createOrder(pick = pickTypeAndQuantity()) {
  const o = CONFIG.orders;
  const { typeId, quantity } = pick;
  const econ = calcOrderEconomics(quantity, typeId);   // frozen when the order arrives
  const deadline = o.deadlineBaseSec + o.deadlineSecPerTee * quantity;
  setFlag("sawOrder");
  if (econ.belowMoq) setFlag("sawBelowMoq");
  if (econ.discountRate > 0) setFlag("sawBulkOrder");
  return {
    id: state.nextOrderId++,
    typeId,
    quantity,
    value: econ.revenue,
    costs: econ.costs,
    pricing: {
      discountRate: econ.discountRate,
      surchargeRate: econ.surchargeRate,
      belowMoq: econ.belowMoq,
    },
    deadline,
    deadlineTotal: deadline,
    stepIndex: 0,      // next step to do
    running: false,    // is a step in progress?
    stepLeft: 0,
    stepTotal: 0,
  };
}

function spawnOrders(dt) {
  state.nextOrderIn -= dt;
  if (state.nextOrderIn > 0) return;
  if (state.orders.length < CONFIG.orders.maxOpen) {
    const pick = pickTypeAndQuantity();
    if (pick) state.orders.push(createOrder(pick));
    else rescueIfBroke();
  }
  state.nextOrderIn = randomBetween(CONFIG.orders.arrivalMinSec, CONFIG.orders.arrivalMaxSec);
}

// Safety net so the player is never stuck: with no open orders and too
// little cash for even the cheapest order, a supplier extends credit.
function rescueIfBroke() {
  if (state.orders.length > 0) return;
  const cheapest = Math.min(
    ...orderType("screen").quantities.map((q) => calcOrderEconomics(q, "screen").totalCost)
  );
  if (state.cash >= cheapest) return;
  const credit = cheapest - state.cash;
  state.cash += credit;
  showNotice(`${CONFIG.rescue.message} +${formatMoney(credit)}`, "good");
}

function startStep(orderId) {
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || order.running) return;
  const step = CONFIG.steps[order.stepIndex];
  const cost = stepCost(order, step);
  if (state.cash < cost) return;
  state.cash -= cost;
  if (step.id === "buy") setFlag("boughtBlanks");
  order.running = true;
  order.stepTotal = stepSeconds(order, step);
  order.stepLeft = order.stepTotal;
  render();
}

function finishStep(order) {
  order.running = false;
  order.stepIndex += 1;
  if (order.stepIndex >= CONFIG.steps.length) shipOrder(order);
}

function shipOrder(order) {
  state.cash += order.value;
  state.totalSales += order.value;
  state.ordersShipped += 1;
  state.reputation = Math.min(
    CONFIG.reputation.max,
    state.reputation + CONFIG.reputation.gainPerShippedOrder
  );
  removeOrder(order);
  showNotice(`Order #${order.id} shipped: +${formatMoney(order.value)}`, "good");
  if (state.ordersShipped === 1) track("firstOrderShipped");
  checkUnlocks();
  checkMilestone();
  saveGame();
}

function failOrder(order) {
  state.reputation = Math.max(0, state.reputation - CONFIG.reputation.lossPerMissedDeadline);
  removeOrder(order);
  showNotice(
    `Order #${order.id} missed its deadline: -${CONFIG.reputation.lossPerMissedDeadline} reputation`,
    "bad"
  );
  saveGame();
}

function removeOrder(order) {
  state.orders = state.orders.filter((o) => o !== order);
}

function advanceOrders(dt) {
  for (const order of [...state.orders]) {
    order.deadline -= dt;
    if (order.running) {
      order.stepLeft -= dt;
      if (order.stepLeft <= 0) finishStep(order);
    }
    // A shipped order is already removed; anything still open and late fails.
    if (state.orders.includes(order) && order.deadline <= 0) failOrder(order);
  }
}

// ---------- Unlocks ----------

function statValue(stat) {
  return state[stat];
}

function checkUnlocks() {
  for (const [id, unlock] of Object.entries(CONFIG.unlocks)) {
    if (state.unlocked.includes(id)) continue;
    if (statValue(unlock.requires.stat) < unlock.requires.min) continue;
    state.unlocked.push(id);
    announceUnlock(unlock);
  }
}

function announceUnlock(unlock) {
  unlockMessages.push(`${unlock.name}: ${unlock.description}`);
  showUnlockBanner();
}

// ---------- Save / load ----------

function saveGame() {
  state.lastSeen = Date.now();
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(state));
  } catch (e) {
    console.warn("Could not save:", e);
  }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (typeof saved.cash !== "number" || typeof saved.lastSeen !== "number") return null;
    return { ...newState(), ...saved };
  } catch (e) {
    return null;
  }
}

function resetGame() {
  if (!confirm("Erase all progress and start over?")) return;
  localStorage.removeItem(CONFIG.saveKey);
  state = newState();
  unlockMessages = [];
  hideWelcomeBack();
  hideUnlockBanner();
  hideLesson();
  hideResultCard();
  showNotice("");
  ensureBrandName();
  render();
}

// ---------- UI ----------

const el = {
  cash: document.getElementById("cash"),
  reputation: document.getElementById("reputation"),
  notice: document.getElementById("notice"),
  orders: document.getElementById("orders"),
  noOrders: document.getElementById("no-orders"),
  upgrades: document.getElementById("upgrades"),
  unlocks: document.getElementById("unlocks"),
  welcome: document.getElementById("welcome-back"),
  welcomeText: document.getElementById("welcome-back-text"),
  welcomeClose: document.getElementById("welcome-back-close"),
  unlockBanner: document.getElementById("unlock-banner"),
  unlockText: document.getElementById("unlock-banner-text"),
  unlockClose: document.getElementById("unlock-banner-close"),
  reset: document.getElementById("reset"),
  brand: document.getElementById("brand-name"),
  brandOverlay: document.getElementById("brand-overlay"),
  brandForm: document.getElementById("brand-form"),
  brandInput: document.getElementById("brand-input"),
  brandError: document.getElementById("brand-error"),
  lesson: document.getElementById("lesson-card"),
  lessonTitle: document.getElementById("lesson-title"),
  lessonBody: document.getElementById("lesson-body"),
  lessonLink: document.getElementById("lesson-link"),
  lessonClose: document.getElementById("lesson-close"),
  resultOverlay: document.getElementById("result-overlay"),
  resultCanvas: document.getElementById("result-canvas"),
  resultDownload: document.getElementById("result-download"),
  resultClose: document.getElementById("result-close"),
  viewResult: document.getElementById("view-result"),
};

function showNotice(text, kind) {
  el.notice.textContent = text;
  el.notice.className = kind || "";
}

function showWelcomeBack(result) {
  const capNote = result.capped ? ` (capped at ${CONFIG.offlineCapHours} hours)` : "";
  el.welcomeText.textContent =
    `You were away for ${formatDuration(result.seconds)}${capNote}. ` +
    `Your shop earned ${formatMoney(result.earned)} while you were gone. ` +
    `Open orders were put on hold.`;
  el.welcome.hidden = false;
}

function hideWelcomeBack() {
  el.welcome.hidden = true;
}

function showUnlockBanner() {
  el.unlockText.innerHTML = unlockMessages.map((m) => `<p>${m}</p>`).join("");
  el.unlockBanner.hidden = false;
}

function hideUnlockBanner() {
  unlockMessages = [];
  el.unlockBanner.hidden = true;
}

// One card per order. Built once, then updated in place so buttons keep working.
function buildOrderCard(order) {
  const type = orderType(order.typeId);
  const card = document.createElement("div");
  card.className = "panel order";
  card.dataset.id = order.id;
  const rows = COST_PARTS.map(
    ([part, label]) =>
      `<tr><td>${type.partLabels[part] || label}</td><td data-part="${part}"></td><td data-total="${part}"></td></tr>`
  ).join("");
  const pills = CONFIG.steps.map((s) => `<span class="step">${stepLabel(order, s)}</span>`).join("");
  card.innerHTML = `
    <div class="order-head">
      <strong class="order-title"></strong>
      <span class="order-deadline"></span>
    </div>
    <div class="muted order-type"></div>
    <div class="muted order-value"></div>
    <div class="order-notes"></div>
    <table class="costs">
      <tr class="muted"><td>Cost per tee</td><td>each</td><td>order</td></tr>
      ${rows}
      <tr class="total"><td>Total</td><td data-part="all"></td><td data-total="all"></td></tr>
    </table>
    <div class="steps">${pills}</div>
    <div class="bar"><div class="bar-fill"></div></div>
    <button class="order-action"></button>`;
  fillOrderCosts(card, order);
  return card;
}

// Cost rows never change after the order arrives, so fill them once.
function fillOrderCosts(card, order) {
  const q = order.quantity;
  for (const [part] of COST_PARTS) {
    card.querySelector(`[data-part="${part}"]`).textContent = formatMoneyExact(order.costs[part] / q);
    card.querySelector(`[data-total="${part}"]`).textContent = formatMoneyExact(order.costs[part]);
  }
  const total = sumCosts(order.costs, COST_PARTS.map(([p]) => p));
  card.querySelector(`[data-part="all"]`).textContent = formatMoneyExact(total / q);
  card.querySelector(`[data-total="all"]`).textContent = formatMoneyExact(total);
  card.querySelector(".order-title").textContent = `Order #${order.id} · ${q} tees`;
  card.querySelector(".order-type").textContent = orderType(order.typeId).label;
  card.querySelector(".order-value").textContent =
    `Pays ${formatMoney(order.value)} (${formatMoneyExact(order.value / q)} per tee) · ` +
    `profit ${formatMoney(order.value - total)}`;
  card.querySelector(".order-notes").innerHTML = pricingNotes(order)
    .map((note) => `<p class="${note.kind}">${note.text}</p>`)
    .join("");
}

// Tell the player which MOQ and bulk-discount rules apply to this order.
function pricingNotes(order) {
  const type = orderType(order.typeId);
  const pricing = order.pricing || {};
  const notes = [];
  if (type.note) notes.push({ kind: "muted", text: type.note });
  if (pricing.belowMoq) {
    notes.push({
      kind: "warn",
      text: `Below the ${type.moq.quantity}-tee minimum order: the supplier adds a ` +
        `${formatPercent(pricing.surchargeRate)} surcharge to blank tees (already in the cost above).`,
    });
  }
  const discountedParts = CONFIG.bulkDiscount.appliesTo.map(partLabel).join(" and ").toLowerCase();
  if (pricing.discountRate > 0) {
    notes.push({
      kind: "good",
      text: `Bulk discount: ${formatPercent(pricing.discountRate)} off ${discountedParts} (already in the cost above).`,
    });
  }
  const next = nextBulkBreak(order.quantity);
  if (next) {
    notes.push({
      kind: "muted",
      text: `Next bulk break: ${formatPercent(next.rate)} off ${discountedParts} at ${next.minQuantity}+ tees.`,
    });
  }
  return notes;
}

function updateOrderCard(card, order) {
  const secsLeft = Math.max(0, Math.ceil(order.deadline));
  const deadlineEl = card.querySelector(".order-deadline");
  deadlineEl.textContent = `Due in ${secsLeft}s`;
  deadlineEl.classList.toggle("urgent", order.deadline < order.deadlineTotal * CONFIG.ui.urgentDeadlineShare);

  card.querySelectorAll(".step").forEach((pill, i) => {
    pill.classList.toggle("done", i < order.stepIndex);
    pill.classList.toggle("current", i === order.stepIndex);
  });

  const fill = card.querySelector(".bar-fill");
  fill.style.width = order.running ? `${100 * (1 - order.stepLeft / order.stepTotal)}%` : "0%";

  const step = CONFIG.steps[order.stepIndex];
  const label = stepLabel(order, step);
  const button = card.querySelector(".order-action");
  const cost = stepCost(order, step);
  if (order.running) {
    button.textContent = `${label}… ${Math.ceil(order.stepLeft)}s`;
    button.disabled = true;
  } else {
    const price = cost > 0 ? formatMoney(cost) : "free";
    button.textContent = `${label} · ${price} · ${Math.round(stepSeconds(order, step))}s`;
    button.disabled = state.cash < cost;
  }
}

function renderOrders() {
  const open = new Set(state.orders.map((o) => String(o.id)));
  for (const card of [...el.orders.children]) {
    if (!open.has(card.dataset.id)) card.remove();
  }
  for (const order of state.orders) {
    let card = el.orders.querySelector(`[data-id="${order.id}"]`);
    if (!card) {
      card = buildOrderCard(order);
      el.orders.appendChild(card);
    }
    updateOrderCard(card, order);
  }
  el.noOrders.hidden = state.orders.length > 0;
}

// Upgrade rows are built once and updated in place.
function buildUpgradeRows() {
  el.upgrades.innerHTML = CONFIG.upgrades.map((u) => `
    <div class="panel upgrade" data-upgrade="${u.id}">
      <div class="order-head"><strong>${u.name}</strong><span class="upgrade-level"></span></div>
      <div class="muted upgrade-now"></div>
      <div class="muted upgrade-next"></div>
      <button class="upgrade-buy"></button>
    </div>`).join("");
}

function renderUpgrades() {
  for (const u of CONFIG.upgrades) {
    const row = el.upgrades.querySelector(`[data-upgrade="${u.id}"]`);
    const level = upgradeLevel(u.id);
    const maxed = level >= u.maxLevel;
    const cost = upgradeCost(u);
    row.querySelector(".upgrade-level").textContent = `Level ${level} / ${u.maxLevel}`;
    row.querySelector(".upgrade-now").textContent = `Now: ${describeEffect(u, level)}`;
    row.querySelector(".upgrade-next").textContent = maxed
      ? "Fully upgraded"
      : `Next level: ${describeEffect(u, level + 1)}`;
    const button = row.querySelector(".upgrade-buy");
    button.textContent = maxed ? "Maxed" : `Upgrade · ${formatMoney(cost)}`;
    button.disabled = maxed || state.cash < cost;
  }
}

function renderUnlocks() {
  el.unlocks.innerHTML = Object.entries(CONFIG.unlocks).map(([id, unlock]) => {
    const req = unlock.requires;
    const done = state.unlocked.includes(id);
    const progress = `${formatNumber(Math.min(statValue(req.stat), req.min))} / ${formatNumber(req.min)} ${req.label}`;
    return `<div class="unlock ${done ? "done" : ""}">
      <strong>${unlock.name}</strong>
      <span class="muted">${done ? "Unlocked" : "Locked: " + progress}</span>
    </div>`;
  }).join("");
}

function render() {
  el.cash.textContent = formatMoney(state.cash);
  el.reputation.textContent = formatNumber(state.reputation);
  el.brand.textContent = state.brandName;
  el.viewResult.hidden = !state.milestoneReached;
  renderOrders();
  renderUpgrades();
  renderUnlocks();
}

// ---------- Tracking ----------

// Count events in localStorage, and also send them to GoatCounter when a
// site code is set in config.js.
let analyticsQueue = [];

function readEventLog() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG.tracking.storageKey)) || { counts: {}, firstSeen: {} };
  } catch (e) {
    return { counts: {}, firstSeen: {} };
  }
}

function track(name, detail) {
  const label = detail ? `${name}:${detail}` : name;
  const log = readEventLog();
  log.counts[label] = (log.counts[label] || 0) + 1;
  log.firstSeen[label] = log.firstSeen[label] || new Date().toISOString();
  try {
    localStorage.setItem(CONFIG.tracking.storageKey, JSON.stringify(log));
  } catch (e) {
    console.warn("Could not log event:", e);
  }
  sendToGoatCounter(label);
}

function goatCounterReady() {
  return window.goatcounter && typeof window.goatcounter.count === "function";
}

function sendToGoatCounter(label) {
  if (!CONFIG.tracking.goatcounterCode) return;
  if (!goatCounterReady()) {
    analyticsQueue.push(label);   // the script is still loading
    return;
  }
  window.goatcounter.count({ path: "event-" + label.replace(":", "-"), title: label, event: true });
}

function initAnalytics() {
  const code = CONFIG.tracking.goatcounterCode;
  if (!code) return;
  const script = document.createElement("script");
  script.async = true;
  script.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  script.src = "https://gc.zgo.at/count.js";
  script.onload = () => {
    analyticsQueue.splice(0).forEach(sendToGoatCounter);
  };
  document.head.appendChild(script);
}

// ---------- Lesson cards ----------

// Each lesson in lessons.js names a trigger. These are the checks for them.
const LESSON_TRIGGERS = {
  "first-order-seen": () => state.flags.sawOrder,
  "below-moq-order": () => state.flags.sawBelowMoq,
  "first-blanks-bought": () => state.flags.boughtBlanks,
  "first-unlock": () => state.unlocked.length > 0,
  "bulk-discount-order": () => state.flags.sawBulkOrder,
  "first-order-shipped": () => state.ordersShipped > 0,
};

let currentLesson = null;

// Show the next unseen lesson whose trigger is true, one at a time.
function checkLessons() {
  if (currentLesson || !state.brandName) return;
  const next = LESSONS.find((lesson) => {
    const trigger = LESSON_TRIGGERS[lesson.trigger];
    return !state.lessonsSeen.includes(lesson.id) && trigger && trigger();
  });
  if (next) showLesson(next);
}

function showLesson(lesson) {
  currentLesson = lesson;
  state.lessonsSeen.push(lesson.id);   // each card shows only once, ever
  el.lessonTitle.textContent = lesson.title;
  el.lessonBody.textContent = lesson.body;
  el.lessonLink.href = CONFIG.b2bPageUrl;
  el.lessonLink.textContent = lesson.linkText + " →";
  el.lesson.hidden = false;
  document.body.classList.add("lesson-open");
  track("lessonOpened", lesson.id);
  saveGame();
}

function hideLesson() {
  currentLesson = null;
  el.lesson.hidden = true;
  document.body.classList.remove("lesson-open");
}

// ---------- Brand name ----------

function ensureBrandName() {
  el.brandOverlay.hidden = !!state.brandName;
  if (!state.brandName) el.brandInput.focus();
}

function submitBrandName(event) {
  event.preventDefault();
  const name = el.brandInput.value.trim().slice(0, CONFIG.brand.maxLength);
  if (!name) {
    el.brandError.textContent = CONFIG.brand.emptyError;
    return;
  }
  state.brandName = name;
  el.brandError.textContent = "";
  lastTick = Date.now();
  saveGame();
  ensureBrandName();
  render();
}

// ---------- Result card ----------

function checkMilestone() {
  const m = CONFIG.resultCard.milestone;
  if (state.milestoneReached || statValue(m.stat) < m.min) return;
  state.milestoneReached = true;
  saveGame();
  showResultCard();
}

function showResultCard() {
  drawResultCard(el.resultCanvas);
  el.resultOverlay.hidden = false;
}

function hideResultCard() {
  el.resultOverlay.hidden = true;
}

// Shrink text until it fits the width, then return the font size used.
function fitText(ctx, text, maxWidth, startSize, weight) {
  let size = startSize;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && size > 12) {
    size -= 2;
    ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  }
  return size;
}

// Draw the shareable card. Everything is drawn from fractions of the card
// size, so it stays correct if CONFIG.resultCard.size changes.
function drawResultCard(canvas) {
  const rc = CONFIG.resultCard;
  const s = rc.size;
  const c = rc.colors;
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  const centre = s / 2;
  const maxWidth = s * 0.84;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = c.accent;
  ctx.fillRect(0, 0, s, s * 0.03);

  ctx.fillStyle = c.accent;
  ctx.font = `700 ${s * 0.04}px system-ui, sans-serif`;
  ctx.fillText(rc.heading.toUpperCase(), centre, s * 0.12);

  ctx.fillStyle = c.text;
  fitText(ctx, state.brandName, maxWidth, s * 0.12, 800);
  ctx.fillText(state.brandName, centre, s * 0.25);

  const stats = [
    [rc.cashLabel, formatMoney(state.totalSales)],
    [rc.ordersLabel, formatNumber(state.ordersShipped)],
  ];
  stats.forEach(([label, value], i) => {
    const top = s * (0.36 + i * 0.22);
    ctx.fillStyle = c.panel;
    ctx.fillRect(s * 0.08, top, s * 0.84, s * 0.19);
    ctx.fillStyle = c.muted;
    ctx.font = `600 ${s * 0.032}px system-ui, sans-serif`;
    ctx.fillText(label.toUpperCase(), centre, top + s * 0.045);
    ctx.fillStyle = c.text;
    fitText(ctx, value, maxWidth, s * 0.09, 800);
    ctx.fillText(value, centre, top + s * 0.12);
  });

  ctx.fillStyle = c.text;
  ctx.font = `700 ${s * 0.05}px system-ui, sans-serif`;
  ctx.fillText(rc.gameName, centre, s * 0.84);
  ctx.fillStyle = c.muted;
  fitText(ctx, rc.footer, maxWidth, s * 0.03, 400);
  ctx.fillText(rc.footer, centre, s * 0.89);
  ctx.fillStyle = c.accent;
  fitText(ctx, CONFIG.b2bPageUrl, maxWidth, s * 0.03, 600);
  ctx.fillText(CONFIG.b2bPageUrl, centre, s * 0.94);
}

function downloadResultCard() {
  drawResultCard(el.resultCanvas);
  const slug = state.brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brand";
  el.resultCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug}-${CONFIG.resultCard.fileSuffix}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    track("resultCardDownloaded");
  }, "image/png");
}

// ---------- Debug: economy check ----------

// Profit table for every order type at the quantities in CONFIG.debug.quantities,
// using base numbers (no upgrades). Open index.html?debug=1 to see it, or call
// economyReport() in the console.
function economyReport() {
  const rows = [];
  for (const typeId of Object.keys(CONFIG.orderTypes)) {
    for (const quantity of CONFIG.debug.quantities) {
      const e = calcOrderEconomics(quantity, typeId, false);
      rows.push({
        type: typeId,
        tees: quantity,
        revenue: e.revenue,
        cost: e.totalCost,
        profit: e.profit,
        marginPercent: e.margin * 100,
        costPerTee: e.totalCost / quantity,
        note: e.belowMoq
          ? `below MOQ: +${formatPercent(e.surchargeRate)} on blanks`
          : e.discountRate > 0 ? `bulk: -${formatPercent(e.discountRate)}` : "base price",
      });
    }
  }
  return rows;
}

function renderDebugPanel() {
  const panel = document.getElementById("debug");
  const rows = economyReport().map((r) =>
    `<tr><td>${r.type}</td><td>${r.tees}</td><td>${formatMoneyExact(r.revenue)}</td><td>${formatMoneyExact(r.cost)}</td>` +
    `<td>${formatMoneyExact(r.profit)}</td><td>${r.marginPercent.toFixed(1)}%</td>` +
    `<td>${formatMoneyExact(r.costPerTee)}</td><td>${r.note}</td></tr>`
  ).join("");
  const std = calcOrderEconomics(CONFIG.economy.standardQuantity, "screen", false);
  panel.innerHTML = `
    <h2>Debug: economy check (base numbers)</h2>
    <table class="costs">
      <tr class="muted"><td>Type</td><td>Tees</td><td>Revenue</td><td>Cost</td><td>Profit</td><td>Margin</td><td>Cost/tee</td><td>Rule</td></tr>
      ${rows}
    </table>
    <p class="muted">Standard order (${CONFIG.economy.standardQuantity} tees): margin
      ${(std.margin * 100).toFixed(1)}% vs target ${(CONFIG.economy.targetMargin * 100).toFixed(0)}%.</p>
    <h2>Debug: event counts (this browser)</h2>
    <p class="muted">${JSON.stringify(readEventLog().counts)}</p>`;
  panel.hidden = false;
}

// ---------- Loop ----------

let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  if (!state.brandName) return;   // game waits until the player names their brand
  if (dt > CONFIG.maxTickSeconds) {
    applyAway(dt * 1000);   // computer slept or tab was frozen: treat as time away
  } else {
    advanceGame(dt);
  }
  checkLessons();
  render();
}

function advanceGame(dt) {
  state.cash += incomePerSecond() * dt;
  spawnOrders(dt);
  advanceOrders(dt);
}

// Time away earns capped passive income. Orders are paused, not failed.
function applyAway(awayMs) {
  const result = calcOfflineEarnings(awayMs);
  state.cash += result.earned;
  if (result.seconds >= CONFIG.offlineMinSeconds) showWelcomeBack(result);
  saveGame();
}

// ---------- Start ----------

// Words shown in dialogs live in config.js; put them on the page.
function applyConfigText() {
  const b = CONFIG.brand;
  const rc = CONFIG.resultCard;
  document.getElementById("brand-title").textContent = b.promptTitle;
  document.getElementById("brand-text").textContent = b.promptText;
  document.getElementById("brand-submit").textContent = b.startButton;
  el.brandInput.placeholder = b.placeholder;
  el.brandInput.maxLength = b.maxLength;
  const link = document.getElementById("result-link");
  link.href = CONFIG.b2bPageUrl;
  link.textContent = rc.linkText + " →";
  el.resultDownload.textContent = rc.downloadButton;
  el.resultClose.textContent = rc.closeButton;
  el.viewResult.textContent = rc.viewButton;
}

function start() {
  applyConfigText();
  const saved = loadGame();
  if (saved) {
    state = saved;
    applyAway(Date.now() - saved.lastSeen);
  }
  checkUnlocks();   // catches up if config thresholds changed
  lastTick = Date.now();
  initAnalytics();
  track("gameStarted");
  buildUpgradeRows();
  ensureBrandName();
  render();
  saveGame();

  setInterval(tick, CONFIG.tickMs);
  setInterval(saveGame, CONFIG.autosaveMs);
  window.addEventListener("beforeunload", saveGame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveGame();
  });
  if (new URLSearchParams(location.search).has("debug")) renderDebugPanel();
  el.welcomeClose.addEventListener("click", hideWelcomeBack);
  el.unlockClose.addEventListener("click", hideUnlockBanner);
  el.reset.addEventListener("click", resetGame);
  el.brandForm.addEventListener("submit", submitBrandName);
  el.lessonClose.addEventListener("click", hideLesson);
  el.resultClose.addEventListener("click", hideResultCard);
  el.resultDownload.addEventListener("click", downloadResultCard);
  el.viewResult.addEventListener("click", showResultCard);
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-b2b]");
    if (link) track("b2bLinkClicked", link.dataset.b2b);
  });
  el.orders.addEventListener("click", (e) => {
    const button = e.target.closest(".order-action");
    if (button) startStep(Number(button.closest(".order").dataset.id));
  });
  el.upgrades.addEventListener("click", (e) => {
    const button = e.target.closest(".upgrade-buy");
    if (button) buyUpgrade(button.closest(".upgrade").dataset.upgrade);
  });
}

start();
