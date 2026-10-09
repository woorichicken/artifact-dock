# Backlog

다른 작업을 하다 발견했지만 그 범위가 아니어서 미룬 것. 로드맵이나 희망 목록이 아니다 —
이 저장소에서 실제로 관측했고, 근거와 다시 볼 조건(트리거)이 있는 것만 둔다.
고치는 변경에서 해당 항목을 지운다(기록은 git 이력이 맡는다).

## Open

### `src/sidepanel.css` — `.host-status` 의 `display:block` 이 `hidden` 속성을 덮어씀
- Discovered: 2026-10-09, 0.5.0 사이드바 목록 개선(PR #1) 작업 중
- Why deferred: 피드백 범위 밖이고, 보이는 영향이 사이드바를 연 직후 잠깐(연결 상태 응답 전, 최대 약 0.8초)뿐이다
- Trigger: 사이드바 상단(검색 바·연결 상태 줄) 레이아웃을 다음에 손댈 때
- Evidence: `src/sidepanel.html:16` 이 `<button id="hostStatus" class="host-status" hidden>` 로 시작하는데
  `src/sidepanel.css:177-178` 의 `.host-status { display: block; }` 이 작성자 스타일이라 브라우저 기본
  `[hidden] { display: none }` 보다 우선한다 → 연결 상태를 받기 전에도 빈 줄(아래 테두리 + 여백)이 보인다.
  `hidden` 을 지우는 쪽은 `src/sidepanel.js` 의 `setHostStatus()` 하나뿐이다.

### `install.sh` — 호스트를 저장소 안 스크립트(`$ROOT/host/…`)로 등록해서, 저장소가 `~/Downloads` 아래면 브라우저가 실행하지 못할 수 있음
- Discovered: 2026-10-09, 0.5.0 before/after 캡처 중 (Chrome for Testing 헤드리스에 확장을 로드했을 때)
- Why deferred: 사이드바·웹스토어 스크립트 작업 범위 밖이다. 원인이 macOS 폴더 접근 권한이라는 건 추정이고,
  설치 경로를 바꾸면 업데이트 흐름(지금은 `git pull` 만으로 호스트가 갱신된다)이 달라져 설계 결정이 필요하다
- Trigger: 「CLI 미연결」·`artifact-open --status` 끊김인데 호스트 프로세스가 안 뜬다는 제보가 오거나, `install.sh` 를 다음에 손댈 때
- Evidence:
  - `install.sh:86` 이 `"path": "$ROOT/host/artifact_dock_host.py"` 로 등록한다. README 설치 안내대로 clone 하면 대개 `~/Downloads/…` 다.
  - 호스트 스크립트를 `~/Downloads/…` 에 둔 채 Chrome for Testing 이 실행하자 `host:ready` 가 오지 않았다 —
    확장 페이지의 `connectNative()` 가 3초 동안 메시지도 끊김도 받지 못했고, 래퍼가 연 stderr 파일은 비어 있었다
    (소켓 경로를 104자 아래로 줄인 뒤에도 같았다). 같은 스크립트를 `/private/tmp` 로 복사해 등록하자 바로 연결됐다.
  - 한 개발 맥은 등록 json 이 `~/.local/lib/artifact-dock/artifact_dock_host.py` 사본을 가리킨다. 현재·이전 `install.sh`
    어느 쪽도 그 경로를 만들지 않는다 — 손으로 옮긴 배치다(2026-10-09 호스트를 0.5.0 으로 갱신하면서 확인).
- 할 일 후보: `install.sh` 에 호스트를 `~/.local/lib/artifact-dock/` 로 복사해 등록하는 옵션(예: `--copy-host`).
  복사본은 `git pull` 로 바뀌지 않으므로, 업데이트 때 다시 복사하는 절차와 버전 확인(`host:ready` 의 `caps`)을 함께 정한다.
