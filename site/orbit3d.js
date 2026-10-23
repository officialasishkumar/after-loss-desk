// The room around the Echo, in three dimensions. The device sits at the centre (it is HTML, layered on top of this canvas);
// around it, on a tilted ring, one node per institution the desk has to reach. A node is slate while open, grey with a half
// disc while a notice is out, green with a check when done, an amber diamond when a gate waits on you. A pulse of light runs
// out along the ring's spokes when a notice goes, and back when a reply lands. Dust drifts; the centre light takes the
// device's colour (blue speaking, violet listening, amber when a gate waits). three.js is loaded from cdnjs; without it the
// page still works, just without the room.
let THREE = null;
const COL = { ghost: 0x2b3643, open: 0x5b6878, waiting: 0x93a1b1, done: 0x3ecf8e, parked: 0xf0b429, held: 0xf0b429, alexa: 0x3d8cff, sim: 0xb48cff, needs: 0xf0b429 };
const GLYPH = { ghost: "", open: "", waiting: "◐ ", done: "✓ ", parked: "◆ ", held: "✋ " };
const NAMES = { ssa_report: "Social Security", ssa_return_payment: "SSA payment", ssa_survivor: "Survivor benefits", will_deliver: "Probate court", certificates_order: "County clerk", bureau_equifax: "Equifax", bureau_experian: "Experian", bureau_transunion: "TransUnion", bank_notify: "Bank", pension_notify: "Pension", employer_notify: "Employer", insurance_claim: "Insurer", utilities_notify: "Utility", phone_internet_notify: "Phone", subscription_cancel: "Gym", credit_card_notify: "Card issuer", vehicle_reg5: "DMV" };
export function nameOf(id, label) { if (label) return label; id = id.replace(/^ghost_/, ""); const k = Object.keys(NAMES).find((p) => id.startsWith(p)); return k ? NAMES[k] : id.replace(/_/g, " "); }

