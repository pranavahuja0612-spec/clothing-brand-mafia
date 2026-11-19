// Loads the 3D models (Week 6): the KayKit props (CC0) and, if present, the
// owner's tee models in assets/tees/. It is an ES module because the glTF
// loader from three.js only ships as one; it uses the page's three.js
// through three-shim.js. When it is done it fires a "models-ready" event on
// window with the result, which scene3d.js waits for. Opened from disk
// (file://) browsers block these files, so the game uses shapes built in code.

import { GLTFLoader } from "./vendor/three-addons/loaders/GLTFLoader.js";

const M = CONFIG.view3d.models;
const loader = new GLTFLoader();

// Keep only what the merged meshes need: position, normal, uv, baked into the
// model's own space.
function partsOf(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  let texture = null;
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(node.matrixWorld);
    parts.push(g);
    if (!texture && node.material && node.material.map) texture = node.material.map;
  });
  return { parts, texture };
}

async function loadPack(pack, names) {
  const out = {};
  await Promise.all(names.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`assets/kaykit/${pack}/${name}.gltf`);
      const { parts, texture } = partsOf(gltf.scene);
      out[name] = { parts };
      if (texture && !out.texture) out.texture = texture;
    } catch (e) {
      console.warn("Model not loaded:", pack, name);
    }
  }));
  return out;
}

// The owner's tee: laid flat (thinnest side up), centred and scaled to the
// size of a folded tee in the game, merged into one geometry.
async function loadTee() {
  for (const url of M.teeModels) {
    try {
      const gltf = await loader.loadAsync(url);
      const { parts } = partsOf(gltf.scene);
      if (!parts.length) continue;
      const merged = mergeGeometries(parts);
      merged.computeBoundingBox();
      const size = merged.boundingBox.getSize(new THREE.Vector3());
      if (size.y > size.z && size.y > size.x * 0.4) merged.rotateX(-Math.PI / 2);   // a standing tee lies down
      merged.computeBoundingBox();
      const box = merged.boundingBox;
      const centre = box.getCenter(new THREE.Vector3());
      merged.translate(-centre.x, -box.min.y, -centre.z);
      const s = box.getSize(new THREE.Vector3());
      merged.scale(0.74 / Math.max(s.x, 0.001), 0.13 / Math.max(s.y, 0.001), 0.62 / Math.max(s.z, 0.001));
      merged.deleteAttribute("uv");
      merged.computeVertexNormals();
      return merged;
    } catch (e) {
      // Not there (yet): the game uses its own tee shape.
    }
  }
  return null;
}

function mergeGeometries(list) {
  const total = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let at = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, at * 3);
    nor.set(g.attributes.normal.array, at * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, at * 2);
    at += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}

async function loadAll() {
  const kaykit = {};
  const packs = Object.entries(M.kaykit);
  const results = await Promise.all(packs.map(([pack, names]) => loadPack(pack, names)));
  packs.forEach(([pack], i) => {
    const r = results[i];
    if (r.texture) {
      r.texture.colorSpace = THREE.SRGBColorSpace;
      kaykit[pack] = r;
    }
  });
  const tee = await loadTee();
  return { kaykit, tee };
}

loadAll()
  .then((models) => { window.LoadedModels = models; })
  .catch(() => { window.LoadedModels = null; })
  .finally(() => window.dispatchEvent(new Event("models-ready")));
