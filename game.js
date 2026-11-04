// Game state, loop, save/load and UI. Numbers come from config.js.

let state = newState();

function newState() {
  return {
    version: CONFIG.saveVersion,
    cash: CONFIG.startingCash,
    lastSeen: Date.now(),
  };
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
  hideWelcomeBack();
  render();
}

// ---------- Formatting ----------

function formatMoney(n) {
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatDuration(totalSeconds) {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// ---------- UI ----------

const el = {
  cash: document.getElementById("cash"),
  income: document.getElementById("income"),
  welcome: document.getElementById("welcome-back"),
  welcomeText: document.getElementById("welcome-back-text"),
  welcomeClose: document.getElementById("welcome-back-close"),
  reset: document.getElementById("reset"),
};

function render() {
  el.cash.textContent = formatMoney(state.cash);
  el.income.textContent = `$${incomePerSecond().toFixed(2)} / sec`;
}

function showWelcomeBack(result) {
  const capNote = result.capped
    ? ` (capped at ${CONFIG.offlineCapHours} hours)`
    : "";
  el.welcomeText.textContent =
    `You were away for ${formatDuration(result.seconds)}${capNote}. ` +
    `Your shop earned ${formatMoney(result.earned)} while you were gone.`;
  el.welcome.hidden = false;
}

function hideWelcomeBack() {
  el.welcome.hidden = true;
}

// ---------- Loop ----------

let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  state.cash += incomePerSecond() * dt;
  render();
}

function applyOfflineEarnings(saved) {
  const awayMs = Date.now() - saved.lastSeen;
  const result = calcOfflineEarnings(awayMs);
  state.cash += result.earned;
  if (result.seconds >= CONFIG.offlineMinSeconds) showWelcomeBack(result);
}

// ---------- Start ----------

function start() {
  const saved = loadGame();
  if (saved) {
    state = saved;
    applyOfflineEarnings(saved);
  }
  lastTick = Date.now();
  render();
  saveGame();

  setInterval(tick, CONFIG.tickMs);
  setInterval(saveGame, CONFIG.autosaveMs);
  window.addEventListener("beforeunload", saveGame);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveGame();
  });
  el.welcomeClose.addEventListener("click", hideWelcomeBack);
  el.reset.addEventListener("click", resetGame);
}

start();
