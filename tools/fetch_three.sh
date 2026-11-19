#!/usr/bin/env sh
# Local copies of the CDN libraries for the offline test harness (the pages themselves load them from jsDelivr):
#   three r160 -> vendor/package; the path tracer, its BVH library and MapLibre GL JS -> vendor/<name>@<version>/package
#   geojson-vt + vt-pbf -> vendor/tiletools (tools/make_sg_tiles.mjs builds the Singapore map's fixture tiles with them)
set -e
cd "$(dirname "$0")/.." && mkdir -p vendor && cd vendor
npm pack three@0.160.0 --silent && tar xzf three-0.160.0.tgz && rm three-0.160.0.tgz
for spec in three-mesh-bvh@0.7.8 three-gpu-pathtracer@0.0.23 maplibre-gl@5.24.1; do
  name=${spec%@*}; ver=${spec#*@}
  mkdir -p "$spec" && npm pack "$spec" --silent && tar xzf "$name-$ver.tgz" -C "$spec" && rm "$name-$ver.tgz"
done
mkdir -p tiletools && (cd tiletools && [ -f package.json ] || npm init -y >/dev/null) && (cd tiletools && npm install --silent geojson-vt@4.0.3 vt-pbf@3)
echo "three r160 -> vendor/package; three-mesh-bvh, three-gpu-pathtracer, maplibre-gl -> vendor/<name>@<version>/package; tile tools -> vendor/tiletools"
