// Free, token-less terrain: AWS Open Data "Terrain Tiles" (Terrarium PNG, Web-Mercator XYZ) decoded into Cesium heightmaps.
const C = () => window.Cesium;
export function makeTerrariumProvider(maxLevel = 12) {
  const Cesium = C(), N = 65;
  class Terrarium {
    constructor() {
      this.tilingScheme = new Cesium.WebMercatorTilingScheme(); this.errorEvent = new Cesium.Event(); this.hasWaterMask = false; this.hasVertexNormals = false;
      this.credit = new Cesium.Credit('Terrain: Mapzen/AWS Terrain Tiles (SRTM, USGS 3DEP, GMTED)'); this.availability = undefined; this.ready = true; this.readyPromise = Promise.resolve(true);
      this._err0 = Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(this.tilingScheme.ellipsoid, N, 1);
      this._cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      this._cx = this._cv.getContext('2d', { willReadFrequently: true });
    }
    getLevelMaximumGeometricError(l) { return this._err0 / (1 << l); }
    getTileDataAvailable(x, y, l) { return l <= maxLevel; }
    loadTileDataAvailability() { return undefined; }
    requestTileGeometry(x, y, level, request) {
      if (level > maxLevel) return Promise.reject(new Error('lvl'));
      const res = new Cesium.Resource({ url: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${level}/${x}/${y}.png`, request });
      const p = res.fetchImage({ preferImageBitmap: true }); if (!p) return undefined;
      return p.then(img => {
        this._cx.clearRect(0, 0, 256, 256); this._cx.drawImage(img, 0, 0, 256, 256); const d = this._cx.getImageData(0, 0, 256, 256).data;
        const H = (i, j) => { const o = (j * 256 + i) * 4; return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768; };
        const buf = new Float32Array(N * N);
        for (let j = 0; j < N; j++) { const fy = j / (N - 1) * 255, y0 = Math.min(254, fy | 0), ty = fy - y0;
          for (let i = 0; i < N; i++) { const fx = i / (N - 1) * 255, x0 = Math.min(254, fx | 0), tx = fx - x0;
            buf[j * N + i] = (H(x0, y0) * (1 - tx) + H(x0 + 1, y0) * tx) * (1 - ty) + (H(x0, y0 + 1) * (1 - tx) + H(x0 + 1, y0 + 1) * tx) * ty; } }
        return new Cesium.HeightmapTerrainData({ buffer: buf, width: N, height: N, childTileMask: level < maxLevel ? 15 : 0, structure: { heightScale: 1, heightOffset: 0, elementsPerHeight: 1, stride: 1, elementMultiplier: 256, isBigEndian: false } });
      });
    }
  }
  return new Terrarium();
}
