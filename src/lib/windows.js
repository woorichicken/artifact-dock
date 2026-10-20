// 크롬 창이 여러 개일 때 "새 문서를 어느 창에 열까"를 정하는 규칙.
// background(여는 쪽)와 sidepanel(지정하는 쪽)이 같은 저장 키를 봐야 해서 한 파일로 둔다.

// 받는 창 id 는 chrome.storage.session 에 둔다. 창 id 는 브라우저를 다시 켜면 새로 매겨지므로
// local 에 남기면 다음 실행 때 엉뚱한 창(또는 없는 창)을 가리킨다. session 은 재시작하면 비워진다.
export const DOCK_WINDOW_KEY = 'dockWindowId';

/**
 * 새 아티팩트 탭을 열 창.
 *  1) 사용자가 사이드바에서 지정한 받는 창 — 아직 열려 있을 때만
 *  2) 마지막으로 포커스됐던 창 (지정이 없을 때의 원래 동작)
 *  3) 아무 창 / 창이 없으면 null (호출부가 새 창을 만든다)
 */
export function chooseTargetWindow({ dockWindowId, windowIds, lastFocusedId }) {
  if (dockWindowId != null && windowIds.includes(dockWindowId)) return dockWindowId;
  if (lastFocusedId != null && windowIds.includes(lastFocusedId)) return lastFocusedId;
  return windowIds[0] ?? null;
}
