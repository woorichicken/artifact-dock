#!/usr/bin/env bash
# 왜 artifact-open 이 확장에 못 붙는지 한 번에 본다.
ROOT="$(cd "$(dirname "$0")" && pwd)"
EXT_IDS="$(grep -v '^#' "$ROOT/host/.extension-id" | tr -d ' ' | grep -v '^$' | paste -sd, -)"
HOST_JSON="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.artifactdock.host.json"
SOCK="$HOME/Library/Application Support/ArtifactDock/dock.sock"
ok() { echo "  ✅ $*"; }
ng() { echo "  ❌ $*"; }

echo "1. 네이티브 호스트 등록"
if [ -f "$HOST_JSON" ]; then
  ok "$HOST_JSON"
  echo "     기대 ID: $EXT_IDS"
  echo "     등록 ID: $(python3 -c "import json,sys;print(', '.join(json.load(open(sys.argv[1]))['allowed_origins']))" "$HOST_JSON")"
  p="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['path'])" "$HOST_JSON")"
  [ -x "$p" ] && ok "호스트 실행 가능: $p" || ng "호스트가 실행 불가: $p  → chmod +x"
else
  ng "미등록 → ./install.sh"
fi

echo "2. 호스트 프로세스"
if pgrep -f artifact_dock_host.py >/dev/null; then ok "떠 있음 (Chrome 이 실행함)"; else ng "안 떠 있음 → 확장이 connectNative 에 실패했거나 확장이 꺼져 있음"; fi

echo "3. 소켓"
[ -S "$SOCK" ] && ok "$SOCK" || ng "없음"

echo "4. CLI"
command -v artifact-open >/dev/null && ok "$(command -v artifact-open)" || ng "PATH 에 없음 → ./install.sh"

echo "5. Chrome"
pgrep -x "Google Chrome" >/dev/null && ok "실행 중" || ng "안 켜져 있음"

cat <<TXT

막혔다면 순서대로:
  a) chrome://extensions 에서 Artifact Dock 의 ID 가 $EXT_IDS 중 하나인지 확인
     (다르면 폴더를 지우고 다시 로드하거나, install.sh 를 그 ID 로 다시 실행)
  b) 확장을 껐다 켜기 (또는 ⟳ 새로고침) — 네이티브 호스트는 그때 실행된다
  c) 확장 카드의 [서비스 워커] 를 눌러 콘솔에서 '[ArtifactDock]' 로그 확인
TXT
