# Re-bakes the CC-BY amvlab airliner GLBs so every model has nose +Z, up +Y, metres, centred (root node matrix only; geometry untouched).
import struct, json, sys, numpy as np
TARGET = {'A320': 37.6, 'B737': 39.5, 'B787': 57.0, 'A350': 66.8, 'A380': 72.7}
def quat(q):
    x, y, z, w = q; return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
for name, L in TARGET.items():
    p = f'assets/models/{name}.glb'; d = open(p, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20+jl]); rest = d[20+jl:]
    node = j['nodes'][0]; assert 'children' not in node and len(j['nodes']) == 1, name
    acc = j['accessors'][j['meshes'][0]['primitives'][0]['attributes']['POSITION']]; bv = j['bufferViews'][acc['bufferView']]
    binstart = 8; off = binstart + bv.get('byteOffset', 0) + acc.get('byteOffset', 0); ct = acc['componentType']; n = acc['count']
    assert ct == 5126, (name, ct)
    P = np.frombuffer(rest, dtype='<f4', count=n*3, offset=off).reshape(n, 3).astype(np.float64)
    if 'matrix' in node: M = np.array(node['matrix']).reshape(4, 4).T; A = M[:3, :3]; T = M[:3, 3]
    else:
        A = quat(node.get('rotation', [0, 0, 0, 1])) @ np.diag(node.get('scale', [1, 1, 1])); T = np.array(node.get('translation', [0, 0, 0]))
    W = P @ A.T + T; ext = W.max(0) - W.min(0)
    vert = int(np.argmin(ext)); lon = [a for a in range(3) if a != vert][int(np.argmax([ext[a] for a in range(3) if a != vert]))]
    # wingspan vs length: the longer horizontal axis could be span; the fuselage is the axis whose extent at vertex density is ... use the fin: highest vertical vertex lies aft
    cand = [a for a in range(3) if a != vert]
    best = None
    for L_ax in cand:
        s_ax = [a for a in cand if a != L_ax][0]
        # fuselage axis has the tall fin at one end: top 0.5% vertices (by vertical) should cluster at the far end of L_ax with ~0 spread in s_ax
        up_sign = 1 if W[:, vert].max() - np.median(W[:, vert]) > np.median(W[:, vert]) - W[:, vert].min() else -1
        top = W[np.argsort(-up_sign * W[:, vert])[:max(20, n // 200)]]
        spread_s = top[:, s_ax].std(); spread_l = top[:, L_ax].std(); score = spread_s / (spread_l + 1e-9)
        if best is None or score < best[0]: best = (score, L_ax, s_ax, up_sign, top[:, L_ax].mean() - np.median(W[:, L_ax]))
    _, L_ax, s_ax, up_sign, finpos = best; nose_sign = -1 if finpos > 0 else 1
    up = np.zeros(3); up[vert] = up_sign; nose = np.zeros(3); nose[L_ax] = nose_sign; right = np.cross(up, nose)
    R = np.stack([right, up, nose])  # rows
    W2 = W @ R.T; mn, mx = W2.min(0), W2.max(0); s = L / (mx[2] - mn[2]); ctr = (mn + mx) / 2; ctr[1] = mn[1]
    Mnew = np.eye(4); Mnew[:3, :3] = s * (R @ A); Mnew[:3, 3] = s * (R @ T - ctr)
    node.pop('rotation', None); node.pop('scale', None); node.pop('translation', None); node['matrix'] = [float(x) for x in Mnew.T.flatten()]
    # fix accessor bounds untouched (local space). write
    js = json.dumps(j, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    out = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<I', len(js)) + b'JSON' + js + rest
    open(p, 'wb').write(out); print(name, 'vert axis', vert, 'long axis', L_ax, 'up', up_sign, 'nose', nose_sign, 'len->', L, 'span', round((mx[0]-mn[0])*s, 1), 'height', round((mx[1]-mn[1])*s, 1))
