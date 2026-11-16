// 3D isometric view of the shop. Week 3 built the scene; Week 5 turned it
// into the place you play: it draws the carry loop from carry.js (you, your
// staff, the items you carry, the tiles you stand on), follows you with the
// camera and shows the effects (coins, bursts, floating numbers, shake).
// It reads `state` and carry.js every frame and changes neither, except that
// it calls Carry.update() once a frame to move the loop on.
// If WebGL is missing or the device is too slow, the 2D page is used.
// Tunable numbers and words are in CONFIG.view3d and CONFIG.carry.

const View3D = (() => {
  const V = CONFIG.view3d;
  const C = CONFIG.carry;
  const T = V.text;
  const FLOOR_TOP = 0.25;     // height of a zone's floor slab
  const ITEM_H = { blank: 0.13, printed: 0.13, box: 0.4 };
  const MAX_ITEMS = 260;

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

  const view = { zoom: C.cameraZoom, target: null, shake: 0 };
  const pointers = new Map();
  let pinchDistance = 0;

  let zoneViews = {};         // zone id -> { floor, contents, label, lock, open, anim }
  let machines = {};
  let van = null;
  const vanTrip = { phase: "parked", t: 0, queue: 0 };
  const speedCheck = { startedAt: 0, frames: 0, time: 0, done: false };
  let frameWorkMs = 0;        // average time one frame takes to update and draw (for testing)

  let characters = [];        // one model per carrier
  let itemMeshes = {};        // kind -> InstancedMesh
  let tileViews = new Map();  // tile -> { group, fill, label, ... }
  let stationLabels = {};
  let guideArrow = null;
  let groundArrow = null;
  let coins = null;
  let confetti = null;
  let rings = [];
  const particles = { coins: [], confetti: [] };
  const floaters = [];
  let lastCash = null;

  // ---------- Settings (kept apart from the game save) ----------

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(V.settingsKey)) || {};
    } catch (e) {
      return {};
    }
  }

  // Merge, so the view choice and the sound choice do not overwrite each other.
  function writeSettings(changes) {
    try {
      localStorage.setItem(V.settingsKey, JSON.stringify({ ...readSettings(), ...changes }));
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

  function worldOf(areaId, local) {
    const p = Carry.toWorld(areaId, local);
    return new THREE.Vector3(p.x, 0, p.z);
  }

  // A label drawn on a canvas, shown as a sprite that always faces the camera.
  // One or two lines; the second line is smaller.
  function makeLabel(text, worldWidth, background, lines = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = lines === 2 ? 200 : 112;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(worldWidth, worldWidth * (canvas.height / canvas.width), 1);
    sprite.renderOrder = 10;
    let last = "";
    sprite.userData.setText = (value, bg = background, second = "", secondColor = "#ffffff") => {
      const key = `${value}|${bg}|${second}|${secondColor}`;
      if (key === last) return;
      last = key;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = bg;
      roundRect(ctx, 4, 8, canvas.width - 8, canvas.height - 16, 28);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fit = (str, start, weight, y, color) => {
        let size = start;
        ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        while (ctx.measureText(str).width > canvas.width - 40 && size > 18) {
          size -= 2;
          ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        }
        ctx.fillStyle = color;
        ctx.fillText(str, canvas.width / 2, y);
      };
      if (lines === 2) {
        fit(value, 50, 800, 66, "#ffffff");
        fit(second, 64, 900, 134, secondColor);
      } else {
        fit(value, 52, 800, canvas.height / 2 + 2, "#ffffff");
      }
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
  // Positions of the working stations come from CONFIG.carry.stations.

  const S = C.stations;

  const BUILDERS = {
    printFloor(g) {
      // Fabric rack: a shelf unit with rolls of fabric and folded blanks.
      const [rx, rz] = S.rack.model;
      for (const dx of [-0.9, 0.9]) box(0.12, 2.2, 0.12, "#495057", rx + dx, FLOOR_TOP, rz, g);
      [0.3, 1.0, 1.7].forEach((y, i) => {
        box(2.0, 0.08, 0.9, "#6c757d", rx, FLOOR_TOP + y, rz, g);
        const roll = addMesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 10), ["#e64980", "#4dabf7", "#ffd43b"][i], rx, FLOOR_TOP + y + 0.3, rz, g);
        roll.rotation.z = Math.PI / 2;
      });
      box(1.4, 0.15, 1.2, "#a47148", -2.7, FLOOR_TOP, -3.6, g);   // pallet for the blanks on offer

      // Carousel screen press: base, post and four arms with platens.
      const [px, pz] = S.press.model;
      cylinder(0.9, 0.4, "#2b2f3a", px, FLOOR_TOP, pz, g, 12);
      cylinder(0.16, 1.5, "#868e96", px, FLOOR_TOP + 0.4, pz, g);
      const arms = new THREE.Group();
      arms.position.set(px, FLOOR_TOP + 1.25, pz);
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.y = (i * Math.PI) / 2;
        box(1.4, 0.1, 0.22, "#495057", 0.7, 0, 0, arm);
        box(0.7, 0.07, 0.8, "#f1f3f5", 1.35, 0.1, 0, arm);
        arms.add(arm);
      }
      g.add(arms);
      // Flash cure unit beside the press.
      cylinder(0.07, 1.1, "#868e96", px + 1.7, FLOOR_TOP, pz - 1.0, g);
      const flash = box(0.8, 0.22, 0.6, "#e8590c", px + 1.7, FLOOR_TOP + 1.1, pz - 1.0, g);
      // Conveyor dryer.
      box(3.0, 0.12, 0.8, "#212529", 3.4, FLOOR_TOP + 0.7, 3.4, g);
      box(1.9, 1.0, 1.1, "#495057", 3.4, FLOOR_TOP + 0.4, 3.4, g);
      const glow = box(1.8, 0.06, 0.85, "#ff6b35", 3.4, FLOOR_TOP + 0.82, 3.4, g);
      glow.material = new THREE.MeshBasicMaterial({ color: "#5a2a14" });
      glow.userData.baseMaterial = glow.material;
      // Packing table with tape and flat boxes.
      const [kx, kz] = S.pack.model;
      const top = table(1.4, 2.4, "#b08968", kx, kz, g);
      box(0.5, 0.25, 0.5, "#c08552", kx, top, kz - 0.7, g);
      cylinder(0.12, 0.1, "#adb5bd", kx + 0.2, top, kz + 0.6, g);
      machines.pressArms = arms;
      machines.flash = flash;
      machines.dryerGlow = glow;
    },

    cutSew(g) {
      const top = table(4.5, 1.8, "#c8b28a", 0, -1.6, g);
      const roll = addMesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 10), "#e64980", -1.2, top + 0.3, -1.6, g);
      roll.rotation.x = Math.PI / 2;
      for (const x of [-2.4, 2.4]) {
        const t = table(1.5, 0.9, "#adb5bd", x, 3.2, g);
        box(0.7, 0.45, 0.3, "#f8f9fa", x, t, 3.2, g);
        box(0.15, 0.3, 0.3, "#f8f9fa", x - 0.28, t + 0.45, 3.2, g);
      }
    },

    packing(g) {
      for (const x of [-2.2, 2.2]) {
        const top = table(2.4, 1.3, "#b08968", x, -1.4, g);
        box(0.5, 0.35, 0.4, "#c08552", x - 0.5, top, -1.4, g);
        box(0.4, 0.3, 0.4, "#c08552", x + 0.4, top, -1.3, g);
      }
      // Shelf of boxed orders.
      for (const level of [0, 1, 2]) {
        box(5, 0.08, 1, "#6c757d", 0, FLOOR_TOP + 0.1 + level * 0.8, -3.9, g);
        for (let i = 0; i < 5; i++) box(0.7, 0.55, 0.7, "#c08552", -2 + i, FLOOR_TOP + 0.18 + level * 0.8, -3.9, g);
      }
    },

    embroideryCorner(g) {
      const [ex, ez] = S.embroidery.model;
      box(4.4, 1.2, 1.1, "#dee2e6", ex, FLOOR_TOP, ez, g);
      machines.embroideryHeads = [];
      for (let i = 0; i < 4; i++) {
        machines.embroideryHeads.push(box(0.55, 0.6, 0.6, "#2fa38a", ex - 1.5 + i, FLOOR_TOP + 1.2, ez + 0.3, g));
      }
      const colours = ["#ff6b6b", "#ffd43b", "#4dabf7", "#f783ac", "#69db7c"];
      colours.forEach((c, i) => {
        addMesh(new THREE.ConeGeometry(0.16, 0.45, 8), c, ex - 1.6 + i * 0.8, FLOOR_TOP + 1.45, ez - 0.35, g);
      });
    },

    bulkDesk(g) {
      const top = table(3, 1.3, "#8d6e63", 0, -0.6, g);
      box(3, 0.7, 0.08, "#6d4c41", 0, FLOOR_TOP + 0.1, 0.04, g);
      box(0.5, 0.3, 0.4, "#f8f9fa", 0.8, top, -0.7, g);
      box(0.7, 0.9, 0.7, "#343a40", 0, FLOOR_TOP, -1.8, g);   // chair
      // The Kpda Karkhana sign: two posts and a board with painted text.
      for (const x of [-1.9, 1.9]) cylinder(0.1, 2.9, "#495057", x, FLOOR_TOP, -3.6, g);
      box(4.2, 1.4, 0.15, "#212529", 0, FLOOR_TOP + 1.7, -3.6, g);
      g.add(makeSign());
      // Pallets of boxed bulk orders.
      for (const x of [-3.2, 3.2]) {
        box(1.6, 0.15, 1.4, "#a47148", x, FLOOR_TOP, 3.4, g);
        for (let i = 0; i < 3; i++) box(0.65, 0.5, 0.6, "#c08552", x - 0.35 + (i % 2) * 0.7, FLOOR_TOP + 0.15 + Math.floor(i / 2) * 0.5, 3.4, g);
      }
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
    sign.position.set(0, FLOOR_TOP + 2.4, -3.51);
    sign.userData.baseMaterial = sign.material;
    return sign;
  }

  function makePadlock(scale = 1) {
    const lock = new THREE.Group();
    box(1.3, 1.0, 0.5, "#ffd166", 0, 0, 0, lock);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.11, 8, 16, Math.PI), mat("#ced4da"));
    shackle.position.set(0, 1.0, 0);
    lock.add(shackle);
    box(0.18, 0.35, 0.05, "#1d2230", 0, 0.3, 0.26, lock);
    lock.rotation.y = Math.PI / 4;   // face the camera
    lock.scale.setScalar(scale);
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
    if (BUILDERS[zone.id]) BUILDERS[zone.id](contents);
    const label = makeLabel(zone.name, 4.6, "rgba(0,0,0,0.6)");
    label.position.set(0, 0.9, V.zoneSize / 2 - 0.5);
    group.add(label);
    const lock = makePadlock();
    lock.position.y = 2.2;
    group.add(lock);
    zoneViews[zone.id] = { zone, group, floor, contents, label, lock, color, open: null, anim: null };
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

  // ---------- Loading dock and van ----------

  function buildDock() {
    const centre = cellCentre(V.dockCell);
    const group = new THREE.Group();
    group.position.copy(centre);
    world.add(group);
    box(V.zoneSize, FLOOR_TOP, V.zoneSize, V.colors.dock, 0, 0, 0, group);
    box(3, 0.05, 30, V.colors.road, 0, 0, V.zoneSize / 2 + 15, group);   // road out of the shop
    const label = makeLabel(T.dockLabel, 4.2, "rgba(0,0,0,0.6)");
    label.position.set(-2.6, 0.9, V.zoneSize / 2 - 0.5);
    group.add(label);
    box(1.3, 0.12, 1.1, "#a47148", 0, FLOOR_TOP, 1.2, group);   // pallet the boxes are loaded from
    van = buildVan();
    van.position.set(S.van.model[0], FLOOR_TOP, S.van.model[1] + 0.3);
    van.userData.home = van.position.z;
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

  // ---------- Characters: the player and the staff ----------

  function buildCharacter(isPlayer, i) {
    const g = new THREE.Group();
    const shirt = isPlayer ? V.colors.player : V.colors.shirt[i % V.colors.shirt.length];
    const body = new THREE.Group();   // squashes and stretches
    g.add(body);
    const legs = [-0.12, 0.12].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.5, 0);
      box(0.16, 0.5, 0.18, "#343a40", 0, -0.5, 0, pivot);
      body.add(pivot);
      return pivot;
    });
    box(0.5, 0.55, 0.32, shirt, 0, 0.5, 0, body);
    addMesh(new THREE.SphereGeometry(0.2, 10, 8), "#f1c27d", 0, 1.27, 0, body);
    if (isPlayer) box(0.44, 0.1, 0.44, "#e03131", 0, 1.38, 0.04, body);   // cap, so you spot yourself
    const arms = [-0.31, 0.31].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.98, 0);
      box(0.12, 0.45, 0.14, shirt, 0, -0.45, 0, pivot);
      body.add(pivot);
      return pivot;
    });
    g.scale.setScalar(isPlayer ? 1.2 : 1.05);
    world.add(g);
    return { group: g, body, legs, arms, walk: 0, lastPos: null };
  }

  function updateCharacters(dt) {
    const carriers = Carry.carriers();
    while (characters.length < carriers.length) characters.push(buildCharacter(characters.length === 0, characters.length));
    while (characters.length > carriers.length) world.remove(characters.pop().group);
    carriers.forEach((c, i) => {
      const ch = characters[i];
      ch.group.position.set(c.pos.x, FLOOR_TOP, c.pos.z);
      // Turn smoothly toward the way it is facing.
      let diff = c.facing - ch.group.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      ch.group.rotation.y += diff * Math.min(1, dt * 14);
      const moving = c.speed > 0.1;
      ch.walk += moving ? dt * c.speed * 2.2 : 0;
      const swing = moving ? Math.sin(ch.walk) * 0.7 : 0;
      ch.legs[0].rotation.x = swing;
      ch.legs[1].rotation.x = -swing;
      const carrying = c.stack.length > 0;
      ch.arms.forEach((a, k) => { a.rotation.x = carrying ? -1.2 : (k ? swing : -swing) * 0.8; });
      ch.body.position.y = moving ? Math.abs(Math.sin(ch.walk)) * 0.08 : 0;
      // Squash and stretch on every pickup.
      const s = c.squash;
      const y = 1 - 0.22 * s * Math.cos((1 - s) * Math.PI * 1.5);
      ch.body.scale.set(1 / Math.sqrt(y), y, 1 / Math.sqrt(y));
    });
  }

  // ---------- Items: what is carried and what waits at stations ----------

  function buildItems() {
    const geo = {
      blank: new THREE.BoxGeometry(0.72, ITEM_H.blank * 0.9, 0.56),
      printed: new THREE.BoxGeometry(0.72, ITEM_H.printed * 0.9, 0.56),
      box: new THREE.BoxGeometry(0.56, ITEM_H.box * 0.95, 0.56),
    };
    const colors = { blank: V.colors.blank, printed: "#ffffff", box: V.colors.box };
    for (const kind of Object.keys(geo)) {
      const mesh = new THREE.InstancedMesh(geo[kind], new THREE.MeshLambertMaterial({ color: colors[kind] }), MAX_ITEMS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (kind === "printed") mesh.setColorAt(0, new THREE.Color("#ffffff"));
      mesh.count = 0;
      mesh.frustumCulled = false;
      world.add(mesh);
      itemMeshes[kind] = mesh;
    }
  }

  const tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Color(), e: new THREE.Euler() };

  function placeItem(item, x, y, z, rotY, scale = 1) {
    const mesh = itemMeshes[item.kind];
    if (!mesh || mesh.count >= MAX_ITEMS) return;
    const age = (performance.now() - item.born) / 1000;
    const pop = age < 0.25 ? 1 + 0.5 * (1 - age / 0.25) : 1;   // new items pop in
    tmp.e.set(0, rotY, 0);
    tmp.q.setFromEuler(tmp.e);
    tmp.s.setScalar(scale * pop);
    tmp.p.set(x, y, z);
    tmp.m.compose(tmp.p, tmp.q, tmp.s);
    mesh.setMatrixAt(mesh.count, tmp.m);
    if (item.kind === "printed") mesh.setColorAt(mesh.count, tmp.c.set(V.colors.tees[item.typeId] || V.colors.tees.screen));
    mesh.count += 1;
  }

  // A pile at a world spot: columns of up to `perColumn`, side by side.
  function placePile(items, origin, perColumn = 8) {
    items.forEach((item, i) => {
      const col = Math.floor(i / perColumn);
      const row = i % perColumn;
      placeItem(item, origin.x + col * 0.75, FLOOR_TOP + 0.12 + (row + 0.5) * ITEM_H[item.kind], origin.z, Math.PI / 4);
    });
  }

  const PILES = {
    rack: ["printFloor", [-2.7, -3.6]],
    pressIn: ["printFloor", [-0.4, -1.6]],
    pressOut: ["printFloor", [2.3, -0.9]],
    embroideryIn: ["embroideryCorner", [-1.6, -0.1]],
    embroideryOut: ["embroideryCorner", [1.6, -0.1]],
    packIn: ["printFloor", [-3.7, 1.0]],
    packOut: ["printFloor", [-1.4, 3.3]],
    van: ["dock", [0, 1.2]],
  };

  function pileSpot(name) {
    return worldOf(PILES[name][0], PILES[name][1]);
  }

  function updateItems(dt) {
    for (const mesh of Object.values(itemMeshes)) mesh.count = 0;
    const st = Carry.stations();
    // Blanks on offer at the rack (bought ones, plus the next order's if affordable).
    const stock = Carry.rackStock();
    const rackItems = [];
    for (let i = 0; i < Math.min(stock.count, 24); i++) rackItems.push({ kind: "blank", born: 0 });
    placePile(rackItems, pileSpot("rack"));
    placePile(st.press.input, pileSpot("pressIn"));
    placePile(st.press.output, pileSpot("pressOut"));
    if (isZoneOpen("embroideryCorner")) {
      placePile(st.embroidery.input, pileSpot("embroideryIn"));
      placePile(st.embroidery.output, pileSpot("embroideryOut"));
    }
    placePile(st.pack.input, pileSpot("packIn"));
    placePile(st.pack.output, pileSpot("packOut"), 6);
    if (vanTrip.phase === "parked") placePile(st.van.input, pileSpot("van"), 5);
    // Items being worked on sit on the machine.
    workingItems(st.press, worldOf("printFloor", S.press.model).add(new THREE.Vector3(0.9, 0, 0.9)), 1.45);
    workingItems(st.embroidery, worldOf("embroideryCorner", S.embroidery.model).add(new THREE.Vector3(0, 0, 0.3)), 1.5);
    workingItems(st.pack, worldOf("printFloor", S.pack.model), 1.2);
    // Stacks on everyone's back, swaying as they move.
    Carry.carriers().forEach((c, i) => {
      const ch = characters[i];
      if (!ch) return;
      const scale = ch.group.scale.x;
      const rot = ch.group.rotation.y;
      const back = { x: -Math.sin(rot) * 0.42 * scale, z: -Math.cos(rot) * 0.42 * scale };
      const lean = c.speed / C.playerSpeed;
      let y = FLOOR_TOP + 0.75 * scale + ch.body.position.y;
      c.stack.forEach((item, k) => {
        const sway = lean * k * 0.022;
        placeItem(item, c.pos.x + back.x - Math.sin(rot) * sway, y + ITEM_H[item.kind] / 2, c.pos.z + back.z - Math.cos(rot) * sway, rot, 0.85);
        y += ITEM_H[item.kind] * 0.85;
      });
    });
    for (const mesh of Object.values(itemMeshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  function workingItems(station, at, height) {
    if (!station.working) return;
    let k = 0;
    for (const job of station.working.values()) {
      const bob = Math.sin(performance.now() / 90 + k) * 0.04;
      placeItem(job.item, at.x + k * 0.3, FLOOR_TOP + height + bob, at.z - k * 0.3, Math.PI / 4);
      k += 1;
    }
  }

  // Labels over the rack (price of the next blanks) and blocked machines.
  function buildStationLabels() {
    for (const [id, area, local] of [["rack", "printFloor", S.rack.model], ["press", "printFloor", S.press.model],
      ["pack", "printFloor", S.pack.model], ["embroidery", "embroideryCorner", S.embroidery.model]]) {
      const label = makeLabel("", 2.6, "rgba(0,0,0,0.7)");
      label.position.copy(worldOf(area, local)).add(new THREE.Vector3(0, 3.0, 0));
      label.visible = false;
      world.add(label);
      stationLabels[id] = label;
    }
  }

  function updateStationLabels() {
    const stock = Carry.rackStock();
    const rack = stationLabels.rack;
    rack.visible = Boolean(stock.next) && stock.paid === 0;
    if (rack.visible) {
      rack.userData.setText(`Blanks ${formatMoney(stock.nextCost)}`, stock.affordable ? "rgba(20,90,40,0.85)" : "rgba(140,30,30,0.85)");
    }
    const st = Carry.stations();
    for (const id of ["press", "pack", "embroidery"]) {
      const label = stationLabels[id];
      label.visible = st[id].blockedBy > 0 && state.cash < st[id].blockedBy;
      if (label.visible) label.userData.setText(fillText(C.text.needCash, { cash: formatMoney(st[id].blockedBy) }), "rgba(140,30,30,0.85)");
    }
  }

  // ---------- Tiles ----------

  function buildTileView(tile) {
    const group = new THREE.Group();
    group.position.set(tile.pos.x, FLOOR_TOP, tile.pos.z);
    const size = C.tileRadius * 1.75;
    const rim = box(size, 0.06, size, "#ffffff", 0, 0, 0, group);
    rim.material = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const inner = box(size - 0.2, 0.08, size - 0.2, "#1d2230", 0, 0, 0, group);
    inner.material = new THREE.MeshLambertMaterial({ color: "#1d2230" });
    const fill = box(size - 0.2, 0.1, size - 0.2, V.colors.tileFill, 0, 0, 0, group);
    fill.scale.z = 0.001;
    const label = makeLabel("", 2.8, "rgba(0,0,0,0.75)", 2);
    label.position.set(0, 1.5, 0);
    group.add(label);
    let icon = null;
    if (tile.kind === "zone") {
      icon = makePadlock(0.45);
      icon.position.y = 0.15;
      group.add(icon);
    } else {
      icon = addMesh(new THREE.ConeGeometry(0.3, 0.45, 4), "#ffd166", 0, 0.45, 0, group);   // an "upgrade" arrow
    }
    world.add(group);
    return { group, rim, inner, fill, label, icon, size };
  }

  function updateTiles(now) {
    const visible = new Set(Carry.tiles());
    for (const [tile, tv] of tileViews) {
      if (!visible.has(tile)) {
        world.remove(tv.group);
        tileViews.delete(tile);
      }
    }
    for (const tile of visible) {
      let tv = tileViews.get(tile);
      if (!tv) {
        tv = buildTileView(tile);
        tileViews.set(tile, tv);
      }
      const info = Carry.tileInfo(tile);
      tv.group.visible = !info.maxed;
      if (info.maxed) continue;
      const rimColor = info.ready ? V.colors.tileReady : info.locked ? V.colors.tileLocked : "#ff8787";
      tv.rim.material.color.set(rimColor);
      const lineColor = info.ready ? "#7fd48a" : info.locked ? "#ced4da" : "#ff8787";
      tv.label.userData.setText(info.title, "rgba(0,0,0,0.75)", info.line, lineColor);
      // The fill grows from the near edge as cash drains in.
      tv.fill.scale.z = Math.max(0.001, tile.fill);
      tv.fill.position.z = (tv.size - 0.2) * (tile.fill - 1) / 2;
      const pulse = info.ready ? 1 + Math.sin(now / 180) * 0.04 : 1;
      tv.rim.scale.set(pulse, 1, pulse);
      tv.icon.position.y = (tile.kind === "zone" ? 0.15 : 0.45) + (info.ready ? Math.abs(Math.sin(now / 300)) * 0.25 : 0);
      tv.icon.rotation.y = tile.kind === "zone" ? Math.PI / 4 : now / 600;
    }
  }

  // ---------- Guide arrow ----------

  function buildGuide() {
    guideArrow = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshBasicMaterial({ color: "#ffd43b" }));
    cone.rotation.x = Math.PI;   // point down
    guideArrow.add(cone);
    const label = makeLabel("", 3.2, "rgba(20,22,30,0.85)");
    label.position.y = 1.1;
    guideArrow.add(label);
    guideArrow.userData.label = label;
    guideArrow.visible = false;
    world.add(guideArrow);
    groundArrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 3), new THREE.MeshBasicMaterial({ color: "#ffd43b", transparent: true, opacity: 0.85 }));
    groundArrow.visible = false;
    world.add(groundArrow);
  }

  function updateGuide(now) {
    const g = Carry.guideToShow();
    const player = Carry.player();
    guideArrow.visible = Boolean(g);
    groundArrow.visible = false;
    if (!g || !player) return;
    guideArrow.position.set(g.pos.x, FLOOR_TOP + 2.4 + Math.abs(Math.sin(now / 250)) * 0.4, g.pos.z);
    guideArrow.userData.label.userData.setText(g.label);
    const dx = g.pos.x - player.pos.x;
    const dz = g.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.2 && !g.waiting) {
      groundArrow.visible = true;
      const k = 1.3 + Math.sin(now / 200) * 0.15;
      groundArrow.position.set(player.pos.x + (dx / d) * k, FLOOR_TOP + 0.12, player.pos.z + (dz / d) * k);
      // A cone lying flat, its tip toward the target.
      groundArrow.rotation.set(Math.PI / 2, 0, Math.atan2(-dx, dz));
    }
  }

  // ---------- Effects: coins, confetti, rings, floating numbers, shake ----------

  function buildEffects() {
    coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 10), new THREE.MeshLambertMaterial({ color: V.colors.coin, emissive: "#664400" }), 80);
    coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coins.count = 0;
    coins.frustumCulled = false;
    world.add(coins);
    confetti = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 0.04), new THREE.MeshBasicMaterial({ color: "#ffffff" }), 120);
    confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    confetti.setColorAt(0, new THREE.Color("#ffffff"));
    confetti.count = 0;
    confetti.frustumCulled = false;
    world.add(confetti);
  }

  const CONFETTI_COLORS = ["#ffd43b", "#ff6b6b", "#4dabf7", "#69db7c", "#f783ac", "#ffffff"];

  function burst(pos, big, small) {
    const n = big ? 70 : small ? 18 : 40;
    for (let i = 0; i < n && particles.confetti.length < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 6 : 4) * (0.4 + Math.random());
      particles.confetti.push({
        x: pos.x, y: FLOOR_TOP + 0.8, z: pos.z,
        vx: Math.cos(a) * sp, vy: 5 + Math.random() * (big ? 7 : 4), vz: Math.sin(a) * sp,
        life: 1.4 + Math.random() * 0.6, spin: Math.random() * 10,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 6, 32), new THREE.MeshBasicMaterial({ color: "#ffd43b", transparent: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pos.x, FLOOR_TOP + 0.2, pos.z);
    world.add(ring);
    rings.push({ mesh: ring, t: 0, max: big ? 6 : 3 });
  }

  function poof(pos) {
    for (let i = 0; i < 10 && particles.confetti.length < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      particles.confetti.push({
        x: pos.x, y: FLOOR_TOP + 0.6, z: pos.z, vx: Math.cos(a) * 1.5, vy: 2 + Math.random() * 2, vz: Math.sin(a) * 1.5,
        life: 0.6, spin: 4, color: "#868e96",
      });
    }
  }

  function coinBurst(pos, count) {
    for (let i = 0; i < count && particles.coins.length < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      particles.coins.push({
        mode: "burst", x: pos.x, y: FLOOR_TOP + 1.2, z: pos.z,
        vx: Math.cos(a) * 2.5, vy: 6 + Math.random() * 4, vz: Math.sin(a) * 2.5, life: 1.1, spin: Math.random() * 6,
      });
    }
  }

  function drainCoin(from, to) {
    if (particles.coins.length >= 80) return;
    particles.coins.push({ mode: "fly", from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, t: 0, life: 0.35, spin: 0 });
  }

  function updateParticles(dt) {
    coins.count = 0;
    particles.coins = particles.coins.filter((c) => {
      c.spin += dt * 12;
      if (c.mode === "fly") {
        c.t += dt / c.life;
        if (c.t >= 1) return false;
        c.x = c.from.x + (c.to.x - c.from.x) * c.t;
        c.z = c.from.z + (c.to.z - c.from.z) * c.t;
        c.y = FLOOR_TOP + 1.6 + Math.sin(c.t * Math.PI) * 1.2 - c.t * 1.3;
      } else {
        c.life -= dt;
        if (c.life <= 0) return false;
        c.vy -= 18 * dt;
        c.x += c.vx * dt;
        c.y = Math.max(FLOOR_TOP + 0.05, c.y + c.vy * dt);
        c.z += c.vz * dt;
      }
      tmp.e.set(Math.PI / 2, c.spin, 0);
      tmp.q.setFromEuler(tmp.e);
      tmp.s.setScalar(1);
      tmp.p.set(c.x, c.y, c.z);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      coins.setMatrixAt(coins.count++, tmp.m);
      return true;
    });
    coins.instanceMatrix.needsUpdate = true;

    confetti.count = 0;
    particles.confetti = particles.confetti.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy -= 14 * dt;
      p.vx *= 0.98;
      p.vz *= 0.98;
      p.x += p.vx * dt;
      p.y = Math.max(FLOOR_TOP + 0.03, p.y + p.vy * dt);
      p.z += p.vz * dt;
      p.spin += dt * 8;
      tmp.e.set(p.spin, p.spin * 0.7, 0);
      tmp.q.setFromEuler(tmp.e);
      tmp.s.setScalar(Math.min(1, p.life * 2));
      tmp.p.set(p.x, p.y, p.z);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      confetti.setMatrixAt(confetti.count, tmp.m);
      confetti.setColorAt(confetti.count, tmp.c.set(p.color));
      confetti.count += 1;
      return true;
    });
    confetti.instanceMatrix.needsUpdate = true;
    if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;

    rings = rings.filter((r) => {
      r.t += dt / 0.6;
      if (r.t >= 1) {
        world.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        return false;
      }
      r.mesh.scale.setScalar(0.5 + r.t * r.max);
      r.mesh.material.opacity = 1 - r.t;
      return true;
    });
  }

  // Floating numbers are HTML, so they stay crisp; they follow a world point.
  function floatText(pos, text, kind) {
    const layer = document.getElementById("fx-layer");
    if (!layer || floaters.length > 20) return;
    const el = document.createElement("div");
    el.className = `floater ${kind || ""}`;
    el.textContent = text;
    layer.appendChild(el);
    floaters.push({ el, pos: new THREE.Vector3(pos.x, FLOOR_TOP + 2.2, pos.z), t: 0 });
  }

  function updateFloaters(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt / 1.1;
      if (f.t >= 1) {
        f.el.remove();
        floaters.splice(i, 1);
        continue;
      }
      tmp.p.copy(f.pos).project(camera);
      const x = (tmp.p.x + 1) / 2 * w;
      const y = (1 - tmp.p.y) / 2 * h - f.t * 60;
      const scale = f.t < 0.15 ? 0.6 + f.t / 0.15 * 0.6 : 1.2 - Math.min(0.2, (f.t - 0.15));
      f.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
      f.el.style.opacity = f.t > 0.7 ? (1 - f.t) / 0.3 : 1;
    }
  }

  function handleEvents() {
    for (const e of Carry.takeEvents()) {
      if (e.type === "float") floatText(e.pos, e.text, e.kind);
      else if (e.type === "coins") coinBurst(e.pos, e.count);
      else if (e.type === "drainCoin") drainCoin(e.from, e.to);
      else if (e.type === "burst") burst(e.pos, e.big, e.small);
      else if (e.type === "poof") poof(e.pos);
      else if (e.type === "shake") view.shake = C.shakeSeconds;
      else if (e.type === "vanTrip") vanTrip.queue += 1;
    }
  }

  // The cash counter bumps whenever money comes in.
  function bumpCash() {
    if (lastCash !== null && state.cash > lastCash + 0.5) {
      const panel = document.getElementById("cash").closest(".panel");
      panel.classList.remove("bump");
      void panel.offsetWidth;
      panel.classList.add("bump");
    }
    lastCash = state.cash;
  }

  // ---------- Machines, zones and the van ----------

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

  function updateMachines(dt) {
    const st = Carry.stations();
    const printing = Carry.isBusy(st.press);
    const stitching = Carry.isBusy(st.embroidery);
    if (machines.pressArms && printing) machines.pressArms.rotation.y += dt * 1.8;
    if (machines.flash) machines.flash.scale.y = printing ? 1 + Math.abs(Math.sin(performance.now() / 120)) * 0.3 : 1;
    if (machines.dryerGlow) machines.dryerGlow.material.color.set(printing ? "#ff6b35" : "#5a2a14");
    if (machines.embroideryHeads) {
      const now = performance.now() / 120;
      machines.embroideryHeads.forEach((head, i) => {
        head.position.y = FLOOR_TOP + 1.5 + (stitching ? Math.abs(Math.sin(now + i)) * 0.15 : 0);
      });
    }
  }

  function updateVan(dt) {
    if (vanTrip.phase === "parked" && vanTrip.queue > 0) {
      vanTrip.queue -= 1;
      vanTrip.phase = "out";
      vanTrip.t = 0;
    }
    if (vanTrip.phase === "parked") return;
    vanTrip.t = Math.min(1, vanTrip.t + dt / V.vanDriveSeconds);
    const ease = vanTrip.t * vanTrip.t;
    const away = vanTrip.phase === "out" ? ease : 1 - vanTrip.t * (2 - vanTrip.t);
    van.position.z = van.userData.home + away * 18;
    van.visible = away < 0.95;
    van.userData.wheels.forEach((w) => { w.rotation.x += dt * 14; });
    if (vanTrip.t >= 1) {
      vanTrip.phase = vanTrip.phase === "out" ? "back" : "parked";
      vanTrip.t = 0;
      van.visible = true;
    }
  }

  // ---------- Camera: fixed isometric angle that follows you ----------

  const SCREEN_RIGHT = () => new THREE.Vector3(1, 0, -1).normalize();
  const SCREEN_UP = () => new THREE.Vector3(-1, 2, -1).normalize();

  function updateCamera(dt = 0) {
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
    const player = Carry.player();
    const goal = player ? new THREE.Vector3(player.pos.x, 0, player.pos.z) : cellCentre([0, 0]);
    if (!view.target) view.target = goal.clone();
    view.target.lerp(goal, dt ? 1 - Math.exp(-dt * 7) : 1);
    // Keep you in the middle of the part of the screen the overlay leaves free.
    const k = (camera.top - camera.bottom) / camera.zoom / h;
    const target = view.target.clone()
      .add(SCREEN_RIGHT().multiplyScalar(-freeArea.dx * k))
      .add(SCREEN_UP().multiplyScalar(freeArea.dy * k));
    if (view.shake > 0) {
      const s = C.shakeStrength * (view.shake / C.shakeSeconds);
      target.add(new THREE.Vector3((Math.random() - 0.5) * s, 0, (Math.random() - 0.5) * s));
      view.shake = Math.max(0, view.shake - dt);
    }
    camera.position.copy(target).add(new THREE.Vector3(30, 30, 30));
    camera.lookAt(target);
  }

  // The middle of the screen area not covered by the HUD and the panel, as
  // an offset in pixels from the screen centre. Measured a few times a
  // second, not every frame, because measuring forces a page layout.
  const freeArea = { dx: 0, dy: 0, measuredAt: 0 };

  function measureFreeArea(now) {
    if (now - freeArea.measuredAt < 400) return;
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
    freeArea.dx = (left + right) / 2 - w / 2;
    freeArea.dy = (top + bottom) / 2 - h / 2;
  }

  // One finger (or the mouse) steers with the joystick; two fingers pinch to zoom.
  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      renderer.domElement.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some browsers refuse capture for a pointer; steering still works.
    }
    if (pointers.size === 1) Input.stickStart(e.pointerId, e.clientX, e.clientY);
    if (pointers.size === 2) {
      Input.stickEnd(null);
      pinchDistance = currentPinch();
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const d = currentPinch();
      if (pinchDistance > 0) view.zoom = clampZoom(view.zoom * (d / pinchDistance));
      pinchDistance = d;
    } else {
      Input.stickMove(e.pointerId, e.clientX, e.clientY);
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    Input.stickEnd(e.pointerId);
    pinchDistance = pointers.size === 2 ? currentPinch() : 0;
  }

  function currentPinch() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clampZoom(z) {
    return Math.min(V.zoom.max, Math.max(V.zoom.min, z));
  }

  function onWheel(e) {
    e.preventDefault();
    view.zoom = clampZoom(view.zoom * Math.exp(-e.deltaY * V.zoom.wheelSpeed));
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
    machines = {};
    characters = [];
    itemMeshes = {};
    tileViews = new Map();
    stationLabels = {};
    particles.coins = [];
    particles.confetti = [];
    rings = [];
    floaters.splice(0).forEach((f) => f.el.remove());
    scene = new THREE.Scene();
    scene.background = new THREE.Color(V.colors.background);
    scene.add(new THREE.HemisphereLight("#ffffff", "#3a3f4c", 1.6));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(12, 20, 6);
    scene.add(sun);
    world = new THREE.Group();
    scene.add(world);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(V.colors.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    world.add(ground);
    CONFIG.zones.forEach(buildZone);
    buildDock();
    buildItems();
    buildStationLabels();
    buildGuide();
    buildEffects();
    vanTrip.phase = "parked";
    vanTrip.queue = 0;
    view.target = null;
    view.zoom = C.cameraZoom;
    lastCash = null;
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
    Carry.enable();
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
    Input.stickEnd(null);
    Carry.disable();
    floaters.splice(0).forEach((f) => f.el.remove());
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
    const workStart = performance.now();
    Carry.update(dt);
    measureFreeArea(now);
    handleEvents();
    updateZones(dt);
    updateCharacters(dt);
    updateItems(dt);
    updateStationLabels();
    updateTiles(now);
    updateMachines(dt);
    updateVan(dt);
    updateParticles(dt);
    updateCamera(dt);
    updateGuide(now);
    updateFloaters(dt);
    bumpCash();
    renderer.render(scene, camera);
    frameWorkMs = frameWorkMs * 0.95 + (performance.now() - workStart) * 0.05;
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
    const on = Sound.isOn();
    document.getElementById("settings-sound-on").classList.toggle("selected", on);
    document.getElementById("settings-sound-off").classList.toggle("selected", !on);
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
    document.getElementById("settings-sound-label").textContent = T.soundLabel;
    document.getElementById("settings-sound-on").textContent = T.soundOn;
    document.getElementById("settings-sound-off").textContent = T.soundOff;
    document.getElementById("settings-close").textContent = T.close;
    document.getElementById("upgrade-hint").textContent = C.text.walkToBuy;
    const overlay = document.getElementById("settings-overlay");
    document.getElementById("settings-open").addEventListener("click", () => {
      renderSettings();
      overlay.hidden = false;
    });
    document.getElementById("settings-close").addEventListener("click", () => { overlay.hidden = true; });
    document.getElementById("settings-3d").addEventListener("click", () => choose("3d"));
    document.getElementById("settings-2d").addEventListener("click", () => choose("2d"));
    document.getElementById("settings-sound-on").addEventListener("click", () => { Sound.setOn(true); renderSettings(); });
    document.getElementById("settings-sound-off").addEventListener("click", () => { Sound.setOn(false); renderSettings(); });

    const sheet = document.getElementById("sheet");
    document.getElementById("sheet-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) {
        const same = sheet.dataset.tab === tab.dataset.tab && !sheet.classList.contains("collapsed");
        sheet.dataset.tab = tab.dataset.tab;
        sheet.classList.toggle("collapsed", same);   // tapping the open tab again closes it
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
    frameMs: () => frameWorkMs,
    view,
  };
})();
