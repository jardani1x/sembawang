#!/usr/bin/env sh
# Local copies of the CDN libraries for the offline test harness (the app itself loads them from jsDelivr):
#   three r160 -> vendor/package; the path tracer and its BVH library -> vendor/<name>@<version>/package
set -e
cd "$(dirname "$0")/.." && mkdir -p vendor && cd vendor
npm pack three@0.160.0 --silent && tar xzf three-0.160.0.tgz && rm three-0.160.0.tgz
for spec in three-mesh-bvh@0.7.8 three-gpu-pathtracer@0.0.23; do
  name=${spec%@*}; ver=${spec#*@}
  mkdir -p "$spec" && npm pack "$spec" --silent && tar xzf "$name-$ver.tgz" -C "$spec" && rm "$name-$ver.tgz"
done
echo "three r160 -> vendor/package; three-mesh-bvh, three-gpu-pathtracer -> vendor/<name>@<version>/package"
