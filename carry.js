// The carry loop (Week 5). In the 3D view the player walks each order through
// the shop: blanks from the fabric rack to the press, printed tees to the
// packing table, boxes onto the van. Hired staff run the same loop on their
// own. Padlock and upgrade tiles take cash when you stand on them.
//
// The economy is the one in game.js and config.js: every step costs the same
// and is paid when an order's first item enters it; the press and packing
// table take the step's time (with upgrades) shared over the order's items.
// Orders keep their usual stepIndex and running fields, so the save shape
// is unchanged; where the carried items are is rebuilt from those fields on
// load. All numbers are in CONFIG.carry.

const Carry = (() => {
  const C = CONFIG.carry;
  const V = CONFIG.view3d;
  const TXT = C.text;
  const STEP = Object.fromEntries(CONFIG.steps.map((s, i) => [s.id, { ...s, index: i }]));
  const BODY_RADIUS = 0.35;

  let active = false;
  let stations = {};
  let carriers = [];        // carriers[0] is the player
  let tiles = [];
  let records = new Map();  // order id -> where its items are
  let nextItemId = 1;
  let events = [];          // effects for scene3d.js to show
  let idleFor = 0;
  let denyCooldown = 0;
  let chipsBuiltFor = "";
  let chipsUpdatedAt = 0;

  // ---------- Layout ----------

  function cellCentre(cell) {
    const step = V.zoneSize + V.zoneGap;
    return { x: cell[0] * step, z: cell[1] * step };
  }

  function areaCell(areaId) {
    return areaId === "dock" ? V.dockCell : V.layout[areaId];
  }

  function toWorld(areaId, local) {
    const c = cellCentre(areaCell(areaId));
    return { x: c.x + local[0], z: c.z + local[1] };
  }

  function isAreaOpen(areaId) {
    return areaId === "dock" || isZoneOpen(areaId);
  }

  // A point is inside an open room or the dock. Rooms are grown by half the
  // gap so neighbours join up.
  function onFloor(x, z) {
    const half = V.zoneSize / 2 + V.zoneGap / 2 + 0.01;
    const areas = ["dock", ...CONFIG.zones.map((zn) => zn.id)];
    return areas.some((id) => {
      if (!isAreaOpen(id)) return false;
      const c = cellCentre(areaCell(id));
      return Math.abs(x - c.x) <= half && Math.abs(z - c.z) <= half;
    });
  }

  // A carrier fits here when its whole body is on an open floor.
  function walkable(x, z) {
    const r = BODY_RADIUS;
    return onFloor(x, z) && onFloor(x + r, z) && onFloor(x - r, z) && onFloor(x, z + r) && onFloor(x, z - r);
  }

  // Machines and furniture you walk around: [area, local x, local z, radius].
  const OBSTACLES = [
    ["printFloor", C.stations.rack.model, 1.0],
    ["printFloor", C.stations.press.model, 1.5],
    ["printFloor", C.stations.pack.model, 1.0],
    ["embroideryCorner", C.stations.embroidery.model, 1.3],
    ["dock", C.stations.van.model, 1.2],
    ["dock", [C.stations.van.model[0], C.stations.van.model[1] + 1.4], 1.2],
  ];

  function pushOutOfObstacles(pos) {
    for (const [area, local, r] of OBSTACLES) {
      if (!isAreaOpen(area)) continue;
      const o = toWorld(area, local);
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = r + BODY_RADIUS;
      if (d < min && d > 0.0001) {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      }
    }
  }

  function moveBy(c, dx, dz) {
    const p = c.pos;
    if (walkable(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
    } else if (walkable(p.x + dx, p.z)) {
      p.x += dx;
    } else if (walkable(p.x, p.z + dz)) {
      p.z += dz;
    }
    const before = { x: p.x, z: p.z };
    pushOutOfObstacles(p);
    if (!walkable(p.x, p.z)) {
      p.x = before.x;
      p.z = before.z;
    }
  }

  // ---------- Orders and their items ----------

  function itemsFor(order) {
    const n = Math.ceil(order.quantity / C.teesPerItem);
    return Math.min(C.maxItemsPerOrder, Math.max(C.minItemsPerOrder, n));
  }

  function newItem(order, kind) {
    return { id: nextItemId++, orderId: order.id, typeId: order.typeId, kind, born: performance.now() };
  }

  function orderById(id) {
    return state.orders.find((o) => o.id === id) || null;
  }

  // Which machine prints this order's blanks.
  function printStationFor(typeId) {
    return typeId === "embroidery" && isZoneOpen("embroideryCorner") ? stations.embroidery : stations.press;
  }

  // Rebuild where an order's items are from its saved step. Items that were
  // in someone's hands when the game was saved go back to their station.
  function recordFor(order) {
    let rec = records.get(order.id);
    if (rec) return rec;
    const k = itemsFor(order);
    rec = { k, paid: { buy: false, print: false, pack: false }, done: { print: 0, pack: 0 }, loaded: 0, rackLeft: 0 };
    records.set(order.id, rec);
    if (order.stepIndex === STEP.buy.index && order.running) {
      order.stepIndex = STEP.print.index;   // the blanks were already paid for in the 2D view
      order.running = false;
    }
    const s = order.stepIndex;
    const run = order.running;
    const fill = (list, kind) => { for (let i = 0; i < k; i++) list.push(newItem(order, kind)); };
    if (s >= STEP.print.index) rec.paid.buy = true;
    if (s === STEP.print.index) {
      rec.paid.print = run;
      fill(printStationFor(order.typeId).input, "blank");
    } else if (s === STEP.pack.index) {
      rec.paid.print = true;
      rec.done.print = k;
      rec.paid.pack = run;
      fill(run ? stations.pack.input : printStationFor(order.typeId).output, "printed");
    } else if (s >= STEP.ship.index) {
      rec.paid.print = rec.paid.pack = true;
      rec.done.print = rec.done.pack = k;
      if (run) {
        fill(stations.van.input, "box");
        rec.loaded = k;
      } else {
        fill(stations.pack.output, "box");
      }
    }
    return rec;
  }

  function unpaidSteps(order) {
    const rec = recordFor(order);
    return CONFIG.steps.filter((s) => !rec.paid[s.id]);
  }

  // Pay for a step when the order's first item enters it. Returns false if
  // the cash is not there yet.
  function payStep(order, stepId, where) {
    const rec = recordFor(order);
    if (rec.paid[stepId]) return true;
    const step = STEP[stepId];
    const cost = stepCost(order, step);
    if (state.cash < cost) return false;
    state.cash -= cost;
    rec.paid[stepId] = true;
    if (stepId === "buy") setFlag("boughtBlanks");
    if (order.stepIndex === step.index) startStepClock(order, step);
    if (cost > 0) {
      emit({ type: "float", pos: where, text: `-${formatMoney(cost)}`, kind: "cost" });
      playSound("pay");
    }
    return true;
  }

  // Keep the order's own step clock in line with the carried items, so the
  // order card shows progress and the 2D view can carry on from here.
  function startStepClock(order, step) {
    order.running = true;
    order.stepTotal = stepSeconds(order, step);
    order.stepLeft = order.stepTotal;
  }

  function syncStepClock(order) {
    const rec = recordFor(order);
    const step = CONFIG.steps[order.stepIndex];
    if (!step || !order.running) return;
    const done = step.id === "print" ? rec.done.print : step.id === "pack" ? rec.done.pack : 0;
    order.stepTotal = stepSeconds(order, step);
    order.stepLeft = Math.max(0.1, order.stepTotal * (1 - done / rec.k));
  }

  // Move the order to its next step once every item has finished this one.
  function advanceOrder(order) {
    const rec = recordFor(order);
    if (order.stepIndex === STEP.print.index && rec.done.print >= rec.k) {
      order.stepIndex = STEP.pack.index;
      order.running = false;
      if (rec.paid.pack) startStepClock(order, STEP.pack);
    }
    if (order.stepIndex === STEP.pack.index && rec.done.pack >= rec.k) {
      order.stepIndex = STEP.ship.index;
      order.running = false;
    }
    syncStepClock(order);
  }

  // ---------- Stations ----------

  function buildStations() {
    const spot = (s) => toWorld(s.zone, s.spot);
    stations = {
      rack: { id: "rack", gives: "blank", input: [], output: [], area: "printFloor" },
      press: { id: "press", step: "print", takes: "blank", gives: "printed", input: [], output: [], working: new Map(), area: "printFloor" },
      embroidery: { id: "embroidery", step: "print", takes: "blank", gives: "printed", input: [], output: [], working: new Map(), area: "embroideryCorner" },
      pack: { id: "pack", step: "pack", takes: "printed", gives: "box", input: [], output: [], working: new Map(), area: "printFloor" },
      van: { id: "van", takes: "box", input: [], output: [], area: "dock" },
    };
    for (const [id, st] of Object.entries(stations)) st.pos = spot(C.stations[id]);
  }

  function stationOpen(st) {
    return isAreaOpen(st.area);
  }

  // Can this station take the item off a carrier's stack?
  function accepts(st, item) {
    if (!stationOpen(st) || !st.takes || st.takes !== item.kind) return false;
    if (st.step === "print") return printStationFor(item.typeId) === st;
    return true;
  }

  // Blanks waiting at the rack: paid ones first, then the next order's,
  // if there is cash to buy them.
  function rackHasBlanks() {
    return rackStock().count > 0;
  }

  function rackStock() {
    let paid = 0;
    let next = null;
    for (const order of state.orders) {
      const rec = recordFor(order);
      paid += rec.rackLeft;
      if (!rec.paid.buy && !next) next = order;
    }
    const nextCost = next ? stepCost(next, STEP.buy) : 0;
    const affordable = next && state.cash >= nextCost;
    return { paid, next, nextCost, affordable, count: paid + (affordable ? recordFor(next).k : 0) };
  }

  function takeFromRack() {
    for (const order of state.orders) {
      const rec = recordFor(order);
      if (rec.rackLeft > 0) {
        rec.rackLeft -= 1;
        return newItem(order, "blank");
      }
    }
    const next = state.orders.find((o) => !recordFor(o).paid.buy);
    if (!next) return null;
    if (!payStep(next, "buy", stations.rack.pos)) return { need: stepCost(next, STEP.buy) };
    const rec = recordFor(next);
    next.stepIndex = Math.max(next.stepIndex, STEP.print.index);
    next.running = false;
    rec.rackLeft = rec.k - 1;
    return newItem(next, "blank");
  }

  function takeFrom(st) {
    if (st.id === "rack") return takeFromRack();
    return st.output.length ? st.output.pop() : null;
  }

  function availableAt(st) {
    if (!stationOpen(st)) return 0;
    if (st.id === "rack") return rackStock().count;
    return st.output.length;
  }

  function dropAt(st, item) {
    if (st.id === "van") {
      st.input.push(item);
      const order = orderById(item.orderId);
      const rec = recordFor(order);
      rec.loaded += 1;
      if (rec.loaded >= rec.k) shipFromVan(order);
      return;
    }
    st.input.push(item);
  }

  function shipFromVan(order) {
    const value = order.value;
    stations.van.input = stations.van.input.filter((it) => it.orderId !== order.id);
    records.delete(order.id);
    order.stepIndex = STEP.ship.index;
    order.running = false;
    finishStep(order);   // ships it: cash, XP, missions (game.js)
    const at = stations.van.pos;
    emit({ type: "float", pos: at, text: `+${formatMoney(value)}`, kind: "sale" });
    emit({ type: "coins", pos: at, count: 14 });
    emit({ type: "vanTrip" });
    render();
  }

  // Each machine works on one item per order at a time, so orders run side by
  // side as they do in the 2D view.
  function updateMachine(st, dt) {
    if (!stationOpen(st)) return;
    for (const order of state.orders) {
      if (st.working.has(order.id)) continue;
      const index = st.input.findIndex((it) => it.orderId === order.id);
      if (index < 0) continue;
      if (!payStep(order, st.step, st.pos)) {
        st.blockedBy = stepCost(order, STEP[st.step]);
        continue;
      }
      st.blockedBy = 0;
      const [item] = st.input.splice(index, 1);
      const rec = recordFor(order);
      st.working.set(order.id, { item, t: 0, dur: stepSeconds(order, STEP[st.step]) / rec.k });
    }
    for (const [orderId, job] of st.working) {
      job.t += dt;
      if (job.t < job.dur) continue;
      st.working.delete(orderId);
      const order = orderById(orderId);
      if (!order) continue;
      job.item.kind = st.gives;
      job.item.born = performance.now();
      st.output.push(job.item);
      recordFor(order).done[st.step] += 1;
      advanceOrder(order);
    }
    for (const order of state.orders) syncStepClock(order);
  }

  function isBusy(st) {
    return Boolean(st.working && st.working.size > 0);
  }

  // ---------- Carriers: the player and the staff ----------

  function makeCarrier(isPlayer, pos) {
    return {
      isPlayer, pos: { ...pos }, facing: 0, speed: 0, stack: [],
      cool: 0, squash: 0, walk: 0, task: null, think: 0, id: carriers.length,
    };
  }

  function capacity() {
    const bags = CONFIG.upgrades.find((u) => u.effect.type === "carry");
    return C.stackBase + (bags ? upgradeLevel(bags.id) * bags.effect.perLevel : 0);
  }

  function staffWanted() {
    return upgradeLevel("staff") * C.staffPerLevel;
  }

  function restSpot(i) {
    return toWorld("dock", [C.restSpot[0], C.restSpot[1] + i * 0.9]);
  }

  function syncStaff() {
    const want = staffWanted();
    while (carriers.length - 1 < want) {
      const spot = restSpot(carriers.length - 1);
      carriers.push(makeCarrier(false, spot));
      emit({ type: "burst", pos: spot, small: true });
    }
    while (carriers.length - 1 > want) {
      const gone = carriers.pop();
      gone.stack.forEach(returnItem);
    }
  }

  // Put an item back where it came from (a carrier left, or the view changed).
  function returnItem(item) {
    const order = orderById(item.orderId);
    if (!order) return;
    if (item.kind === "blank") recordFor(order).rackLeft += 1;
    else if (item.kind === "printed") printStationFor(item.typeId).output.push(item);
    else stations.pack.output.push(item);
  }

  function nearestStation(pos, reach) {
    let best = null;
    let bestD = reach;
    for (const st of Object.values(stations)) {
      if (!stationOpen(st)) continue;
      const d = Math.hypot(pos.x - st.pos.x, pos.z - st.pos.z);
      if (d <= bestD) {
        best = st;
        bestD = d;
      }
    }
    return best;
  }

  // Swap one item between a carrier and the station it stands at.
  function interact(c, st) {
    const top = c.stack[c.stack.length - 1];
    if (top && accepts(st, top)) {
      c.stack.pop();
      dropAt(st, top);
      c.cool = C.pickSeconds;
      if (c.isPlayer) playSound("drop", c.stack.length);
      return "drop";
    }
    if (c.stack.length >= capacity()) return null;
    if (top && top.kind !== st.gives) return null;
    if (!st.gives || !stationOpen(st)) return null;
    const got = takeFrom(st);
    if (!got) return null;
    if (got.need) {
      if (c.isPlayer && denyCooldown <= 0) {
        emit({ type: "float", pos: st.pos, text: fillText(TXT.needCash, { cash: formatMoney(got.need) }), kind: "deny" });
        playSound("deny");
        denyCooldown = 1.5;
      }
      return null;
    }
    got.born = performance.now();
    c.stack.push(got);
    c.cool = C.pickSeconds;
    c.squash = 1;
    if (c.isPlayer) playSound("pickup", c.stack.length);
    return "pick";
  }

  function updatePlayer(dt) {
    const p = carriers[0];
    const input = typeof Input !== "undefined" ? Input.vector() : { x: 0, y: 0 };
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    // Screen directions on the ground for the fixed isometric camera.
    const dx = (input.x - input.y) / Math.SQRT2;
    const dz = (-input.x - input.y) / Math.SQRT2;
    p.speed = mag * C.playerSpeed;
    if (mag > 0.05) {
      const len = Math.hypot(dx, dz);
      moveBy(p, (dx / len) * p.speed * dt, (dz / len) * p.speed * dt);
      p.facing = Math.atan2(dx, dz);
      idleFor = 0;
    } else {
      idleFor += dt;
    }
    p.cool -= dt;
    if (p.cool <= 0) {
      const st = nearestStation(p.pos, C.reach);
      if (st) interact(p, st);
    }
  }

  // ---------- Staff: the same loop, on their own ----------

  // Where a carrier should take the item on top of its stack.
  function destinationFor(item) {
    if (item.kind === "blank") return printStationFor(item.typeId);
    if (item.kind === "printed") return stations.pack;
    return stations.van;
  }

  function claimedAt(st, except) {
    return carriers.filter((c) => c !== except && !c.isPlayer && c.task && c.task.st === st && c.task.kind === "pick").length;
  }

  function chooseTask(w) {
    if (w.stack.length) return { st: destinationFor(w.stack[w.stack.length - 1]), kind: "drop" };
    const sources = [stations.pack, stations.embroidery, stations.press, stations.rack];
    for (const st of sources) {
      const free = availableAt(st) - claimedAt(st, w) * capacity();
      if (free > 0) return { st, kind: "pick" };
    }
    return null;
  }

  function updateStaff(w, i, dt) {
    w.think -= dt;
    if (!w.task || w.think <= 0) {
      w.task = chooseTask(w);
      w.think = C.staffThinkSeconds;
    }
    const target = w.task ? w.task.st.pos : restSpot(i);
    const dx = target.x - w.pos.x;
    const dz = target.z - w.pos.z;
    const dist = Math.hypot(dx, dz);
    const atTarget = dist < (w.task ? C.reach * 0.8 : 0.1);
    if (!atTarget) {
      const step = Math.min(dist, C.staffSpeed * dt);
      moveBy(w, (dx / dist) * step, (dz / dist) * step);
      w.facing = Math.atan2(dx, dz);
      w.speed = C.staffSpeed;
      return;
    }
    w.speed = 0;
    if (!w.task) return;
    w.cool -= dt;
    if (w.cool > 0) return;
    const did = interact(w, w.task.st);
    // Wait at a machine while more of the same order is about to come off it.
    if (!did && w.task.kind === "pick" && w.stack.length && w.stack.length < capacity() && moreComing(w.task.st, w.stack)) return;
    // Done here: empty after dropping, or full / nothing left after picking.
    if (!did) {
      w.task = null;
      w.think = 0;
    }
  }

  // ---------- Padlock and upgrade tiles ----------

  function buildTiles() {
    tiles = [];
    for (const u of CONFIG.upgrades) {
      const local = C.upgradeTiles[u.id];
      if (!local) continue;
      const area = u.id === "staff" ? "dock" : u.zone;
      tiles.push({ kind: "upgrade", id: u.id, area, pos: toWorld(area, local), fill: 0, armed: true });
    }
    for (const [zoneId, gate] of Object.entries(C.zoneGates)) {
      tiles.push({ kind: "zone", id: zoneId, area: gate.in, pos: toWorld(gate.in, gate.at), fill: 0, armed: true });
    }
  }

  // Upgrade tiles appear after the first sale, so the first minute has one
  // thing to do. Padlocks show from the start, as goals.
  function tileVisible(t) {
    if (!isAreaOpen(t.area)) return false;
    if (t.kind === "zone") return !isZoneOpen(t.id);
    if (state.ordersShipped === 0) return false;
    const u = CONFIG.upgrades.find((x) => x.id === t.id);
    return isZoneOpen(u.zone);
  }

  function tilePrice(t) {
    if (t.kind === "zone") return 0;
    const u = CONFIG.upgrades.find((x) => x.id === t.id);
    return upgradeLevel(u.id) >= u.maxLevel ? 0 : upgradeCost(u);
  }

  function tileReady(t) {
    return t.kind === "zone" ? canOpenZone(t.id) : canBuyUpgrade(t.id);
  }

  // What a tile's label says, for scene3d.js.
  function tileInfo(t) {
    if (t.kind === "zone") {
      const zone = zoneConfig(t.id);
      const r = zone.requires || {};
      const ready = canOpenZone(t.id);
      const need = r.level !== undefined
        ? fillText(TXT.levelGate, { n: r.level })
        : fillText(TXT.cashGate, { cash: formatMoney(r.cash || 0) });
      return { title: zone.name, line: ready ? TXT.ready : need, ready, locked: !ready, maxed: false };
    }
    const u = CONFIG.upgrades.find((x) => x.id === t.id);
    const level = upgradeLevel(u.id);
    const maxed = level >= u.maxLevel;
    return {
      title: `${u.name} ${level + (maxed ? 0 : 1)}`,
      line: maxed ? TXT.maxed : formatMoney(upgradeCost(u)),
      ready: canBuyUpgrade(u.id),
      locked: false,
      maxed,
    };
  }

  function updateTiles(dt) {
    const p = carriers[0];
    for (const t of tiles) {
      if (!tileVisible(t)) {
        t.fill = 0;
        continue;
      }
      const inside = Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z) < C.tileRadius;
      if (!inside) {
        t.fill = Math.max(0, t.fill - dt * 2);
        t.armed = true;
        t.denied = false;
        continue;
      }
      if (!t.armed) continue;
      if (!tileReady(t)) {
        if (!t.denied && tileInfo(t).line !== TXT.maxed) {
          t.denied = true;
          const info = tileInfo(t);
          const text = t.kind === "zone" ? info.line : fillText(TXT.needCash, { cash: info.line });
          emit({ type: "float", pos: t.pos, text, kind: "deny" });
          playSound("deny");
        }
        continue;
      }
      t.fill = Math.min(1, t.fill + dt / C.tileFillSeconds);
      idleFor = 0;
      if (tilePrice(t) > 0) emit({ type: "drainCoin", from: p.pos, to: t.pos });
      playSound("drain", t.fill);
      if (t.fill >= 1) completeTile(t);
    }
  }

  function completeTile(t) {
    t.fill = 0;
    t.armed = false;
    const ok = t.kind === "zone" ? openZone(t.id) : buyUpgrade(t.id);
    if (!ok) return;
    if (t.kind === "upgrade" && t.id === "staff") syncStaff();
    const zonePos = t.kind === "zone" ? toWorld(t.id, [0, 0]) : t.pos;
    emit({ type: "burst", pos: zonePos, big: t.kind === "zone" });
    emit({ type: "shake" });
    emit({ type: "unlocked", kind: t.kind, id: t.id });
    render();
  }

  // Cash shown as already spent while it drains into a tile.
  function pendingSpend() {
    return tiles.reduce((sum, t) => sum + (t.fill > 0 && tileVisible(t) && tileReady(t) ? tilePrice(t) * t.fill : 0), 0);
  }

  // ---------- Guide arrow ----------

  // The next useful thing for the player to do, or null.
  function guide() {
    const p = carriers[0];
    if (!p) return null;
    const top = p.stack[p.stack.length - 1];
    if (top) {
      const st = destinationFor(top);
      const label = st === stations.van ? TXT.toVan : st === stations.pack ? TXT.toPack
        : st === stations.embroidery ? TXT.toEmbroidery : TXT.toPress;
      const source = sourceOf(top.kind, top.typeId);
      if (p.stack.length < capacity() && near(p, source) && (availableAt(source) > 0 || moreComing(source, p.stack))) {
        return null;   // still picking up here, or more of this order is nearly done
      }
      return { pos: st.pos, label };
    }
    if (stations.pack.output.length) return { pos: stations.pack.pos, label: TXT.grabBoxes };
    for (const st of [stations.embroidery, stations.press]) {
      if (stationOpen(st) && st.output.length) return { pos: st.pos, label: TXT.grabPrinted };
    }
    if (rackHasBlanks()) return { pos: stations.rack.pos, label: TXT.grabBlanks };
    if (isBusy(stations.pack) || stations.pack.input.length) return { pos: stations.pack.pos, label: TXT.packing, waiting: true };
    for (const st of [stations.embroidery, stations.press]) {
      if (stationOpen(st) && (isBusy(st) || st.input.length)) return { pos: st.pos, label: TXT.printing, waiting: true };
    }
    const tile = tiles.find((t) => tileVisible(t) && tileReady(t));
    if (tile) return { pos: tile.pos, label: tile.kind === "zone" ? TXT.openZone : TXT.buyTile, tile: true };
    return null;
  }

  function sourceOf(kind, typeId) {
    if (kind === "blank") return stations.rack;
    if (kind === "printed") return printStationFor(typeId);
    return stations.pack;
  }

  // Is the machine still working on items of an order you are carrying?
  function moreComing(st, stack) {
    if (!st.working) return false;
    const ids = new Set(stack.map((it) => it.orderId));
    return [...st.working.keys()].some((id) => ids.has(id)) || st.input.some((it) => ids.has(it.orderId));
  }

  function near(c, st) {
    return Math.hypot(c.pos.x - st.pos.x, c.pos.z - st.pos.z) <= C.reach;
  }

  // Show the arrow all through the first sale; afterwards only when the
  // player has stood still for a while.
  function guideToShow() {
    if (!active || !state.brandName) return null;
    const g = guide();
    if (!g) return null;
    if (state.ordersShipped === 0) return g;
    return idleFor >= C.idleHintSeconds ? g : null;
  }

  // ---------- Orders: tidy up, status text, chips on the HUD ----------

  // Orders that failed or were cleared (rebrand, reset) take their items with them.
  function dropGoneOrders() {
    const open = new Set(state.orders.map((o) => o.id));
    for (const id of [...records.keys()]) {
      if (open.has(id)) continue;
      records.delete(id);
      for (const st of Object.values(stations)) {
        const before = st.input.length + st.output.length;
        st.input = st.input.filter((it) => it.orderId !== id);
        st.output = st.output.filter((it) => it.orderId !== id);
        if (st.working) st.working.delete(id);
        if (before !== st.input.length + st.output.length) emit({ type: "poof", pos: st.pos });
      }
      for (const c of carriers) {
        const before = c.stack.length;
        c.stack = c.stack.filter((it) => it.orderId !== id);
        if (before !== c.stack.length) emit({ type: "poof", pos: c.pos });
      }
    }
    for (const order of state.orders) recordFor(order);
  }

  function stageCounts(order) {
    const rec = recordFor(order);
    const picked = rec.paid.buy ? rec.k - rec.rackLeft : 0;
    return { k: rec.k, picked, printed: rec.done.print, packed: rec.done.pack, loaded: rec.loaded };
  }

  function orderStatus(order) {
    const s = stageCounts(order);
    const names = TXT.orderStage;
    if (s.picked < s.k) return `${names[0]} ${s.picked}/${s.k}`;
    if (s.printed < s.k) return `${names[1]} ${s.printed}/${s.k}`;
    if (s.packed < s.k) return `${names[2]} ${s.packed}/${s.k}`;
    return `${names[3]} ${s.loaded}/${s.k}`;
  }

  function renderChips(now) {
    const box = document.getElementById("order-chips");
    if (!box || now - chipsUpdatedAt < 200) return;
    chipsUpdatedAt = now;
    const ids = state.orders.map((o) => o.id).join(",");
    if (ids !== chipsBuiltFor) {
      chipsBuiltFor = ids;
      box.innerHTML = state.orders.map((o) => `
        <div class="chip" data-chip="${o.id}">
          <span class="chip-dot" style="background:${V.colors.tees[o.typeId] || V.colors.tees.screen}"></span>
          <span class="chip-qty">${o.quantity}</span>
          <span class="chip-pips">${[0, 1, 2, 3].map(() => '<i><b></b></i>').join("")}</span>
          <span class="chip-time"></span>
        </div>`).join("");
    }
    for (const order of state.orders) {
      const chip = box.querySelector(`[data-chip="${order.id}"]`);
      if (!chip) continue;
      const s = stageCounts(order);
      const parts = [s.picked, s.printed, s.packed, s.loaded];
      chip.querySelectorAll(".chip-pips b").forEach((b, i) => { b.style.width = `${(100 * parts[i]) / s.k}%`; });
      const left = Math.max(0, Math.ceil(order.deadline));
      const time = chip.querySelector(".chip-time");
      time.textContent = `${left}s`;
      chip.classList.toggle("urgent", order.deadline < order.deadlineTotal * CONFIG.ui.urgentDeadlineShare);
    }
  }

  // ---------- Effects queue ----------

  function emit(e) {
    if (events.length < 80) events.push(e);
  }

  function takeEvents() {
    return events.splice(0);
  }

  // ---------- Main update ----------

  function update(dt) {
    if (!active || !state.brandName) return;
    dt = Math.min(dt, 0.25);
    denyCooldown -= dt;
    dropGoneOrders();
    syncStaff();
    updatePlayer(dt);
    carriers.slice(1).forEach((w, i) => updateStaff(w, i, dt));
    for (const c of carriers) c.squash = Math.max(0, c.squash - dt * 5);
    for (const st of [stations.press, stations.embroidery, stations.pack]) updateMachine(st, dt);
    updateTiles(dt);
    renderChips(performance.now());
  }

  // ---------- Turning the loop on and off ----------

  function enable() {
    if (active) return;
    buildStations();
    buildTiles();
    records = new Map();
    events = [];
    const start = toWorld("printFloor", [-0.6, 1.2]);
    carriers = [makeCarrier(true, start)];
    active = true;
    for (const order of state.orders) recordFor(order);
    syncStaff();
    document.body.classList.add("carry-on");
    render();
  }

  // Back to the 2D view: steps already paid ahead of the order's current
  // step are refunded, because the 2D view charges them when they start.
  function disable() {
    if (!active) return;
    for (const order of state.orders) {
      const rec = recordFor(order);
      const current = CONFIG.steps[order.stepIndex];
      for (const step of CONFIG.steps.slice(order.stepIndex + 1)) {
        if (rec.paid[step.id]) state.cash += stepCost(order, step);
      }
      order.running = Boolean(current && rec.paid[current.id] && current.id !== "ship");
      if (order.running) syncStepClock(order);
    }
    active = false;
    records = new Map();
    carriers = [];
    document.body.classList.remove("carry-on");
    const box = document.getElementById("order-chips");
    if (box) box.innerHTML = "";
    chipsBuiltFor = "";
    render();
  }

  function reset() {
    if (!active) return;
    active = false;
    enable();
  }

  return {
    enable, disable, reset, update,
    isActive: () => active,
    unpaidSteps, pendingSpend, orderStatus,
    takeEvents, guideToShow, guide,
    // Read by scene3d.js to draw the loop.
    carriers: () => carriers,
    stations: () => stations,
    tiles: () => tiles.filter(tileVisible),
    tileInfo, capacity, rackStock, isBusy, toWorld, cellCentre,
    player: () => carriers[0],
  };
})();
