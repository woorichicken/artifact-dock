// 목록 정리 규칙. "무엇을 지울지"만 계산하고 실제로 닫고 지우는 건 background.js 가 한다.
// 순수 함수로 둬서 확장 없이 tests/cleanup.test.mjs 로 확인한다.
//
// 입력 형태
//   history: [{ key, at, pinned }]                         ← chrome.storage.local 의 history
//   tabs:    [{ id, key, active, pinned, lastAccessed }]   ← 아티팩트 탭만 (key 는 artifactKey 결과)
// 출력
//   { closeTabIds: number[], dropKeys: string[] }
//
// 어느 규칙이든 건드리지 않는 것: 📌 고정한 문서 · 지금 보고 있는 탭 · Chrome 탭 고정(pinned)

export const DAY_MS = 24 * 60 * 60 * 1000;

function pinnedKeysOf(history) {
  return new Set(history.filter((h) => h.pinned).map((h) => h.key));
}

function canClose(tab, pinnedKeys) {
  return !tab.active && !tab.pinned && !pinnedKeys.has(tab.key);
}

/** 닫을 탭이 정해진 뒤, 탭이 하나라도 남는 문서는 목록에서 지우지 않는다(열린 채로 사라지면 이상하다). */
function keysStillOpen(tabs, closeTabIds) {
  const closing = new Set(closeTabIds);
  return new Set(tabs.filter((t) => !closing.has(t.id)).map((t) => t.key));
}

/**
 * N일 동안 다시 열지도(at) 보지도(lastAccessed) 않은 문서를 고른다.
 * 기준을 "마지막으로 본 때"까지 넓힌 이유: 에이전트가 한 번 열고 끝난 리포트라도
 * 사람이 어제 들여다봤다면 아직 쓰는 문서다.
 */
export function planAgeCleanup({ history, tabs, now, days }) {
  if (!(days > 0)) return { closeTabIds: [], dropKeys: [] };
  const cutoff = now - days * DAY_MS;
  const pinnedKeys = pinnedKeysOf(history);

  const lastSeen = new Map();
  const bump = (key, t) => lastSeen.set(key, Math.max(lastSeen.get(key) ?? 0, t ?? 0));
  history.forEach((h) => bump(h.key, h.at));
  tabs.forEach((t) => bump(t.key, t.lastAccessed));
  const stale = (key) => (lastSeen.get(key) ?? 0) < cutoff;

  const closeTabIds = tabs.filter((t) => canClose(t, pinnedKeys) && stale(t.key)).map((t) => t.id);
  const open = keysStillOpen(tabs, closeTabIds);
  const dropKeys = history
    .filter((h) => !h.pinned && stale(h.key) && !open.has(h.key))
    .map((h) => h.key);
  return { closeTabIds, dropKeys };
}

/**
 * 파일이 지워진 문서를 고른다. (/tmp 처럼 재부팅·정리로 사라지는 경로에서 쌓인다)
 * closeTabs=false 면 목록(최근 닫힘)만 정리하고 열린 탭은 그대로 둔다 — 자동 정리용.
 * 지워진 파일의 탭도 화면에는 내용이 남아 있어서, 사람이 [정리]를 누를 때만 닫는다.
 */
export function planMissingCleanup({ history, tabs, missingKeys, closeTabs }) {
  const missing = missingKeys instanceof Set ? missingKeys : new Set(missingKeys);
  if (!missing.size) return { closeTabIds: [], dropKeys: [] };
  const pinnedKeys = pinnedKeysOf(history);

  const closeTabIds = closeTabs
    ? tabs.filter((t) => missing.has(t.key) && canClose(t, pinnedKeys)).map((t) => t.id)
    : [];
  const open = keysStillOpen(tabs, closeTabIds);
  const dropKeys = history
    .filter((h) => !h.pinned && missing.has(h.key) && !open.has(h.key))
    .map((h) => h.key);
  return { closeTabIds, dropKeys };
}

/**
 * 파일 경로별 존재 여부로 "지워진 문서" 키를 고른다.
 * 같은 키에 경로가 여럿이면(제목·파일명 기준 합치기) 전부 없어야 지워진 것으로 본다.
 * 확인하지 못한 경로(exists 에 없음)는 있는 것으로 친다 — 모르면 지우지 않는다.
 */
export function missingKeysFrom(pathsByKey, exists) {
  const out = [];
  for (const [key, paths] of pathsByKey) {
    if (!paths.size) continue;
    if ([...paths].every((p) => exists[p] === false)) out.push(key);
  }
  return out;
}
