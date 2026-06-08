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

// Helix tuning constants — TRUE CYLINDER spec.
// Posters are tangent planes on a vertical cylinder. Camera looks at the cylinder
// from outside its front face. Back-half posters are physically behind the cylinder
// surface and occluded by the focused poster via the depth test.
//
// 20 posters distributed around a helix. Lower revs = neighbors closer to the focused poster
// in viewport; higher revs = more 'spiral stair' feel. 1.5 revs = 27°/poster (sweet spot for portrait).
const CYL_RADIUS = 2.8;             // bumped per Axel's arc-vs-poster-width formula: 20% slack, no neighbor clipping
const HELIX_PITCH = 0.42;            // gentle staircase descent (matches larger cylinder)
const REVS_PER_LOOP = 1.5;           // 20 posters * 1.5 revolutions = 27°/poster (visible tilt on neighbors)
const POSTER_W = 1.1;                // poster width — still well under cylinder radius (2.4), no self-intersection
const POSTER_H = POSTER_W * 1.5;     // 2:3 movie poster ratio
const VISIBLE_FALLOFF = 5;           // posters this many steps away from focus get faded out
const BACK_HIDE = 14;                // posters more than this many steps away hidden entirely (far back of cylinder)
const SNAP_DURATION = 420;           // ms
const DRAG_SENSITIVITY = 0.006;      // rad per pixel
const WHEEL_SENSITIVITY = 0.0024;    // rad per wheel delta

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
// kills back-of-cylinder posters via facing uniform,
// adds animated directional rim catching the right edge.
const POSTER_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D map;
  uniform float focusDelta;   // 0 at center, grows with distance
  uniform float snapPulse;    // 0..1, brief on snap landing
  uniform float time;
  uniform float dpr;
  uniform float facing;       // cos(angleFromCamera): 1 front, 0 edge, -1 back

  vec3 desaturate(vec3 c, float amt) {
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    return mix(c, vec3(g), amt);
  }

  void main() {
    // Sample with mipmap bias for fake DOF.
    float bias = clamp(focusDelta * 1.6, 0.0, 4.5);

    // Back-facing posters show a mirrored, dimmer version of the front
    // (physically correct: a printed poster glued to a cylinder shows its back when it rotates away).
    bool isBack = facing < 0.0;
    vec2 uv = isBack ? vec2(1.0 - vUv.x, vUv.y) : vUv;
    vec4 tex = texture2D(map, uv, bias);

    // No focus-based desat or dim on front-facing posters — Saber #15640 wanted
    // posters rendered at their true brightness regardless of position on the cylinder.
    // The "color burn" look came from stacking three multiplicative dim factors here;
    // removed entirely for front-facing posters, kept only on the back side below.
    vec3 col = tex.rgb;

    // Edge-on alpha shaping is still needed so glancing posters fade out (otherwise
    // they render as visible thin slivers at the cylinder horizon), but no longer
    // multiplies into color — alpha-only, computed once and reused for the final mask.
    float absFacing = abs(facing);
    float edgeShade = smoothstep(0.05, 0.55, absFacing);

    if (isBack) {
      // Back of poster: strong dim + slight desaturation + faint paper tint, no rim.
      // This is the only place darkening still applies — backs are physically the
      // reverse of a printed poster glued to a cylinder, so they should read dim.
      col = desaturate(col, 0.35) * 0.55;
      col *= vec3(0.95, 0.93, 0.88); // warm paper tint
    } else {
      // No always-on rim glow — it read as a flash artifact stuck on the right edge (Saber #15448).
      // The sweeping shimmer on snap below provides all the highlight personality we need.

      // Snap shimmer: a soft diagonal highlight band sweeps left→right across the
      // poster when it locks into focus. snapPulse fades 1→0 over ~700ms with
      // easeInOutCubic (driven from JS tick), so we map that to band position 0→1
      // across the surface — reads as light catching glossy stock (Axel #15423).
      if (snapPulse > 0.001 && focusDelta < 0.6) {
        float sweepPos = (1.0 - snapPulse) * 1.4 - 0.2; // -0.2 .. 1.2
        // Diagonal: band perpendicular to a vector tilted slightly.
        float diag = vUv.x * 0.85 + (1.0 - vUv.y) * 0.15;
        float bandDist = abs(diag - sweepPos);
        float band = exp(-bandDist * bandDist * 60.0); // narrow gaussian
        float shimmerFade = 1.0 - smoothstep(0.0, 0.6, focusDelta);
        vec3 shimmerColor = vec3(1.0, 0.96, 0.86); // warm white
        col += shimmerColor * band * shimmerFade * 0.55;
      }
    }

    // Rounded-corner mask (matches the detail-page poster border-radius).
    // Compute in poster-aspect-aware space so corners stay circular, not stretched.
    vec2 halfSize = vec2(0.5, 0.75); // POSTER_W/2, POSTER_H/2 in local units; ratio 1.5
    vec2 p = (vUv - 0.5) * halfSize * 2.0; // -halfSize..halfSize
    float radius = 0.06; // ~12px on 200px-wide poster
    vec2 q = abs(p) - (halfSize - vec2(radius));
    float cornerDist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    // Anti-aliased mask: smoothstep over ~1.5 fragment widths.
    float aa = fwidth(cornerDist) * 1.5;
    float cornerMask = 1.0 - smoothstep(-aa, aa, cornerDist);

    // Faint white inner border — reads like a paper print's white margin around
    // the artwork. ~0.5px hairline at 5% opacity, only on the front of the poster
    // so the back-of-cylinder side keeps its raw paper look (Saber #15553, thinned per Saber #15651).
    if (!isBack) {
      float borderWidth = 0.004; // ~0.5px inside the rounded mask
      float borderInner = -borderWidth;
      float borderAA = fwidth(cornerDist);
      // ring = 1 inside the border band (between borderInner and 0), 0 elsewhere
      float ring = smoothstep(borderInner - borderAA, borderInner + borderAA, cornerDist)
                 - smoothstep(-borderAA, borderAA, cornerDist);
      col = mix(col, vec3(1.0), ring * 0.05);
    }

    float alpha = tex.a * edgeShade * cornerMask;
    gl_FragColor = vec4(col, alpha);
    // Custom ShaderMaterial in r152+ does sRGB->linear on texture sample (via map.colorSpace)
    // but does NOT auto-encode linear->sRGB on output. Without this include, posters render
    // ~32% darker than source, with green dimmed most (sRGB curve hits midtones hardest).
    // Saber called this out: "posters are still darker than they should be" (#15725+).
    #include <colorspace_fragment>
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
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  // Aim camera below the focused poster center so the poster projects ABOVE viewport
  // midline — leaves clear bottom space for the title-meta text (Saber #15373).
  const cameraDistance = 6.6;
  camera.position.set(0, -0.27, cameraDistance);
  camera.lookAt(0, -0.27, 0);

  // Subtle radial vignette via a fullscreen plane.
  // Sits BEHIND the helix (renderOrder -999) so it darkens the empty background
  // around the reel without tinting the posters themselves. Posters write depth
  // and render on top, preserving their true colors (Saber #15537).
  const vignetteGeo = new THREE.PlaneGeometry(40, 40);
  const vignetteMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {},
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99, 1.0); }
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
  vignette.renderOrder = -999;
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
      depthWrite: true,      // write depth so back-of-cylinder posters are occluded by focused
      depthTest: true,       // honor depth when rendering
      side: THREE.DoubleSide, // see poster back when it rotates around
      uniforms: {
        map: { value: placeholderTex },
        focusDelta: { value: Math.abs(i) },
        time: { value: 0 },
        snapPulse: { value: 0 },
        dpr: { value: renderer.getPixelRatio() },
        facing: { value: 1.0 }, // 1 front-facing, 0 back-facing (alpha kill)
      },
      vertexShader: POSTER_VERT,
      fragmentShader: POSTER_FRAG,
      extensions: { derivatives: true },
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

  // Intro entrance: subtle scale-only cascade. Each mesh progresses 0ₒ1 over
  // INTRO_DURATION, scaling from 0.88 → 1.0. No big vertical drop — that read
  // as "stop then move" because posters were staged 2.2 units below their final
  // position before sliding up (Saber #15563). Now they appear in place and
  // gently bloom to full size, synced with the GSAP canvas fade-in.
  const introProgress = new Array(N).fill(0);
  let introStart = -1;
  const INTRO_DURATION = 0.7;
  const INTRO_STAGGER = 0.025;

  function placeMeshes() {
    // True cylinder: each poster has a base angle theta_i = i * (2*PI*REVS_PER_LOOP / N),
    // and the whole cylinder rotates so the poster at round(rotation) faces the camera.
    const ANG_PER = (2 * Math.PI * REVS_PER_LOOP) / N;

    for (let i = 0; i < N; i++) {
      const delta = i - rotation; // fractional during snap, integer when settled
      const angle = delta * ANG_PER; // 0 at focus; ± walks around the cylinder
      const y = -delta * HELIX_PITCH;

      const m = meshes[i].mesh;
      // Intro: subtle scale bloom only, no vertical offset.
      const intro = introProgress[i];
      const scaleIntro = lerp(0.88, 1.0, intro);
      m.scale.set(scaleIntro, scaleIntro, 1);
      // Tangent plane on the cylinder surface:
      // At angle=0, poster sits at (0, y, +CYL_RADIUS) facing camera.
      // At angle=π, poster sits at (0, y, -CYL_RADIUS) facing AWAY from camera.
      m.position.set(
        Math.sin(angle) * CYL_RADIUS,
        y,
        Math.cos(angle) * CYL_RADIUS
      );
      // Poster face points outward from the cylinder axis.
      m.rotation.y = angle;

      // Facing factor: cos(angle) = 1 at focus, 0 at sides (edge-on), -1 at back.
      const facing = Math.cos(angle);
      const absDelta = Math.abs(delta);

      meshes[i].material.uniforms.focusDelta.value = absDelta;
      meshes[i].material.uniforms.facing.value = facing;

      // Manual render order: back posters first, front last, so overlaps composite correctly.
      m.renderOrder = facing * 10;

      // Cull posters far above/below the visible window. With back-faces rendered,
      // we keep posters around the full cylinder — the helix vertical drift handles culling.
      const hasArt = meshes[i].currentSize !== null;
      const vertOk = Math.abs(y) < 4.5; // visible vertical window
      m.visible = vertOk && hasArt && absDelta <= BACK_HIDE;
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
        // Make this slot visible now that art is loaded (placeMeshes will keep it culled if too far)
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
      } else if (delta <= BACK_HIDE) {
        loadFor(i, 'w185');
      }
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

  // Start near the middle of the deck so the cylinder has posters above AND below from frame 0.
  const introTarget = Math.floor(N / 2);
  rotation = introTarget - 0.0001; // sub-pixel so startSnap registers movement and triggers a snap-in
  startSnap(introTarget);
  introStart = performance.now() / 1000; // start the entrance cascade NOW

  // Preload ALL posters at w185 up front so the cylinder doesn't show blank slots.
  // 20 * ~30KB = ~600KB — still mobile-friendly, and the cylinder feel demands density.
  for (let i = 0; i < N; i++) loadFor(i, 'w185');

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

    // Drive intro cascade: cascade from focused poster outward.
    if (introStart >= 0) {
      let allDone = true;
      for (let i = 0; i < N; i++) {
        const distFromFocus = Math.abs(i - introTarget);
        const localStart = introStart + distFromFocus * INTRO_STAGGER;
        const tt = (t - localStart) / INTRO_DURATION;
        const p = Math.max(0, Math.min(1, tt));
        // ease-out-back-ish: ease out cubic + small overshoot
        const eased = 1 - Math.pow(1 - p, 3);
        introProgress[i] = eased;
        if (p < 1) allDone = false;
      }
      if (allDone) introStart = -1;
    }

    // Update time uniform for rim animation
    for (let i = 0; i < N; i++) {
      meshes[i].material.uniforms.time.value = t;
    }

    // Fire onFocus when snapped to a new poster
    const focusIdx = Math.round(rotation);
    if (!snapping && !dragging && focusIdx !== lastFocusIdx && Math.abs(rotation - focusIdx) < 0.05) {
      lastFocusIdx = focusIdx;
      if (focusIdx >= 0 && focusIdx < N) {
        // Reflective shimmer on the newly-focused poster: snapPulseStart drives a
        // time-based sweep over SHIMMER_DURATION (~700ms) with easeInOutCubic.
        if (meshes[focusIdx]) {
          meshes[focusIdx].mesh.userData.snapPulseStart = t;
        }
        onFocus(focusIdx, posters[focusIdx]);
        updateTextureLoading();
      }
    }

    // Drive snapPulse uniform from per-mesh start time — 700ms eased sweep so it
    // reads as light sliding across glossy stock, not a flash (Axel #15423).
    const SHIMMER_DURATION = 0.7;
    for (let i = 0; i < N; i++) {
      const start = meshes[i].mesh.userData.snapPulseStart;
      const u = meshes[i].material.uniforms.snapPulse;
      if (start === undefined) { u.value = 0; continue; }
      const elapsed = t - start;
      if (elapsed > SHIMMER_DURATION) {
        u.value = 0;
        meshes[i].mesh.userData.snapPulseStart = undefined;
        continue;
      }
      // Progress 0→1. Map to snapPulse so that shader's sweepPos = (1 - snapPulse)
      // goes from 0→1 over the duration. easeInOutCubic for elegant slide.
      const p = elapsed / SHIMMER_DURATION;
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      u.value = 1.0 - eased;
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
