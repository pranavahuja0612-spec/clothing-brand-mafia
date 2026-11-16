# Clothing Brand Mafia — project brief

## What it is
A free, browser-based idle/tycoon game where the player runs a small clothing and screen-printing business. The game teaches how to run a clothing brand through its mechanics and short lesson cards. It is a marketing funnel for the owner's B2B Instagram page.

## Working title
"Clothing Brand Mafia" (working title; the naming rubric is not yet agreed, so do not treat the name as final).

## Brand rules
- Kpda Karkhana appears inside the game as a bulk client and partner. It is never the game's name.
- Do not mention Misfit Mavericks unless the owner asks.
- Lesson text must be original. Do not copy text from other sites or games.
- Do not copy art, names, or assets from other commercial games.

## Constraints (hard)
- Zero spend. No paid services, APIs, ads, or in-app purchases. Hosting is GitHub Pages.
- No build step. Plain HTML, CSS, and JavaScript in a single index.html for the MVP. No npm, no framework.
- Works on phones. Save progress in localStorage.
- Every licence of any code or asset we use must be recorded in CREDITS.md before it is added.

## Architecture
- index.html: markup and styles
- game.js: loop, state, save/load, UI
- config.js: ALL numbers (prices, costs, upgrade levels, unlock thresholds). Balancing happens only here.
- lessons.js: lesson cards (id, trigger, title, body, link to B2B page)
- missions.js: mission text and order (targets and rewards are numbers, so they live in config.js under `missions`)
- carry.js: the carry loop played in the 3D view (Week 5): stations, carried items, the player, staff, padlock and upgrade tiles, the guide arrow, order chips. It moves orders through the same steps and costs as game.js; its numbers and words live in config.js under `carry`.
- input.js: keyboard (WASD/arrows) and the floating virtual joystick.
- sound.js: sound effects made with Web Audio (no sound files); on/off in Settings.
- scene3d.js: the 3D isometric view. It draws `state` and carry.js every frame and calls `Carry.update()`; it never changes the game itself. Its numbers and words live in config.js under `view3d`.
- vendor/: third-party files kept unmodified (three.js r159, MIT). Record each in CREDITS.md before adding it.
- Saves carry a `version`. When the save shape changes, bump `saveVersion` in config.js and add a migration step in game.js (`migrateSave`). Never wipe old saves.
- Keep the code readable. Short functions, clear names, comments only where they help.

## Economy rules
- Cost per tee = blank + ink + screen + labour + packaging. Show it to the player.
- Minimum order quantity (MOQ) and bulk discounts must be real mechanics.
- Offline earnings: cap at 8 hours, shown on return.

