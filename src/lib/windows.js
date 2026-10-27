// 크롬 창이 여러 개일 때 "새 문서를 어느 창에 열까"를 정하는 규칙.
// background(여는 쪽)와 sidepanel(지정하는 쪽)이 같은 저장 키를 봐야 해서 한 파일로 둔다.

// 받는 창 id 는 chrome.storage.session 에 둔다. 창 id 는 브라우저를 다시 켜면 새로 매겨지므로
// local 에 남기면 다음 실행 때 엉뚱한 창(또는 없는 창)을 가리킨다. session 은 재시작하면 비워진다.
export const DOCK_WINDOW_KEY = 'dockWindowId';

// 사이드바가 열린 창과 창별 마지막 포커스 시각. 서비스 워커가 죽었다 깨어나도 순서를 잃지 않게 session 에 둔다.
export const WINDOW_FOCUS_KEY = 'windowFocusAt';

/**
 * 새 아티팩트 탭을 열 창.
 *  1) 사용자가 사이드바에서 지정한 받는 창 — 아직 열려 있을 때만
 *  2) 사이드바가 열린 창 — "지금 쓰는 창"의 가장 믿을 만한 신호다. 크롬의 마지막 포커스 창은
 *     터미널에서 작업하는 동안 다른 모니터의 창을 한 번 클릭했던 것만으로도 바뀐다.
 *     마지막 포커스 창에 사이드바가 있으면 그 창, 아니면 사이드바 창 중 가장 최근에 포커스된 창
 *  3) 마지막으로 포커스됐던 창 (사이드바가 어디에도 없을 때)
 *  4) 아무 창 / 창이 없으면 null (호출부가 새 창을 만든다)
 */
export function chooseTargetWindow({ dockWindowId, windowIds, lastFocusedId, panelWindowIds = [], focusAt = {} }) {
  if (dockWindowId != null && windowIds.includes(dockWindowId)) return dockWindowId;
  const panels = panelWindowIds.filter((id) => windowIds.includes(id));
  if (panels.length) {
    if (lastFocusedId != null && panels.includes(lastFocusedId)) return lastFocusedId;
    return [...panels].sort((a, b) => (focusAt[b] ?? 0) - (focusAt[a] ?? 0))[0];
  }
  if (lastFocusedId != null && windowIds.includes(lastFocusedId)) return lastFocusedId;
  return windowIds[0] ?? null;
}
