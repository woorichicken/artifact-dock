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

cp -R manifest.json src icons _locales "$STAGE/"
python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
manifest = json.load(open(path))
manifest.pop("key", None)
json.dump(manifest, open(path, "w"), ensure_ascii=False, indent=2)
PY
find "$STAGE" -name .DS_Store -delete

# manifest 가 가리키는 파일이 zip 에 다 들어갔는지 확인한다. 빠지면 스토어에서 로드 자체가 실패하는데
# 로컬(압축해제 로드)은 저장소 전체를 보므로 멀쩡해서 알아채지 못한다.
python3 - "$STAGE" <<'PY'
import json, os, re, sys
stage = sys.argv[1]
m = json.load(open(os.path.join(stage, "manifest.json")))
need = [m["background"]["service_worker"], m["side_panel"]["default_path"], m["options_page"],
        *m["icons"].values(), *m["action"]["default_icon"].values()]
if "default_locale" in m:
    need.append(f"_locales/{m['default_locale']}/messages.json")
missing = [p for p in need if not os.path.exists(os.path.join(stage, p))]
if missing:
    sys.exit(f"zip 에 빠진 파일: {missing}")
if "default_locale" in m:
    msgs = json.load(open(os.path.join(stage, "_locales", m["default_locale"], "messages.json")))
    for key in re.findall(r"__MSG_([A-Za-z0-9_]+)__", json.dumps(m)):
        if key not in msgs:
            sys.exit(f"manifest 가 쓰는 번역 키 없음: {key}")
PY

mkdir -p "$OUT_DIR"
ZIP="$OUT_DIR/artifact-dock-$VERSION.zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -qr "$ZIP" .)
echo "$ZIP"
