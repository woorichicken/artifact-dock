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
