// 3D isometric view of the shop (Week 3). Presentation only: every frame it
// reads `state` and helpers from game.js and draws them. It never changes the
// game. If WebGL is missing or the device is too slow, the 2D page is used.
// All tunable numbers and words are in CONFIG.view3d (config.js).

const View3D = (() => {
  const V = CONFIG.view3d;
  const T = V.text;
  const FLOOR_TOP = 0.25;     // height of a zone's floor slab
  const STEP_COUNT = CONFIG.steps.length;

  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let active = false;
  let rafId = 0;
  let lastFrame = 0;
  let noWebgl = false;
  let loadReported = false;
  let materials = {};

  const view = { panX: 0, panY: 0, zoom: V.zoom.start };
  const pointers = new Map();
  let pinchDistance = 0;

  let zoneViews = {};         // zone id -> { floor, contents, label, lock, open, anim, stations }
  let workers = [];
  let stacks = [];
  let slotOfOrder = new Map(); // order id -> slot 0..maxOpen-1
  let machines = {};
  let dock = null;
  let van = null;
  const vanTrip = { phase: "parked", t: 0, queue: 0 };
  let seenShipped = 0;
  const speedCheck = { startedAt: 0, frames: 0, time: 0, done: false };

  // ---------- Settings (kept apart from the game save) ----------

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(V.settingsKey)) || {};
    } catch (e) {
      return {};
    }
  }

  function writeSettings(settings) {
    try {
      localStorage.setItem(V.settingsKey, JSON.stringify(settings));
    } catch (e) {
      // Private mode: the choice simply is not remembered.
    }
  }

  function webglAvailable() {
    if (typeof THREE === "undefined") return false;
    try {
      const canvas = document.createElement("canvas");
      return Boolean(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
    } catch (e) {
      return false;
    }
  }

  // ---------- Small building blocks ----------

  function mat(color) {
    if (!materials[color]) materials[color] = new THREE.MeshLambertMaterial({ color });
    return materials[color];
  }

  // Remember each mesh's own material so a locked zone can be greyed out
  // and coloured again on unlock.
  function addMesh(geometry, color, x, y, z, parent) {
    const mesh = new THREE.Mesh(geometry, mat(color));
    mesh.position.set(x, y, z);
    mesh.userData.baseMaterial = mesh.material;
    parent.add(mesh);
    return mesh;
  }

  // A box standing on height `y` (its bottom sits at y).
  function box(w, h, d, color, x, y, z, parent) {
    return addMesh(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, parent);
  }

  function cylinder(radius, h, color, x, y, z, parent, segments = 10) {
    return addMesh(new THREE.CylinderGeometry(radius, radius, h, segments), color, x, y + h / 2, z, parent);
  }

  function table(w, d, color, x, z, parent) {
    const top = 0.9;
    box(w, 0.12, d, color, x, FLOOR_TOP + top - 0.12, z, parent);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(0.1, top - 0.12, 0.1, "#3b3f4a", x + sx * (w / 2 - 0.12), FLOOR_TOP, z + sz * (d / 2 - 0.12), parent);
      }
    }
    return FLOOR_TOP + top;
  }

  function cellCentre(cell) {
    const step = V.zoneSize + V.zoneGap;
    return new THREE.Vector3(cell[0] * step, 0, cell[1] * step);
  }

  // A text label drawn on a canvas, shown as a sprite that always faces the camera.
  function makeLabel(text, worldWidth, background) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 112;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(worldWidth, worldWidth * (canvas.height / canvas.width), 1);
    sprite.renderOrder = 10;
    sprite.userData.setText = (value, bg = background) => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = bg;
      roundRect(ctx, 4, 8, canvas.width - 8, canvas.height - 16, 28);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      let size = 52;
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      while (ctx.measureText(value).width > canvas.width - 40 && size > 20) {
        size -= 2;
        ctx.font = `800 ${size}px system-ui, sans-serif`;
      }
      ctx.fillText(value, canvas.width / 2, canvas.height / 2 + 2);
      texture.needsUpdate = true;
    };
    sprite.userData.setText(text);
    return sprite;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Zone contents, built from simple shapes ----------
  // Each builder fills a zone group and returns its station points
  // (local positions where workers stand).

  const BUILDERS = {
    printFloor(g) {
      // Carousel screen press: base, post and four arms with platens.
      cylinder(1.1, 0.4, "#2b2f3a", -1.6, FLOOR_TOP, -1.4, g, 12);
      cylinder(0.18, 1.6, "#868e96", -1.6, FLOOR_TOP + 0.4, -1.4, g);
      const arms = new THREE.Group();
      arms.position.set(-1.6, FLOOR_TOP + 1.3, -1.4);
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.y = (i * Math.PI) / 2;
        box(2.2, 0.12, 0.25, "#495057", 1.1, 0, 0, arm);
        box(0.8, 0.08, 0.9, "#f1f3f5", 2.1, 0.12, 0, arm);
        arms.add(arm);
      }
      g.add(arms);
      // Flash cure unit beside the press.
      cylinder(0.08, 1.1, "#868e96", 0.3, FLOOR_TOP, -2.7, g);
      const flash = box(0.9, 0.25, 0.7, "#e8590c", 0.3, FLOOR_TOP + 1.1, -2.7, g);
      // Conveyor dryer.
      box(4.6, 0.15, 0.9, "#212529", 1.2, FLOOR_TOP + 0.7, 1.4, g);
      box(3.0, 1.1, 1.3, "#495057", 1.2, FLOOR_TOP + 0.45, 1.4, g);
      const glow = box(2.9, 0.06, 0.95, "#ff6b35", 1.2, FLOOR_TOP + 0.86, 1.4, g);
      glow.material = new THREE.MeshBasicMaterial({ color: "#5a2a14" });
      glow.userData.baseMaterial = glow.material;
      // A table for packing until the Packing Room opens.
      table(2.2, 1.2, "#b08968", 2.4, -2.3, g);
      machines.pressArms = arms;
      machines.flash = flash;
      machines.dryerGlow = glow;
      return { print: [-1.6, 0.2], packFallback: [2.4, -1.2] };
    },

    cutSew(g) {
      const top = table(4.5, 1.8, "#c8b28a", 0, -1.2, g);
      const roll = addMesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 10), "#e64980", -1.2, top + 0.3, -1.2, g);
      roll.rotation.x = Math.PI / 2;
      for (const x of [-1.8, 1.6]) {
        const t = table(1.5, 0.9, "#adb5bd", x, 1.9, g);
        box(0.7, 0.45, 0.3, "#f8f9fa", x, t, 1.9, g);
        box(0.15, 0.3, 0.3, "#f8f9fa", x - 0.28, t + 0.45, 1.9, g);
      }
      return { cut: [0, 0.2] };
    },

    packing(g) {
      for (const x of [-1.6, 1.6]) {
        const top = table(2.4, 1.3, "#b08968", x, -0.6, g);
        box(0.5, 0.35, 0.4, "#c08552", x - 0.5, top, -0.6, g);
        box(0.4, 0.3, 0.4, "#c08552", x + 0.4, top, -0.5, g);
      }
      // Shelf of boxed orders.
      for (const level of [0, 1, 2]) {
        box(5, 0.08, 1, "#6c757d", 0, FLOOR_TOP + 0.1 + level * 0.8, -3, g);
        for (let i = 0; i < 5; i++) box(0.7, 0.55, 0.7, "#c08552", -2 + i, FLOOR_TOP + 0.18 + level * 0.8, -3, g);
      }
      return { pack: [-1.6, 0.6] };
    },

    embroideryCorner(g) {
      box(4.4, 1.2, 1.1, "#dee2e6", 0, FLOOR_TOP, -1.2, g);
      machines.embroideryHeads = [];
      for (let i = 0; i < 4; i++) {
        machines.embroideryHeads.push(box(0.55, 0.6, 0.6, "#2fa38a", -1.5 + i, FLOOR_TOP + 1.2, -0.9, g));
      }
      const colours = ["#ff6b6b", "#ffd43b", "#4dabf7", "#f783ac", "#69db7c"];
      colours.forEach((c, i) => {
        addMesh(new THREE.ConeGeometry(0.16, 0.45, 8), c, -1.6 + i * 0.8, FLOOR_TOP + 1.45, -1.55, g);
      });
      return { embroider: [0, 0.6] };
    },

    bulkDesk(g) {
      const top = table(3, 1.3, "#8d6e63", 0, -0.4, g);
      box(3, 0.7, 0.08, "#6d4c41", 0, FLOOR_TOP + 0.1, 0.24, g);
      box(0.5, 0.3, 0.4, "#f8f9fa", 0.8, top, -0.5, g);
      box(0.7, 0.9, 0.7, "#343a40", 0, FLOOR_TOP, -1.6, g);   // chair
      // The Kpda Karkhana sign: two posts and a board with painted text.
      for (const x of [-1.9, 1.9]) cylinder(0.1, 2.9, "#495057", x, FLOOR_TOP, -3, g);
      box(4.2, 1.4, 0.15, "#212529", 0, FLOOR_TOP + 1.7, -3, g);
      g.add(makeSign());
      // Pallets of boxed bulk orders.
      for (const x of [-2.6, 2.6]) {
        box(1.6, 0.15, 1.4, "#a47148", x, FLOOR_TOP, 2.2, g);
        for (let i = 0; i < 3; i++) box(0.65, 0.5, 0.6, "#c08552", x - 0.35 + (i % 2) * 0.7, FLOOR_TOP + 0.15 + Math.floor(i / 2) * 0.5, 2.2, g);
      }
      return { desk: [0, 0.8] };
    },
  };

  function makeSign() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 170;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#c9a23c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1d2230";
    ctx.fillRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.fillStyle = "#ffd166";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 64px system-ui, sans-serif";
    ctx.fillText(T.signTop, canvas.width / 2, 68);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 40px system-ui, sans-serif";
    ctx.fillText(T.signBottom, canvas.width / 2, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.33), new THREE.MeshBasicMaterial({ map: texture }));
    sign.position.set(0, FLOOR_TOP + 2.4, -2.91);
    sign.userData.baseMaterial = sign.material;
    return sign;
  }

  function makePadlock() {
    const lock = new THREE.Group();
    const gold = "#ffd166";
    box(1.3, 1.0, 0.5, gold, 0, 0, 0, lock);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 8, 16, Math.PI), mat("#ced4da"));
    shackle.position.set(0, 1.0, 0);
    lock.add(shackle);
    box(0.18, 0.35, 0.05, "#1d2230", 0, 0.3, 0.26, lock);
    lock.position.y = 2.2;
    lock.rotation.y = Math.PI / 4;   // face the camera
    return lock;
  }

  function buildZone(zone) {
    const group = new THREE.Group();
    group.position.copy(cellCentre(V.layout[zone.id] || [0, 0]));
    world.add(group);
    const color = new THREE.Color(V.colors.zones[zone.id] || V.colors.ground);
    const floorMaterial = new THREE.MeshLambertMaterial({ color });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(V.zoneSize, FLOOR_TOP, V.zoneSize), floorMaterial);
    floor.position.y = FLOOR_TOP / 2;
    group.add(floor);
    const contents = new THREE.Group();
    group.add(contents);
    const builder = BUILDERS[zone.id];
    const stations = builder ? builder(contents) : {};
    const label = makeLabel(zone.name, 4.6, "rgba(0,0,0,0.6)");
    label.position.set(0, 0.9, V.zoneSize / 2 - 0.4);
    group.add(label);
    const lock = makePadlock();
    group.add(lock);
    zoneViews[zone.id] = {
      zone, group, floor, contents, label, lock, stations,
      color, open: null, anim: null,
    };
  }

  function lockedLabel(zone) {
    const r = zone.requires || {};
    const need = r.level !== undefined
      ? fillText(T.levelNeed, { n: r.level })
      : fillText(T.cashNeed, { cash: formatMoney(r.cash || 0) });
    return fillText(T.lockedLabel, { need });
  }

  function setZoneLook(zv, open) {
    const grey = mat(V.colors.locked);
    zv.contents.traverse((m) => {
      if (m.isMesh) m.material = open ? m.userData.baseMaterial : grey;
    });
    zv.floor.material.color.set(open ? zv.color : new THREE.Color(V.colors.locked));
    zv.lock.visible = !open;
    zv.lock.scale.setScalar(1);
    zv.label.userData.setText(open ? zv.zone.name : lockedLabel(zv.zone), open ? "rgba(0,0,0,0.6)" : "rgba(60,40,0,0.75)");
  }

  // ---------- Loading dock, workers, tee stacks, van ----------

  function buildDock() {
    const centre = cellCentre(V.dockCell);
    const group = new THREE.Group();
    group.position.copy(centre);
    world.add(group);
    box(V.zoneSize, FLOOR_TOP, V.zoneSize, V.colors.dock, 0, 0, 0, group);
    box(3, 0.05, 24, V.colors.road, 0, 0, V.zoneSize / 2 + 12, group);   // road out of the shop
    const label = makeLabel(T.dockLabel, 4.2, "rgba(0,0,0,0.6)");
    label.position.set(-2.2, 0.9, V.zoneSize / 2 - 0.4);
    group.add(label);
    dock = { group, centre };
    // One pallet slot per order that can be open at once.
    const slots = CONFIG.orders.maxOpen;
    for (let i = 0; i < slots; i++) {
      const x = (i - (slots - 1) / 2) * 2.4;
      box(1.5, 0.15, 1.2, "#a47148", x, FLOOR_TOP, -2.2, group);
      const layers = [];
      for (let l = 0; l < V.teeStackLayers; l++) {
        const layer = box(1.2, 0.09, 0.9, "#ffffff", x, FLOOR_TOP + 0.15 + l * 0.1, -2.2, group);
        layer.material = new THREE.MeshLambertMaterial({ color: "#ffffff" });
        layer.visible = false;
        layers.push(layer);
      }
      stacks.push({ x, layers });
    }
    van = buildVan();
    van.position.set(0, FLOOR_TOP, 2.4);
    group.add(van);
  }

  function buildVan() {
    const g = new THREE.Group();
    box(1.6, 1.3, 2.4, "#f1f3f5", 0, 0.35, -0.3, g);
    box(1.6, 0.9, 1.0, "#3f6fd8", 0, 0.35, 1.4, g);
    box(1.5, 0.4, 0.05, "#a5d8ff", 0, 0.85, 1.92, g);
    g.userData.wheels = [];
    for (const x of [-0.8, 0.8]) {
      for (const z of [-1, 1.3]) {
        const wheel = addMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10), "#212529", x, 0.3, z, g);
        wheel.rotation.z = Math.PI / 2;
        g.userData.wheels.push(wheel);
      }
    }
    return g;
  }

  function buildWorker(i) {
    const g = new THREE.Group();
    box(0.36, 0.5, 0.24, "#343a40", 0, 0, 0, g);
    box(0.52, 0.6, 0.32, V.colors.shirt[i % V.colors.shirt.length], 0, 0.5, 0, g);
    addMesh(new THREE.SphereGeometry(0.2, 10, 8), "#f1c27d", 0, 1.32, 0, g);
    g.scale.setScalar(1.15);
    g.position.copy(restSpot(i));
    world.add(g);
    return { group: g, walk: 0 };
  }

  function restSpot(i) {
    return dock.centre.clone().add(new THREE.Vector3(-3.2 + i * 0.8, FLOOR_TOP, 1.2));
  }

  function station(zoneId, name, i) {
    const zv = zoneViews[zoneId];
    const p = zv.stations[name] || [0, 0];
    return zv.group.position.clone().add(new THREE.Vector3(p[0] + (i - 1) * 0.6, FLOOR_TOP, p[1]));
  }

  // Where the worker for an order should stand, given the order's step.
  function workerTarget(order, slot) {
    const step = CONFIG.steps[Math.min(order.stepIndex, STEP_COUNT - 1)].id;
    if (step === "buy") {
      if (order.typeId === "kpda" && isZoneOpen("bulkDesk")) return station("bulkDesk", "desk", slot);
      return dock.centre.clone().add(new THREE.Vector3(stacks[slot].x, FLOOR_TOP, -1.1));
    }
    if (step === "print") {
      if (order.typeId === "embroidery" && isZoneOpen("embroideryCorner")) return station("embroideryCorner", "embroider", slot);
      return station("printFloor", "print", slot);
    }
    if (step === "pack") {
      return isZoneOpen("packing") ? station("packing", "pack", slot) : station("printFloor", "packFallback", slot);
    }
    return dock.centre.clone().add(new THREE.Vector3(1.4 + slot * 0.5, FLOOR_TOP, 1.4));
  }

  // Keep each open order on the same pallet slot and worker while it lasts.
  function assignSlots() {
    const ids = new Set(state.orders.map((o) => o.id));
    for (const id of [...slotOfOrder.keys()]) if (!ids.has(id)) slotOfOrder.delete(id);
    const used = new Set(slotOfOrder.values());
    for (const order of state.orders) {
      if (slotOfOrder.has(order.id)) continue;
      for (let s = 0; s < stacks.length; s++) {
        if (!used.has(s)) {
          slotOfOrder.set(order.id, s);
          used.add(s);
          break;
        }
      }
    }
  }

  function orderProgress(order) {
    const within = order.running && order.stepTotal > 0 ? 1 - order.stepLeft / order.stepTotal : 0;
    return Math.min(1, (order.stepIndex + within) / STEP_COUNT);
  }

  // ---------- Per-frame updates ----------

  function updateZones(dt) {
    for (const zv of Object.values(zoneViews)) {
      const open = isZoneOpen(zv.zone.id);
      if (zv.open === null || (!open && zv.open)) {
        setZoneLook(zv, open);
      } else if (open && !zv.open) {
        setZoneLook(zv, true);
        zv.floor.material.color.set(V.colors.locked);
        zv.lock.visible = true;
        zv.anim = 0;   // play the unlock animation
      }
      zv.open = open;
      if (zv.anim !== null) {
        zv.anim = Math.min(1, zv.anim + dt / V.unlockSeconds);
        const t = zv.anim;
        zv.lock.position.y = 2.2 + t * 3;
        zv.lock.scale.setScalar(Math.max(0.001, 1 - t));
        zv.lock.rotation.y = Math.PI / 4 + t * Math.PI * 2;
        zv.floor.material.color.lerpColors(new THREE.Color(V.colors.locked), zv.color, t);
        zv.contents.scale.setScalar(1 + 0.12 * Math.sin(t * Math.PI));
        if (t >= 1) {
          zv.anim = null;
          zv.lock.visible = false;
          zv.lock.position.y = 2.2;
        }
      } else if (!open) {
        zv.lock.position.y = 2.2 + Math.sin(performance.now() / 500) * 0.12;   // gentle bob
      }
    }
  }

  function updateWorkers(dt) {
    assignSlots();
    const orderInSlot = [];
    for (const order of state.orders) orderInSlot[slotOfOrder.get(order.id)] = order;
    workers.forEach((w, i) => {
      const order = orderInSlot[i];
      const target = order ? workerTarget(order, i) : restSpot(i);
      const pos = w.group.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = V.workerSpeed * dt;
      if (dist > 0.05) {
        const k = Math.min(1, stepLen / dist);
        pos.x += dx * k;
        pos.z += dz * k;
        w.group.rotation.y = Math.atan2(dx, dz);
        w.walk += dt * 12;
        pos.y = FLOOR_TOP + Math.abs(Math.sin(w.walk)) * 0.12;
      } else if (order && order.running) {
        w.walk += dt * 8;   // busy at the station
        pos.y = FLOOR_TOP + Math.abs(Math.sin(w.walk)) * 0.06;
      } else {
        pos.y = FLOOR_TOP;
      }
    });
  }

  function updateStacks() {
    stacks.forEach((stack) => stack.layers.forEach((l) => { l.visible = false; }));
    for (const order of state.orders) {
      const stack = stacks[slotOfOrder.get(order.id)];
      if (!stack || order.stepIndex === 0 && !order.running) continue;   // no blanks yet
      const count = Math.max(1, Math.round(orderProgress(order) * V.teeStackLayers));
      const colour = V.colors.tees[order.typeId] || V.colors.tees.screen;
      stack.layers.forEach((layer, l) => {
        layer.visible = l < count;
        layer.material.color.set(colour);
      });
    }
  }

  function updateMachines(dt) {
    const runningStep = (stepId, typeTest) => state.orders.some(
      (o) => o.running && CONFIG.steps[o.stepIndex] && CONFIG.steps[o.stepIndex].id === stepId && typeTest(o.typeId)
    );
    const printing = runningStep("print", (t) => t !== "embroidery" || !isZoneOpen("embroideryCorner"));
    const stitching = runningStep("print", (t) => t === "embroidery") && isZoneOpen("embroideryCorner");
    if (machines.pressArms && printing) machines.pressArms.rotation.y += dt * 1.5;
    if (machines.dryerGlow && isZoneOpen("printFloor")) {
      machines.dryerGlow.material.color.set(printing ? "#ff6b35" : "#5a2a14");
    }
    if (machines.embroideryHeads) {
      const now = performance.now() / 120;
      machines.embroideryHeads.forEach((head, i) => {
        head.position.y = FLOOR_TOP + 1.5 + (stitching ? Math.abs(Math.sin(now + i)) * 0.15 : 0);
      });
    }
  }

  function updateVan(dt) {
    if (state.ordersShipped < seenShipped) seenShipped = state.ordersShipped;   // after a reset
    if (state.ordersShipped > seenShipped) {
      vanTrip.queue += state.ordersShipped - seenShipped;
      seenShipped = state.ordersShipped;
    }
    if (vanTrip.phase === "parked" && vanTrip.queue > 0) {
      vanTrip.queue -= 1;
      vanTrip.phase = "out";
      vanTrip.t = 0;
    }
    if (vanTrip.phase === "parked") return;
    vanTrip.t = Math.min(1, vanTrip.t + dt / V.vanDriveSeconds);
    const ease = vanTrip.t * vanTrip.t;
    const away = vanTrip.phase === "out" ? ease : 1 - vanTrip.t * (2 - vanTrip.t);
    van.position.z = 2.4 + away * 16;
    van.visible = away < 0.95;
    van.userData.wheels.forEach((w) => { w.rotation.x += dt * 14; });
    if (vanTrip.t >= 1) {
      vanTrip.phase = vanTrip.phase === "out" ? "back" : "parked";
      vanTrip.t = 0;
      van.visible = true;
    }
  }

  // ---------- Camera: fixed isometric angle, drag to pan, pinch/scroll to zoom ----------

  const SCREEN_RIGHT = () => new THREE.Vector3(1, 0, -1).normalize();
  const SCREEN_UP = () => new THREE.Vector3(-1, 2, -1).normalize();

  function sceneCentre() {
    const top = cellCentre([0, 0]);
    const bottom = cellCentre(V.dockCell);
    return top.add(bottom).multiplyScalar(0.5);
  }

  function updateCamera() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const half = V.viewSize / 2;
    const aspect = w / h;
    const halfW = aspect >= 1 ? half * aspect : half;
    const halfH = aspect >= 1 ? half : half / aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    // Centre the shop in the part of the screen the overlay leaves free.
    const k = (camera.top - camera.bottom) / camera.zoom / h;
    const target = sceneCentre()
      .add(SCREEN_RIGHT().multiplyScalar(view.panX - freeArea.dx * k))
      .add(SCREEN_UP().multiplyScalar(view.panY + freeArea.dy * k));
    camera.position.copy(target).add(new THREE.Vector3(30, 30, 30));
    camera.lookAt(target);
  }

  // The middle of the screen area not covered by the HUD and the panel, as
  // an offset in pixels from the screen centre. Measured a few times a
  // second, not every frame, because measuring forces a page layout.
  const freeArea = { dx: 0, dy: 0, measuredAt: 0 };

  function measureFreeArea(now) {
    if (now - freeArea.measuredAt < 400) return false;
    freeArea.measuredAt = now;
    const hud = document.getElementById("hud").getBoundingClientRect();
    const sheet = document.getElementById("sheet").getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    let left = 0, right = w, top = 0, bottom = h;
    if (sheet.left > hud.right - 1) {   // side-by-side layout on wide screens
      left = hud.right;
      right = sheet.left;
    } else {
      top = Math.min(hud.bottom, h * 0.6);
      bottom = Math.max(sheet.top, top + 1);
    }
    const dx = (left + right) / 2 - w / 2;
    const dy = (top + bottom) / 2 - h / 2;
    const changed = Math.abs(dx - freeArea.dx) > 1 || Math.abs(dy - freeArea.dy) > 1;
    freeArea.dx = dx;
    freeArea.dy = dy;
    return changed;
  }

  function clampView() {
    view.zoom = Math.min(V.zoom.max, Math.max(V.zoom.min, view.zoom));
    const dist = Math.hypot(view.panX, view.panY);
    if (dist > V.panLimit) {
      view.panX *= V.panLimit / dist;
      view.panY *= V.panLimit / dist;
    }
  }

  function worldPerPixel() {
    return (camera.top - camera.bottom) / camera.zoom / renderer.domElement.clientHeight;
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      renderer.domElement.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some browsers refuse capture for a pointer; dragging still works.
    }
    if (pointers.size === 2) pinchDistance = currentPinch();
  }

  function onPointerMove(e) {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const now = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      const k = worldPerPixel();
      view.panX -= (now.x - last.x) * k;
      view.panY += (now.y - last.y) * k;
    }
    pointers.set(e.pointerId, now);
    if (pointers.size === 2) {
      const d = currentPinch();
      if (pinchDistance > 0) view.zoom *= d / pinchDistance;
      pinchDistance = d;
    }
    clampView();
    updateCamera();
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    pinchDistance = pointers.size === 2 ? currentPinch() : 0;
  }

  function currentPinch() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onWheel(e) {
    e.preventDefault();
    view.zoom *= Math.exp(-e.deltaY * V.zoom.wheelSpeed);
    clampView();
    updateCamera();
  }

  function onResize() {
    if (!active) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateCamera();
  }

  // ---------- Start, stop, frame loop ----------

  function buildScene() {
    materials = {};
    zoneViews = {};
    workers = [];
    stacks = [];
    machines = {};
    slotOfOrder = new Map();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(V.colors.background);
    scene.add(new THREE.HemisphereLight("#ffffff", "#3a3f4c", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(12, 20, 6);
    scene.add(sun);
    world = new THREE.Group();
    scene.add(world);
    // Ground under the whole shop.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat(V.colors.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    world.add(ground);
    CONFIG.zones.forEach(buildZone);
    buildDock();
    for (let i = 0; i < CONFIG.orders.maxOpen; i++) workers.push(buildWorker(i));
    seenShipped = state.ordersShipped;
    vanTrip.phase = "parked";
    vanTrip.queue = 0;
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    updateCamera();
  }

  function start() {
    if (active) return true;
    if (!webglAvailable()) {
      noWebgl = true;
      return false;
    }
    try {
      const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 600;
      renderer = new THREE.WebGLRenderer({ antialias: !smallScreen, powerPreference: "high-performance" });
    } catch (e) {
      noWebgl = true;
      renderer = null;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, V.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    const root = document.getElementById("scene-root");
    root.appendChild(renderer.domElement);
    root.hidden = false;
    document.body.classList.add("view-3d");
    buildScene();
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    active = true;
    speedCheck.startedAt = performance.now();
    speedCheck.frames = 0;
    speedCheck.time = 0;
    speedCheck.done = false;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
    return true;
  }

  function stop() {
    if (!active) return;
    active = false;
    cancelAnimationFrame(rafId);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    renderer = null;
    scene = null;
    const root = document.getElementById("scene-root");
    root.hidden = true;
    document.body.classList.remove("view-3d");
  }

  function frame(now) {
    if (!active) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (measureFreeArea(now)) updateCamera();
    updateZones(dt);
    updateWorkers(dt);
    updateStacks();
    updateMachines(dt);
    updateVan(dt);
    renderer.render(scene, camera);
    if (!loadReported) reportLoad("3d");
    checkSpeed(now, dt);
  }

  // Count frames for a few seconds after a warm-up. Too slow -> 2D, unless
  // the player picked 3D themselves in Settings.
  function checkSpeed(now, dt) {
    if (speedCheck.done) return;
    if (now - speedCheck.startedAt < V.warmUpSeconds * 1000) return;
    if (document.hidden || dt >= 0.1) return;   // ignore background tabs and stalls
    speedCheck.frames += 1;
    speedCheck.time += dt;
    if (speedCheck.time < V.checkSeconds) return;
    speedCheck.done = true;
    const fps = speedCheck.frames / speedCheck.time;
    speedCheck.fps = fps;
    if (fps < V.minFps && readSettings().view !== "3d") {
      stop();
      writeSettings({ view: "2d", reason: "slow" });
      track("viewFallback", "slow");
      showNotice(T.switchedSlow, "bad");
    }
  }

  // ---------- Tracking: which view, and how long the page took to show it ----------

  function loadBucket(seconds) {
    const edges = V.loadTimeBucketsSec;
    if (seconds < edges[0]) return `under-${edges[0]}s`;
    for (let i = 1; i < edges.length; i++) {
      if (seconds < edges[i]) return `${edges[i - 1]}-${edges[i]}s`;
    }
    return `over-${edges[edges.length - 1]}s`;
  }

  function reportLoad(mode) {
    loadReported = true;
    const ms = Math.round(performance.now());
    track("viewUsed", mode);
    track("loadTime", `${mode}-${loadBucket(ms / 1000)}`);
    try {
      const log = readEventLog();
      log.values = log.values || {};
      log.values.lastView = mode;
      log.values.lastLoadTimeMs = ms;
      localStorage.setItem(CONFIG.tracking.storageKey, JSON.stringify(log));
    } catch (e) {
      // Tracking must never break the game.
    }
  }

  // ---------- Settings dialog and the bottom sheet ----------

  function settingsNote() {
    const s = readSettings();
    if (noWebgl) return T.noteNoWebgl;
    if (!active && s.reason === "slow") return T.noteSlow;
    return active ? T.noteChosen3d : T.noteChosen2d;
  }

  function renderSettings() {
    const b3 = document.getElementById("settings-3d");
    const b2 = document.getElementById("settings-2d");
    b3.classList.toggle("selected", active);
    b2.classList.toggle("selected", !active);
    b3.disabled = noWebgl;
    document.getElementById("settings-note").textContent = settingsNote();
  }

  function choose(mode) {
    if (mode === "3d") {
      writeSettings({ view: "3d", reason: "chosen" });
      start();
    } else {
      writeSettings({ view: "2d", reason: "chosen" });
      stop();
    }
    renderSettings();
  }

  function wireUi() {
    document.getElementById("settings-title").textContent = T.settingsTitle;
    document.getElementById("settings-view-label").textContent = T.viewLabel;
    document.getElementById("settings-3d").textContent = T.view3d;
    document.getElementById("settings-2d").textContent = T.view2d;
    document.getElementById("settings-close").textContent = T.close;
    const overlay = document.getElementById("settings-overlay");
    document.getElementById("settings-open").addEventListener("click", () => {
      renderSettings();
      overlay.hidden = false;
    });
    document.getElementById("settings-close").addEventListener("click", () => { overlay.hidden = true; });
    document.getElementById("settings-3d").addEventListener("click", () => choose("3d"));
    document.getElementById("settings-2d").addEventListener("click", () => choose("2d"));

    const sheet = document.getElementById("sheet");
    document.getElementById("sheet-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        sheet.dataset.tab = tab.dataset.tab;
        sheet.classList.remove("collapsed");
      } else if (e.target.closest("#sheet-toggle")) {
        sheet.classList.toggle("collapsed");
      }
    });
    window.addEventListener("resize", onResize);
  }

  function boot() {
    wireUi();
    const wants3d = readSettings().view !== "2d";
    if (!wants3d || !start()) reportLoad("2d");
  }

  boot();

  // A small handle for testing from the console.
  return {
    start, stop, choose,
    isActive: () => active,
    fps: () => speedCheck.fps,
    drawCalls: () => (renderer ? renderer.info.render.calls : 0),
    view,
  };
})();
