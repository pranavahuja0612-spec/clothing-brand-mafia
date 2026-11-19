# Art style

One style everywhere: **stylised toon, warm and saturated**. Chunky shapes,
flat colour bands instead of smooth gradients, a thin plum outline on the
things you play with, and soft warm light. Detail comes from props, not from
more polygons.

## Palette (8 colours)

| Name      | Hex       | Used for |
|-----------|-----------|----------|
| Plum ink  | `#3B2A4A` | outlines, deep shadows, UI panels, text shadows |
| Cream     | `#FFF4E2` | highlights, blank tees, text on dark |
| Sunflower | `#FFC53D` | cash, coins, the guide arrow, main buttons |
| Tomato    | `#F0544F` | costs, warnings, the player's cap |
| Tangerine | `#F7934C` | wood, cardboard, warm accents, Packing Room |
| Mint      | `#2FBFA5` | success, ready tiles, Embroidery Corner |
| Sky       | `#4DA6E8` | Print Floor, screen-printed tees, info |
| Lilac     | `#9B7BE0` | level and XP, Cut & Sew |

The hex values live in `config.js` under `view3d.palette`; the CSS copies
them as variables at the top of `index.html`. Change both together.

## Rules

1. **Only palette colours**, or tints (mixed with cream) and shades (mixed
   with plum ink) of them. No pure black, no pure white, no grey: a "grey"
   is plum mixed with cream.
2. **Toon shading**: three light bands (`MeshToonMaterial` with a 3-step
   gradient). No shiny or metallic surfaces.
3. **Light**: one warm sun from the upper left (soft shadows) plus a
   cream-over-plum hemisphere fill. Every standing object gets a soft contact
   shadow under it.
4. **Outlines** (plum, about 2 px) only on characters and the key machines:
   the fabric rack, press, dryer, packing table, embroidery machine and the
   van. Props and floors have none, so the things you use stand out.
5. **Detail through props**: fabric rolls, ink tubs, hangers with tees, tee
   stacks, posters, cables, floor tape and arrows, plants, boxes. Prefer one
   more prop over a more detailed model.
6. **Assets**: KayKit (CC0, by Kay Lousberg) for furniture and street props,
   simple shapes built in code for the rest, in the same chunky proportions.
   Tees use the owner's models from `assets/tees/` when present.
7. **Motion**: nothing appears or disappears instantly. Things pop in with an
   ease-out-back overshoot and shrink out; items fly between hands and
   stations on an arc; machines move while they work.
8. **Locked** areas are desaturated and darkened toward plum; they get their
   colour back with the unlock animation.
9. **UI**: one font (Fredoka, bold, rounded), plum panels with a cream text,
   sunflower for money, 48 px minimum tap targets, safe-area padding. During
   play at most four things are on screen: cash, level, the mission banner and
   the menu button.
10. **Words** on posters and signs are original. Kpda Karkhana appears only as
    the bulk client's signboard.
