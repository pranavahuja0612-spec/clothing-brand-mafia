// Art helpers for the 3D view (Week 6): toon materials, outlines, contact
// shadows, painted textures (floors, posters, the signboard), a builder that
// merges a zone's static props into a few meshes, and the rigged character
// with idle, run and carry animations. The style rules are in STYLE.md; the
// colours and numbers are in CONFIG.view3d (palette, art).
// Nothing here touches the game state.

const Art = (() => {
  const V = CONFIG.view3d;
  const P = V.palette;
  const A = V.art;
  const FONT = "Fredoka, system-ui, sans-serif";

  let gradientMap = null;
  const materialCache = new Map();

  // ---------- Colour helpers ----------

  // Mix two hex colours: t=0 gives a, t=1 gives b.
  function mix(a, b, t) {
    return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
  }
  const tint = (c, t) => mix(c, P.cream, t);    // lighter, toward cream
  const shade = (c, t) => mix(c, P.ink, t);     // darker, toward plum

  // ---------- Materials ----------

  function toonGradient() {
    if (gradientMap) return gradientMap;
    const steps = A.toonSteps.map((v) => Math.round(v * 255));
    gradientMap = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
    return gradientMap;
  }

  // A toon material. Plain colours are shared (do not change them);
  // anything with options, or from fresh(), is a new material of its own.
  function toon(color = "#ffffff", options) {
    if (options) return fresh(color, options);
    if (materialCache.has(color)) return materialCache.get(color);
    const material = fresh(color);
    materialCache.set(color, material);
    return material;
  }

  function fresh(color = "#ffffff", options = {}) {
    return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...options });
  }

  // Locked zones are desaturated toward plum. `uniforms.uGrey` (0..1) is
  // shared by all of a zone's materials, so one number greys the whole zone.
  function zoneUniforms() {
    return { uGrey: { value: 0 }, uPlum: { value: new THREE.Color(P.ink) } };
  }

  function addGrey(material, uniforms) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGrey = uniforms.uGrey;
      shader.uniforms.uPlum = uniforms.uPlum;
      shader.fragmentShader = "uniform float uGrey;\nuniform vec3 uPlum;\n" + shader.fragmentShader.replace(
        "#include <tonemapping_fragment>",
        `float greyLevel = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(vec3(greyLevel), uPlum, 0.3) * 0.85, uGrey);
        #include <tonemapping_fragment>`);
    };
    return material;
  }

  // ---------- Outlines: an inverted shell pushed out along smooth normals ----------

  // Box corners have split normals, which would tear the shell open, so the
  // shell uses normals averaged over every vertex at the same spot.
  function addOutlineNormals(geometry) {
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const sums = new Map();
    const keys = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const key = `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
      keys[i] = key;
      const s = sums.get(key) || [0, 0, 0];
      s[0] += nor.getX(i); s[1] += nor.getY(i); s[2] += nor.getZ(i);
      sums.set(key, s);
    }
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const s = sums.get(keys[i]);
      const len = Math.hypot(s[0], s[1], s[2]) || 1;
      out[i * 3] = s[0] / len; out[i * 3 + 1] = s[1] / len; out[i * 3 + 2] = s[2] / len;
    }
    geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(out, 3));
  }

  let outlineMaterial = null;
  function outlineMat() {
    if (outlineMaterial) return outlineMaterial;
    outlineMaterial = new THREE.MeshBasicMaterial({ color: P.ink, side: THREE.BackSide });
    outlineMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uOutline = { value: A.outline };
      shader.vertexShader = "attribute vec3 outlineNormal;\nuniform float uOutline;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "vec3 transformed = vec3(position) + outlineNormal * uOutline;");
    };
    return outlineMaterial;
  }

  // Give a mesh (plain or skinned) a plum outline that moves with it.
  function outline(mesh) {
    if (!mesh.geometry.attributes.outlineNormal) addOutlineNormals(mesh.geometry);
    let shell;
    if (mesh.isSkinnedMesh) {
      shell = new THREE.SkinnedMesh(mesh.geometry, outlineMat());
      shell.bind(mesh.skeleton, mesh.bindMatrix);
    } else {
      shell = new THREE.Mesh(mesh.geometry, outlineMat());
    }
    // A child of the mesh, so it follows every move and scale.
    shell.frustumCulled = mesh.frustumCulled;
    shell.userData.isOutline = true;
    mesh.add(shell);
    mesh.userData.outline = shell;
    return shell;
  }

  // ---------- Contact shadows: soft dark blobs under things ----------

  let blobTexture = null;
  function blobTex() {
    if (blobTexture) return blobTexture;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.55, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    blobTexture = new THREE.CanvasTexture(c);
    return blobTexture;
  }

  // An InstancedMesh of flat blobs; `place(i, x, y, z, sx, sz)` positions one.
  function blobs(max, opacity = 0.32) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: blobTex(), color: P.ink, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.InstancedMesh(geo, material, max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }

  // ---------- Painted textures ----------

  function canvasTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
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

  // Dashed hazard tape (sunflower and plum) around a rectangle.
  function tapeRect(ctx, x, y, w, h, scale) {
    ctx.save();
    ctx.lineWidth = 9 * scale;
    ctx.strokeStyle = P.sun;
    ctx.setLineDash([22 * scale, 14 * scale]);
    roundRect(ctx, x, y, w, h, 10 * scale);
    ctx.stroke();
    ctx.restore();
  }

  function arrow(ctx, x, y, angle, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.4, -size * 0.75);
    ctx.lineTo(-size * 0.1, 0);
    ctx.lineTo(-size * 0.4, size * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // A zone's floor: tiles in its colour, with tape boxes around the work
  // spots and painted arrows along the walkway. `marks` is in zone-local
  // units (the zone spans -size/2 .. size/2).
  function floorTexture(color, size, marks = {}) {
    const px = 512;
    const k = px / size;
    const toPx = (v) => (v + size / 2) * k;
    return canvasTexture(px, px, (ctx) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, px, px);
      // Tiles: every other one a touch lighter, with thin grout lines.
      const tile = px / 8;
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          if ((i + j) % 2) {
            ctx.fillStyle = "rgba(255,244,226,0.10)";
            ctx.fillRect(i * tile, j * tile, tile, tile);
          }
        }
      }
      ctx.strokeStyle = "rgba(59,42,74,0.10)";
      ctx.lineWidth = 2;
      for (let i = 1; i < 8; i++) {
        ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, px); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(px, i * tile); ctx.stroke();
      }
      // A darker band at the edge reads as dirt and wear near the walls.
      const edge = ctx.createLinearGradient(0, 0, 0, 40);
      edge.addColorStop(0, "rgba(59,42,74,0.22)");
      edge.addColorStop(1, "rgba(59,42,74,0)");
      if (marks.wallBack) { ctx.fillStyle = edge; ctx.fillRect(0, 0, px, 40); }
      if (marks.wallLeft) {
        const side = ctx.createLinearGradient(0, 0, 40, 0);
        side.addColorStop(0, "rgba(59,42,74,0.22)");
        side.addColorStop(1, "rgba(59,42,74,0)");
        ctx.fillStyle = side;
        ctx.fillRect(0, 0, 40, px);
      }
      for (const [x, z, w, d] of marks.tape || []) {
        tapeRect(ctx, toPx(x - w / 2), toPx(z - d / 2), w * k, d * k, k / 51);
      }
      for (const [x, z, angle] of marks.arrows || []) {
        arrow(ctx, toPx(x), toPx(z), angle, 0.35 * k, "rgba(255,244,226,0.55)");
      }
      for (const [x, z, text, angle] of marks.words || []) {
        ctx.save();
        ctx.translate(toPx(x), toPx(z));
        ctx.rotate(angle || 0);
        ctx.fillStyle = "rgba(255,244,226,0.6)";
        ctx.font = `700 ${0.55 * k}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
      for (const [x, z, w, d] of marks.stripes || []) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(toPx(x - w / 2), toPx(z - d / 2), w * k, d * k);
        ctx.clip();
        ctx.fillStyle = P.ink;
        ctx.fillRect(toPx(x - w / 2), toPx(z - d / 2), w * k, d * k);
        ctx.strokeStyle = P.sun;
        ctx.lineWidth = 0.16 * k;
        for (let s = -px; s < px * 2; s += 0.42 * k) {
          ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(s + px, px); ctx.stroke();
        }
        ctx.restore();
      }
    });
  }

  // Original wall posters. Each is a simple graphic with a short line.
  const POSTERS = [
    { bg: P.tomato, fg: P.cream, line1: "PRINT", line2: "LOUD", icon: "tee" },
    { bg: P.sky, fg: P.cream, line1: "INK", line2: "IT", icon: "drop" },
    { bg: P.sun, fg: P.ink, line1: "FOLD", line2: "PACK SHIP", icon: "box" },
    { bg: P.lilac, fg: P.cream, line1: "CUT", line2: "TWICE", icon: "scissors" },
    { bg: P.mint, fg: P.ink, line1: "STITCH", line2: "SQUAD", icon: "star" },
    { bg: P.tangerine, fg: P.cream, line1: "SAMPLE", line2: "FIRST", icon: "tee" },
  ];

  function posterTexture(i) {
    const p = POSTERS[i % POSTERS.length];
    return canvasTexture(256, 340, (ctx, w, h) => {
      ctx.fillStyle = P.cream;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = p.bg;
      ctx.fillRect(12, 12, w - 24, h - 24);
      ctx.fillStyle = p.fg;
      ctx.strokeStyle = p.fg;
      const cx = w / 2;
      if (p.icon === "tee") {
        ctx.beginPath();
        ctx.moveTo(cx - 40, 60); ctx.lineTo(cx - 80, 85); ctx.lineTo(cx - 64, 115); ctx.lineTo(cx - 44, 105);
        ctx.lineTo(cx - 44, 175); ctx.lineTo(cx + 44, 175); ctx.lineTo(cx + 44, 105); ctx.lineTo(cx + 64, 115);
        ctx.lineTo(cx + 80, 85); ctx.lineTo(cx + 40, 60); ctx.quadraticCurveTo(cx, 82, cx - 40, 60);
        ctx.fill();
      } else if (p.icon === "drop") {
        ctx.beginPath();
        ctx.moveTo(cx, 50); ctx.quadraticCurveTo(cx + 55, 125, cx + 40, 150);
        ctx.arc(cx, 140, 42, 0.2, Math.PI - 0.2);
        ctx.quadraticCurveTo(cx - 55, 125, cx, 50);
        ctx.fill();
      } else if (p.icon === "box") {
        ctx.fillRect(cx - 55, 80, 110, 85);
        ctx.fillStyle = p.bg;
        ctx.fillRect(cx - 10, 80, 20, 85);
      } else if (p.icon === "scissors") {
        ctx.lineWidth = 12;
        ctx.beginPath(); ctx.arc(cx - 28, 150, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + 28, 150, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 18, 132); ctx.lineTo(cx + 30, 55); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + 18, 132); ctx.lineTo(cx - 30, 55); ctx.stroke();
      } else {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 26 : 62;
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          ctx.lineTo(cx + Math.cos(a) * r, 115 + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.textAlign = "center";
      ctx.font = `700 54px ${FONT}`;
      ctx.fillText(p.line1, cx, 238);
      ctx.font = `600 34px ${FONT}`;
      ctx.fillText(p.line2, cx, 284);
    });
  }

  // The Kpda Karkhana signboard face (the bulk client and partner).
  function signTexture(top, bottom) {
    return canvasTexture(512, 200, (ctx, w, h) => {
      ctx.fillStyle = P.ink;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = P.sun;
      ctx.lineWidth = 8;
      roundRect(ctx, 14, 14, w - 28, h - 28, 18);
      ctx.stroke();
      ctx.fillStyle = P.sun;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 70px ${FONT}`;
      ctx.fillText(top, w / 2, 82);
      ctx.fillStyle = P.cream;
      ctx.font = `600 40px ${FONT}`;
      ctx.fillText(bottom, w / 2, 148);
    });
  }

  // Moving stripes for the dryer belt (the texture offset scrolls).
  function beltTexture() {
    const t = canvasTexture(64, 64, (ctx) => {
      ctx.fillStyle = shade(P.ink, 0.2);
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = mix(P.ink, P.cream, 0.25);
      for (let i = 0; i < 4; i++) ctx.fillRect(i * 16, 0, 6, 64);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 1);
    return t;
  }

  // ---------- Shapes ----------

  // A tee lying flat, seen from above: a T silhouette with a soft edge.
  // `print` adds a chest print (darker patch) on top.
  function teeGeometry(print) {
    const s = new THREE.Shape();
    const w = 0.36, sl = 0.62, b = 0.33, n = 0.13;
    s.moveTo(-n, -0.3);
    s.quadraticCurveTo(0, -0.22, n, -0.3);
    s.lineTo(w, -0.26);
    s.lineTo(sl * 0.62, -0.12);
    s.lineTo(sl * 0.48, 0.02);
    s.lineTo(w * 0.72, -0.06);
    s.lineTo(w * 0.72, b);
    s.lineTo(-w * 0.72, b);
    s.lineTo(-w * 0.72, -0.06);
    s.lineTo(-sl * 0.48, 0.02);
    s.lineTo(-sl * 0.62, -0.12);
    s.lineTo(-w, -0.26);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 4 });
    geo.rotateX(Math.PI / 2);    // lie flat, chest up
    geo.translate(0, 0.095, 0.02);
    const parts = [{ geo, color: "#ffffff" }];
    if (print) {
      const patch = new THREE.BoxGeometry(0.3, 0.02, 0.22);
      patch.translate(0, 0.13, -0.02);
      parts.push({ geo: patch, color: mix("#ffffff", P.ink, 0.45) });
    }
    return mergeParts(parts);
  }

  // A cardboard box with a tape strip and a label.
  function boxGeometry() {
    const box = new THREE.BoxGeometry(0.56, 0.38, 0.56);
    box.translate(0, 0.19, 0);
    const tape = new THREE.BoxGeometry(0.14, 0.012, 0.565);
    tape.translate(0, 0.385, 0);
    const label = new THREE.BoxGeometry(0.2, 0.12, 0.012);
    label.translate(0.12, 0.2, 0.282);
    return mergeParts([
      { geo: box, color: "#ffffff" },
      { geo: tape, color: mix("#ffffff", P.ink, 0.3) },
      { geo: label, color: "#ffffff" },
    ]);
  }

  // Merge geometry parts into one non-indexed geometry with vertex colours.
  function mergeParts(parts) {
    const positions = [];
    const normals = [];
    const colors = [];
    const c = new THREE.Color();
    for (const part of parts) {
      const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
      c.set(part.color);
      positions.push(g.attributes.position.array);
      normals.push(g.attributes.normal.array);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      colors.push(col);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(concat(positions), 3));
    out.setAttribute("normal", new THREE.BufferAttribute(concat(normals), 3));
    out.setAttribute("color", new THREE.BufferAttribute(concat(colors), 3));
    return out;
  }

  function concat(arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const a of arrays) { out.set(a, at); at += a.length; }
    return out;
  }

  // ---------- Builder: merges a zone's static props into a few meshes ----------
  // Untextured parts become one vertex-coloured toon mesh (plus one outlined
  // mesh for key machines); KayKit models become one mesh per texture.

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();

  function builder(models) {
    const lists = { plain: [], outlined: [] };
    const textured = {};       // pack -> list
    const blobsAt = [];        // [x, z, sx, sz]

    function matrix(x, y, z, o = {}) {
      tmpE.set(o.rx || 0, o.ry || 0, o.rz || 0);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(o.sx || o.s || 1, o.sy || o.s || 1, o.sz || o.s || 1);
      return new THREE.Matrix4().compose(tmpV.set(x, y, z), tmpQ, tmpS);
    }

    const api = {
      // Any geometry, placed with a matrix, in one colour.
      geo(geometry, color, m, o = {}) {
        lists[o.outline ? "outlined" : "plain"].push({ geometry, color, matrix: m });
        return api;
      },
      // A box whose bottom sits at y.
      box(w, h, d, color, x, y, z, o = {}) {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(0, h / 2, 0);
        return api.geo(g, color, matrix(x, y, z, o), o);
      },
      // A cylinder (or cone) whose bottom sits at y. Lay it down with rx/rz.
      cyl(rTop, rBottom, h, color, x, y, z, o = {}) {
        const g = new THREE.CylinderGeometry(rTop, rBottom, h, o.seg || 12);
        if (!o.centred) g.translate(0, h / 2, 0);
        return api.geo(g, color, matrix(x, y, z, o), o);
      },
      sphere(r, color, x, y, z, o = {}) {
        const g = new THREE.SphereGeometry(r, o.seg || 12, Math.max(6, (o.seg || 12) - 4));
        return api.geo(g, color, matrix(x, y, z, o), o);
      },
      // A tube along points (cables on the floor).
      tube(points, r, color) {
        const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
        return api.geo(new THREE.TubeGeometry(curve, points.length * 6, r, 5), color, new THREE.Matrix4());
      },
      // A tee lying flat (decor stacks); colour tints the whole tee.
      tee(color, x, y, z, o = {}) {
        return api.geo(teeGeometry(o.print), color, matrix(x, y, z, o), o);
      },
      // A KayKit model (skipped if the models did not load).
      prop(pack, name, x, y, z, o = {}) {
        const model = models && models.kaykit && models.kaykit[pack] && models.kaykit[pack][name];
        if (!model) return false;
        const m = matrix(x, y, z, o);
        textured[pack] = textured[pack] || [];
        for (const part of model.parts) textured[pack].push({ geometry: part, matrix: m });
        if (o.blob) blobsAt.push([x, z, o.blob, o.blob]);
        return true;
      },
      blob(x, z, sx, sz = sx) {
        blobsAt.push([x, z, sx, sz]);
        return api;
      },
      // Turn the lists into meshes under `parent`. `uniforms` greys a locked zone.
      finish(parent, uniforms) {
        const made = [];
        for (const kind of ["plain", "outlined"]) {
          if (!lists[kind].length) continue;
          const geometry = mergeList(lists[kind], true, false);
          const material = toon("#ffffff", { vertexColors: true });
          const mesh = new THREE.Mesh(geometry, uniforms ? addGrey(material, uniforms) : material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
          if (kind === "outlined") outline(mesh);
          made.push(mesh);
        }
        for (const [pack, list] of Object.entries(textured)) {
          const geometry = mergeList(list, false, true);
          const material = toon("#ffffff", { map: models.kaykit[pack].texture });
          const mesh = new THREE.Mesh(geometry, uniforms ? addGrey(material, uniforms) : material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          parent.add(mesh);
          made.push(mesh);
        }
        if (blobsAt.length) {
          const b = blobs(blobsAt.length, 0.28);
          blobsAt.forEach(([x, z, sx, sz], i) => {
            b.setMatrixAt(i, tmpM.compose(tmpV.set(x, 0.006, z), tmpQ.identity(), tmpS.set(sx, 1, sz)));
          });
          b.count = blobsAt.length;
          b.instanceMatrix.needsUpdate = true;
          parent.add(b);
          made.push(b);
        }
        return made;
      },
    };
    return api;
  }

  // Bake each entry's matrix (and colour) into one big geometry.
  function mergeList(list, withColor, withUv) {
    const pos = [];
    const nor = [];
    const col = [];
    const uvs = [];
    const c = new THREE.Color();
    const normalMatrix = new THREE.Matrix3();
    for (const entry of list) {
      const g = (entry.geometry.index ? entry.geometry.toNonIndexed() : entry.geometry.clone());
      g.applyMatrix4(entry.matrix);
      normalMatrix.getNormalMatrix(entry.matrix);
      pos.push(g.attributes.position.array);
      nor.push(g.attributes.normal.array);
      const n = g.attributes.position.count;
      if (withColor) {
        c.set(entry.color);
        const own = g.attributes.color;
        const out = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          out[i * 3] = c.r * (own ? own.getX(i) : 1);
          out[i * 3 + 1] = c.g * (own ? own.getY(i) : 1);
          out[i * 3 + 2] = c.b * (own ? own.getZ(i) : 1);
        }
        col.push(out);
      }
      if (withUv) uvs.push(g.attributes.uv ? g.attributes.uv.array : new Float32Array(n * 2));
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(concat(pos), 3));
    out.setAttribute("normal", new THREE.BufferAttribute(concat(nor), 3));
    if (withColor) out.setAttribute("color", new THREE.BufferAttribute(concat(col), 3));
    if (withUv) out.setAttribute("uv", new THREE.BufferAttribute(concat(uvs), 2));
    out.computeBoundingSphere();
    return out;
  }

  // ---------- The rigged character ----------
  // Seven bones (hips, spine, head, two arms, two legs). Each body part is
  // bound to one bone, and four clips (idle, run, carry idle, carry run)
  // play together; their weights blend with speed and with whether the
  // character carries a stack.

  const BONES = ["hips", "spine", "head", "armL", "armR", "legL", "legR"];
  const SKIN = mix(P.tangerine, P.cream, 0.55);
  const DENIM = mix(P.sky, P.ink, 0.45);

  function characterGeometry(shirt, isPlayer, hair) {
    const parts = [];   // { geo, color, bone }
    const put = (geo, color, bone, x, y, z, o = {}) => {
      geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0)),
        new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1)));
      parts.push({ geo, color, bone: BONES.indexOf(bone) });
    };
    // Legs and shoes.
    for (const [side, x] of [["legL", 0.12], ["legR", -0.12]]) {
      put(new THREE.CapsuleGeometry(0.095, 0.3, 3, 8), DENIM, side, x, 0.3, 0);
      put(new THREE.BoxGeometry(0.17, 0.1, 0.26), P.cream, side, x, 0.05, 0.04);
    }
    // Hips (shorts) and torso (the tee).
    put(new THREE.CylinderGeometry(0.235, 0.21, 0.18, 12), DENIM, "hips", 0, 0.58, 0, { sz: 0.78 });
    put(new THREE.CylinderGeometry(0.255, 0.24, 0.5, 12), shirt, "spine", 0, 0.9, 0, { sz: 0.78 });
    put(new THREE.SphereGeometry(0.255, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), shirt, "spine", 0, 1.13, 0, { sy: 0.45, sz: 0.78 });
    put(new THREE.BoxGeometry(0.2, 0.16, 0.02), mix(shirt, P.cream, 0.6), "spine", 0, 0.95, 0.2);   // chest print
    // Head, face and hair or cap.
    put(new THREE.SphereGeometry(0.26, 14, 10), SKIN, "head", 0, 1.43, 0);
    put(new THREE.SphereGeometry(0.035, 6, 4), P.ink, "head", 0.09, 1.45, 0.235, { sy: 1.4 });
    put(new THREE.SphereGeometry(0.035, 6, 4), P.ink, "head", -0.09, 1.45, 0.235, { sy: 1.4 });
    put(new THREE.SphereGeometry(0.05, 6, 4), mix(P.tomato, P.cream, 0.4), "head", 0.16, 1.37, 0.2, { sz: 0.4 });
    put(new THREE.SphereGeometry(0.05, 6, 4), mix(P.tomato, P.cream, 0.4), "head", -0.16, 1.37, 0.2, { sz: 0.4 });
    if (isPlayer) {
      put(new THREE.SphereGeometry(0.272, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), P.tomato, "head", 0, 1.47, 0, { sy: 0.85 });
      put(new THREE.BoxGeometry(0.34, 0.035, 0.22), P.tomato, "head", 0, 1.49, 0.27, { rx: -0.15 });
      put(new THREE.SphereGeometry(0.04, 6, 4), P.cream, "head", 0, 1.71, 0);
    } else {
      put(new THREE.SphereGeometry(0.272, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair, "head", 0, 1.45, -0.02, { sy: 0.95, rx: -0.35 });
    }
    // Arms: sleeve, forearm, hand.
    for (const [side, x] of [["armL", 0.33], ["armR", -0.33]]) {
      put(new THREE.CapsuleGeometry(0.085, 0.1, 3, 8), shirt, side, x, 1.0, 0);
      put(new THREE.CapsuleGeometry(0.068, 0.24, 3, 8), SKIN, side, x, 0.82, 0);
      put(new THREE.SphereGeometry(0.075, 8, 6), SKIN, side, x, 0.66, 0);
    }
    // Merge into one skinned geometry: every vertex follows its part's bone.
    const merged = mergeParts(parts.map((p) => ({ geo: p.geo, color: p.color })));
    const n = merged.attributes.position.count;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    let v = 0;
    for (const p of parts) {
      const count = (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count);
      for (let i = 0; i < count; i++, v++) {
        skinIndex[v * 4] = p.bone;
        skinWeight[v * 4] = 1;
      }
    }
    merged.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    merged.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
    return merged;
  }

  // Bone rest positions (model space): hips, spine on hips, head on spine,
  // shoulders on the spine, hips joints for the legs.
  const REST = {
    hips: [0, 0.58, 0], spine: [0, 0.1, 0], head: [0, 0.48, 0],
    armL: [0.33, 0.42, 0], armR: [-0.33, 0.42, 0], legL: [0.12, -0.02, 0], legR: [-0.12, -0.02, 0],
  };
  const PARENT = { spine: "hips", head: "spine", armL: "spine", armR: "spine", legL: "hips", legR: "hips" };

  let clipCache = null;

  function q(x, y = 0, z = 0) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray();
  }

  // A clip from keyframes: { bone: [[time, rx, ry, rz], ...] } and hips heights.
  function clip(name, duration, rotations, hipsY) {
    const tracks = [];
    for (const [bone, keys] of Object.entries(rotations)) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, keys.map((k) => k[0]), keys.flatMap((k) => q(k[1], k[2], k[3]))));
    }
    tracks.push(new THREE.VectorKeyframeTrack("hips.position", hipsY.map((k) => k[0]), hipsY.flatMap((k) => [0, k[1], 0])));
    return new THREE.AnimationClip(name, duration, tracks);
  }

  function clips() {
    if (clipCache) return clipCache;
    const out = 0.12;   // arms rest a little away from the body
    const idleRot = {
      spine: [[0, 0.02, 0, 0], [1, 0.06, 0, 0], [2, 0.02, 0, 0]],
      head: [[0, 0.02, 0.05, 0], [1, -0.04, -0.03, 0.02], [2, 0.02, 0.05, 0]],
      armL: [[0, 0, 0, out], [1, 0.05, 0, out + 0.05], [2, 0, 0, out]],
      armR: [[0, 0, 0, -out], [1, 0.05, 0, -out - 0.05], [2, 0, 0, -out]],
      legL: [[0, 0, 0, 0], [2, 0, 0, 0]],
      legR: [[0, 0, 0, 0], [2, 0, 0, 0]],
    };
    const idleY = [[0, 0.58], [1, 0.565], [2, 0.58]];
    // Running: legs and arms swing in opposite pairs, the body bobs twice a cycle.
    const T = 0.56;
    const at = (f) => f * T;
    const swing = 0.85;
    const runRot = {
      spine: [[at(0), 0.2, 0.12, 0], [at(0.5), 0.2, -0.12, 0], [at(1), 0.2, 0.12, 0]],
      head: [[0, -0.12, 0, 0], [T, -0.12, 0, 0]],
      armL: [[at(0), 0.75, 0, 0.18], [at(0.5), -0.75, 0, 0.18], [at(1), 0.75, 0, 0.18]],
      armR: [[at(0), -0.75, 0, -0.18], [at(0.5), 0.75, 0, -0.18], [at(1), -0.75, 0, -0.18]],
      legL: [[at(0), -swing, 0, 0], [at(0.25), 0, 0, 0], [at(0.5), swing, 0, 0], [at(0.75), 0, 0, 0], [at(1), -swing, 0, 0]],
      legR: [[at(0), swing, 0, 0], [at(0.25), 0, 0, 0], [at(0.5), -swing, 0, 0], [at(0.75), 0, 0, 0], [at(1), swing, 0, 0]],
    };
    const runY = [[at(0), 0.56], [at(0.25), 0.64], [at(0.5), 0.56], [at(0.75), 0.64], [at(1), 0.56]];
    // Carrying: hands up behind the shoulders, holding the stack on the back,
    // and a stronger forward lean under the load.
    const hold = 2.55;
    const carryArms = (wobble) => ({
      armL: [[0, hold, 0, 0.42], [wobble, hold - 0.1, 0, 0.45], [wobble * 2, hold, 0, 0.42]],
      armR: [[0, hold, 0, -0.42], [wobble, hold - 0.1, 0, -0.45], [wobble * 2, hold, 0, -0.42]],
    });
    const carryIdleRot = {
      ...idleRot,
      spine: [[0, 0.16, 0, 0], [1, 0.2, 0, 0], [2, 0.16, 0, 0]],
      ...carryArms(1),
    };
    const carryRunRot = {
      ...runRot,
      spine: [[at(0), 0.32, 0.06, 0], [at(0.5), 0.32, -0.06, 0], [at(1), 0.32, 0.06, 0]],
      ...carryArms(T / 2),
    };
    clipCache = {
      idle: clip("idle", 2, idleRot, idleY),
      run: clip("run", T, runRot, runY),
      carryIdle: clip("carryIdle", 2, carryIdleRot, idleY),
      carryRun: clip("carryRun", T, carryRunRot, runY),
    };
    return clipCache;
  }

  // Build one character. `update(dt, speed01, carrying)` blends the clips.
  function character(shirt, isPlayer, index = 0) {
    const hairColors = [shade(P.tangerine, 0.55), P.ink, shade(P.sun, 0.35), shade(P.tomato, 0.5)];
    const geometry = characterGeometry(shirt, isPlayer, hairColors[index % hairColors.length]);
    const root = new THREE.Group();
    const material = toon("#ffffff", { vertexColors: true });
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const bones = {};
    for (const name of BONES) {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.fromArray(REST[name]);
      bones[name] = bone;
    }
    for (const [child, parent] of Object.entries(PARENT)) bones[parent].add(bones[child]);
    mesh.add(bones.hips);
    root.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
    outline(mesh).frustumCulled = false;

    const mixer = new THREE.AnimationMixer(mesh);
    const c = clips();
    const actions = {};
    for (const name of Object.keys(c)) {
      actions[name] = mixer.clipAction(c[name]);
      actions[name].play();
      actions[name].setEffectiveWeight(0);
    }
    const blend = { run: 0, carry: 0 };
    function update(dt, speed01, carrying) {
      // Ease the blend weights so changes never snap.
      blend.run += (Math.min(1, speed01 * 1.6) - blend.run) * Math.min(1, dt * 10);
      blend.carry += ((carrying ? 1 : 0) - blend.carry) * Math.min(1, dt * 8);
      const r = blend.run;
      const k = blend.carry;
      actions.idle.setEffectiveWeight((1 - r) * (1 - k));
      actions.run.setEffectiveWeight(r * (1 - k));
      actions.carryIdle.setEffectiveWeight((1 - r) * k);
      actions.carryRun.setEffectiveWeight(r * k);
      const rate = 0.75 + speed01 * 0.6;
      actions.run.timeScale = rate;
      actions.carryRun.timeScale = rate;
      mixer.update(dt);
    }
    return { root, mesh, bones, mixer, update, blend };
  }

  // ---------- Easing ----------

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const u = t - 1;
    return 1 + c3 * u * u * u + c1 * u * u;
  }
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeIn = (t) => t * t;

  return {
    P, FONT, mix, tint, shade, toon, fresh, zoneUniforms, addGrey, outline, blobs,
    floorTexture, posterTexture, signTexture, beltTexture, canvasTexture, roundRect,
    teeGeometry, boxGeometry, mergeParts, builder, character,
    easeOutBack, easeInOut, easeIn,
  };
})();
