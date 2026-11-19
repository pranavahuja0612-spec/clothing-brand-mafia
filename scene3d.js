// 3D isometric view of the shop. Week 3 built the scene, Week 5 made it the
// place you play (the carry loop from carry.js), and Week 6 gave it its art
// and feel: toon shading, soft shadows, props, a rigged cast, and motion on
// everything (pops, flights, working machines, coins to the counter, slow
// motion and a camera punch on unlocks). Style rules: STYLE.md.
// It reads `state` and carry.js every frame and changes neither, except that
// it calls Carry.update() once a frame to move the loop on.
// If WebGL is missing or the device is too slow, the 2D page is used.
// Tunable numbers and words are in CONFIG.view3d and CONFIG.carry.

const View3D = (() => {
  const V = CONFIG.view3d;
  const C = CONFIG.carry;
  const A = V.art;
  const P = V.palette;
  const T = V.text;
  const FLOOR_TOP = 0.25;     // height of a zone's floor slab
  const ITEM_H = { blank: 0.12, printed: 0.12, box: 0.4 };
  const MAX_ITEMS = 300;
  const S = C.stations;

  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let sun = null;
  let active = false;
  let building = 0;           // changes when a build starts, so a stale one stops
  let rafId = 0;
  let lastFrame = 0;
  let noWebgl = false;
  let loadReported = false;
  let models = null;
  let clock = 0;              // seconds of (possibly slowed) scene time

  const isPhone = () => Math.min(window.innerWidth, window.innerHeight) < 600;
  const view = { zoom: C.cameraZoom, target: null, shake: 0, punch: 0, slow: 0 };
  const pointers = new Map();
  let pinchDistance = 0;

  let zoneViews = {};         // zone id -> { group, contents, uniforms, label, lock, open, anim }
  let machines = {};
  let van = null;
  const vanTrip = { phase: "parked", t: 0, queue: 0 };
  const speedCheck = { startedAt: 0, frames: 0, time: 0, done: false };
  let frameWorkMs = 0;

  let characters = [];        // one per carrier
  let charBlobs = null;
  let itemMeshes = {};        // kind -> InstancedMesh
  const shown = new Map();    // item key -> how it is drawn now (position, pop, flight)
  let ghosts = [];            // items shrinking away
  let frameNo = 0;
  let tileViews = new Map();
  let stationLabels = {};
  let guide = null;
  let fx = {};                // coins, confetti, puffs, bulbs
  let rings = [];
  const particles = { coins: [], confetti: [], puffs: [] };
  const floaters = [];
  const flyingCash = [];
  let lastCash = null;
  let intro = 0;              // 0..1 while the shop pops in after loading

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

  // ---------- Small helpers ----------

  const ease = Art.easeOutBack;

  function cellCentre(cell) {
    const step = V.zoneSize + V.zoneGap;
    return new THREE.Vector3(cell[0] * step, 0, cell[1] * step);
  }

  function worldOf(areaId, local) {
    const p = Carry.toWorld(areaId, local);
    return new THREE.Vector3(p.x, 0, p.z);
  }

  // A toon mesh with its own material (for parts that animate or change colour).
  function part(geometry, color, parent, x = 0, y = 0, z = 0, o = {}) {
    const mesh = new THREE.Mesh(geometry, o.material || Art.toon(color, o.emissive ? { emissive: o.emissive } : {}));
    mesh.position.set(x, y, z);
    mesh.castShadow = o.shadow !== false;
    parent.add(mesh);
    if (o.outline) Art.outline(mesh);
    return mesh;
  }

  // A label on a canvas, shown as a sprite that faces the camera. One or two
  // lines; the second is bigger (a price). Pops in and shrinks out.
  function makeLabel(text, worldWidth, background, lines = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = lines === 2 ? 210 : 116;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    const base = new THREE.Vector3(worldWidth, worldWidth * (canvas.height / canvas.width), 1);
    sprite.scale.copy(base);
    sprite.renderOrder = 10;
    sprite.userData.base = base;
    sprite.userData.pop = 1;
    sprite.userData.want = true;
    let last = "";
    sprite.userData.setText = (value, bg = background, second = "", secondColor = P.cream) => {
      const key = `${value}|${bg}|${second}|${secondColor}`;
      if (key === last) return;
      last = key;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = bg;
      Art.roundRect(ctx, 6, 8, canvas.width - 12, canvas.height - 18, 34);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,244,226,0.18)";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fit = (str, start, weight, y, color) => {
        let size = start;
        ctx.font = `${weight} ${size}px ${Art.FONT}`;
        while (ctx.measureText(str).width > canvas.width - 48 && size > 18) {
          size -= 2;
          ctx.font = `${weight} ${size}px ${Art.FONT}`;
        }
        ctx.fillStyle = color;
        ctx.fillText(str, canvas.width / 2, y);
      };
      if (lines === 2) {
        fit(value, 48, 600, 64, P.cream);
        fit(second, 70, 700, 140, secondColor);
      } else {
        fit(value, 54, 600, canvas.height / 2, P.cream);
      }
      texture.needsUpdate = true;
    };
    sprite.userData.setText(text);
    return sprite;
  }

  // Show or hide a label with a pop and a shrink instead of a snap.
  function setShown(obj, want) {
    if (want && !obj.userData.want) obj.userData.pop = 0;
    obj.userData.want = want;
  }

  function animateShown(obj, dt) {
    const u = obj.userData;
    if (u.want) {
      obj.visible = true;
      u.pop = Math.min(1, u.pop + dt / A.popSeconds);
      obj.scale.copy(u.base).multiplyScalar(Math.max(0.001, ease(u.pop)));
    } else if (obj.visible) {
      u.shrink = (u.shrink || 0) + dt / A.shrinkSeconds;
      const k = 1 - Art.easeIn(Math.min(1, u.shrink));
      obj.scale.copy(u.base).multiplyScalar(Math.max(0.001, k));
      if (u.shrink >= 1) obj.visible = false;
    }
    if (u.want) u.shrink = 0;
  }

  const PANEL = "rgba(59,42,74,0.9)";
  const PANEL_GOOD = "rgba(31,128,110,0.92)";
  const PANEL_BAD = "rgba(176,52,48,0.92)";

  // ---------- Zones: floors, walls, props and machines ----------

  // Where each zone's walls go: the back (-z) row and the left (-x) column
  // get walls, like a cut-away doll's house seen from the front corner.
  function wallsFor(cell) {
    return { back: cell[1] === 0, left: cell[0] === -1 };
  }

  const FLOOR_MARKS = {
    printFloor: {
      tape: [[-2.6, -2.4, 1.6, 1.4], [1.0, -0.2, 1.6, 1.4], [-2.6, 2.0, 1.6, 1.4]],
      arrows: [[-1.0, -1.4, 0], [-1.2, 1.0, 2.4], [-2.6, 3.8, Math.PI / 2]],
      words: [[2.6, 1.6, "PRINT FLOOR", -Math.PI / 2]],
    },
    dock: {
      tape: [[0, 0.4, 1.8, 1.6]],
      stripes: [[0, 4.75, 10, 0.5]],
      words: [[-2.6, 3.4, "LOADING", 0], [2.6, 3.4, "ZONE", 0]],
      arrows: [[0, 2.2, Math.PI / 2]],
    },
    cutSew: { tape: [[0, -1.6, 5.2, 2.4]], words: [[0, 1.0, "CUT & SEW", 0]] },
    packing: { tape: [[-2.2, -1.4, 3.0, 1.9], [2.2, -1.4, 3.0, 1.9]], arrows: [[0, 2.5, Math.PI / 2]] },
    embroideryCorner: { tape: [[0, 0.4, 1.6, 1.4], [0, -1.6, 5.0, 1.8]] },
    bulkDesk: { tape: [[0, -0.6, 3.6, 2.0]], stripes: [[-3.2, 3.4, 2.0, 1.8], [3.2, 3.4, 2.0, 1.8]] },
  };

  function buildFloor(group, id, color, uniforms, walls) {
    const marks = { ...(FLOOR_MARKS[id] || {}), wallBack: walls.back, wallLeft: walls.left };
    const top = Art.addGrey(Art.toon("#ffffff", { map: Art.floorTexture(color, V.zoneSize, marks) }), uniforms);
    const side = Art.addGrey(Art.fresh(Art.shade(color, 0.35)), uniforms);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(V.zoneSize, FLOOR_TOP, V.zoneSize), [side, side, top, side, side, side]);
    floor.position.y = FLOOR_TOP / 2;
    floor.receiveShadow = true;
    group.add(floor);
    return floor;
  }

  // Back and left walls with a baseboard, a coloured band and a window or two.
  function buildWalls(b, walls, accent) {
    const half = V.zoneSize / 2 + V.zoneGap / 2;
    const h = 3.0;
    const t = 0.3;
    const wall = V.colors.wall;
    if (walls.back) {
      const z = -half - t / 2 + 0.02;
      b.box(V.zoneSize + V.zoneGap, h, t, wall, 0, 0, z);
      b.box(V.zoneSize + V.zoneGap, 1.0, t + 0.04, Art.tint(accent, 0.25), 0, 0, z);
      b.box(V.zoneSize + V.zoneGap, 0.16, t + 0.08, Art.shade(accent, 0.45), 0, 0, z);
      b.box(V.zoneSize + V.zoneGap, 0.14, t + 0.1, Art.shade(wall, 0.25), 0, h - 0.14, z);
      for (const x of [-2.4, 2.4]) {
        b.box(1.7, 1.0, t + 0.06, Art.shade(wall, 0.3), x, 1.55, z);
        b.box(1.5, 0.82, t + 0.08, Art.tint(P.sky, 0.45), x, 1.64, z);
        b.box(0.08, 0.82, t + 0.1, Art.shade(wall, 0.3), x, 1.64, z);
      }
    }
    if (walls.left) {
      const x = -half - t / 2 + 0.02;
      b.box(t, h, V.zoneSize + V.zoneGap, wall, x, 0, 0);
      b.box(t + 0.04, 1.0, V.zoneSize + V.zoneGap, Art.tint(accent, 0.25), x, 0, 0);
      b.box(t + 0.08, 0.16, V.zoneSize + V.zoneGap, Art.shade(accent, 0.45), x, 0, 0);
      b.box(t + 0.1, 0.14, V.zoneSize + V.zoneGap, Art.shade(wall, 0.25), x, h - 0.14, 0);
    }
  }

  // A poster on a wall. side "back" faces +z, "left" faces +x.
  function poster(group, i, side, along, uniforms) {
    const half = V.zoneSize / 2 + V.zoneGap / 2;
    const material = Art.addGrey(Art.toon("#ffffff", { map: Art.posterTexture(i) }), uniforms);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.26), material);
    if (side === "back") {
      mesh.position.set(along, 1.95 + FLOOR_TOP, -half + 0.05);
    } else {
      mesh.position.set(-half + 0.05, 1.95 + FLOOR_TOP, along);
      mesh.rotation.y = Math.PI / 2;
    }
    group.add(mesh);
  }

  // Tables (legs and top) at floor height; returns the height of the top.
  function table(b, w, d, color, x, z, o = {}) {
    const top = o.height || 0.92;
    b.box(w, 0.12, d, color, x, FLOOR_TOP + top - 0.12, z, o);
    b.box(w - 0.2, 0.06, d - 0.2, Art.shade(color, 0.3), x, FLOOR_TOP + top - 0.16, z);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(0.1, top - 0.12, 0.1, Art.shade(P.ink, 0.1), x + sx * (w / 2 - 0.14), FLOOR_TOP, z + sz * (d / 2 - 0.14));
      }
    }
    b.blob(x, z, w + 0.4, d + 0.4);
    return FLOOR_TOP + top;
  }

  // A stack of folded tees (decor), in a few colours.
  function teeStack(b, x, y, z, n, colors, rot = 0) {
    for (let i = 0; i < n; i++) {
      b.tee(colors[i % colors.length], x + Math.sin(i * 1.7) * 0.02, y + i * 0.105, z, { ry: rot + Math.sin(i) * 0.08, print: i % 2 === 1 });
    }
  }

  // A rail with tees on hangers.
  function hangerRail(b, x, z, length, colors, rotY = 0) {
    const g = new THREE.Group();
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const at = (u) => [x + u * cos, z - u * sin];
    for (const u of [-length / 2, length / 2]) {
      const [px, pz] = at(u);
      b.cyl(0.04, 0.04, 1.8, Art.shade(P.ink, 0.1), px, FLOOR_TOP, pz, { seg: 6 });
      b.box(0.5, 0.05, 0.5, Art.shade(P.ink, 0.1), px, FLOOR_TOP, pz, { ry: rotY });
    }
    const [cx, cz] = at(0);
    b.cyl(0.03, 0.03, length, P.cream, cx, FLOOR_TOP + 1.78, cz, { rz: Math.PI / 2, ry: rotY, centred: true, seg: 6 });
    const n = Math.max(3, Math.floor(length / 0.32));
    for (let i = 0; i < n; i++) {
      const u = -length / 2 + 0.2 + (i * (length - 0.4)) / (n - 1);
      const [px, pz] = at(u);
      b.tee(colors[i % colors.length], px, FLOOR_TOP + 1.05, pz, { rx: Math.PI / 2, ry: rotY + Math.PI / 2, rz: 0, s: 0.95, print: i % 2 === 0 });
      b.box(0.36, 0.03, 0.03, P.cream, px, FLOOR_TOP + 1.7, pz, { ry: rotY + Math.PI / 2 });
    }
    b.blob(cx, cz, length + 0.4, 0.8);
    return g;
  }

  // A tub of ink with a coloured top.
  function inkTub(b, x, z, color) {
    b.cyl(0.24, 0.21, 0.42, P.cream, x, FLOOR_TOP, z, { outline: false });
    b.cyl(0.22, 0.22, 0.02, color, x, FLOOR_TOP + 0.42, z);
    b.cyl(0.25, 0.25, 0.05, Art.shade(P.cream, 0.25), x, FLOOR_TOP + 0.38, z);
    b.blob(x, z, 0.7);
  }

  // A fabric roll lying on its side (dx, dz direction set by ry).
  function fabricRoll(b, x, y, z, color, length, ry = 0) {
    b.cyl(0.22, 0.22, length, color, x, y + 0.22, z, { rz: Math.PI / 2, ry, centred: true, outline: true });
    b.cyl(0.08, 0.08, length + 0.06, P.cream, x, y + 0.22, z, { rz: Math.PI / 2, ry, centred: true, seg: 8 });
  }

  const BUILDERS = {
    printFloor(b, g, w) {
      // Fabric rack: steel frame, three shelves of rolls and stacked blanks.
      const [rx, rz] = S.rack.model;
      for (const dx of [-1.0, 1.0]) {
        for (const dz of [-0.4, 0.4]) b.box(0.1, 2.3, 0.1, Art.shade(P.sky, 0.55), rx + dx, FLOOR_TOP, rz + dz, { outline: true });
      }
      [0.25, 0.95, 1.65].forEach((y, i) => {
        b.box(2.1, 0.07, 0.95, Art.shade(P.sky, 0.4), rx, FLOOR_TOP + y, rz, { outline: true });
        fabricRoll(b, rx - 0.45, FLOOR_TOP + y + 0.07, rz, [P.tomato, P.sky, P.sun][i], 0.9);
        fabricRoll(b, rx + 0.5, FLOOR_TOP + y + 0.07, rz, [P.lilac, P.mint, P.cream][i], 0.9);
      });
      b.blob(rx, rz, 2.6, 1.4);
      // Pallet for the blanks on offer.
      b.box(1.4, 0.14, 1.2, Art.shade(P.tangerine, 0.25), -2.7, FLOOR_TOP, -3.6);
      b.blob(-2.7, -3.6, 1.7, 1.5);

      // The carousel press (animated parts are built in buildPress).
      buildPress(g, worldLocal(w, S.press.model));
      b.blob(S.press.model[0], S.press.model[1], 3.6);
      // Ink tubs and a cable to the wall.
      inkTub(b, 0.5, -4.5, P.sky);
      inkTub(b, 1.05, -4.55, P.tomato);
      inkTub(b, 0.75, -4.0, P.sun);
      b.tube([[1.5, FLOOR_TOP + 0.04, -2.5], [1.9, FLOOR_TOP + 0.04, -3.6], [1.7, FLOOR_TOP + 0.04, -4.8], [1.7, FLOOR_TOP + 0.6, -5.15]], 0.04, P.ink);
      // Flash cure on its stand beside the press.
      buildFlash(g, 4.3, -2.6);
      b.blob(4.3, -2.6, 1.0);
      // Conveyor dryer at the front right.
      buildDryer(g, 3.3, 3.5);
      b.blob(3.3, 3.5, 3.6, 1.6);
      b.tube([[3.3, FLOOR_TOP + 0.04, 2.7], [2.2, FLOOR_TOP + 0.04, 1.8], [1.6, FLOOR_TOP + 0.04, -0.9], [1.5, FLOOR_TOP + 0.04, -1.6]], 0.04, P.ink);
      // Packing table with tape, a bubble-wrap roll and flat boxes.
      const [kx, kz] = S.pack.model;
      const top = table(b, 1.5, 2.5, Art.shade(P.tangerine, 0.15), kx, kz, { outline: true });
      b.box(0.62, 0.05, 0.62, Art.tint(P.tangerine, 0.15), kx, top, kz - 0.75);
      b.box(0.62, 0.05, 0.62, Art.tint(P.tangerine, 0.15), kx, top + 0.05, kz - 0.75, { ry: 0.2 });
      b.cyl(0.18, 0.18, 0.7, Art.tint(P.sky, 0.7), kx - 0.2, top + 0.18, kz + 0.75, { rx: Math.PI / 2, centred: true });
      machines.tape = part(new THREE.BoxGeometry(0.18, 0.16, 0.3), P.tomato, g, ...worldLocal(w, [kx + 0.35, kz + 0.2], top + 0.08));
      // Hanger rail with printed tees by the back wall, and a plant.
      hangerRail(b, -0.9, -4.55, 1.6, [P.sky, P.tomato, P.sun, P.mint, P.lilac], 0);
      b.prop("furniture", "cactus_medium_A", 4.4, FLOOR_TOP, -4.5, { s: 1.2, blob: 0.9 });
      b.prop("furniture", "lamp_standing", -4.5, FLOOR_TOP, -4.5, { blob: 0.9 });
      b.prop("restaurant", "papertowel", -4.5, FLOOR_TOP, 4.4, { blob: 0.6 });
    },

    cutSew(b, g) {
      const top = table(b, 4.6, 2.0, Art.tint(P.lilac, 0.35), 0, -1.6, { outline: true });
      b.box(3.6, 0.04, 1.5, P.lilac, -0.2, top, -1.6);
      b.box(1.2, 0.03, 1.1, P.tomato, 1.4, top + 0.04, -1.5, { ry: 0.2 });
      fabricRoll(b, -1.8, top, -1.6, P.lilac, 1.7, Math.PI / 2);
      b.box(1.4, 0.02, 0.1, P.sun, 0.8, top + 0.05, -2.2, { ry: -0.1 });   // ruler
      for (const x of [-2.4, 2.4]) {
        const t = table(b, 1.6, 1.0, Art.tint(P.sky, 0.6), x, 3.2);
        b.box(0.75, 0.42, 0.3, P.cream, x, t, 3.2, { outline: true });
        b.box(0.18, 0.32, 0.3, P.cream, x - 0.28, t + 0.42, 3.2, { outline: true });
        b.box(0.55, 0.1, 0.3, P.cream, x + 0.05, t + 0.66, 3.2);
        b.cyl(0.06, 0.06, 0.12, P.tomato, x + 0.3, t + 0.42, 3.05, { seg: 8 });
        b.prop("furniture", "chair_stool", x, FLOOR_TOP, 2.2, { blob: 0.7 });
      }
      hangerRail(b, 2.6, -4.4, 2.2, [P.lilac, P.cream, P.sky, P.tomato], 0);
      hangerRail(b, -4.4, 0.6, 2.0, [P.mint, P.sun, P.lilac], Math.PI / 2);
      // A dress form.
      b.cyl(0.04, 0.04, 1.0, P.ink, -3.6, FLOOR_TOP, -3.8, { seg: 6 });
      b.cyl(0.3, 0.22, 0.6, P.cream, -3.6, FLOOR_TOP + 1.0, -3.8, { sz: 0.7, outline: true });
      b.sphere(0.12, P.ink, -3.6, FLOOR_TOP + 1.66, -3.8);
      b.blob(-3.6, -3.8, 0.8);
      // Rolls leaning in the corner.
      b.cyl(0.18, 0.18, 1.6, P.sky, -4.5, FLOOR_TOP, 3.9, { rz: 0.15 });
      b.cyl(0.18, 0.18, 1.5, P.sun, -4.5, FLOOR_TOP, 4.4, { rx: -0.12 });
      b.prop("furniture", "rug_rectangle_stripes_A", 0, FLOOR_TOP, 1.4, { s: 0.9 });
    },

    packing(b) {
      for (const x of [-2.2, 2.2]) {
        const top = table(b, 2.5, 1.4, Art.shade(P.tangerine, 0.15), x, -1.4);
        b.box(0.5, 0.36, 0.42, P.tangerine, x - 0.5, top, -1.4);
        b.box(0.42, 0.3, 0.42, Art.tint(P.tangerine, 0.2), x + 0.42, top, -1.3);
        b.cyl(0.11, 0.11, 0.06, P.tomato, x + 0.9, top, -1.0, { seg: 10 });
      }
      // Shelf of boxed orders along the left wall.
      for (const level of [0, 1, 2]) {
        b.box(1.0, 0.08, 5, Art.shade(P.tangerine, 0.5), -4.4, FLOOR_TOP + 0.1 + level * 0.8, 0.8);
        for (let i = 0; i < 5; i++) b.box(0.7, 0.55, 0.72, i % 2 ? P.tangerine : Art.tint(P.tangerine, 0.2), -4.4, FLOOR_TOP + 0.18 + level * 0.8, -1.2 + i);
      }
      b.blob(-4.4, 0.8, 1.4, 5.4);
      // A pallet of boxes and a cart.
      b.box(1.6, 0.14, 1.4, Art.shade(P.tangerine, 0.3), 2.8, FLOOR_TOP, 3.6);
      for (let i = 0; i < 4; i++) b.box(0.66, 0.5, 0.62, P.tangerine, 2.45 + (i % 2) * 0.7, FLOOR_TOP + 0.14 + Math.floor(i / 2) * 0.5, 3.6);
      b.blob(2.8, 3.6, 1.9, 1.7);
      b.prop("city", "box_B", -1.0, FLOOR_TOP, 3.8, { s: 3, ry: 0.4, blob: 0.8 });
      b.prop("furniture", "cactus_small_A", 4.4, FLOOR_TOP, -4.3, { s: 1.3, blob: 0.6 });
    },

    embroideryCorner(b, g, w) {
      const [ex, ez] = S.embroidery.model;
      b.box(4.4, 1.15, 1.1, P.cream, ex, FLOOR_TOP, ez, { outline: true });
      b.box(4.5, 0.12, 1.2, Art.shade(P.mint, 0.25), ex, FLOOR_TOP + 1.15, ez, { outline: true });
      b.box(4.4, 0.08, 0.3, Art.shade(P.cream, 0.3), ex, FLOOR_TOP + 0.75, ez + 0.56);
      b.blob(ex, ez, 5, 1.8);
      machines.embroideryHeads = [];
      for (let i = 0; i < 4; i++) {
        const hx = ex - 1.5 + i;
        const head = part(new THREE.BoxGeometry(0.55, 0.6, 0.62), P.mint, g, ...worldLocal(w, [hx, ez + 0.25], FLOOR_TOP + 1.27), { outline: true });
        head.geometry.translate(0, 0.3, 0);
        const needle = part(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), P.ink, head, 0, 0.0, 0.25);
        b.cyl(0.26, 0.26, 0.03, Art.tint(P.lilac, 0.3), hx, FLOOR_TOP + 1.27, ez + 0.4, { seg: 14 });   // hoop
        machines.embroideryHeads.push({ head, needle, baseY: FLOOR_TOP + 1.27 });
      }
      // Thread cones on a rack along the top.
      const colours = [P.tomato, P.sun, P.sky, P.lilac, P.mint, P.tangerine, P.cream, P.ink];
      colours.forEach((c, i) => b.cyl(0.03, 0.12, 0.34, c, ex - 1.75 + i * 0.5, FLOOR_TOP + 1.27, ez - 0.42, { seg: 8 }));
      hangerRail(b, -3.4, -4.4, 2.2, [P.mint, P.sky, P.cream, P.sun], 0);
      b.prop("furniture", "shelf_B_large_decorated", 2.6, FLOOR_TOP + 1.6, -4.85, { s: 1.0 });
      b.prop("furniture", "cactus_medium_A", 4.4, FLOOR_TOP, 4.3, { s: 1.2, blob: 0.9 });
      b.prop("furniture", "chair_stool", -2.6, FLOOR_TOP, 1.4, { blob: 0.7 });
    },

    bulkDesk(b, g, w) {
      b.prop("furniture", "table_medium_long", 0, FLOOR_TOP, -0.6, { s: 1.0, blob: 3.0 }) || table(b, 3, 1.4, Art.shade(P.tangerine, 0.3), 0, -0.6);
      b.prop("furniture", "chair_A", 0, FLOOR_TOP, -1.9, { blob: 0.8 });
      b.box(0.6, 0.04, 0.42, P.ink, 0.5, FLOOR_TOP + 1.0, -0.5);                       // laptop
      b.box(0.6, 0.38, 0.04, Art.shade(P.ink, 0.0), 0.5, FLOOR_TOP + 1.04, -0.72, { rx: -0.3 });
      teeStack(b, -0.8, FLOOR_TOP + 1.0, -0.4, 4, [P.sun, P.cream], 0.3);
      // The Kpda Karkhana signboard: two posts, a framed board and bulbs.
      for (const x of [-2.2, 2.2]) b.cyl(0.1, 0.12, 3.1, P.ink, x, FLOOR_TOP, -3.8, { outline: true });
      b.box(4.6, 1.6, 0.2, P.ink, 0, FLOOR_TOP + 1.7, -3.8, { outline: true });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.64), Art.toon("#ffffff", { map: Art.signTexture(T.signTop, T.signBottom), emissive: "#3a2a10" }));
      sign.position.copy(worldLocal(w, [0, -3.68], FLOOR_TOP + 2.5));
      g.add(sign);
      machines.signBulbs = [];
      for (let i = 0; i < 14; i++) {
        const u = i / 13;
        machines.signBulbs.push(worldLocal(w, [-2.15 + u * 4.3, -3.67], FLOOR_TOP + 3.38));
      }
      b.blob(0, -3.8, 5, 0.8);
      // Pallets of wrapped bulk orders.
      for (const x of [-3.2, 3.2]) {
        b.box(1.7, 0.14, 1.5, Art.shade(P.tangerine, 0.3), x, FLOOR_TOP, 3.4);
        for (let i = 0; i < 6; i++) b.box(0.66, 0.5, 0.62, i % 3 ? P.tangerine : Art.tint(P.tangerine, 0.25), x - 0.35 + (i % 2) * 0.7, FLOOR_TOP + 0.14 + Math.floor(i / 2) * 0.5, 3.4);
        b.box(1.5, 1.55, 1.3, Art.tint(P.sky, 0.75), x, FLOOR_TOP + 0.14, 3.4, { s: 1 });
        b.blob(x, 3.4, 2.0, 1.8);
      }
      b.prop("furniture", "cabinet_medium", 3.6, FLOOR_TOP, -2.0, { ry: -Math.PI / 2, blob: 1.4 });
      b.prop("furniture", "cactus_small_A", -4.3, FLOOR_TOP, -4.2, { s: 1.3, blob: 0.6 });
      b.prop("furniture", "book_set", -0.4, FLOOR_TOP + 1.0, -0.9, { s: 0.8 });
    },
  };

  // A point in a zone's local layout, as a position inside its group.
  function worldLocal(w, local, y = 0) {
    return new THREE.Vector3(local[0], y, local[1]);
  }

  // ---------- Machines that move ----------

  function buildPress(g, at) {
    const press = new THREE.Group();
    press.position.copy(at);
    g.add(press);
    part(new THREE.CylinderGeometry(0.95, 1.05, 0.42, 16), Art.shade(P.sky, 0.55), press, 0, FLOOR_TOP + 0.21, 0, { outline: true });
    part(new THREE.CylinderGeometry(0.17, 0.2, 1.3, 10), P.cream, press, 0, FLOOR_TOP + 1.05, 0, { outline: true });
    const carousel = new THREE.Group();
    carousel.position.y = FLOOR_TOP + 1.18;
    press.add(carousel);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i * Math.PI) / 2;
      part(new THREE.BoxGeometry(1.35, 0.1, 0.22), Art.shade(P.sky, 0.3), arm, 0.68, 0, 0);
      part(new THREE.BoxGeometry(0.72, 0.08, 0.8), P.cream, arm, 1.38, 0.08, 0, { outline: true });
      carousel.add(arm);
    }
    // The print head: a frame with a screen that lowers onto the platen.
    const headPivot = new THREE.Group();
    headPivot.position.set(0, FLOOR_TOP + 1.85, 0);
    press.add(headPivot);
    part(new THREE.BoxGeometry(1.0, 0.14, 0.2), P.sky, headPivot, 0.55, 0, 0, { outline: true });
    const screenFrame = part(new THREE.BoxGeometry(0.78, 0.07, 0.86), P.sun, headPivot, 1.38, -0.18, 0, { outline: true });
    part(new THREE.BoxGeometry(0.6, 0.075, 0.66), Art.tint(P.sky, 0.6), screenFrame, 0, 0.005, 0);
    const squeegee = part(new THREE.BoxGeometry(0.06, 0.16, 0.7), P.tomato, screenFrame, -0.2, 0.1, 0);
    machines.press = { carousel, headPivot, squeegee, phase: 0, index: 0 };
  }

  function buildFlash(g, x, z) {
    part(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), P.ink, g, x, FLOOR_TOP + 0.6, z);
    part(new THREE.CylinderGeometry(0.35, 0.4, 0.06, 10), P.ink, g, x, FLOOR_TOP + 0.03, z);
    const heater = part(new THREE.BoxGeometry(0.9, 0.2, 0.7), P.tangerine, g, x - 0.2, FLOOR_TOP + 1.3, z, { outline: true });
    const glow = part(new THREE.BoxGeometry(0.8, 0.04, 0.6), "#ffffff", heater, 0, -0.11, 0, { material: new THREE.MeshBasicMaterial({ color: Art.shade(P.tangerine, 0.5) }) });
    machines.flash = { heater, glow };
  }

  function buildDryer(g, x, z) {
    const dryer = new THREE.Group();
    dryer.position.set(x, 0, z);
    g.add(dryer);
    for (const dx of [-1.4, 1.4]) {
      for (const dz of [-0.4, 0.4]) part(new THREE.BoxGeometry(0.08, 0.7, 0.08), P.ink, dryer, dx, FLOOR_TOP + 0.35, dz);
    }
    part(new THREE.BoxGeometry(3.1, 0.12, 0.95), Art.shade(P.ink, 0.1), dryer, 0, FLOOR_TOP + 0.74, 0, { outline: true });
    const beltTex = Art.beltTexture();
    const belt = part(new THREE.PlaneGeometry(3.0, 0.8), "#ffffff", dryer, 0, FLOOR_TOP + 0.805, 0, { material: Art.toon("#ffffff", { map: beltTex }), shadow: false });
    belt.rotation.x = -Math.PI / 2;
    belt.receiveShadow = true;
    // Heater tunnel with a glowing mouth and a vent on top.
    part(new THREE.BoxGeometry(1.6, 0.85, 1.15), P.tomato, dryer, 0, FLOOR_TOP + 1.18, 0, { outline: true });
    part(new THREE.BoxGeometry(1.64, 0.14, 1.19), Art.shade(P.tomato, 0.4), dryer, 0, FLOOR_TOP + 1.62, 0);
    const mouth = part(new THREE.PlaneGeometry(1.0, 0.36), "#ffffff", dryer, 0.81, FLOOR_TOP + 1.0, 0, { material: new THREE.MeshBasicMaterial({ color: Art.shade(P.tangerine, 0.5) }), shadow: false });
    mouth.rotation.y = Math.PI / 2;
    part(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 10), Art.shade(P.cream, 0.2), dryer, -0.4, FLOOR_TOP + 1.9, 0, { outline: true });
    // Tees riding the belt while the press works.
    const tees = [];
    for (let i = 0; i < 3; i++) {
      const tee = part(Art.teeGeometry(true), V.colors.tees.screen, dryer, 0, FLOOR_TOP + 0.81, 0, { material: Art.toon("#ffffff", { vertexColors: true }) });
      tee.material = tee.material.clone();
      tee.material.color.set(V.colors.tees.screen);
      tee.scale.setScalar(0.001);
      tees.push(tee);
    }
    machines.dryer = { belt, beltTex, mouth, tees, vent: new THREE.Vector3(x - 0.4, FLOOR_TOP + 2.2, z), group: dryer };
  }

  // ---------- Building a zone ----------

  function buildZone(zone) {
    const cell = V.layout[zone.id] || [0, 0];
    const group = new THREE.Group();
    group.position.copy(cellCentre(cell));
    world.add(group);
    const uniforms = Art.zoneUniforms();
    const color = V.colors.zones[zone.id] || V.colors.ground;
    const walls = wallsFor(cell);
    buildFloor(group, zone.id, color, uniforms, walls);
    const contents = new THREE.Group();
    group.add(contents);
    const b = Art.builder(models);
    buildWalls(b, walls, V.colors.zones[zone.id] ? Art.shade(color, 0.2) : P.sky);
    if (BUILDERS[zone.id]) BUILDERS[zone.id](b, contents, group);
    b.finish(contents, uniforms);
    // Moving parts were added straight to `contents`; grey them with the zone too.
    contents.traverse((m) => {
      if (m.isMesh && !m.userData.isOutline && !m.isInstancedMesh && m.material && !m.material.onBeforeCompile.toString().includes("uGrey")) {
        if (m.material.isMeshToonMaterial) {
          m.material = m.material.clone();
          Art.addGrey(m.material, uniforms);
        }
      }
    });
    const n = posterCount++;
    if (walls.back) { poster(contents, n, "back", -0.6, uniforms); poster(contents, n + 2, "back", 4.0, uniforms); }
    if (walls.left) poster(contents, n + 1, "left", -2.6, uniforms);
    const label = makeLabel(zone.name, 3.6, PANEL);
    label.position.set(0, 0.7, V.zoneSize / 2 - 0.4);
    group.add(label);
    const lock = makePadlock(1.25);
    lock.position.y = 2.6;
    group.add(lock);
    zoneViews[zone.id] = { zone, group, contents, uniforms, label, lock, open: null, anim: null };
  }
  let posterCount = 0;

  function makePadlock(scale = 1, outlined = true) {
    const lock = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.0, 0.55), Art.toon(P.sun));
    body.position.y = 0.5;
    lock.add(body);
    const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.11, 8, 18, Math.PI), Art.toon(P.cream));
    shackle.position.y = 1.0;
    lock.add(shackle);
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), Art.toon(P.ink));
    hole.rotation.x = Math.PI / 2;
    hole.position.set(0, 0.6, 0.28);
    lock.add(hole);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.06), Art.toon(P.ink));
    slot.position.set(0, 0.45, 0.28);
    lock.add(slot);
    if (outlined) { Art.outline(body); Art.outline(shackle); }
    lock.rotation.y = Math.PI / 4;   // face the camera
    lock.scale.setScalar(scale);
    lock.userData.scale = scale;
    return lock;
  }

  function lockedLabel(zone) {
    const r = zone.requires || {};
    const need = r.level !== undefined
      ? fillText(T.levelNeed, { n: r.level })
      : fillText(T.cashNeed, { cash: formatMoney(r.cash || 0) });
    return fillText(T.lockedLabel, { need });
  }

  function setZoneLook(zv, open) {
    zv.uniforms.uGrey.value = open ? 0 : 1;
    zv.lock.visible = !open;
    zv.lock.scale.setScalar(zv.lock.userData.scale);
    zv.label.userData.setText(open ? zv.zone.name : lockedLabel(zv.zone), open ? PANEL : "rgba(110,80,20,0.9)");
  }

  // ---------- Loading dock, street and van ----------

  function buildDock() {
    const centre = cellCentre(V.dockCell);
    const group = new THREE.Group();
    group.position.copy(centre);
    world.add(group);
    const uniforms = Art.zoneUniforms();
    buildFloor(group, "dock", V.colors.dock, uniforms, { back: false, left: false });
    const b = Art.builder(models);
    // Road out of the shop, with dashes and a kerb.
    b.box(3.4, 0.06, 30, V.colors.road, 0, 0, V.zoneSize / 2 + 15);
    for (let i = 0; i < 12; i++) b.box(0.14, 0.02, 1.0, P.cream, 0, 0.06, V.zoneSize / 2 + 1.5 + i * 2.4);
    for (const x of [-1.85, 1.85]) b.box(0.3, 0.12, 30, Art.shade(P.cream, 0.35), x, 0, V.zoneSize / 2 + 15);
    // Pallet the boxes are loaded from, and the dock's props.
    b.box(1.4, 0.14, 1.2, Art.shade(P.tangerine, 0.25), 0, FLOOR_TOP, 1.2);
    b.blob(0, 1.2, 1.7, 1.5);
    b.prop("city", "streetlight", -2.4, 0, 7.5, { s: 4.2, blob: 0.8 });
    b.prop("city", "streetlight", 2.4, 0, 12.5, { s: 4.2, ry: Math.PI, blob: 0.8 });
    b.prop("city", "firehydrant", 2.5, 0, 6.6, { s: 4, blob: 0.5 });
    b.prop("city", "bush", -2.5, 0, 6.0, { s: 4, blob: 0.9 });
    b.prop("city", "bush", -2.6, 0, 10.5, { s: 4, blob: 0.9 });
    b.prop("city", "bench", 2.7, 0, 9.0, { s: 4, ry: -Math.PI / 2, blob: 1.0 });
    b.prop("city", "car_stationwagon", -0.95, 0.06, 18.5, { s: 4, ry: Math.PI, blob: 2.2 });
    b.prop("city", "dumpster", 4.3, FLOOR_TOP, 3.2, { s: 3.4, ry: -Math.PI / 2, blob: 1.6 });
    b.prop("city", "trash_A", 3.6, FLOOR_TOP, 4.3, { s: 4, blob: 0.5 });
    b.prop("restaurant", "crate", -4.2, FLOOR_TOP, 3.9, { s: 0.55, blob: 1.3 });
    b.prop("restaurant", "crate", -4.2, FLOOR_TOP + 0.44, 3.9, { s: 0.45, ry: 0.4 });
    b.prop("city", "box_A", -3.2, FLOOR_TOP, 4.3, { s: 3, ry: 0.3, blob: 0.7 });
    b.finish(group, uniforms);
    const label = makeLabel(T.dockLabel, 3.4, PANEL);
    label.position.set(-2.6, 0.7, V.zoneSize / 2 - 0.4);
    group.add(label);
    van = buildVan();
    van.position.set(S.van.model[0], FLOOR_TOP, S.van.model[1] + 0.3);
    van.userData.home = van.position.z;
    group.add(van);
  }

  // A delivery van: cream body, tomato stripe, sky windows, plum wheels.
  function buildVan() {
    const g = new THREE.Group();
    part(new THREE.BoxGeometry(1.7, 1.45, 2.5), P.cream, g, 0, 0.35 + 0.72, -0.35, { outline: true });
    part(new THREE.BoxGeometry(1.72, 0.22, 2.52), P.tomato, g, 0, 0.75, -0.35);
    part(new THREE.BoxGeometry(1.7, 0.95, 1.1), P.cream, g, 0, 0.35 + 0.47, 1.4, { outline: true });
    part(new THREE.BoxGeometry(1.72, 0.22, 1.12), P.tomato, g, 0, 0.75, 1.4);
    const glass = part(new THREE.BoxGeometry(1.5, 0.42, 0.06), Art.tint(P.sky, 0.25), g, 0, 1.12, 1.96, { shadow: false });
    glass.rotation.x = -0.25;
    for (const x of [-0.86, 0.86]) part(new THREE.BoxGeometry(0.04, 0.36, 0.7), Art.tint(P.sky, 0.25), g, x, 1.1, 1.35, { shadow: false });
    for (const x of [-0.6, 0.6]) part(new THREE.BoxGeometry(0.3, 0.16, 0.05), P.sun, g, x, 0.6, 1.96, { shadow: false });
    part(new THREE.BoxGeometry(1.4, 0.5, 0.04), Art.tint(P.tangerine, 0.2), g, 0, 1.15, -1.61);   // back doors
    g.userData.wheels = [];
    for (const x of [-0.82, 0.82]) {
      for (const z of [-1.05, 1.3]) {
        const wheel = part(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14), P.ink, g, x, 0.32, z);
        wheel.rotation.z = Math.PI / 2;
        part(new THREE.CylinderGeometry(0.14, 0.14, 0.26, 10), P.cream, wheel, 0, 0, 0, { shadow: false });
        g.userData.wheels.push(wheel);
      }
    }
    return g;
  }

  // ---------- Characters: the player and the staff ----------

  function buildCharacter(index) {
    const isPlayer = index === 0;
    const shirt = isPlayer ? V.colors.player : V.colors.shirt[(index - 1) % V.colors.shirt.length];
    const ch = Art.character(shirt, isPlayer, index);
    ch.size = isPlayer ? 1.15 : 1.0;
    ch.pop = 0;
    ch.leaving = 0;
    ch.wob = { x: 0, z: 0, vx: 0, vz: 0, lastVx: 0, lastVz: 0, lastX: null, lastZ: null };
    world.add(ch.root);
    return ch;
  }

  function updateCharacters(dt) {
    const carriers = Carry.carriers();
    while (characters.filter((c) => !c.leaving).length < carriers.length) {
      const live = characters.filter((c) => !c.leaving);
      const ch = buildCharacter(live.length);
      characters.splice(live.length, 0, ch);
    }
    // Staff who leave (a rebrand) shrink away.
    let liveCount = 0;
    for (const ch of characters) {
      if (ch.leaving) continue;
      liveCount += 1;
      if (liveCount > carriers.length) ch.leaving = 0.0001;
    }
    characters = characters.filter((ch) => {
      if (!ch.leaving) return true;
      ch.leaving += dt / A.shrinkSeconds;
      ch.root.scale.setScalar(Math.max(0.001, ch.size * (1 - Art.easeIn(Math.min(1, ch.leaving)))));
      if (ch.leaving >= 1) { world.remove(ch.root); return false; }
      return true;
    });
    let bi = 0;
    carriers.forEach((c, i) => {
      const ch = characters[i];
      if (!ch || ch.leaving) return;
      ch.root.position.set(c.pos.x, FLOOR_TOP, c.pos.z);
      // Turn smoothly toward the way it is facing.
      let diff = c.facing - ch.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      ch.root.rotation.y += diff * Math.min(1, dt * 14);
      const speed01 = Math.min(1, c.speed / C.playerSpeed);
      ch.update(dt, speed01, c.stack.length > 0);
      // Pop in when hired, then squash and stretch on every pickup.
      ch.pop = Math.min(1, ch.pop + dt / A.popSeconds);
      const s = c.squash;
      const y = 1 - 0.24 * s * Math.cos((1 - s) * Math.PI * 1.5);
      const k = ch.size * ease(ch.pop);
      ch.root.scale.set(k / Math.sqrt(y), k * y, k / Math.sqrt(y));
      updateWobble(ch, c, dt);
      placeBlob(charBlobs, bi++, c.pos.x, c.pos.z, 0.95 * ch.size);
    });
    charBlobs.count = bi;
    charBlobs.instanceMatrix.needsUpdate = true;
  }

  // The stack on a carrier's back is a spring: it lags when you start and
  // swings past when you stop.
  function updateWobble(ch, c, dt) {
    const w = ch.wob;
    if (w.lastX === null) { w.lastX = c.pos.x; w.lastZ = c.pos.z; }
    const vx = dt > 0 ? (c.pos.x - w.lastX) / dt : 0;
    const vz = dt > 0 ? (c.pos.z - w.lastZ) / dt : 0;
    const ax = dt > 0 ? (vx - w.lastVx) / dt : 0;
    const az = dt > 0 ? (vz - w.lastVz) / dt : 0;
    w.lastX = c.pos.x; w.lastZ = c.pos.z; w.lastVx = vx; w.lastVz = vz;
    const k = 70;
    const damp = 7;
    w.vx += (-k * w.x - damp * w.vx - Math.max(-60, Math.min(60, ax)) * 0.9) * dt;
    w.vz += (-k * w.z - damp * w.vz - Math.max(-60, Math.min(60, az)) * 0.9) * dt;
    w.x = Math.max(-0.5, Math.min(0.5, w.x + w.vx * dt));
    w.z = Math.max(-0.5, Math.min(0.5, w.z + w.vz * dt));
  }

  const tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Color(), e: new THREE.Euler() };

  function placeBlob(mesh, i, x, z, size) {
    tmp.q.identity();
    mesh.setMatrixAt(i, tmp.m.compose(tmp.p.set(x, FLOOR_TOP + 0.012, z), tmp.q, tmp.s.set(size, 1, size)));
  }

  // ---------- Items: what is carried and what waits at stations ----------
  // Each item keeps how it is drawn between frames, so it can pop in, fly on
  // an arc when it jumps to a new place, glide when a pile shifts, and shrink
  // away when it is gone.

  function buildItems() {
    const tee = models && models.tee;
    const geo = {
      blank: tee || Art.teeGeometry(false),
      printed: tee || Art.teeGeometry(true),
      box: Art.boxGeometry(),
    };
    for (const kind of Object.keys(geo)) {
      const material = Art.toon("#ffffff", geo[kind].attributes.color ? { vertexColors: true } : {});
      const mesh = new THREE.InstancedMesh(geo[kind], material, MAX_ITEMS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color("#ffffff"));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      world.add(mesh);
      itemMeshes[kind] = mesh;
    }
  }

  function itemColor(kind, typeId) {
    if (kind === "blank") return V.colors.blank;
    if (kind === "box") return V.colors.box;
    return V.colors.tees[typeId] || V.colors.tees.screen;
  }

  function drawInstance(kind, x, y, z, rotY, scale, color, tilt = 0) {
    const mesh = itemMeshes[kind];
    if (!mesh || mesh.count >= MAX_ITEMS) return;
    tmp.e.set(tilt, rotY, 0);
    tmp.q.setFromEuler(tmp.e);
    tmp.s.setScalar(Math.max(0.001, scale));
    tmp.p.set(x, y, z);
    tmp.m.compose(tmp.p, tmp.q, tmp.s);
    mesh.setMatrixAt(mesh.count, tmp.m);
    mesh.setColorAt(mesh.count, tmp.c.set(color));
    mesh.count += 1;
  }

  // Draw one item. `o.follow` items track their target exactly (carried
  // stacks); others glide. `o.from` makes a new item fly in from that spot.
  function showItem(key, kind, typeId, x, y, z, rotY, scale, dt, o = {}) {
    let rec = shown.get(key);
    if (!rec) {
      rec = { x, y, z, kind, pop: o.from ? 1 : 0, fly: null };
      if (o.from) rec.fly = { x: o.from.x, y: o.from.y, z: o.from.z, t: 0 };
      shown.set(key, rec);
    } else if (Math.hypot(x - rec.x, z - rec.z, (y - rec.y) * 0.5) > 0.9 && !rec.fly) {
      rec.fly = { x: rec.x, y: rec.y, z: rec.z, t: 0 };
    }
    if (rec.kind !== kind) {
      rec.kind = kind;
      rec.pop = 0.35;   // a machine finished it: a little bounce
    }
    rec.pop = Math.min(1, rec.pop + dt / A.popSeconds);
    let px = x, py = y, pz = z;
    if (rec.fly) {
      rec.fly.t = Math.min(1, rec.fly.t + dt / A.flySeconds);
      const t = Art.easeInOut(rec.fly.t);
      px = rec.fly.x + (x - rec.fly.x) * t;
      pz = rec.fly.z + (z - rec.fly.z) * t;
      py = rec.fly.y + (y - rec.fly.y) * t + Math.sin(t * Math.PI) * 1.1;
      if (rec.fly.t >= 1) rec.fly = null;
    } else if (!o.follow) {
      const k = 1 - Math.exp(-dt * 16);
      px = rec.x + (x - rec.x) * k;
      py = rec.y + (y - rec.y) * k;
      pz = rec.z + (z - rec.z) * k;
    }
    rec.x = px; rec.y = py; rec.z = pz; rec.rot = rotY; rec.scale = scale; rec.typeId = typeId;
    rec.seen = frameNo;
    const s = scale * ease(rec.pop);
    drawInstance(kind, px, py, pz, rotY, s, itemColor(kind, typeId), o.tilt || 0);
  }

  // Items not drawn this frame shrink away where they were.
  function retireItems(dt) {
    for (const [key, rec] of shown) {
      if (rec.seen === frameNo) continue;
      shown.delete(key);
      ghosts.push({ ...rec, t: 0 });
    }
    ghosts = ghosts.filter((g) => {
      g.t += dt / A.shrinkSeconds;
      if (g.t >= 1) return false;
      drawInstance(g.kind, g.x, g.y, g.z, g.rot || 0, g.scale * (1 - Art.easeIn(g.t)), itemColor(g.kind, g.typeId));
      return true;
    });
  }

  // A pile at a world spot: columns of up to `perColumn`, side by side.
  function placePile(prefix, items, origin, dt, perColumn = 8, base = 0.01) {
    items.forEach((item, i) => {
      const col = Math.floor(i / perColumn);
      const row = i % perColumn;
      const h = ITEM_H[item.kind];
      const key = item.id !== undefined ? item.id : `${prefix}-${i}`;
      showItem(key, item.kind, item.typeId, origin.x + col * 0.78, FLOOR_TOP + base + row * h, origin.z, Math.PI / 4 + Math.sin(row * 2.1) * 0.06, 1, dt);
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
  let pileSpots = {};

  function pileSpot(name) {
    if (!pileSpots[name]) pileSpots[name] = worldOf(PILES[name][0], PILES[name][1]);
    return pileSpots[name];
  }

  // Where a newly picked-up item flies from: the nearest pile to the carrier.
  function pickupOrigin(c) {
    let best = null;
    let bestD = 3;
    for (const name of Object.keys(PILES)) {
      const s = pileSpot(name);
      const d = Math.hypot(s.x - c.pos.x, s.z - c.pos.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best ? { x: best.x, y: FLOOR_TOP + 0.4, z: best.z } : null;
  }

  function updateItems(dt) {
    frameNo += 1;
    for (const mesh of Object.values(itemMeshes)) mesh.count = 0;
    const st = Carry.stations();
    // Blanks on offer at the rack (bought ones, plus the next order's if affordable).
    const stock = Carry.rackStock();
    const rackItems = [];
    for (let i = 0; i < Math.min(stock.count, 24); i++) rackItems.push({ kind: "blank" });
    placePile("rack", rackItems, pileSpot("rack"), dt, 8, 0.14);
    placePile("pressIn", st.press.input, pileSpot("pressIn"), dt);
    placePile("pressOut", st.press.output, pileSpot("pressOut"), dt);
    if (isZoneOpen("embroideryCorner")) {
      placePile("embIn", st.embroidery.input, pileSpot("embroideryIn"), dt);
      placePile("embOut", st.embroidery.output, pileSpot("embroideryOut"), dt);
    }
    placePile("packIn", st.pack.input, pileSpot("packIn"), dt);
    placePile("packOut", st.pack.output, pileSpot("packOut"), dt, 6);
    if (vanTrip.phase === "parked") placePile("van", st.van.input, pileSpot("van"), dt, 5, 0.14);
    // Items being worked on sit on the machine.
    workingItems(st.press, worldOf("printFloor", S.press.model), 1.32, dt, true);
    workingItems(st.embroidery, worldOf("embroideryCorner", S.embroidery.model).add(new THREE.Vector3(0, 0, 0.4)), 1.3, dt);
    workingItems(st.pack, worldOf("printFloor", S.pack.model), 1.18, dt);
    // Stacks on everyone's back, wobbling as they move.
    Carry.carriers().forEach((c, i) => {
      const ch = characters[i];
      if (!ch || ch.leaving) return;
      const scale = ch.root.scale.y;
      const rot = ch.root.rotation.y;
      const sin = Math.sin(rot);
      const cos = Math.cos(rot);
      const back = 0.36 * ch.size;
      let y = FLOOR_TOP + 0.98 * scale;
      const n = c.stack.length;
      c.stack.forEach((item, k) => {
        const lean = Math.pow((k + 1) / Math.max(4, n), 1.3);
        const wx = ch.wob.x * lean;
        const wz = ch.wob.z * lean;
        const fresh = !shown.has(item.id);
        showItem(item.id, item.kind, item.typeId,
          c.pos.x - sin * back + wx, y, c.pos.z - cos * back + wz,
          rot, 0.85, dt, { follow: true, from: fresh ? pickupOrigin(c) : null, tilt: (Math.abs(ch.wob.x) + Math.abs(ch.wob.z)) * lean * 0.6 });
        y += ITEM_H[item.kind] * 0.85;
      });
    });
    retireItems(dt);
    for (const mesh of Object.values(itemMeshes)) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  function workingItems(station, at, height, dt, onPlaten) {
    if (!station.working) return;
    let k = 0;
    for (const job of station.working.values()) {
      const bob = Math.sin(clock * 9 + k) * 0.03;
      const x = onPlaten ? at.x + 1.38 : at.x + k * 0.3;
      const z = onPlaten ? at.z + k * 0.25 : at.z - k * 0.3;
      showItem(job.item.id, job.item.kind, job.item.typeId, x, FLOOR_TOP + height + bob, z, Math.PI / 2, 1, dt);
      k += 1;
    }
  }

  // Labels over the rack (price of the next blanks) and blocked machines.
  function buildStationLabels() {
    for (const [id, area, local] of [["rack", "printFloor", S.rack.model], ["press", "printFloor", S.press.model],
      ["pack", "printFloor", S.pack.model], ["embroidery", "embroideryCorner", S.embroidery.model]]) {
      const label = makeLabel("", 2.5, PANEL);
      label.position.copy(worldOf(area, local)).add(new THREE.Vector3(0, 3.2, 0));
      label.visible = false;
      label.userData.want = false;
      world.add(label);
      stationLabels[id] = label;
    }
  }

  function updateStationLabels(dt) {
    const stock = Carry.rackStock();
    const rack = stationLabels.rack;
    const rackOn = Boolean(stock.next) && stock.paid === 0;
    if (rackOn) rack.userData.setText(`Blanks ${formatMoney(stock.nextCost)}`, stock.affordable ? PANEL_GOOD : PANEL_BAD);
    setShown(rack, rackOn);
    animateShown(rack, dt);
    const st = Carry.stations();
    for (const id of ["press", "pack", "embroidery"]) {
      const label = stationLabels[id];
      const on = st[id].blockedBy > 0 && state.cash < st[id].blockedBy;
      if (on) label.userData.setText(fillText(C.text.needCash, { cash: formatMoney(st[id].blockedBy) }), PANEL_BAD);
      setShown(label, on);
      animateShown(label, dt);
    }
  }

  // ---------- Tiles ----------

  function roundedSquare(size, radius, depth) {
    const s = new THREE.Shape();
    const h = size / 2;
    s.moveTo(-h + radius, -h);
    s.lineTo(h - radius, -h);
    s.quadraticCurveTo(h, -h, h, -h + radius);
    s.lineTo(h, h - radius);
    s.quadraticCurveTo(h, h, h - radius, h);
    s.lineTo(-h + radius, h);
    s.quadraticCurveTo(-h, h, -h, h - radius);
    s.lineTo(-h, -h + radius);
    s.quadraticCurveTo(-h, -h, -h + radius, -h);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    return g;
  }

  function upgradeIcon() {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.32);
    shape.lineTo(0.3, 0.02);
    shape.lineTo(0.14, 0.02);
    shape.lineTo(0.14, -0.28);
    shape.lineTo(-0.14, -0.28);
    shape.lineTo(-0.14, 0.02);
    shape.lineTo(-0.3, 0.02);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    geo.translate(0, 0, -0.06);
    const arrowMesh = new THREE.Mesh(geo, Art.toon(P.sun));
    arrowMesh.rotation.y = Math.PI / 4;
    g.add(arrowMesh);
    Art.outline(arrowMesh);
    return g;
  }

  function buildTileView(tile) {
    const group = new THREE.Group();
    group.position.set(tile.pos.x, FLOOR_TOP, tile.pos.z);
    const size = C.tileRadius * 1.8;
    const rim = new THREE.Mesh(roundedSquare(size, 0.32, 0.06), Art.fresh(P.cream));
    rim.receiveShadow = true;
    group.add(rim);
    const inner = new THREE.Mesh(roundedSquare(size - 0.22, 0.24, 0.08), Art.toon(Art.shade(P.ink, 0.1)));
    inner.receiveShadow = true;
    group.add(inner);
    const fill = new THREE.Mesh(new THREE.BoxGeometry(size - 0.3, 0.1, size - 0.3), Art.toon(V.colors.tileFill));
    fill.scale.z = 0.001;
    group.add(fill);
    const label = makeLabel("", 2.7, PANEL, 2);
    label.position.set(0, 1.6, 0);
    group.add(label);
    const icon = tile.kind === "zone" ? makePadlock(0.42, false) : upgradeIcon();
    icon.position.y = 0.2;
    group.add(icon);
    group.scale.setScalar(0.001);
    world.add(group);
    return { group, rim, inner, fill, label, icon, size, pop: 0, leaving: 0 };
  }

  function updateTiles(dt) {
    const visible = new Set(Carry.tiles());
    for (const [tile, tv] of tileViews) {
      const info = visible.has(tile) ? Carry.tileInfo(tile) : null;
      tv.leaving = (!info || info.maxed) ? tv.leaving + dt / A.shrinkSeconds : 0;
      if (tv.leaving >= 1) {
        world.remove(tv.group);
        tileViews.delete(tile);
      }
    }
    for (const tile of visible) {
      let tv = tileViews.get(tile);
      const info = Carry.tileInfo(tile);
      if (!tv) {
        if (info.maxed) continue;
        tv = buildTileView(tile);
        tileViews.set(tile, tv);
      }
      tv.pop = Math.min(1, tv.pop + dt / A.popSeconds);
      const k = tv.leaving > 0 ? 1 - Art.easeIn(Math.min(1, tv.leaving)) : ease(tv.pop);
      tv.group.scale.setScalar(Math.max(0.001, k));
      if (info.maxed) continue;
      const rimColor = info.ready ? V.colors.tileReady : info.locked ? V.colors.tileLocked : P.tomato;
      tv.rim.material.color.set(rimColor);
      const lineColor = info.ready ? Art.tint(P.mint, 0.3) : info.locked ? Art.tint(P.lilac, 0.5) : Art.tint(P.tomato, 0.35);
      tv.label.userData.setText(info.title, PANEL, info.line, lineColor);
      // The fill grows from the near edge as cash drains in.
      tv.fill.scale.z = Math.max(0.001, tile.fill);
      tv.fill.position.z = (tv.size - 0.3) * (1 - tile.fill) / 2;
      const pulse = info.ready ? 1 + Math.sin(clock * 5.5) * 0.04 : 1;
      tv.rim.scale.set(pulse, 1, pulse);
      tv.icon.position.y = 0.2 + (info.ready ? Math.abs(Math.sin(clock * 3.3)) * 0.3 : 0);
      tv.icon.rotation.y = tile.kind === "zone" ? 0 : clock * 1.6;
    }
  }

  // ---------- Guide arrow ----------

  function buildGuide() {
    const group = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), Art.toon(P.sun, { emissive: Art.shade(P.sun, 0.75) }));
    cone.rotation.x = Math.PI;   // point down
    group.add(cone);
    Art.outline(cone);
    const label = makeLabel("", 3.0, PANEL);
    label.position.y = 1.15;
    group.add(label);
    world.add(group);
    const ground = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 3), new THREE.MeshBasicMaterial({ color: P.sun, transparent: true, opacity: 0.9 }));
    ground.visible = false;
    world.add(ground);
    guide = { group, label, ground, pop: 0, want: false, lastLabel: "", base: 1 };
    group.visible = false;
  }

  function updateGuide(dt) {
    const g = Carry.guideToShow();
    const player = Carry.player();
    const want = Boolean(g && player);
    // Pop the arrow in when it appears or points somewhere new.
    if (want && (!guide.want || g.label !== guide.lastLabel)) guide.pop = 0;
    guide.want = want;
    if (want) {
      guide.lastLabel = g.label;
      guide.target = new THREE.Vector3(g.pos.x, 0, g.pos.z);
      guide.label.userData.setText(g.label);
      guide.pop = Math.min(1, guide.pop + dt / A.popSeconds);
      guide.group.visible = true;
      guide.group.scale.setScalar(Math.max(0.001, ease(guide.pop)));
      guide.shrink = 0;
    } else if (guide.group.visible) {
      guide.shrink = (guide.shrink || 0) + dt / A.shrinkSeconds;
      guide.group.scale.setScalar(Math.max(0.001, 1 - Art.easeIn(Math.min(1, guide.shrink))));
      if (guide.shrink >= 1) guide.group.visible = false;
    }
    if (guide.target) guide.group.position.set(guide.target.x, FLOOR_TOP + 2.5 + Math.abs(Math.sin(clock * 4)) * 0.4, guide.target.z);
    guide.ground.visible = false;
    if (!want) return;
    const dx = g.pos.x - player.pos.x;
    const dz = g.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.2 && !g.waiting) {
      guide.ground.visible = true;
      const k = 1.35 + Math.sin(clock * 5) * 0.15;
      guide.ground.position.set(player.pos.x + (dx / d) * k, FLOOR_TOP + 0.12, player.pos.z + (dz / d) * k);
      guide.ground.rotation.set(Math.PI / 2, 0, Math.atan2(-dx, dz));
    }
  }

  // ---------- Effects: coins, confetti, steam, rings, numbers, cash flights ----------

  function buildEffects() {
    const coinGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12);
    fx.coins = new THREE.InstancedMesh(coinGeo, Art.toon(P.sun, { emissive: Art.shade(P.sun, 0.7) }), 90);
    fx.confetti = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.15, 0.04), new THREE.MeshBasicMaterial({ color: "#ffffff" }), 140);
    fx.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: P.cream, transparent: true, opacity: 0.75, depthWrite: false }), 60);
    for (const m of [fx.coins, fx.confetti, fx.puffs]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      world.add(m);
    }
    fx.confetti.setColorAt(0, new THREE.Color("#ffffff"));
    if (machines.signBulbs) {
      fx.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), machines.signBulbs.length);
      const centre = cellCentre(V.layout.bulkDesk);
      machines.signBulbs.forEach((p, i) => {
        fx.bulbs.setMatrixAt(i, tmp.m.makeTranslation(p.x + centre.x, p.y, p.z + centre.z));
        fx.bulbs.setColorAt(i, tmp.c.set(P.sun));
      });
      world.add(fx.bulbs);
    }
  }

  const CONFETTI_COLORS = [P.sun, P.tomato, P.sky, P.mint, P.lilac, P.cream];

  function burst(pos, big, small) {
    const n = big ? 80 : small ? 18 : 44;
    for (let i = 0; i < n && particles.confetti.length < 140; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 6.5 : 4) * (0.4 + Math.random());
      particles.confetti.push({
        x: pos.x, y: FLOOR_TOP + 0.8, z: pos.z,
        vx: Math.cos(a) * sp, vy: 5 + Math.random() * (big ? 8 : 4), vz: Math.sin(a) * sp,
        life: 1.4 + Math.random() * 0.6, spin: Math.random() * 10, age: 0,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      });
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 6, 36), new THREE.MeshBasicMaterial({ color: P.sun, transparent: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pos.x, FLOOR_TOP + 0.2, pos.z);
    world.add(ring);
    rings.push({ mesh: ring, t: 0, max: big ? 6.5 : 3 });
  }

  function poof(pos) {
    for (let i = 0; i < 6 && particles.puffs.length < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      particles.puffs.push({ x: pos.x + Math.cos(a) * 0.4, y: FLOOR_TOP + 0.5, z: pos.z + Math.sin(a) * 0.4, vy: 1.2, life: 0.7, age: 0, size: 1.2 });
    }
  }

  function steam(at, size = 1) {
    if (particles.puffs.length >= 60) return;
    particles.puffs.push({ x: at.x + (Math.random() - 0.5) * 0.2, y: at.y, z: at.z + (Math.random() - 0.5) * 0.2, vy: 1.4 + Math.random() * 0.5, life: 1.3, age: 0, size });
  }

  function coinBurst(pos, count) {
    for (let i = 0; i < count && particles.coins.length < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      particles.coins.push({
        mode: "burst", x: pos.x, y: FLOOR_TOP + 1.2, z: pos.z, age: 0,
        vx: Math.cos(a) * 2.5, vy: 6 + Math.random() * 4, vz: Math.sin(a) * 2.5, life: 1.0, spin: Math.random() * 6,
      });
    }
  }

  function drainCoin(from, to) {
    if (particles.coins.length >= 90) return;
    particles.coins.push({ mode: "fly", from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, t: 0, life: 0.35, spin: 0, age: 0 });
  }

  function updateParticles(dt) {
    fx.coins.count = 0;
    particles.coins = particles.coins.filter((c) => {
      c.spin += dt * 12;
      c.age += dt;
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
      const pop = Math.min(1, c.age / 0.12);
      const fade = c.mode === "burst" ? Math.min(1, c.life / 0.2) : 1;
      tmp.e.set(Math.PI / 2, c.spin, 0);
      tmp.q.setFromEuler(tmp.e);
      tmp.s.setScalar(Math.max(0.001, pop * fade));
      tmp.p.set(c.x, c.y, c.z);
      fx.coins.setMatrixAt(fx.coins.count++, tmp.m.compose(tmp.p, tmp.q, tmp.s));
      return true;
    });
    fx.coins.instanceMatrix.needsUpdate = true;

    fx.confetti.count = 0;
    particles.confetti = particles.confetti.filter((p) => {
      p.life -= dt;
      p.age += dt;
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
      tmp.s.setScalar(Math.max(0.001, Math.min(1, p.life * 2, p.age / 0.08)));
      tmp.p.set(p.x, p.y, p.z);
      fx.confetti.setMatrixAt(fx.confetti.count, tmp.m.compose(tmp.p, tmp.q, tmp.s));
      fx.confetti.setColorAt(fx.confetti.count, tmp.c.set(p.color));
      fx.confetti.count += 1;
      return true;
    });
    fx.confetti.instanceMatrix.needsUpdate = true;
    if (fx.confetti.instanceColor) fx.confetti.instanceColor.needsUpdate = true;

    fx.puffs.count = 0;
    particles.puffs = particles.puffs.filter((p) => {
      p.age += dt;
      if (p.age >= p.life) return false;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      const s = p.size * (t < 0.2 ? ease(t / 0.2) * 0.8 : 0.8 + t * 0.6) * (1 - Art.easeIn(Math.max(0, (t - 0.6) / 0.4)));
      tmp.q.identity();
      fx.puffs.setMatrixAt(fx.puffs.count++, tmp.m.compose(tmp.p.set(p.x, p.y, p.z), tmp.q, tmp.s.setScalar(Math.max(0.001, s))));
      return true;
    });
    fx.puffs.instanceMatrix.needsUpdate = true;

    rings = rings.filter((r) => {
      r.t += dt / 0.6;
      if (r.t >= 1) {
        world.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        return false;
      }
      r.mesh.scale.setScalar(0.5 + Art.easeInOut(r.t) * r.max);
      r.mesh.material.opacity = 1 - r.t;
      return true;
    });
  }

  function toScreen(pos, lift = 2.2) {
    tmp.p.set(pos.x, FLOOR_TOP + lift, pos.z).project(camera);
    return { x: (tmp.p.x + 1) / 2 * window.innerWidth, y: (1 - tmp.p.y) / 2 * window.innerHeight };
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
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt / 1.15;
      if (f.t >= 1) {
        f.el.remove();
        floaters.splice(i, 1);
        continue;
      }
      const s = toScreen(f.pos, 0);
      const y = s.y - Art.easeInOut(Math.min(1, f.t * 1.4)) * 70;
      const scale = f.t < 0.25 ? ease(f.t / 0.25) : 1 - Math.max(0, f.t - 0.75) * 1.2;
      f.el.style.transform = `translate(-50%, -50%) translate(${s.x}px, ${y}px) scale(${Math.max(0.01, scale)})`;
      f.el.style.opacity = f.t > 0.75 ? (1 - f.t) / 0.25 : 1;
    }
  }

  // On a sale, coins fly from the van to the cash counter on a curve. Each
  // one that lands bumps the counter.
  function cashToCounter(pos) {
    const layer = document.getElementById("fx-layer");
    const target = document.getElementById("cash");
    if (!layer || !target) return;
    const start = toScreen(pos, 1.5);
    for (let i = 0; i < A.cashCoins; i++) {
      const el = document.createElement("div");
      el.className = "cash-coin";
      layer.appendChild(el);
      const spread = (i - (A.cashCoins - 1) / 2) * 16;
      flyingCash.push({ el, start: { x: start.x + spread, y: start.y + Math.random() * 20 }, t: -i * 0.05, bend: (Math.random() - 0.5) * 160 });
    }
  }

  function updateCashFlights(dt) {
    if (!flyingCash.length) return;
    const r = document.getElementById("cash").getBoundingClientRect();
    const end = { x: r.left + 18, y: r.top + r.height / 2 };
    for (let i = flyingCash.length - 1; i >= 0; i--) {
      const f = flyingCash[i];
      f.t += dt / 0.75;
      if (f.t < 0) { f.el.style.opacity = 0; continue; }
      if (f.t >= 1) {
        f.el.remove();
        flyingCash.splice(i, 1);
        bump(document.getElementById("cash").closest(".panel"));
        continue;
      }
      const t = Art.easeInOut(f.t);
      const cx = (f.start.x + end.x) / 2 + f.bend;
      const cy = Math.min(f.start.y, end.y) - 120;
      const x = (1 - t) * (1 - t) * f.start.x + 2 * (1 - t) * t * cx + t * t * end.x;
      const y = (1 - t) * (1 - t) * f.start.y + 2 * (1 - t) * t * cy + t * t * end.y;
      const s = f.t < 0.15 ? ease(f.t / 0.15) : 1 - t * 0.35;
      f.el.style.opacity = 1;
      f.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s})`;
    }
  }

  function bump(el) {
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  // An unlock: a burst, a short slow motion and a camera punch.
  function celebrate() {
    view.slow = A.slowMoSeconds;
    view.punch = 1;
    view.shake = C.shakeSeconds;
  }

  function handleEvents() {
    for (const e of Carry.takeEvents()) {
      if (e.type === "float") floatText(e.pos, e.text, e.kind);
      else if (e.type === "coins") { coinBurst(e.pos, e.count); cashToCounter(e.pos); }
      else if (e.type === "drainCoin") drainCoin(e.from, e.to);
      else if (e.type === "burst") burst(e.pos, e.big, e.small);
      else if (e.type === "poof") poof(e.pos);
      else if (e.type === "shake") view.shake = C.shakeSeconds;
      else if (e.type === "unlocked") celebrate();
      else if (e.type === "vanTrip") vanTrip.queue += 1;
    }
  }

  // The cash counter also bumps when money comes in another way (offline, missions).
  function bumpCash() {
    if (lastCash !== null && state.cash > lastCash + 0.5 && !flyingCash.length) bump(document.getElementById("cash").closest(".panel"));
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
        zv.uniforms.uGrey.value = 1;
        zv.lock.visible = true;
        zv.anim = 0;   // play the unlock animation
        celebrate();
      }
      zv.open = open;
      if (zv.anim !== null) {
        zv.anim = Math.min(1, zv.anim + dt / V.unlockSeconds);
        const t = zv.anim;
        zv.lock.position.y = 2.6 + Art.easeIn(t) * 3;
        zv.lock.scale.setScalar(Math.max(0.001, zv.lock.userData.scale * (t < 0.2 ? 1 + t : 1.2 * (1 - (t - 0.2) / 0.8))));
        zv.lock.rotation.y = Math.PI / 4 + Art.easeIn(t) * Math.PI * 3;
        zv.uniforms.uGrey.value = 1 - Art.easeInOut(t);
        zv.contents.scale.set(1, Math.max(0.001, t < 0.5 ? 1 - 0.15 * Math.sin(t * 2 * Math.PI) : ease((t - 0.5) * 2) * 0.15 + 0.85 + 0.0), 1);
        if (t >= 1) {
          zv.anim = null;
          zv.lock.visible = false;
          zv.lock.position.y = 2.6;
          zv.contents.scale.set(1, 1, 1);
        }
      } else if (!open) {
        zv.lock.position.y = 2.6 + Math.sin(clock * 2) * 0.14;   // gentle bob
        zv.lock.rotation.y = Math.PI / 4 + Math.sin(clock * 1.3) * 0.15;
      }
    }
  }

  function updateIntro(dt) {
    if (intro >= 1) return;
    intro = Math.min(1, intro + dt / 1.1);
    Object.values(zoneViews).forEach((zv, i) => {
      if (zv.anim !== null) return;
      const t = Math.max(0, Math.min(1, (intro * 1.1 - i * 0.08) / 0.6));
      zv.contents.scale.set(1, Math.max(0.001, ease(t)), 1);
    });
  }

  function updateMachines(dt) {
    const st = Carry.stations();
    const printing = Carry.isBusy(st.press);
    const stitching = Carry.isBusy(st.embroidery);
    const packing = Carry.isBusy(st.pack);
    // Press: index the carousel a quarter turn, lower the screen, sweep, lift.
    const pr = machines.press;
    if (pr) {
      if (printing || pr.phase > 0) {
        pr.phase += dt / 1.2;
        if (pr.phase >= 1) {
          pr.phase = printing ? pr.phase - 1 : 0;
          pr.index += 1;
        }
      }
      const ph = pr.phase;
      const turn = Art.easeInOut(Math.min(1, ph / 0.3));
      pr.carousel.rotation.y = (pr.index + turn) * (Math.PI / 2);
      const down = ph < 0.3 ? 0 : ph < 0.45 ? (ph - 0.3) / 0.15 : ph < 0.85 ? 1 : 1 - (ph - 0.85) / 0.15;
      pr.headPivot.rotation.z = -0.35 * (1 - Art.easeInOut(Math.max(0, Math.min(1, down))));
      pr.squeegee.position.x = ph > 0.45 && ph < 0.85 ? -0.25 + ((ph - 0.45) / 0.4) * 0.5 : -0.25;
    }
    if (machines.flash) {
      const glow = printing ? 0.5 + Math.abs(Math.sin(clock * 6)) * 0.5 : 0;
      machines.flash.glow.material.color.set(Art.mix(Art.shade(P.tangerine, 0.5), P.sun, glow));
    }
    const dr = machines.dryer;
    if (dr) {
      if (printing) dr.beltTex.offset.x -= dt * 0.6;
      dr.mouth.material.color.set(printing ? Art.mix(P.tangerine, P.sun, Math.abs(Math.sin(clock * 3)) * 0.6) : Art.shade(P.tangerine, 0.5));
      dr.tees.forEach((tee, i) => {
        const u = ((clock * 0.35 + i / 3) % 1);
        tee.position.x = 1.4 - u * 2.8;
        tee.position.y = FLOOR_TOP + 0.81;
        const want = printing ? Math.min(1, (tee.userData.k || 0) + dt / A.popSeconds) : Math.max(0, (tee.userData.k || 0) - dt / A.shrinkSeconds);
        tee.userData.k = want;
        const edge = Math.min(1, u * 8, (1 - u) * 8);
        tee.scale.setScalar(Math.max(0.001, 0.8 * (printing ? ease(want) : want) * edge));
      });
      dr.steamT = (dr.steamT || 0) + dt;
      if (printing && dr.steamT > 0.18) {
        dr.steamT = 0;
        steam(dr.vent.clone().add(dr.group.parent.parent.position), 1);
      }
    }
    if (pr && printing && Math.random() < dt * 3) {
      const at = worldOf("printFloor", S.press.model);
      steam({ x: at.x + 1.3, y: FLOOR_TOP + 1.5, z: at.z }, 0.6);
    }
    if (machines.embroideryHeads) {
      machines.embroideryHeads.forEach((h, i) => {
        h.head.position.y = h.baseY + (stitching ? Math.abs(Math.sin(clock * 9 + i)) * 0.08 : 0);
        h.needle.position.y = stitching ? -0.05 + Math.sin(clock * 40 + i) * 0.05 : 0;
      });
    }
    if (machines.tape) {
      machines.tape.position.z = S.pack.model[1] + 0.2 + (packing ? Math.sin(clock * 6) * 0.35 : 0);
    }
    if (fx.bulbs) {
      const n = machines.signBulbs.length;
      for (let i = 0; i < n; i++) {
        const on = Math.sin(clock * 4 - i * 0.9) > -0.2;
        fx.bulbs.setColorAt(i, tmp.c.set(on ? P.sun : Art.shade(P.sun, 0.5)));
      }
      fx.bulbs.instanceColor.needsUpdate = true;
      fx.bulbs.visible = isZoneOpen("bulkDesk");
    }
  }

  function updateVan(dt) {
    if (vanTrip.phase === "parked" && vanTrip.queue > 0) {
      vanTrip.queue -= 1;
      vanTrip.phase = "out";
      vanTrip.t = 0;
    }
    if (vanTrip.phase === "parked") {
      van.position.y = FLOOR_TOP + Math.abs(Math.sin(clock * 1.5)) * 0.015;
      return;
    }
    vanTrip.t = Math.min(1, vanTrip.t + dt / V.vanDriveSeconds);
    const away = vanTrip.phase === "out" ? Art.easeIn(vanTrip.t) : 1 - (1 - Math.pow(1 - vanTrip.t, 3));
    van.position.z = van.userData.home + away * 18;
    van.scale.setScalar(Math.max(0.001, 1 - Math.max(0, away - 0.75) * 4));
    van.userData.wheels.forEach((w) => { w.rotation.x += dt * 14; });
    if (vanTrip.t >= 1) {
      vanTrip.phase = vanTrip.phase === "out" ? "back" : "parked";
      vanTrip.t = 0;
    }
  }

  // ---------- Camera: fixed isometric angle that follows you ----------

  const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
  const SCREEN_UP = new THREE.Vector3(-1, 2, -1).normalize();
  const SUN_OFFSET = new THREE.Vector3(-9, 16, -4);

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
    // Camera punch: a quick zoom in that springs back.
    view.punch = Math.max(0, view.punch - dt / 0.45);
    const punch = view.punch > 0 ? Math.sin((1 - view.punch) * Math.PI) * A.punchZoom : 0;
    camera.zoom = view.zoom * (1 + punch);
    camera.updateProjectionMatrix();
    const player = Carry.player();
    const goal = player ? new THREE.Vector3(player.pos.x, 0, player.pos.z) : cellCentre([0, 0]);
    if (!view.target) view.target = goal.clone();
    view.target.lerp(goal, dt ? 1 - Math.exp(-dt * 7) : 1);
    // Keep you in the middle of the part of the screen the overlay leaves free.
    const k = (camera.top - camera.bottom) / camera.zoom / h;
    const target = view.target.clone()
      .add(SCREEN_RIGHT.clone().multiplyScalar(-freeArea.dx * k))
      .add(SCREEN_UP.clone().multiplyScalar(freeArea.dy * k));
    if (view.shake > 0) {
      const s = C.shakeStrength * (view.shake / C.shakeSeconds);
      target.add(new THREE.Vector3((Math.random() - 0.5) * s, 0, (Math.random() - 0.5) * s));
      view.shake = Math.max(0, view.shake - dt);
    }
    camera.position.copy(target).add(new THREE.Vector3(30, 30, 30));
    camera.lookAt(target);
    // The sun follows the view so its shadow map covers what you see.
    if (sun) {
      const snap = 0.25;
      const sx = Math.round(view.target.x / snap) * snap;
      const sz = Math.round(view.target.z / snap) * snap;
      sun.target.position.set(sx, 0, sz);
      sun.position.set(sx, 0, sz).add(SUN_OFFSET);
      sun.target.updateMatrixWorld();
    }
  }

  // The middle of the screen area not covered by the HUD and any open
  // sheet, as an offset in pixels from the screen centre. Measured a few
  // times a second, not every frame, because measuring forces a layout.
  const freeArea = { dx: 0, dy: 0, measuredAt: 0 };

  function measureFreeArea(now) {
    if (now - freeArea.measuredAt < 400) return;
    freeArea.measuredAt = now;
    const hud = document.getElementById("hud").getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    let left = 0, right = w, top = 0, bottom = h;
    const sheet = document.getElementById("sheet");
    const sheetOpen = document.body.classList.contains("menu-open");
    const sr = sheet.getBoundingClientRect();
    if (w >= 900) {
      left = Math.min(hud.right, w * 0.35);
      if (sheetOpen) right = sr.left;
    } else {
      top = Math.min(hud.bottom, h * 0.5);
      if (sheetOpen) bottom = Math.max(sr.top, top + 1);
      const lesson = document.getElementById("lesson-card");
      if (!lesson.hidden && lesson.classList.contains("up")) bottom = Math.max(Math.min(bottom, lesson.getBoundingClientRect().top), top + 1);
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
    if (!active || !renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (camera) updateCamera();
  }

  // ---------- Start, stop, frame loop ----------

  function buildScene() {
    zoneViews = {};
    machines = {};
    characters = [];
    itemMeshes = {};
    shown.clear();
    ghosts = [];
    tileViews = new Map();
    stationLabels = {};
    pileSpots = {};
    fx = {};
    particles.coins = [];
    particles.confetti = [];
    particles.puffs = [];
    rings = [];
    posterCount = 0;
    floaters.splice(0).forEach((f) => f.el.remove());
    flyingCash.splice(0).forEach((f) => f.el.remove());
    scene = new THREE.Scene();
    scene.background = new THREE.Color(V.colors.background);
    scene.add(new THREE.HemisphereLight(P.cream, Art.mix(P.ink, P.lilac, 0.35), 1.25));
    sun = new THREE.DirectionalLight("#ffe4bf", 2.4);
    sun.castShadow = true;
    const size = isPhone() ? A.shadowMapPhone : A.shadowMapDesktop;
    sun.shadow.mapSize.set(size, size);
    const r = A.shadowRadius;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 50 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    scene.add(sun);
    scene.add(sun.target);
    world = new THREE.Group();
    scene.add(world);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), Art.toon(V.colors.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    world.add(ground);
    CONFIG.zones.forEach(buildZone);
    buildDock();
    charBlobs = Art.blobs(16, 0.38);
    world.add(charBlobs);
    buildItems();
    buildStationLabels();
    buildGuide();
    buildEffects();
    vanTrip.phase = "parked";
    vanTrip.queue = 0;
    view.target = null;
    view.zoom = isPhone() ? A.phoneZoom : C.cameraZoom;
    view.slow = 0;
    view.punch = 0;
    lastCash = null;
    intro = 0;
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    updateCamera();
  }

  // Models load over the network; wait for them (and the font, which the
  // labels and posters are painted in) for a few seconds at most.
  function whenReady() {
    const fonts = document.fonts ? document.fonts.load(`600 40px Fredoka`).catch(() => null) : Promise.resolve();
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const modelsLoaded = location.protocol === "file:"
      ? Promise.resolve()
      : new Promise((resolve) => {
        if ("LoadedModels" in window) resolve();
        else window.addEventListener("models-ready", resolve, { once: true });
      });
    return Promise.race([Promise.all([fonts, modelsLoaded]), wait(A.assetWaitSeconds * 1000)])
      .then(() => { models = window.LoadedModels || null; });
  }

  function start() {
    if (active) return true;
    if (!webglAvailable()) {
      noWebgl = true;
      return false;
    }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !isPhone(), powerPreference: "high-performance" });
    } catch (e) {
      noWebgl = true;
      renderer = null;
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, V.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const root = document.getElementById("scene-root");
    root.appendChild(renderer.domElement);
    root.hidden = false;
    root.classList.add("loading");
    document.body.classList.add("view-3d");
    Carry.enable();
    active = true;
    const canvas = renderer.domElement;
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const token = ++building;
    whenReady().then(() => {
      if (!active || token !== building) return;
      buildScene();
      root.classList.remove("loading");
      speedCheck.startedAt = performance.now();
      speedCheck.frames = 0;
      speedCheck.time = 0;
      speedCheck.done = false;
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    });
    return true;
  }

  function stop() {
    if (!active) return;
    active = false;
    building += 1;
    cancelAnimationFrame(rafId);
    Input.stickEnd(null);
    Carry.disable();
    floaters.splice(0).forEach((f) => f.el.remove());
    flyingCash.splice(0).forEach((f) => f.el.remove());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    renderer = null;
    scene = null;
    camera = null;
    const root = document.getElementById("scene-root");
    root.hidden = true;
    root.classList.remove("loading");
    document.body.classList.remove("view-3d", "menu-open");
  }

  function frame(now) {
    if (!active || !scene) return;
    rafId = requestAnimationFrame(frame);
    const realDt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const workStart = performance.now();
    // Slow motion after an unlock eases back to normal speed.
    let timeScale = 1;
    if (view.slow > 0) {
      view.slow = Math.max(0, view.slow - realDt);
      const t = 1 - view.slow / A.slowMoSeconds;
      timeScale = A.slowMoScale + (1 - A.slowMoScale) * Art.easeIn(t);
    }
    const dt = realDt * timeScale;
    clock += dt;
    Carry.update(dt);
    measureFreeArea(now);
    handleEvents();
    updateIntro(realDt);
    updateZones(dt);
    updateCharacters(dt);
    updateItems(dt);
    updateStationLabels(dt);
    updateTiles(dt);
    updateMachines(dt);
    updateVan(dt);
    updateParticles(dt);
    updateCamera(realDt);
    updateGuide(dt);
    updateFloaters(realDt);
    updateCashFlights(realDt);
    bumpCash();
    renderer.render(scene, camera);
    frameWorkMs = frameWorkMs * 0.95 + (performance.now() - workStart) * 0.05;
    if (!loadReported) reportLoad("3d");
    checkSpeed(now, realDt);
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

  // ---------- Settings dialog and the menu sheet ----------

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

  function openSettings() {
    renderSettings();
    document.getElementById("settings-overlay").hidden = false;
  }

  function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    freeArea.measuredAt = 0;
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
    // In 3D the round button opens the menu sheet; on the 2D page it opens Settings.
    document.getElementById("settings-open").addEventListener("click", () => {
      if (active) setMenu(!document.body.classList.contains("menu-open"));
      else openSettings();
    });
    document.getElementById("menu-settings").addEventListener("click", openSettings);
    document.getElementById("menu-close").addEventListener("click", () => setMenu(false));
    document.getElementById("settings-close").addEventListener("click", () => { overlay.hidden = true; });
    document.getElementById("settings-3d").addEventListener("click", () => choose("3d"));
    document.getElementById("settings-2d").addEventListener("click", () => choose("2d"));
    document.getElementById("settings-sound-on").addEventListener("click", () => { Sound.setOn(true); renderSettings(); });
    document.getElementById("settings-sound-off").addEventListener("click", () => { Sound.setOn(false); renderSettings(); });

    const sheet = document.getElementById("sheet");
    document.getElementById("sheet-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (!tab) return;
      sheet.dataset.tab = tab.dataset.tab;
      sheet.classList.remove("collapsed");
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
    start, stop, choose, setMenu,
    isActive: () => active,
    isReady: () => Boolean(active && scene),
    fps: () => speedCheck.fps,
    drawCalls: () => (renderer ? renderer.info.render.calls : 0),
    triangles: () => (renderer ? renderer.info.render.triangles : 0),
    frameMs: () => frameWorkMs,
    hasModels: () => Boolean(models && Object.keys(models.kaykit || {}).length),
    view,
  };
})();