## Week 1 scope (MVP) — do NOT add anything outside this list
1. Core loop: order arrives, buy blanks, print, pack, ship.
2. Upgrades: press, dryer, flash cure, staff.
3. Three unlocks: DTG printing, embroidery, Kpda Karkhana bulk client.
4. Six lesson cards: cost per tee, MOQ, GSM, print method, deadstock, returns.
5. Mobile-friendly layout and a shareable result card.
Out of scope for now: the open-world town, accounts, leaderboards. (Prestige was added in Week 2 as "Rebrand", a 3D isometric view in Week 3, and the carry loop with sound in Week 5, all at the owner's request.)

## Week 2 scope
1. Missions: one active at a time, banner with progress bar, pays cash and XP. 15 missions from first order to first Kpda Karkhana bulk deal, in missions.js.
2. Player level: XP from missions and orders raises the level; level and XP bar on screen.
3. Locked zones: Print Floor, Cut & Sew, Packing Room, Embroidery Corner, Kpda Karkhana Bulk Desk. Each opens at a level or cash threshold (config.js) and brings new upgrades.
4. Rebrand (prestige): after a sales milestone, reset cash and upgrades but keep lessons, level and permanent Brand Value points that raise order pay. The game says clearly what resets and what stays.
5. Four more lesson cards (pricing for profit, sampling before bulk, white-label vs own brand, cash flow), triggered by missions.
6. Track: mission completed, zone unlocked, rebrand.
Old saves must keep loading: migrate, never wipe.

## Week 3 scope
3D isometric view. Game logic, economy and saves stay unchanged; only the presentation changes.
1. Three.js as a local file in /vendor (no CDN, no build step), licence in CREDITS.md.
2. Fixed isometric camera over the shop floor. Each Week 2 zone is a visible area; locked zones are grey with a padlock and unlock with a short animation. Drag to pan, pinch or scroll to zoom, within limits.
3. Free low-poly assets with commercial-use licences only (Kenney first), each licence recorded in CREDITS.md; otherwise simple shapes built in code.
4. Life: workers move between stations while orders run, tee stacks grow with progress, a van leaves when an order ships, the Kpda Karkhana bulk desk has its own sign.
5. Missions, cash, level and lesson cards stay as an HTML overlay, styled like a mobile game.
6. 30fps or more on a mid-range Android phone, total assets under 5 MB, automatic fallback to the 2D view if WebGL fails or the device is slow, plus a 3D/2D toggle in Settings.
7. Track which view is used and the load time.

## Week 5 scope
Rework the core loop to play like a hyper-casual tycoon (move, carry, deliver, unlock). Economy, lessons, missions and saves stay unchanged.
1. Player character: virtual joystick on phones, WASD/arrows on desktop; the camera follows.
2. Carry loop: blanks from the fabric rack (stacked on the back) to the press, printed tees to packing, boxes onto the van. Stack size upgradeable ("Bigger bags").
3. Staff (the Staff upgrade, one carrier per level) run the same loop on their own.
4. Padlock tiles in front of locked zones and upgrade tiles beside machines: stand on one to drain cash into it with a fill bar; it unlocks with a burst. Replaces the upgrade buttons in 3D.
5. Game feel: squash and stretch on pickups, coin bursts, floating money numbers, camera shake on unlock, button press feedback, a sound per action (respects the Settings toggle).
6. First two minutes: first sale within 30 seconds, guided by an arrow, no text walls; lesson cards wait until after the first sale.
7. Track time to first sale, time to first unlock, session length.
The 2D page keeps the button-driven loop as the fallback.

## Working style
- Ask before adding a feature outside the scope above.
- After each day's work, update the progress list at the bottom of this file.
- Test by opening index.html in a browser before saying a task is done.

## Progress
- [x] Day 1: scaffold, loop, save and offline earnings
- [x] Day 2: core order loop
- [x] Day 3: economy in config.js
- [x] Day 4: upgrades and unlocks
- [x] Day 5: lesson cards
- [x] Day 6: mobile layout and result card
- [x] Day 7: playtest, deploy, tracking (live at https://pranavahuja0612-spec.github.io/clothing-brand-mafia/)

### Week 2
- [x] Part 1: missions (15, in missions.js; targets and rewards in config.js)
- [x] Part 2: player level and XP bar
- [x] Part 3: locked shop zones with new upgrades
- [x] Part 4: rebrand with Brand Value
- [x] Part 5: four more lesson cards, triggered by missions
- [x] Part 6: track mission completed, zone unlocked, rebrand
- [x] Save migration from version 1 (Week 1) to 2, tested with a real Day 7 save
- [x] Playtest: fresh save through all 15 missions and a rebrand; 360px and desktop layout
- [x] Deploy: pushed to GitHub, live URL checked 2026-11-16

### Week 3
- [x] three.js r159 in vendor/ (checksum-verified, MIT, in CREDITS.md)
- [x] Isometric scene: five zones plus loading dock, padlocks, unlock animation, drag/pinch/scroll with limits
- [x] Models built in code (Kenney checked: CC0, not used yet because model files need a module-only loader and do not load from disk)
- [x] Life: workers per order, tee stacks, delivery van, Kpda Karkhana sign, busy press/dryer/embroidery heads
- [x] Mobile-game HUD overlay with Orders / Shop / More bottom sheet; side columns on wide screens
- [x] Automatic 2D fallback (no WebGL, or under 25fps) and Settings toggle
- [x] Tracking: view used, load time bucket, automatic switch to 2D
- [x] Tested at 360x740 and 1280x760, WebGL off, forced slow device, long run with a reset; 804 KB total
- [ ] Not yet measured on a real mid-range Android phone (owner to check by hand)
- [x] Deploy

### Week 5
- [x] Playtest of the old loop: 5 reasons it felt boring written down
- [x] Player with joystick and WASD/arrows, follow camera, pinch/scroll zoom
- [x] Carry loop (carry.js): items per order from config, machines work one item per order at a time, costs paid as each step starts; save shape unchanged, items rebuilt from each order's step on load
- [x] Staff carriers from the Staff upgrade; "Bigger bags" upgrade for stack size (3D only)
- [x] Padlock and upgrade tiles with cash drain, fill bar, burst and shake; zones open by tile in 3D (still by themselves in 2D)
- [x] Game feel: squash/stretch, coins, floating numbers, shake, button pop, Web Audio sounds with Settings toggle
- [x] First two minutes: fixed 10-tee first order, guide arrow, upgrade tiles and lessons hidden until the first sale (test bot: first sale in 16s)
- [x] Tracking: timeToFirstSale, timeToFirstUnlock, sessionLength (buckets, plus seconds in the event log)
- [x] Tested: fresh save, Day 7 save, 2D/3D switch mid-order (refunds steps paid ahead), WebGL off, 360x740 and 1280x760, 5 staff stress test (59fps, 139 draw calls); 888 KB total
- [ ] Not yet measured on a real mid-range Android phone (owner to check by hand)
- [x] Deploy
