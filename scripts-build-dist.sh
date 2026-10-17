#!/bin/sh
# Copies only the public app files into ./dist (what Workers Static Assets uploads).
set -e; cd "$(dirname "$0")"; rm -rf dist; mkdir dist
cp -r index.html manifest.webmanifest sw.js css js icons dist/
echo "dist ready: $(find dist -type f | wc -l) files"
