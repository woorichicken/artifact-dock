#!/usr/bin/env bash
# Chrome 웹스토어 업로드용 zip 을 만든다.
#
# 왜 따로 만드나:
#  - manifest 의 "key" 는 압축해제 로드에서 ID 를 고정하려고 넣은 것이다. 웹스토어는 ID 를 스스로
#    부여하므로 key 가 든 manifest 는 업로드에서 거부된다 → zip 안에서만 제거한다.
#  - CLI·네이티브 호스트·테스트는 확장 패키지에 필요 없다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUT_DIR="$ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R manifest.json src icons "$STAGE/"
python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest.pop("key", None)
json.dump(manifest, open(path, "w"), ensure_ascii=False, indent=2)
PY
find "$STAGE" -name .DS_Store -delete

mkdir -p "$OUT_DIR"
ZIP="$OUT_DIR/artifact-dock-$VERSION.zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -qr "$ZIP" .)
echo "$ZIP"
