/* ============================================================================================
   Sun & sky: a glowing 3D sun over the view and a sky that follows the time of day.
   The real sun is ~150 million km away, so — like the sun path — it is drawn on a dome over what
   you are looking at (420 m over the estate; in the area view sized to the view, up to 2.9 km),
   in its true direction for the chosen date and time. Shadows always point away from it.
   The sky: blue by day, warm towards the sun around sunrise/sunset, dark blue at night; the fog
   takes the horizon colour so the distance fades into it.
   ============================================================================================ */
var SKY3D = null; // built on first use (`var`: updateSun may run before this file has)
const SKY_DEFAULT = new THREE.Color('#E3E9EE');

/** the dome the sun path and the 3D sun share: centre, radius (m), and scale vs the estate dome */
function sunDome() {
  const f = sunFrame.half ? sunFrame : sunFrameFor();
  const R = f.area ? Math.min(2900, Math.max(420, f.half * 1.15)) : 420;
  return { c: new THREE.Vector3(f.x, 0, f.z), R, k: R / 420 };
}

/* sky colours by sun elevation (deg): zenith, horizon, warm glow towards the sun, glow amount */
const SKY_KEYS = [
  { el: -18, zen: '#070D18', hor: '#141D2E', warm: '#141D2E', amt: 0 },
  { el: -9, zen: '#0E1830', hor: '#2B3754', warm: '#5B4A63', amt: 0.35 },
  { el: -3, zen: '#2E4468', hor: '#9E8E9A', warm: '#E8946A', amt: 0.85 },
  { el: 2, zen: '#5F83B0', hor: '#E2CDB8', warm: '#F4B27A', amt: 0.8 },
  { el: 8, zen: '#7FA4CC', hor: '#E8E2D6', warm: '#F6CF9C', amt: 0.4 },
  { el: 16, zen: '#8AB1D8', hor: '#E4EAEF', warm: '#F3E2C2', amt: 0.1 },
  { el: 90, zen: '#8DB4DA', hor: '#E3E9EE', warm: '#E3E9EE', amt: 0 },
].map((k) => ({ ...k, zen: new THREE.Color(k.zen), hor: new THREE.Color(k.hor), warm: new THREE.Color(k.warm) }));
function skyAt(el) {
  let i = 0; while (i < SKY_KEYS.length - 2 && el > SKY_KEYS[i + 1].el) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1], t = clamp((el - a.el) / (b.el - a.el), 0, 1);
  return {
    zen: a.zen.clone().lerp(b.zen, t), hor: a.hor.clone().lerp(b.hor, t), warm: a.warm.clone().lerp(b.warm, t),
    amt: a.amt + (b.amt - a.amt) * t,
  };
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.14)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function buildSky3D() {
  G.sky = new THREE.Group(); G.sky.name = 'sky'; scene.add(G.sky);
  const uni = {
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uWarm: { value: new THREE.Color() }, uAmt: { value: 0 }, uGround: { value: new THREE.Color() },
  };
  // drawn at infinity (direction only) behind everything: no parallax, never in front of the model
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    uniforms: uni, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: `varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * vec4((viewMatrix * vec4(position, 0.0)).xyz, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }`,
    fragmentShader: `uniform vec3 uSun, uZen, uHor, uWarm, uGround; uniform float uAmt; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir); float h = d.y; vec3 col;
        if (h >= 0.0) col = mix(uHor, uZen, pow(h, 0.45));
        else col = mix(uHor, uGround, smoothstep(0.0, 0.3, -h));
        // broad warm glow towards the sun's side, strongest low down (sunrise / sunset)
        vec2 s = normalize(uSun.xz + vec2(1e-5)), q = normalize(d.xz + vec2(1e-5));
        float w = uAmt * pow(0.5 + 0.5 * dot(s, q), 3.0) * exp(-max(h, 0.0) * 4.0);
        col = mix(col, uWarm, clamp(w, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  dome.name = 'skyDome'; dome.frustumCulled = false; dome.renderOrder = -1000;
  G.sky.add(dome);
  // the sun: bright core + halo + faint corona; buildings in front hide it
  const tex = glowTexture();
  const sunG = new THREE.Group(); sunG.name = 'sun3d';
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: '#FFF7DE', fog: false, toneMapped: false }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#FFE3A0', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#FFD27A', opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  halo.renderOrder = corona.renderOrder = 10;
  sunG.add(corona, halo, core);
  G.sky.add(sunG);
  SKY3D = { dome, uni, sunG, core, halo, corona };
}

const _skyDir = new THREE.Vector3();
/** call after the sun moved (updateSun) or the layer changed */
function updateSky() {
  if (!SKY3D) buildSky3D();
  const on = !!state.settings.layers.sky, p = lastSun;
  G.sky.visible = on;
  if (!on || !p) { scene.background = SKY_DEFAULT; scene.fog.color.copy(SKY_DEFAULT); return; }
  sunDir(p.az, p.el, _skyDir);
  const s = skyAt(p.el), u = SKY3D.uni;
  u.uSun.value.copy(_skyDir); u.uZen.value.copy(s.zen); u.uHor.value.copy(s.hor); u.uWarm.value.copy(s.warm); u.uAmt.value = s.amt;
  u.uGround.value.copy(s.hor).multiplyScalar(0.72);
  scene.background = s.hor; scene.fog.color.copy(s.hor);
  // the 3D sun on the dome (above the horizon only); low sun turns orange
  const show = p.el > -0.9;
  SKY3D.sunG.visible = show;
  if (show) {
    const d = sunDome(), r = d.R * 0.035, low = 1 - clamp(p.el / 18, 0, 1);
    SKY3D.sunG.position.copy(_skyDir).multiplyScalar(d.R).add(d.c);
    SKY3D.core.scale.setScalar(r);
    SKY3D.halo.scale.setScalar(r * 7); SKY3D.corona.scale.setScalar(r * 20);
    SKY3D.core.material.color.set('#FFF7DE').lerp(new THREE.Color('#FFB46A'), low);
    SKY3D.halo.material.color.set('#FFE3A0').lerp(new THREE.Color('#FF9F55'), low);
    SKY3D.corona.material.color.set('#FFD27A').lerp(new THREE.Color('#FF8A4A'), low);
  }
  requestRender();
}
