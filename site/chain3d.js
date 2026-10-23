// The record in three dimensions: one block per receipt along a gentle spiral, linked in order; colour says who acted
// (blue the assistant or Alexa, slate the agent, amber a gate or an heir, green an approval, grey an institution); the
// newest block breathes. Links are green while the chain verifies and red if it does not. Drag to orbit, wheel to zoom,
// hover for the receipt; focus(seq) lights one block from the list; sweep() runs a verification pulse down the chain.
// three.js is loaded only when this page is opened; if it cannot load, the list below still stands.
let THREE = null;
export async function mountChain(container, receipts, chainOk, onHover) {
  if (!THREE) {
    try { THREE = await import("https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js"); }
    catch { container.hidden = true; return null; }
  }
  container.hidden = false;
  container.replaceChildren();
  const W = container.clientWidth || 800, H = container.clientHeight || 460;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(W, H);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0f1419, 0.012);
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 400);
  const group = new THREE.Group(); scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(4, 8, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x3d8cff, 0.7); rim.position.set(-6, 2, -4); scene.add(rim);
  const COLOR = { alexa: 0x3d8cff, agent: 0x8a96a4, executor: 0x3ecf8e, institution: 0xb9c3cf, heir: 0xf0b429 };
  const n = receipts.length; const step = 0.9; const radius = 3.2 + n * 0.03;
  const pts = []; const meshes = []; const bySeq = new Map();
  receipts.forEach((r, i) => {
    const a = i * 0.42; const x = Math.cos(a) * radius; const z = Math.sin(a) * radius; const y = (i - n / 2) * (step * 0.32);
    const isGate = r.action === "raise" || r.action === "objection"; const isExec = r.action.startsWith("execute:");
    const col = isGate ? 0xf0b429 : r.action === "approve" ? 0x3ecf8e : isExec ? 0x3d8cff : (COLOR[r.actor] ?? 0x8a96a4);
    const geo = isGate ? new THREE.OctahedronGeometry(0.38) : new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.15, emissive: col, emissiveIntensity: i === n - 1 ? 0.5 : 0.08 });
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.userData = r; m.userData.base = i === n - 1 ? 0.5 : 0.08; group.add(m); meshes.push(m); bySeq.set(r.seq, m); pts.push(m.position.clone());
  });
  if (pts.length > 1) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: chainOk ? 0x3ecf8e : 0xff5c5c, transparent: true, opacity: 0.7 }));
    group.add(line);
  }
  const span = Math.max(4, n * step * 0.32); const dist = Math.max(radius * 2.7 + 3, span * 1.4); camera.position.set(0, span * 0.4, dist); camera.lookAt(0, 0, 0);
  let rotY = 0.2, rotX = 0.15, targetY = rotY, drag = null, zoom = 1;
  const el = renderer.domElement; el.style.cursor = "grab"; el.style.touchAction = "none";
  el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, ry: targetY, rx: rotX }; el.style.cursor = "grabbing"; });
  window.addEventListener("pointermove", (e) => { if (!drag) return; targetY = drag.ry + (e.clientX - drag.x) * 0.008; rotX = Math.max(-0.8, Math.min(0.8, drag.rx + (e.clientY - drag.y) * 0.006)); });
  window.addEventListener("pointerup", () => { drag = null; el.style.cursor = "grab"; });
  el.addEventListener("wheel", (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); zoom = Math.max(0.5, Math.min(2.2, zoom + e.deltaY * 0.004)); }, { passive: false });
  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(-9, -9); let hovered = null, focused = null, sweepAt = -1;
  el.addEventListener("pointermove", (e) => { const b = el.getBoundingClientRect(); mouse.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1); });
  el.addEventListener("pointerleave", () => mouse.set(-9, -9));
  let alive = true; const t0 = performance.now();
  (function frame() {
    if (!alive) return;
    const t = (performance.now() - t0) / 1000;
    if (!drag) targetY += 0.0025;
    rotY += (targetY - rotY) * 0.08; group.rotation.set(rotX, rotY, 0);
    camera.position.z = dist * zoom; camera.lookAt(0, 0, 0);
    if (meshes.length) { const last = meshes[meshes.length - 1]; last.material.emissiveIntensity = 0.35 + 0.3 * Math.sin(t * 3); last.rotation.y = t; }
    if (sweepAt >= 0) meshes.forEach((m, i) => { const d = sweepAt - i; m.material.emissiveIntensity = d >= 0 && d < 6 ? 0.9 - d * 0.14 : m.userData.base; });
    ray.setFromCamera(mouse, camera); const hit = ray.intersectObjects(meshes)[0]?.object || null;
    if (hit !== hovered) { if (hovered && hovered !== focused) hovered.scale.setScalar(1); hovered = hit; if (hovered) hovered.scale.setScalar(1.35); onHover?.(hovered ? hovered.userData : null); }
    renderer.render(scene, camera); requestAnimationFrame(frame);
  })();
  const ro = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight || H; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }); ro.observe(container);
  return {
    dispose() { alive = false; ro.disconnect(); renderer.dispose(); container.replaceChildren(); },
    focus(seq) { if (focused && focused !== hovered) focused.scale.setScalar(1); focused = seq == null ? null : bySeq.get(seq) || null; if (focused) focused.scale.setScalar(1.5); },
    sweep() { return new Promise((resolve) => { let i = 0; const id = setInterval(() => { sweepAt = i++; if (i > meshes.length + 6) { clearInterval(id); sweepAt = -1; meshes.forEach((m) => (m.material.emissiveIntensity = m.userData.base)); resolve(); } }, Math.max(18, 900 / Math.max(1, meshes.length))); }); },
  };
}
