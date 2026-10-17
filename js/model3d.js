// Procedural 3D aircraft (for the selected / chased / replayed aircraft): fuselage, swept wings, T-tail, engines. No external assets.
const Cesium = window.Cesium;
let proto;
function quad(pts) {
  const v = new Float64Array(pts.length * 3); pts.forEach((p, i) => { v[i * 3] = p.x; v[i * 3 + 1] = p.y; v[i * 3 + 2] = p.z; });
  return new Cesium.Geometry({ attributes: { position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: v }) },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(v) });
}
function inst(geom, m, color) { return new Cesium.GeometryInstance({ geometry: geom, modelMatrix: m, attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color) } }); }
export function buildAircraft(scene, color = Cesium.Color.WHITE) {
  const T = Cesium.Matrix4.fromTranslation, S = Cesium.Matrix4.fromScale, M = Cesium.Matrix4, Cart = Cesium.Cartesian3;
  const rotX = a => M.fromRotationTranslation(Cesium.Matrix3.fromRotationX(a)), rotZ = a => M.fromRotationTranslation(Cesium.Matrix3.fromRotationZ(a));
  const mul = (...ms) => ms.reduce((a, b) => M.multiply(a, b, new M()));
  const navy = Cesium.Color.fromCssColorString('#1c3d7a'), dark = Cesium.Color.fromCssColorString('#222a33');
  const inst_ = [];
  // aircraft nose points +Y (north at heading 0), up +Z, right wing +X(east)
  inst_.push(inst(new Cesium.EllipsoidGeometry({ radii: new Cart(1.15, 7.2, 1.2), vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT, stackPartitions: 18, slicePartitions: 18 }), T(new Cart(0, 0, 0)), color));
  for (const s of [-1, 1]) {
    inst_.push(inst(quad([new Cart(s * 0.8, 1.6, 0), new Cart(s * 8.2, -1.0, 0.45), new Cart(s * 8.2, -2.3, 0.45), new Cart(s * 0.8, -1.7, 0)]), M.IDENTITY, color));
    inst_.push(inst(quad([new Cart(s * 0.3, -6.2, 2.2), new Cart(s * 3.4, -7.9, 2.9), new Cart(s * 3.4, -8.8, 2.9), new Cart(s * 0.3, -8.2, 2.2)]), M.IDENTITY, color));
    inst_.push(inst(new Cesium.EllipsoidGeometry({ radii: new Cart(0.42, 1.9, 0.42), vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT, stackPartitions: 10, slicePartitions: 10 }), T(new Cart(s * 1.6, -4.4, 0.8)), dark));
  }
  inst_.push(inst(quad([new Cart(0.12, -4.8, 1.0), new Cart(0.12, -8.6, 3.9), new Cart(0.12, -9.4, 3.9), new Cart(0.12, -7.4, 1.0)]), M.IDENTITY, navy));
  inst_.push(inst(quad([new Cart(-0.12, -4.8, 1.0), new Cart(-0.12, -8.6, 3.9), new Cart(-0.12, -9.4, 3.9), new Cart(-0.12, -7.4, 1.0)]), M.IDENTITY, navy));
  inst_.push(inst(new Cesium.EllipsoidGeometry({ radii: new Cart(0.45, 1.3, 0.35), vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT, stackPartitions: 8, slicePartitions: 8 }), T(new Cart(0, 5.4, 0.5)), dark));
  const prim = scene.primitives.add(new Cesium.Primitive({ geometryInstances: inst_, appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false, closed: false, faceForward: true }), asynchronous: false, allowPicking: false }));
  prim.show = false; return prim;
}
const scratchENU = new Cesium.Matrix4();
export function placeAircraft(prim, lon, lat, hMeters, headingDeg, pitchDeg, scale) {
  const p = Cesium.Cartesian3.fromDegrees(lon, lat, hMeters); Cesium.Transforms.eastNorthUpToFixedFrame(p, undefined, scratchENU);
  const r = Cesium.Matrix3.multiply(Cesium.Matrix3.fromRotationZ(-Cesium.Math.toRadians(headingDeg)), Cesium.Matrix3.fromRotationX(Cesium.Math.toRadians(pitchDeg)), new Cesium.Matrix3());
  const local = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.multiplyByScale(r, new Cesium.Cartesian3(scale, scale, scale), new Cesium.Matrix3()));
  Cesium.Matrix4.multiply(scratchENU, local, prim.modelMatrix); prim.show = true; return p;
}
