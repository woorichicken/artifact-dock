#!/usr/bin/env bash
# Artifact Dock 설치 — 네이티브 메시징 호스트 등록 + CLI 링크
#
#   ./install.sh            설치
#   ./install.sh --cli-only  호스트/확장 설정을 유지하고 CLI만 설치
#   ./install.sh --uninstall 제거
#
# 확장 프로그램 자체는 chrome://extensions 에서 "압축해제된 확장 프로그램 로드"로 한 번 올려야 한다.
# (manifest 에 고정 key 가 들어 있어서 몇 번을 다시 올려도 ID 는 그대로다)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="dev.artifactdock.host"
# 확장 ID 는 설치 경로마다 다르다(압축해제 로드 = manifest key 로 고정 / 웹스토어 = 스토어가 부여).
# host/.extension-id 에 한 줄에 하나씩 두고 전부 허용한다.
ALLOWED_ORIGINS=""
while IFS= read -r id || [ -n "$id" ]; do
  id="${id%%#*}"; id="$(echo "$id" | tr -d '[:space:]')"
  [ -n "$id" ] || continue
  ALLOWED_ORIGINS="${ALLOWED_ORIGINS:+$ALLOWED_ORIGINS, }\"chrome-extension://$id/\""
done < "$ROOT/host/.extension-id"
BIN_DIR="${ARTIFACT_DOCK_BIN:-$HOME/.local/bin}"

# 두 CLI는 함께 설치한다. 사용자가 둔 다른 실행 파일을 덮어쓰지 않는다.
install_cli() {
  mkdir -p "$BIN_DIR"
  for name in artifact-open open; do
    target="$BIN_DIR/$name"
    if [ -e "$target" ] || [ -L "$target" ]; then
      if [ ! -L "$target" ] || [ "$(readlink "$target")" != "$ROOT/bin/$name" ]; then
        echo "설치 중단: 기존 파일을 보존했습니다: $target" >&2
        return 1
      fi
    fi
  done
  for name in artifact-open open; do
    chmod +x "$ROOT/bin/$name"
    ln -sfn "$ROOT/bin/$name" "$BIN_DIR/$name"
    echo "링크: $BIN_DIR/$name"
  done
}

if [ "${1:-}" = "--cli-only" ]; then
  install_cli
  exit 0
fi

# 크로미움 계열별 NativeMessagingHosts 위치. 설치된 것만 처리한다.
TARGET_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
)

if [ "${1:-}" = "--uninstall" ]; then
  for d in "${TARGET_DIRS[@]}"; do
    rm -f "$d/$HOST_NAME.json" 2>/dev/null && echo "제거: $d/$HOST_NAME.json" || true
  done
  for name in artifact-open open; do
    target="$BIN_DIR/$name"
    if [ -L "$target" ] && [ "$(readlink "$target")" = "$ROOT/bin/$name" ]; then
      rm "$target"
      echo "제거: $target"
    fi
  done
  rm -f "$HOME/Library/Application Support/ArtifactDock/dock.sock" 2>/dev/null || true
  echo "완료. 확장은 chrome://extensions 에서 직접 삭제하세요."
  exit 0
fi

# python3 없으면 호스트가 안 돈다. 먼저 막는다.
command -v python3 >/dev/null || { echo "python3 가 필요합니다 (xcode-select --install)"; exit 1; }

installed=0
for d in "${TARGET_DIRS[@]}"; do
  parent="$(dirname "$d")"
  [ -d "$parent" ] || continue   # 그 브라우저가 설치돼 있지 않음
  mkdir -p "$d"
  cat > "$d/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Artifact Dock native host",
  "path": "$ROOT/host/artifact_dock_host.py",
  "type": "stdio",
  "allowed_origins": [$ALLOWED_ORIGINS]
}
JSON
  echo "등록: $d/$HOST_NAME.json"
  installed=$((installed + 1))
done

[ "$installed" -gt 0 ] || { echo "크로미움 계열 브라우저를 찾지 못했습니다"; exit 1; }

chmod +x "$ROOT/host/artifact_dock_host.py"
install_cli

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo; echo "⚠  PATH 에 $BIN_DIR 가 없습니다. 셸 설정에 추가하세요:";
     echo "   echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;;
esac

cat <<TXT

다음 단계
  1. chrome://extensions 열기 → 우측 상단 [개발자 모드] 켜기
  2. [압축해제된 확장 프로그램을 로드] → $ROOT 선택
  3. 확장 ID 가 host/.extension-id 목록에 있는지 확인
  4. 터미널에서:  artifact-open --status
     "살아있음"이 나오면 끝. 안 나오면 확장을 껐다 켜세요(호스트를 그때 실행합니다).
TXT
