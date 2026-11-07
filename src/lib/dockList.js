// 목록의 순서·묶음을 정하는 곳. 사이드바와 소켓 `list` 명령이 같은 함수를 쓴다.
// 정렬을 두 곳에 두면 폰의 Dock 이 사이드바와 어긋나므로, 받는 쪽(폰)은 정렬 코드를 갖지 않는다.

import { artifactKey, displayName, subLabel } from './keys.js';

/** `list` 응답 모양의 번호. 받는 쪽은 이 값이 다르면 구판으로 본다. */
export const DOCK_LIST_PROTOCOL = 1;

const SESSION_ID = /^[\w-]{1,64}$/;

/** 터미널 환경변수에서 온 세션 id. 모양이 다르면 없는 것으로 친다. */
export function sessionIdFrom(value) {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : undefined;
}

export function buildDockList({ tabs, history, activeId, cfg }) {
  // 같은 문서를 가리키는 탭이 여러 개면 한 줄로 묶는다.
  // (목록에까지 중복이 그대로 보이면 사이드바를 만든 의미가 없다)
  const byKey = new Map();
  let openTabCount = 0;
  for (const t of tabs) {
    const url = t.url || t.pendingUrl || '';
    const key = artifactKey(url, cfg, t.title);
    if (!key) continue;
    openTabCount++;

    const existing = byKey.get(key);
    if (existing) {
      existing.dupes.push(t.id);
      // 활성 탭이 있으면 그쪽을 대표로 올린다
      if (t.id === activeId) {
        existing.dupes = existing.dupes.filter((id) => id !== t.id).concat(existing.tabId);
        existing.tabId = t.id;
        existing.windowId = t.windowId;
        existing.isActive = true;
      }
      continue;
    }

    byKey.set(key, {
      key,
      url,
      tabId: t.id,
      windowId: t.windowId,
      title: displayName(url, t.title),
      sub: subLabel(url),
      favIconUrl: t.favIconUrl,
      isActive: t.id === activeId,
      dupes: [],
    });
  }
  const open = [...byKey.values()];
  const openKeys = new Set(byKey.keys());

  const byHistory = new Map(history.map((h) => [h.key, h]));
  open.forEach((o) => {
    const h = byHistory.get(o.key);
    o.pinned = !!h?.pinned;
    o.at = h?.at ?? 0;
    if (h?.sessionId) o.sessionId = h.sessionId;
  });

  const closed = history
    .filter((h) => !openKeys.has(h.key))
    .map((h) => ({ ...h, title: h.title, sub: subLabel(h.url), closed: true }));

  // 📌 고정 → 최근에 열린(에이전트가 열거나 다시 쓴) 순.
  // 예전에는 탭 순서 그대로였는데, solo 보기는 문서를 고를 때마다 탭을 그룹 밖으로 꺼냈다
  // 넣으면서 탭 순서를 바꾼다 → 클릭할 때마다 목록이 뒤섞여 보였다. 고르는 동작으로는 바뀌지 않는
  // 기준(at)으로 정렬해서 순서를 고정한다. 기록이 없는 탭은 맨 아래, 그 안에서는 나중에 연 탭이 위.
  const byRecent = (a, b) =>
    Number(b.pinned) - Number(a.pinned) || (b.at ?? 0) - (a.at ?? 0) || (b.tabId ?? 0) - (a.tabId ?? 0);
  open.sort(byRecent);
  closed.sort(byRecent);

  return { open, closed, openTabCount };
}

/**
 * 소켓으로 나가는 한 행. 탭·창 번호와 활성 여부는 싣지 않는다 — 받는 쪽이 탭을 조작할 일이 없고,
 * 파비콘(data: URL)은 커질 수 있다.
 */
export function listRow(item, missingKeys) {
  return {
    key: item.key,
    url: item.url,
    title: item.title,
    sub: item.sub,
    at: item.at ?? 0,
    pinned: !!item.pinned,
    missing: missingKeys.has(item.key),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
  };
}
