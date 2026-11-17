#!/usr/bin/env sh
# Local copy of three.js r160 for the offline test harness (the app itself loads it from jsDelivr).
set -e
cd "$(dirname "$0")/.." && mkdir -p vendor && cd vendor
npm pack three@0.160.0 --silent && tar xzf three-0.160.0.tgz && rm three-0.160.0.tgz
echo "three r160 -> vendor/package"
