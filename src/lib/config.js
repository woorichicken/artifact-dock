// 설정 기본값 + 읽기/쓰기 헬퍼.
// background / sidepanel / options 세 곳에서 같은 값을 봐야 해서 한 파일로 분리했다.

export const DEFAULTS = {
  // 중복 탭 판정 기준
  //  'path'     : 파일 전체 경로가 같아야 같은 문서 (안전한 기본값)
  //  'filename' : 파일 이름만 같으면 같은 문서 (/tmp/a/report.html 과 /tmp/b/report.html 을 합침)
  matchMode: 'path',

  dedupe: true,              // 같은 문서면 기존 탭 재사용
  reloadOnDuplicate: true,   // 재사용할 때 새로고침 (에이전트가 파일을 다시 썼을 테니)

  focusGuard: true,          // 외부에서 열린 탭이면 직전에 보던 탭으로 포커스 되돌리기
  autoGroup: true,           // 아티팩트 탭들을 탭그룹 하나로 묶기
  groupTitle: '📄 Artifacts',
  groupColor: 'blue',
  collapseGroup: true,       // 그룹을 접어둔다. 탭을 보고 나오면 자동으로 다시 접힌다
  maxOpenTabs: 0,            // 0 = 무제한. 값을 주면 초과분을 오래된 순으로 닫는다(목록에는 남음)

  // 사이드바에서 문서를 볼 때 탭바를 어떻게 다룰지
  //  'solo'   : 그 탭만 그룹 밖으로 꺼내 보여준다 → 나머지는 접힌 채 그대로 (기본)
  //  'expand' : 평범하게 활성화한다 → 그룹이 펼쳐지고, 벗어나면 다시 접힌다
  viewMode: 'solo',

  trackClaudeArtifacts: true, // claude.ai 아티팩트 URL 도 대상에 포함
  sweepOnStart: false,        // 브라우저를 켤 때 중복 탭을 자동 정리
  historyLimit: 50,
};

export async function getConfig() {
  const stored = await chrome.storage.local.get('config');
  return { ...DEFAULTS, ...(stored.config || {}) };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}
