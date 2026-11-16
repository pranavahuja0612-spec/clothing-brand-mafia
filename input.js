// Movement input for the carry loop (Week 5): WASD or the arrow keys on a
// keyboard, and a floating virtual joystick on touch screens (it appears
// where the thumb lands). scene3d.js feeds it the pointer events on the 3D
// canvas; carry.js reads Input.vector() every frame.

const Input = (() => {
  const RADIUS = 52;           // joystick travel in CSS pixels
  const keys = new Set();
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let base = null;
  let knob = null;

  const KEYMAP = {
    KeyW: [0, 1], ArrowUp: [0, 1],
    KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };

  function typingInField(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  window.addEventListener("keydown", (e) => {
    if (!KEYMAP[e.code] || typingInField(e)) return;
    keys.add(e.code);
    if (e.code.startsWith("Arrow") && document.body.classList.contains("carry-on")) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  function ensureDom() {
    if (base) return;
    base = document.getElementById("joystick");
    knob = document.getElementById("joystick-knob");
  }

  function stickStart(id, x, y) {
    ensureDom();
    stick.id = id;
    stick.ox = x;
    stick.oy = y;
    stick.x = 0;
    stick.y = 0;
    if (base) {
      base.style.left = `${x}px`;
      base.style.top = `${y}px`;
      base.hidden = false;
      knob.style.transform = "translate(-50%, -50%)";
    }
  }

  function stickMove(id, x, y) {
    if (id !== stick.id) return;
    let dx = x - stick.ox;
    let dy = y - stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      // Let the base follow the thumb a little, so you never run out of stick.
      const over = d - RADIUS;
      stick.ox += (dx / d) * over;
      stick.oy += (dy / d) * over;
      dx = x - stick.ox;
      dy = y - stick.oy;
      if (base) {
        base.style.left = `${stick.ox}px`;
        base.style.top = `${stick.oy}px`;
      }
    }
    stick.x = dx / RADIUS;
    stick.y = -dy / RADIUS;   // screen y grows downwards
    if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  function stickEnd(id) {
    if (id !== null && id !== stick.id) return;
    stick.id = null;
    stick.x = 0;
    stick.y = 0;
    if (base) base.hidden = true;
  }

  // Direction on screen: x to the right, y up, length up to 1.
  function vector() {
    let x = stick.x;
    let y = stick.y;
    for (const code of keys) {
      x += KEYMAP[code][0];
      y += KEYMAP[code][1];
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  return { vector, stickStart, stickMove, stickEnd, stickActive: () => stick.id !== null };
})();
