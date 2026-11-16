# Credits

Every licence of any code or asset used in this project is recorded here
before it is added.

## Code

All code in this repository was written for this project, except:

- **three.js r159** (`vendor/three.min.js`), the 3D library behind the
  isometric view. Licence: **MIT** (allows commercial use; the copyright and
  licence notice must be kept, so the full text is in
  `vendor/three.LICENSE.txt`). Copyright 2010-2023 three.js authors.
  Source: the official npm package `three@0.159.0`
  (https://registry.npmjs.org/three/-/three-0.159.0.tgz), checked against the
  registry's SHA-512 before use. The file is unmodified. Added 2026-11-16.
  r159 is used because it is the last release with a classic (non-module)
  build, which still works when `index.html` is opened straight from disk.

## Art, models, fonts and sound

- **3D models:** every model (zone floors, press, dryer, flash cure, tables,
  sewing machines, embroidery machine, shelves, boxes of tees, workers, the
  delivery van, padlocks and the Kpda Karkhana sign) is built from simple
  shapes in code in `scene3d.js`. No model files are used.
- **Kenney** (https://kenney.nl) was checked first, on 2026-11-16. Its asset
  packs are released under Creative Commons CC0 (public domain), which allows
  commercial use with no attribution required. They were not used for now:
  loading model files needs three.js's GLTF loader, which for this version
  only exists as an ES module, and browsers block loading model files when
  the game is opened from disk. If Kenney models are added later, record
  each pack here with its licence before adding it.
- **Fonts:** the visitor's system fonts. **Images and audio:** none.

## Text

All lesson text is original.

## Optional third-party service

- **GoatCounter** (https://www.goatcounter.com): an optional, cookie-free
  analytics service. It is switched off by default and only loads if a site
  code is set in `config.js` (`tracking.goatcounterCode`). The hosted service
  is free for reasonable public use (terms checked 2026-11-04). Its `count.js`
  script is loaded from `gc.zgo.at` only when enabled.