function labelTexture(text, color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96; const g = c.getContext("2d");
  g.font = "600 38px 'IBM Plex Sans', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,.8)"; g.shadowBlur = 12; g.fillStyle = color; g.fillText(text, 256, 48);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.3, "rgba(255,255,255,.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

export async function mountOrbit(container) {
  if (!THREE) { try { THREE = await import("https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js"); } catch { return null; } }
  const W = container.clientWidth || 1200, H = container.clientHeight || 800;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(W, H); renderer.domElement.className = "orbit-canvas";
  container.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x0f1419, 0.028);
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100); camera.position.set(0, 2.0, 17.5); camera.lookAt(0, 0.2, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const lamp = new THREE.PointLight(COL.alexa, 2.2, 16, 1.6); lamp.position.set(0, 0.6, 0.5); scene.add(lamp);
  const key = new THREE.DirectionalLight(0xffffff, 0.35); key.position.set(-4, 8, 6); scene.add(key);
  // the table: a dark plane that catches the lamp
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x121a22, roughness: 0.85, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -3.4; scene.add(floor);
  // dust
  const N = 700; const pos = new Float32Array(N * 3); const vel = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 36; pos[i * 3 + 1] = (Math.random() - 0.5) * 16; pos[i * 3 + 2] = (Math.random() - 0.5) * 24 - 2; vel[i] = 0.02 + Math.random() * 0.05; }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9fb0c3, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false })); scene.add(dust);
  // the ring
  const ring = new THREE.Group(); ring.rotation.x = 0.5; scene.add(ring);
  const R = 8.2;
  const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos(i / 128 * Math.PI * 2) * R, 0, Math.sin(i / 128 * Math.PI * 2) * R))), new THREE.LineBasicMaterial({ color: 0x3a4756, transparent: true, opacity: 0.6 }));
  ring.add(circle);
  const glow = glowTexture();
  const nodes = new Map(); // id -> { mesh, sprite, status, angle, halo }
  const pulses = [];
  const sphere = new THREE.SphereGeometry(0.3, 24, 24), diamond = new THREE.OctahedronGeometry(0.42);
  function place(id, i, n) { const a = -Math.PI / 2 + (i + 0.5) / n * Math.PI * 2; return { a, v: new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R) }; }
  function setNodes(rows) {
    const ids = new Set(rows.map((r) => r.id)); for (const [id, nd] of nodes) if (!ids.has(id)) { ring.remove(nd.mesh, nd.sprite, nd.halo); nodes.delete(id); }
    rows.forEach((r, i) => {
      const { a, v } = place(r.id, i, rows.length); const color = COL[r.status] ?? COL.open; let nd = nodes.get(r.id);
      if (!nd) {
        const mesh = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.4 }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.setScalar(1.6);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture("", "#fff"), transparent: true, depthWrite: false })); sprite.scale.set(3.2, 0.6, 1);
        nd = { mesh, sprite, halo, status: null, a, born: performance.now() + i * 90 }; nodes.set(r.id, nd); ring.add(mesh, halo, sprite);
        mesh.scale.setScalar(0.001);
      }
      nd.a = a; nd.mesh.position.copy(v); nd.halo.position.copy(v); nd.sprite.position.set(v.x, -0.75, v.z);
      if (nd.status !== r.status) {
        nd.status = r.status; nd.mesh.geometry = r.status === "parked" || r.status === "held" ? diamond : sphere;
        nd.mesh.material.color.setHex(color); nd.mesh.material.emissive.setHex(color); nd.halo.material.color.setHex(color);
        nd.halo.material.opacity = r.status === "ghost" ? 0.06 : r.status === "open" ? 0.12 : r.status === "parked" ? 0.6 : 0.35;
        nd.sprite.material.map?.dispose(); nd.sprite.material.map = labelTexture(GLYPH[r.status] + nameOf(r.id, r.label), r.status === "ghost" ? "#4a5666" : "#" + color.toString(16).padStart(6, "0")); nd.sprite.material.needsUpdate = true;
        nd.flash = performance.now();
      }
    });
  }
  function pulse(id, dir) {
    const nd = nodes.get(id); if (!nd) return;
    const from = dir === "out" ? new THREE.Vector3(0, 0.3, 0) : nd.mesh.position.clone(), to = dir === "out" ? nd.mesh.position.clone() : new THREE.Vector3(0, 0.3, 0);
    const color = dir === "out" ? COL.alexa : nd.status === "parked" ? COL.needs : COL.waiting;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(0.9);
    const trail = Array.from({ length: 7 }, () => { const t = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })); t.scale.setScalar(0.5); ring.add(t); return t; });
    ring.add(s); pulses.push({ s, trail, from, to, t: 0, hist: [] });
  }
  let lampColor = new THREE.Color(COL.alexa), lampTarget = new THREE.Color(COL.alexa), speaking = false;
  function ambient(state) { lampTarget.setHex(state === "listening" ? COL.sim : state === "gate" ? COL.needs : COL.alexa); speaking = state === "speaking" || state === "thinking"; }
  let px = 0, py = 0, tx = 0, ty = 0; const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) container.addEventListener("pointermove", (e) => { const b = container.getBoundingClientRect(); tx = ((e.clientX - b.left) / b.width - 0.5); ty = ((e.clientY - b.top) / b.height - 0.5); }, { passive: true });
  let alive = true, last = performance.now();
  (function frame() {
    if (!alive) return; const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
    px += (tx - px) * 0.04; py += (ty - py) * 0.04;
    camera.position.x = px * 2.2; camera.position.y = 2.0 - py * 1.2; camera.lookAt(0, 0.2, 0);
    if (!reduced) { ring.rotation.y += dt * 0.03; const p = dust.geometry.attributes.position.array; for (let i = 0; i < N; i++) { p[i * 3 + 1] += vel[i] * dt; if (p[i * 3 + 1] > 8) p[i * 3 + 1] = -8; } dust.geometry.attributes.position.needsUpdate = true; }
    lampColor.lerp(lampTarget, 0.05); lamp.color.copy(lampColor); lamp.intensity = speaking ? 2.6 + Math.sin(t * 6) * 0.8 : 2.0 + Math.sin(t * 1.2) * 0.25;
    for (const nd of nodes.values()) {
      const age = (now - nd.born) / 600; if (age < 1) nd.mesh.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - Math.max(0, age), 3))); else nd.mesh.scale.setScalar(1);
      nd.mesh.position.y = Math.sin(t * 0.8 + nd.a * 3) * 0.12; nd.halo.position.y = nd.mesh.position.y; if (nd.status === "parked" || nd.status === "held") nd.mesh.rotation.y = t * 1.2;
      const f = nd.flash ? Math.max(0, 1 - (now - nd.flash) / 900) : 0; nd.mesh.material.emissiveIntensity = (nd.status === "parked" ? 0.6 + Math.sin(t * 4) * 0.25 : nd.status === "done" ? 0.45 : 0.22) + f * 1.2; nd.halo.scale.setScalar(1.6 + f * 1.4);
      nd.sprite.material.rotation = -ring.rotation.y * 0; // labels face the camera as sprites do
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]; p.t += dt / 1.1; const k = Math.min(1, p.t); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pos = p.from.clone().lerp(p.to, e); pos.y += Math.sin(e * Math.PI) * 1.4; p.s.position.copy(pos); p.hist.unshift(pos.clone()); p.hist = p.hist.slice(0, 14);
      p.trail.forEach((tr, j) => { const h = p.hist[j * 2]; if (h) { tr.position.copy(h); tr.material.opacity = 0.3 * (1 - j / 7); } });
      if (p.t >= 1.25) { ring.remove(p.s, ...p.trail); pulses.splice(i, 1); }
    }
    renderer.render(scene, camera); requestAnimationFrame(frame);
  })();
  const ro = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); ro.observe(container);
  return { setNodes, pulse, ambient, dispose() { alive = false; ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); } };
}
