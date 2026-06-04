// reel.js — 3D helix poster reel for Movie Oracle homepage.
// Three.js r160 via ESM CDN. No build step.
//
// Public API:
//   import { mountReel, unmountReel } from './reel.js'
//   const handle = mountReel(containerEl, posters, { onFocus, onSelect })
//   handle.dispose()
//
// posters: [{ id, title, year, poster_path, ... }]
// onFocus(idx, poster) — fires when snap completes on a poster
// onSelect(poster) — fires when user clicks/taps focused poster
//
// Performance notes:
//   - Textures lazy-loaded; w185 thumbs by default, swap to w500 for focused ±1.
//   - Off-focus blur faked via mipmap bias (sample lower mip based on |focusDelta|).
//   - No postprocessing pass. Animated rim done in fragment shader per poster.
//   - Caps DPR at 2 for retina; falls back to 1 if FPS < 45 sustained.

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

// Helix tuning constants — designed for portrait viewports primarily.
const HELIX_RADIUS = 1.15;          // moderate radius — spiral arc reads without sending posters off-frustum
const HELIX_PITCH = 0.85;           // tight vertical pitch so 5+ posters stack visibly in portrait
const ANGLE_STEP = (Math.PI / 180) * 22;  // narrower lateral fan so posters stay in mobile frustum
const POSTER_W = 0.92;              // smaller — the curve is the hero
const POSTER_H = POSTER_W * 1.5;    // 2:3 movie poster ratio
const VISIBLE_FALLOFF = 6;          // see more neighbors so the spiral is unmistakable
const SNAP_DURATION = 420;          // ms
const DRAG_SENSITIVITY = 0.006;     // rad per pixel
const WHEEL_SENSITIVITY = 0.0024;   // rad per wheel delta

// Vertex shader — standard with focus-distance varying
const POSTER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader: samples texture with mipmap bias for fake DOF,
// applies desaturation + dim based on focusDelta uniform,
// adds animated directional rim catching the right edge.
const POSTER_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D map;
  uniform float focusDelta;   // 0 at center, grows with distance
  uniform float time;
  uniform float dpr;

  vec3 desaturate(vec3 c, float amt) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return mix(c, vec3(g), amt);
  }

  void main() {
    // Mipmap bias: higher delta = blurrier sample. Cap so it doesn't go absurd.
    float bias = clamp(focusDelta * 2.2, 0.0, 5.0);
    vec4 tex = texture2D(map, vUv, bias);

    // Desaturate non-focused posters
    float desat = clamp(focusDelta * 0.6, 0.0, 0.6);
    vec3 col = desaturate(tex.rgb, desat);

    // Dim based on distance (gentle — we want neighbors visible enough to read the spiral curve)
    float dim = 1.0 - clamp(focusDelta * 0.16, 0.0, 0.5);
    col *= dim;

    // Animated warm rim (right edge, drifts subtly with time)
    // Only show on near-focus posters
    float rimMask = smoothstep(0.78, 1.0, vUv.x);
    float rimAnim = 0.85 + 0.15 * sin(time * 0.6 + vUv.y * 3.0);
    float rimFalloff = 1.0 - smoothstep(0.0, 1.5, focusDelta);
    vec3 rimColor = vec3(1.0, 0.78, 0.5) * rimMask * rimAnim * rimFalloff * 0.55;
    col += rimColor;

    gl_FragColor = vec4(col, tex.a);
  }
