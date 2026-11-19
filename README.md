# Clothing Brand Mafia

A free, browser-based idle/tycoon game where you run a small clothing and
screen-printing business. Orders arrive, you buy blanks, print, pack and ship
them, and short lesson cards explain the business ideas behind each step.
"Clothing Brand Mafia" is a working title.

## Run it

No build step and nothing to install.

- **On your computer:** double-click `index.html`. It opens in your browser.
- **Over a local server (optional):** run `python -m http.server 8000` in this
  folder and open http://localhost:8000/.
- **Online:** it is hosted with GitHub Pages from the `main` branch
  (Settings, Pages, Deploy from branch, `main`, `/ (root)`).

Progress is saved in your browser's localStorage. Use "Reset progress" at the
bottom of the page to start over.

## 3D view and the carry loop

The shop is drawn as a 3D isometric scene (`scene3d.js`, using three.js from
`vendor/`), and in it you play the carry loop (`carry.js`): walk with the
on-screen joystick (drag anywhere on the shop) or WASD / the arrow keys.
Pick up blanks at the fabric rack, drop them at the press, carry the printed
tees to the packing table and load the boxes onto the van. Each step costs
the same as on the 2D page and is paid as the order's first item enters it.
Stand on a tile beside a machine to buy its upgrade, or on a padlock tile to
open a zone: cash drains into it as the bar fills. Hired staff run the loop
by themselves. Pinch or scroll to zoom. Cash, level, missions, orders and
lesson cards sit on top as an overlay.

The game falls back to the original 2D page by itself when WebGL is not
available, or when 3D runs below `view3d.minFps` frames per second during
the first few seconds. Players can switch between 3D and 2D with the gear
button (Settings); the choice is remembered in this browser. The 2D page
keeps the original buttons. Saves are the same in both views: the carry loop
rebuilds where the items are from each order's step. Sound can be switched
off in Settings too.

## Art

The look is written down in `STYLE.md` (palette, light, outlines, props,
motion, UI). To use your own tee model, save it as `assets/tees/tee.glb`
(or list other files in `config.js` under `view3d.models.teeModels`); it is
laid flat and sized to a folded tee automatically. Models load when the game
is served over http(s), for example from GitHub Pages; opened straight from
disk the game uses shapes built in code instead.

## Change the numbers

Every number in the game lives in `config.js`, with comments explaining the
reasoning. Change one number, save, and reload the page.

- Prices and costs: `costs`, `orders.pricePerTee`
- Minimum order and bulk discounts: `moq`, `bulkDiscount`
- Step costs and times: `steps`
- Upgrades: `upgrades`
- Order types and unlock thresholds: `orderTypes`, `unlocks`
- Result card milestone: `resultCard.milestone`
- Mission targets and rewards: `missions` (mission text is in `missions.js`)
- Level curve and XP per order: `level`
- Shop zones and their thresholds: `zones` (each upgrade names its `zone`)
- Rebrand milestone and Brand Value: `rebrand`
- 3D view (speed check, camera limits, layout, colours, wording): `view3d`
- Carry loop (items per order, stack size, speeds, station and tile places,
  the first order, wording): `carry`; the "Bigger bags" upgrade is in `upgrades`
- The B2B page link used by lesson cards and the result card: `b2bPageUrl`

To check the economy, open `index.html?debug=1`. It shows revenue, cost and
profit margin for 10, 50 and 200 tees for every order type, plus the event
counts logged in this browser.

## Lesson text

All ten lesson cards are in `lessons.js`: id, trigger, title, body and link
text. The triggers (what makes a card appear) are checked in `game.js`, in
`LESSON_TRIGGERS`; a trigger of `mission:<id>` shows the card when that
mission starts. Each card shows once and is remembered in the save.

## Saves

Progress is saved in localStorage with a version number. When a new version
changes what is saved, `migrateSave` in `game.js` upgrades older saves instead
of wiping them.

## Tracking

Events are counted in localStorage (game started, first order shipped, lesson
card opened, result card downloaded, B2B link clicked, mission completed, zone
unlocked, rebrand, which view is in use, load time in buckets, automatic
switches to 2D, time to first sale, time to first unlock and session length).
The exact seconds (and the last load time in milliseconds) are kept under
`values`. That only shows you your
own browser. To see all players, create a free site at
[goatcounter.com](https://www.goatcounter.com) and put its code in
`tracking.goatcounterCode` in `config.js`. It is free for reasonable public use
and uses no cookies. No ads, no paid services.

## Files

- `index.html`: markup and styles
- `game.js`: loop, state, save and load, UI
- `config.js`: all numbers and settings
- `lessons.js`: lesson cards
- `missions.js`: mission text and order
- `carry.js`: the carry loop played in the 3D view
- `input.js`: joystick and keyboard
- `sound.js`: sound effects, made in the browser
- `scene3d.js`: the 3D isometric view
- `art.js`: the art style in code (toon shading, outlines, props, the rigged character)
- `models.js`, `three-shim.js`: load the glTF models (KayKit props, your tees)
- `assets/`: the font, the KayKit models and `assets/tees/` for your own tee models
- `STYLE.md`: the palette and the art rules
- `vendor/three.min.js`: three.js r159 (MIT, see `vendor/three.LICENSE.txt`)
- `vendor/three-addons/`: three.js's glTF loader (MIT, unmodified)
- `CREDITS.md`: licences for anything reused
- `CLAUDE.md`: project brief and progress list
