import { state, save } from './store.js';
import { makeTerrariumProvider } from './terrain.js';
import { clamp, toast } from './util.js';
const Cesium = window.Cesium;
export const BASEMAPS = {
  esri: { name: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 18, credit: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, credit: '© OpenStreetMap contributors' },
  dark: { name: 'Carto Dark (OSM)', url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', max: 19, credit: '© OpenStreetMap contributors © CARTO' },
  light: { name: 'Carto Light (OSM)', url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', max: 19, credit: '© OpenStreetMap contributors © CARTO' },
};
export let viewer, scene, camera;
let baseLayer, terrainOn = false;
const MOB = () => document.body.classList.contains('mobile');
export function createViewer(container, creditEl) {
  viewer = new Cesium.Viewer(container, { baseLayer: false, terrainProvider: new Cesium.EllipsoidTerrainProvider(), animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false, scene3DOnly: true, creditContainer: creditEl, shouldAnimate: true, useBrowserRecommendedResolution: true,
    contextOptions: { webgl: { powerPreference: 'high-performance', preserveDrawingBuffer: true } } });
  scene = viewer.scene; camera = viewer.camera;
  scene.globe.depthTestAgainstTerrain = true; scene.globe.maximumScreenSpaceError = 2.2; scene.globe.tileCacheSize = 300; scene.globe.showGroundAtmosphere = true;
  scene.highDynamicRange = false; scene.fog.enabled = true; scene.fog.density = 2.0e-4; scene.skyAtmosphere.show = true; scene.msaaSamples = 1; scene.postProcessStages.fxaa.enabled = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 30; scene.screenSpaceCameraController.enableCollisionDetection = true;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  if (MOB()) {   // lighter rendering on phones
    const dpr = window.devicePixelRatio || 1; viewer.useBrowserRecommendedResolution = false; viewer.resolutionScale = dpr >= 3 ? 0.75 : dpr >= 2 ? 0.9 : 1;
    scene.globe.maximumScreenSpaceError = 3.4; scene.globe.tileCacheSize = 90; scene.postProcessStages.fxaa.enabled = false; scene.globe.showGroundAtmosphere = false; scene.fog.enabled = false; scene.highDynamicRange = false;
    Cesium.RequestScheduler.maximumRequestsPerServer = 4; Cesium.RequestScheduler.maximumRequests = 24;
    scene.requestRenderMode = true; scene.maximumRenderTimeChange = 0.2;   // idle frames are skipped; aircraft still tick at >= 5 Hz, camera motion renders every frame
  }
  scene.screenSpaceCameraController.inertiaSpin = 0.85; scene.screenSpaceCameraController.inertiaZoom = 0.7;
  setBasemap(state.settings.basemap); setTerrain(state.settings.terrain); setExag(state.settings.exag); applyTheme();
  return viewer;
}
export function setBasemap(key) {
  const b = BASEMAPS[key] || BASEMAPS.esri; state.settings.basemap = key; save('settings');
  if (baseLayer) viewer.imageryLayers.remove(baseLayer, true);
  baseLayer = viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: b.url, maximumLevel: b.max, credit: b.credit }), 0);
  baseLayer.brightness = key === 'esri' ? 1.0 : 1.0;
}
export function setTerrain(on) {
  state.settings.terrain = on; save('settings');
  if (on) { try { viewer.terrainProvider = makeTerrariumProvider(MOB() ? 11 : 12); terrainOn = true; } catch (e) { console.warn(e); toast('Terrain unavailable — using flat ellipsoid', 'warn'); viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider(); terrainOn = false; } }
  else { viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider(); terrainOn = false; }
}
export const exag = () => state.settings.exag || 1;
export function setExag(k) { state.settings.exag = k; save('settings'); scene.verticalExaggeration = k; scene.verticalExaggerationRelativeHeight = 0; }
export function applyTheme() {
  const dark = state.settings.theme === 'dark'; document.documentElement.dataset.theme = state.settings.theme;
  scene.backgroundColor = Cesium.Color.fromCssColorString(dark ? '#000000' : '#dfe6ee'); scene.skyAtmosphere.show = true; scene.globe.baseColor = Cesium.Color.fromCssColorString(dark ? '#05070b' : '#9fb0c4');
  if (baseLayer && state.settings.basemap === 'esri') { baseLayer.brightness = dark ? 0.92 : 1.05; }
}
export function flyTo(lat, lon, height = 150000, { heading = 0, pitch = -55, duration = 2 } = {}) {
  const tgt = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
  camera.flyToBoundingSphere(new Cesium.BoundingSphere(tgt, 1), { offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(heading), Cesium.Math.toRadians(pitch), height), duration });
}
export function setView(lat, lon, h, heading = 0, pitch = -90) { camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, h), orientation: { heading: Cesium.Math.toRadians(heading), pitch: Cesium.Math.toRadians(pitch), roll: 0 } }); }
export function cameraInfo() { const c = Cesium.Cartographic.fromCartesian(camera.positionWC); const ctr = viewCenter(); return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), h: c.height, ctr }; }
export function viewCenter() {
  const cv = scene.canvas, p = scene.pickPosition ? null : null; const ray = camera.getPickRay(new Cesium.Cartesian2(cv.clientWidth / 2, cv.clientHeight / 2)); const hit = ray && scene.globe.pick(ray, scene); if (!hit) return null;
  const c = Cesium.Cartographic.fromCartesian(hit); return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) };
}
export function viewRect() { const r = camera.computeViewRectangle(scene.globe.ellipsoid); return r ? { w: Cesium.Math.toDegrees(r.west), s: Cesium.Math.toDegrees(r.south), e: Cesium.Math.toDegrees(r.east), n: Cesium.Math.toDegrees(r.north) } : null; }
// ---- WASD / QE fly controls (mouse + touch use Cesium's built-ins) ----
const keys = new Set();
export function initKeys() {
  addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || e.ctrlKey || e.metaKey) return; const k = e.key.toLowerCase(); if ('wasdqe'.includes(k) && k.length === 1) { keys.add(k); if (e.shiftKey) keys.add('shift'); e.preventDefault(); } });
  addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); if (!e.shiftKey) keys.delete('shift'); });
  addEventListener('blur', () => keys.clear());
  let last = performance.now();
  scene.preRender.addEventListener(() => {
    const n = performance.now(), dt = Math.min(0.1, (n - last) / 1000); last = n; if (!keys.size) return;
    const h = Math.max(30, Cesium.Cartographic.fromCartesian(camera.positionWC).height), v = (h * 0.9 + 100) * dt * (keys.has('shift') ? 4 : 1);
    if (keys.has('w')) camera.moveForward(v); if (keys.has('s')) camera.moveBackward(v); if (keys.has('a')) camera.moveLeft(v); if (keys.has('d')) camera.moveRight(v); if (keys.has('e')) camera.moveUp(v); if (keys.has('q')) camera.moveDown(v);
  });
}
