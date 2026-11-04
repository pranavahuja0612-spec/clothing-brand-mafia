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
Out of scope for now: prestige, the open-world town, accounts, leaderboards, 3D, sound.

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
- [x] Day 7: playtest, deploy, tracking (deploy: see README; confirm the live URL loads)
