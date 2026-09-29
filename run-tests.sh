#!/usr/bin/env bash
# 확장을 로드하지 않고도 확인할 수 있는 것만 돌린다.
#  - dedup 키 규칙 (순수 함수)
#  - CLI → 네이티브 호스트 브릿지 (호스트를 Chrome 인 척 띄워서)
set -e
cd "$(dirname "$0")"
echo "── dedup 키 규칙"; node tests/keys.test.mjs
echo; echo "── CLI ↔ 네이티브 호스트"; python3 tests/host.test.py
echo; echo "── HTML 직접 열기 차단"; python3 tests/open_guard.test.py
echo; echo "전부 통과"
