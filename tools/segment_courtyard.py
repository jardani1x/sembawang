import json, sys, numpy as np
from PIL import Image
import cv2
im = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
# light-grey "service" fill from the legend: (191,189,190)
tgt = np.array([int(v) for v in sys.argv[4].split(",")])
d = np.abs(im - tgt).sum(axis=2)
mask = (d < int(sys.argv[5])).astype(np.uint8)
# restrict to the estate west part (Blk 436 courtyard / 437B service L), px box
box = np.zeros_like(mask); box[250:350, 225:420] = 1
mask = mask * box
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
n, lab, stats, cen = cv2.connectedComponentsWithStats(mask, 8)
K = 0.708; ox, oy = 221.7, 422.4
out = []
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] < 60: continue
    m = (lab == i).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea)
    ap = cv2.approxPolyDP(c, 1.2, True)[:, 0, :]
    poly = [[round((x - ox) * K, 1), round((y - oy) * K, 1)] for x, y in ap]
    out.append({'areaPx': int(stats[i, cv2.CC_STAT_AREA]), 'area_m2': round(stats[i, cv2.CC_STAT_AREA] * K * K), 'bboxPx': stats[i, :4].tolist(), 'poly': poly})
    print(i, stats[i].tolist(), len(poly))
json.dump(out, open(sys.argv[2], 'w'))
vis = (np.array(Image.open(sys.argv[1]).convert('RGB'))).copy()
for o in out:
    pts = np.array([[x / K + ox, y / K + oy] for x, y in o['poly']], np.int32)
    cv2.polylines(vis, [pts], True, (255, 0, 0), 1)
Image.fromarray(vis[230:370, 200:440]).resize((960, 560), Image.NEAREST).save(sys.argv[3])