`;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Build a placeholder canvas texture (dark grey) so geometry exists before image loads.
function makePlaceholderTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(0, 0, 64, 96);
  ctx.fillStyle = '#2a2a35';
  ctx.fillRect(2, 2, 60, 92);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadPosterTexture(loader, posterPath, size) {
  if (!posterPath) return null;
  const url = `${TMDB_IMG_BASE}/${size}${posterPath}`;
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

export function mountReel(container, posters, opts = {}) {
  const { onFocus = () => {}, onSelect = () => {} } = opts;

  // ---- renderer ----
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.cursor = 'grab';

  // ---- scene + camera ----
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    42,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  // Camera looks at the helix from outside, pointing at origin
  // Helix axis is Y; camera sits on +Z
  const cameraDistance = 7.5;
  // Camera offset upward + look slightly downward so the helix reads as a 3D spiral,
  // not a flat carousel. Focused poster sits ON the spiral arc, visibly mid-curve.
  camera.position.set(0, 0.6, cameraDistance);
  camera.lookAt(0, 0, 0);

  // Subtle radial vignette via a fullscreen plane behind everything
  // (cheaper than a postprocessing pass)
  const vignetteGeo = new THREE.PlaneGeometry(40, 40);
  const vignetteMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float d = length(c) * 1.4;
        float a = smoothstep(0.2, 0.95, d);
        gl_FragColor = vec4(0.0, 0.0, 0.0, a * 0.75);
      }
    `,
  });
  const vignette = new THREE.Mesh(vignetteGeo, vignetteMat);
  vignette.renderOrder = 999;
  scene.add(vignette);

  // ---- helix group ----
  const helixGroup = new THREE.Group();
  scene.add(helixGroup);

  const N = posters.length;
  const placeholderTex = makePlaceholderTexture();
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';

  const meshes = []; // { mesh, material, posterIdx, currentSize }
  const posterGeo = new THREE.PlaneGeometry(POSTER_W, POSTER_H);

  for (let i = 0; i < N; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        map: { value: placeholderTex },
        focusDelta: { value: Math.abs(i) },
        time: { value: 0 },
        dpr: { value: renderer.getPixelRatio() },
      },
      vertexShader: POSTER_VERT,
      fragmentShader: POSTER_FRAG,
    });

    const mesh = new THREE.Mesh(posterGeo, mat);
    // Layout: each poster at angle = i * ANGLE_STEP, y = -i * HELIX_PITCH
    // We'll set position in updateHelix() based on current rotation.
    helixGroup.add(mesh);

    meshes.push({
      mesh,
      material: mat,
      posterIdx: i,
      currentSize: null, // 'w185' | 'w500'
      loadingSize: null,
    });
  }

  // ---- rotation / position state ----
  // "rotation" here is a scalar offset in step-units. Integer = a poster snapped.
  let rotation = 0; // current display rotation
  let targetRotation = 0; // snap target
  let snapStart = 0;
  let snapFrom = 0;
  let snapping = false;
  let lastFocusIdx = -1;

  function placeMeshes() {
    for (let i = 0; i < N; i++) {
      // Position relative to current rotation
      const delta = i - rotation; // can be fractional
      const angle = delta * ANGLE_STEP;
      const y = -delta * HELIX_PITCH;

      const m = meshes[i].mesh;
      m.position.set(
        Math.sin(angle) * HELIX_RADIUS,
        y,
        Math.cos(angle) * HELIX_RADIUS // genuine helix — focused poster orbits the same axis as the rest
      );
      m.rotation.y = -angle;

      // Opacity / focus uniform
      const absDelta = Math.abs(delta);
      meshes[i].material.uniforms.focusDelta.value = absDelta;

      // Hide far posters entirely (still in scene tree for predictable draw count
      // but with very low alpha — we let the shader's dim term handle it)
      // Also fade out beyond VISIBLE_FALLOFF
      const fade = 1.0 - Math.min(absDelta / VISIBLE_FALLOFF, 1.0);
      m.visible = fade > 0.02;
    }
  }

  function loadFor(i, size) {
    const slot = meshes[i];
    if (!slot) return;
    if (slot.currentSize === size) return;
    if (slot.loadingSize === size) return;
    const p = posters[i];
    if (!p || !p.poster_path) return;
    slot.loadingSize = size;
    loadPosterTexture(loader, p.poster_path, size)
      .then((tex) => {
        // If a larger size has since been requested and is loading, skip.
        if (size === 'w185' && slot.currentSize === 'w500') {
          tex.dispose();
          slot.loadingSize = null;
          return;
        }
        // Dispose previous map if it's not the placeholder
        const prev = slot.material.uniforms.map.value;
        if (prev && prev !== placeholderTex) prev.dispose();
        slot.material.uniforms.map.value = tex;
        slot.currentSize = size;
        slot.loadingSize = null;
      })
      .catch(() => {
        slot.loadingSize = null;
      });
  }

  function updateTextureLoading() {
    const focusIdx = Math.round(rotation);
    for (let i = 0; i < N; i++) {
      const delta = Math.abs(i - focusIdx);
      if (delta <= 1) {
        loadFor(i, 'w500');
      } else if (delta <= 5) {
        loadFor(i, 'w185');
      }
      // farther posters wait
    }
  }

  function clampTarget(t) {
    return Math.max(0, Math.min(N - 1, t));
  }

  function startSnap(to) {
    targetRotation = clampTarget(to);
    snapFrom = rotation;
    snapStart = performance.now();
    snapping = true;
  }

  // ---- input ----
  let dragging = false;
  let dragLastY = 0;
  let dragMoved = 0;

  function onPointerDown(e) {
    dragging = true;
    dragMoved = 0;
    dragLastY = e.clientY;
    snapping = false;
    renderer.domElement.style.cursor = 'grabbing';
    renderer.domElement.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const dy = e.clientY - dragLastY;
    dragLastY = e.clientY;
    dragMoved += Math.abs(dy);
    rotation = clampTarget(rotation - dy * DRAG_SENSITIVITY * 4 / HELIX_PITCH);
  }
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    renderer.domElement.style.cursor = 'grab';
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}

    if (dragMoved < 5) {
      // It was a tap, not a drag — check if tap hit the focused poster
      handleTap(e);
    } else {
      // Snap to nearest
      startSnap(Math.round(rotation));
    }
  }
  function onWheel(e) {
    e.preventDefault();
    snapping = false;
    rotation = clampTarget(rotation + e.deltaY * WHEEL_SENSITIVITY);
    clearTimeout(onWheel._snapTimer);
    onWheel._snapTimer = setTimeout(() => {
      startSnap(Math.round(rotation));
    }, 140);
  }

  function handleTap(e) {
    // We treat any tap as "select the currently focused poster"
    // since the focused one is the only visually-prominent target.
    const focusIdx = Math.round(rotation);
    if (focusIdx >= 0 && focusIdx < N) {
      onSelect(posters[focusIdx]);
    }
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  // Keyboard nav
  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      startSnap(Math.round(rotation) + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      startSnap(Math.round(rotation) - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const focusIdx = Math.round(rotation);
      if (focusIdx >= 0 && focusIdx < N) onSelect(posters[focusIdx]);
    }
  }
  window.addEventListener('keydown', onKey);

  // ---- resize ----
  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  // ---- intro spin ----
  // Land on idx 2 (not 0) so users immediately see posters above AND below the focused one,
  // making the helix structure obvious from first frame.
  rotation = 0;
  startSnap(2);

  // ---- render loop ----
  let rafId = 0;
  const clock = new THREE.Clock();

  function tick() {
    const t = clock.getElapsedTime();

    if (snapping) {
      const elapsed = performance.now() - snapStart;
      const p = Math.min(elapsed / SNAP_DURATION, 1);
      rotation = lerp(snapFrom, targetRotation, easeOutCubic(p));
      if (p >= 1) snapping = false;
    }

    placeMeshes();

    // Update time uniform for rim animation
    for (let i = 0; i < N; i++) {
      meshes[i].material.uniforms.time.value = t;
    }

    // Fire onFocus when snapped to a new poster
    const focusIdx = Math.round(rotation);
    if (!snapping && !dragging && focusIdx !== lastFocusIdx && Math.abs(rotation - focusIdx) < 0.05) {
      lastFocusIdx = focusIdx;
      if (focusIdx >= 0 && focusIdx < N) {
        onFocus(focusIdx, posters[focusIdx]);
        updateTextureLoading();
      }
    }

    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  // Initial load + render
  updateTextureLoading();
  tick();

  return {
    dispose() {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      meshes.forEach((s) => {
        const tex = s.material.uniforms.map.value;
        if (tex && tex !== placeholderTex) tex.dispose();
        s.material.dispose();
      });
      placeholderTex.dispose();
      posterGeo.dispose();
      vignetteGeo.dispose();
      vignetteMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    },
    snapTo(i) {
      startSnap(clampTarget(i));
    },
    getFocusIdx() {
      return Math.round(rotation);
    },
  };
}

export function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}
