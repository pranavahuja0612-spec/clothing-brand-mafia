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
- **three.js r159 add-ons** (`vendor/three-addons/loaders/GLTFLoader.js` and
  `vendor/three-addons/utils/BufferGeometryUtils.js`), the glTF model loader
  and a helper it imports. Same licence and copyright as three.js (**MIT**,
  notice in `vendor/three-addons/LICENSE.txt`). Source: `three@0.159.0` from
  the npm registry (jsDelivr and unpkg copies compared byte for byte). Both
  files are unmodified; `three-shim.js` (ours) hands them the page's three.js.
  Added 2026-11-19 (Week 6).

## Art, models, fonts and sound

- **KayKit by Kay Lousberg** (https://kaylousberg.com), three packs:
  *Furniture Bits 1.0*, *Restaurant Bits 1.0* and *City Builder Bits 1.0*.
  Licence: **Creative Commons CC0 1.0** (public domain; commercial use
  allowed, credit not required but given here). Source: KayKit's official
  GitHub organisation (github.com/KayKit-Game-Assets), checked 2026-11-19.
  Only the models listed in `config.js` (`view3d.models.kaykit`) are copied
  into `assets/kaykit/<pack>/`, unmodified, with each pack's `LICENSE.txt`.
  Used for furniture, plants, boxes and street props.
- **Other 3D models:** the machines (press, dryer, flash cure, embroidery
  machine, packing table, fabric rack), walls, tees, boxes, the van, padlocks,
  tiles, the Kpda Karkhana signboard and the characters (rigged, with idle,
  run and carry animations) are built in code in `art.js` and `scene3d.js`.
- **Tee models:** the owner's own models go in `assets/tees/` (see
  `view3d.models.teeModels`); until then the code-built tee is used.
- **Kenney** (https://kenney.nl, CC0) was checked first; its site does not
  allow scripted downloads, so KayKit (same licence) was used instead.
- **Posters and floor markings:** painted in code; the words and graphics are
  original.
- **Font: Fredoka** by the Fredoka Project Authors
  (`assets/fonts/Fredoka.ttf`, variable weight). Licence: **SIL Open Font
  License 1.1** (free for commercial use; the licence travels with the font,
  so it is in `assets/fonts/OFL.txt`). Source: github.com/google/fonts,
  `ofl/fredoka`, 2026-11-19. Unmodified.
- **Images:** none.
- **Sound effects:** made in the browser with the Web Audio API (`sound.js`),
  from simple tones and noise. No sound files are used.

## Text

All lesson text is original.

## Optional third-party service

- **GoatCounter** (https://www.goatcounter.com): an optional, cookie-free
  analytics service. It is switched off by default and only loads if a site
  code is set in `config.js` (`tracking.goatcounterCode`). The hosted service
  is free for reasonable public use (terms checked 2026-11-04). Its `count.js`
  script is loaded from `gc.zgo.at` only when enabled.
