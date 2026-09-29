// Artifact Dock — 백그라운드 서비스 워커
//
// 하는 일 3가지
//  1) dedup      : 같은 문서를 또 열면 기존 탭을 새로고침하고 새 탭은 닫는다
//  2) focus guard: 외부(터미널)에서 열린 탭이면 직전에 보던 탭으로 포커스를 되돌린다
//  3) grouping   : 아티팩트 탭들을 탭그룹 하나로 묶어 탭바를 아낀다
//
// MV3 서비스 워커는 몇 초만 놀아도 죽는다. 그래서 메모리 변수에 상태를 남기면 안 되고,
// 꼭 필요한 것(직전 활성 탭)만 chrome.storage.session 에 적어둔다.

import { getConfig } from './lib/config.js';
import { artifactKey, displayName } from './lib/keys.js';

// ────────────────────────────────────────────────────────────
// 직전 활성 탭 기억 (포커스 복원용)
// ────────────────────────────────────────────────────────────

const activeKey = (windowId) => `active:${windowId}`;

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const k = activeKey(windowId);
  const cur = (await chrome.storage.session.get(k))[k] || {};
  if (cur.current === tabId) return;
  await chrome.storage.session.set({ [k]: { current: tabId, previous: cur.current ?? null } });
});

/** 새로 열린 탭(newTabId)을 제외하고, 사용자가 직전에 보고 있던 탭 id */
async function pickRestoreTarget(windowId, newTabId) {
  const k = activeKey(windowId);
  const rec = (await chrome.storage.session.get(k))[k];

  // 1순위: onActivated 로 직접 기록해 둔 직전 탭
  for (const cand of [rec?.previous, rec?.current]) {
    if (cand == null || cand === newTabId) continue;
    const tab = await getTab(cand);
    if (tab && tab.windowId === windowId) return tab.id;
  }

  // 2순위: 서비스 워커가 죽어서 기록이 없을 때. Chrome 121+ 의 lastAccessed 로 추정한다.
  const tabs = await chrome.tabs.query({ windowId });
  const others = tabs
    .filter((t) => t.id !== newTabId && typeof t.lastAccessed === 'number')
    .sort((a, b) => b.lastAccessed - a.lastAccessed);
  return others[0]?.id ?? null;
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null; // 이미 닫힌 탭
  }
}

// ────────────────────────────────────────────────────────────
// 새 탭 처리
// ────────────────────────────────────────────────────────────

// onCreated 시점에는 URL 이 아직 비어 있을 수 있다. 그런 탭은 여기 담아두고
// onUpdated 에서 URL 이 정해지는 순간 처리한다.
const pending = new Set();

chrome.tabs.onCreated.addListener(async (tab) => {
  // pendingUrl 은 "곧 이동할 주소". open 명령으로 연 file:// 은 대개 여기 들어있다.
  const url = tab.url || tab.pendingUrl || '';
  if (url) {
    await handleNewTab(tab, url);
  } else {
    pending.add(tab.id);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (pending.has(tabId) && info.url) {
    pending.delete(tabId);
    await handleNewTab(tab, info.url);
    return;
  }
  // 제목이 늦게 붙는 경우가 많아서, 대상 탭이면 사이드바만 갱신해 준다.
  if (info.title || info.status === 'complete') {
    const cfg = await getConfig();
    if (artifactKey(tab.url || '', cfg, tab.title)) notifyPanel();
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  pending.delete(tabId);
  notifyPanel();
});

async function handleNewTab(tab, url) {
  if (selfCreated.has(tab.id)) {
    selfCreated.delete(tab.id);
    return; // openFromCli 가 이미 처리한 탭
  }
  const cfg = await getConfig();
  const key = artifactKey(url, cfg, tab.title);
  if (!key) return; // 관리 대상이 아니면 아무것도 하지 않는다

  // ── 1) 중복 판정
  if (cfg.dedupe) {
    const existing = await findTabByKey(key, cfg, tab.id);
    if (existing) {
      if (cfg.reloadOnDuplicate) {
        try { await chrome.tabs.reload(existing.id); } catch {}
      }
      const shouldGuard = cfg.focusGuard && isExternallyOpened(tab) && !(await isUserInitiated());
      try { await chrome.tabs.remove(tab.id); } catch {}

      // 포커스 가드가 꺼져 있으면 "다시 열었으니 보여준다"가 자연스럽다.
      if (!shouldGuard) {
        try {
          await chrome.tabs.update(existing.id, { active: true });
          await chrome.windows.update(existing.windowId, { focused: true });
        } catch {}
      }
      await touchHistory(existing);
      notifyPanel();
      return;
    }
  }

  // ── 2) 새 문서: 그룹에 넣고
  //  단 solo 모드에서 사용자가 보려고 연 탭(active)은 그룹 밖에 둔다.
  //  넣는 순간 그룹이 펼쳐져 탭바가 뒤덮이기 때문이다.
  const keepSolo = cfg.viewMode === 'solo' && tab.active;
  if (cfg.autoGroup && !keepSolo) {
    await addToGroup(tab, cfg);
  } else if (keepSolo) {
    await returnSoloToGroup(tab.id);
    await chrome.storage.session.set({ [SOLO_KEY]: tab.id });
  }

  // ── 3) 포커스 되돌리기
  //  탭 그룹에 넣으면 탭이 이동하므로 반드시 그룹 처리 뒤에 한다.
  if (cfg.focusGuard && isExternallyOpened(tab) && !(await isUserInitiated())) {
    const target = await pickRestoreTarget(tab.windowId, tab.id);
    if (target != null) {
      try { await chrome.tabs.update(target, { active: true }); } catch {}
    }
  }

  await touchHistory(await getTab(tab.id) || tab);
  await enforceTabLimit();
  notifyPanel();
}

/**
 * "터미널에서 열린 탭"인지 판정.
 * 사용자가 페이지 안의 링크를 클릭해서 연 탭에는 openerTabId 가 붙는다.
 * 그 경우까지 포커스를 되돌리면 사용자가 화를 내므로 가드 대상에서 뺀다.
 */
function isExternallyOpened(tab) {
  // active 가 아니면 애초에 포커스를 뺏지 않았으므로 되돌릴 것도 없다.
  if (!tab.active) return false;
  return tab.openerTabId === undefined || tab.openerTabId === null;
}

/**
 * 사이드바에서 사용자가 직접 항목을 클릭해 연 경우에는 포커스를 되돌리면 안 된다.
 * 사이드바가 탭을 만들기 직전에 의도 플래그를 찍어두고, 여기서 그 유효시간을 본다.
 * (탭 생성 이벤트에는 "누가 만들었는지"가 안 담겨서 이 방식이 필요하다)
 */
const OPEN_INTENT_MS = 3000;

async function isUserInitiated() {
  const { openIntentUntil = 0 } = await chrome.storage.session.get('openIntentUntil');
  return Date.now() < openIntentUntil;
}

async function findTabByKey(key, cfg, excludeTabId) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id === excludeTabId) continue;
    const u = t.url || t.pendingUrl || '';
    if (artifactKey(u, cfg, t.title) === key) return t;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// 탭 그룹
// ────────────────────────────────────────────────────────────

/**
 * 탭들을 아티팩트 그룹에 넣는다.
 *
 * 여러 개를 하나씩 넣으면 그룹이 펼쳐졌다 접혔다 깜빡이므로 창 단위로 한 번에 넣는다.
 * 접힘 복원도 여기서만 한다 — 호출부마다 따로 하면 반드시 빠뜨리는 경로가 생긴다.
 */
async function groupTabs(tabIds, windowId, cfg) {
  if (!tabIds.length) return;
  try {
    const found = await chrome.tabGroups.query({ windowId, title: cfg.groupTitle });
    let groupId = found[0]?.id;

    // 탭을 넣는 순간 Chrome 이 그룹을 펼친다. 원래 접혀 있었는지 먼저 기억해 둔다.
    const wasCollapsed = found[0]?.collapsed ?? false;

    if (groupId != null) {
      await chrome.tabs.group({ tabIds, groupId });
    } else {
      groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: cfg.groupTitle, color: cfg.groupColor });
    }

    if (wasCollapsed || cfg.collapseGroup) {
      try {
        await chrome.tabGroups.update(groupId, { collapsed: true });
      } catch {
        // 활성 탭이 이 그룹 안에 있으면 Chrome 이 접기를 거부한다.
        // 그 탭을 벗어날 때 onActivated 에서 다시 시도된다.
      }
    }
  } catch (e) {
    // 그룹핑 실패는 치명적이지 않다. 탭은 이미 열려 있으니 조용히 넘어간다.
    console.warn('[ArtifactDock] group failed', e);
  }
}

async function addToGroup(tab, cfg) {
  await groupTabs([tab.id], tab.windowId, cfg);
}

/**
 * 그룹 밖에 나와 있는 아티팩트 탭을 도로 집어넣는다.
 *
 * solo 로 꺼낸 탭을 storage 에 적어두고 추적했는데, 서비스 워커가 죽거나 이벤트를 한 번
 * 놓치면 그 기록이 끊겨서 탭이 그룹 밖에 영영 남는다("전에 보던 html 이 튀어나와 있다").
 * 그래서 기록이 아니라 **지금 실제 상태**를 보고 정리한다 — 기록은 틀릴 수 있어도
 * "그룹 밖에 있는 아티팩트 탭"이라는 사실은 틀릴 수 없다.
 */
async function tidyStrayArtifactTabs() {
  const cfg = await getConfig();
  if (!cfg.autoGroup || cfg.viewMode !== 'solo') return;

  const tabs = await chrome.tabs.query({});
  const byWindow = new Map();
  for (const t of tabs) {
    if (t.active || t.pinned) continue; // 보고 있는 탭은 꺼내둔 채로 둔다
    if (t.groupId > -1) continue;       // 이미 그룹 안
    if (!artifactKey(t.url || t.pendingUrl || '', cfg, t.title)) continue;
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId).push(t.id);
  }

  for (const [windowId, ids] of byWindow) {
    await groupTabs(ids, windowId, cfg);
    console.log('[ArtifactDock] 그룹 밖에 있던 아티팩트 탭', ids, '을 그룹으로 되돌림');
  }
}

// ────────────────────────────────────────────────────────────
// 히스토리 (닫힌 문서도 사이드바에서 다시 열 수 있게)
// ────────────────────────────────────────────────────────────

async function touchHistory(tab) {
  if (!tab) return;
  const cfg = await getConfig();
  const url = tab.url || tab.pendingUrl || '';
  const key = artifactKey(url, cfg, tab.title);
  if (!key) return;

  const { history = [] } = await chrome.storage.local.get('history');
  const rest = history.filter((h) => h.key !== key);
  rest.unshift({
    key,
    url,
    title: displayName(url, tab.title),
    at: Date.now(),
    pinned: history.find((h) => h.key === key)?.pinned || false,
  });
  await chrome.storage.local.set({ history: rest.slice(0, cfg.historyLimit) });
}

// ────────────────────────────────────────────────────────────
// 사이드바 연동
// ────────────────────────────────────────────────────────────

function notifyPanel() {
  // 사이드바가 안 열려 있으면 수신자가 없어 reject 된다. 무시해도 되는 에러다.
  chrome.runtime.sendMessage({ type: 'dock:refresh' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'dock:focus') {
    focusTab(msg.tabId).then(sendResponse);
    return true;
  }
  if (msg?.type === 'dock:sweep') {
    sweepAll().then(sendResponse);
    return true;
  }
  if (msg?.type === 'dock:openIntent') {
    chrome.storage.session
      .set({ openIntentUntil: Date.now() + OPEN_INTENT_MS })
      .then(() => sendResponse({ ok: true }));
    return true; // 비동기 응답을 쓰겠다는 표시
  }
  return false;
});

// 툴바 아이콘을 누르면 사이드바가 열리게 한다.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
});


// ────────────────────────────────────────────────────────────
// 네이티브 메시징: CLI 가 보낸 "이 파일 열어줘"를 받는다
//
// 이 경로가 있어야 포커스를 진짜로 안 뺏는다.
// (open -g 도, AppleScript 도 Chrome 앱을 앞으로 가져온다는 걸 실측으로 확인했다.
//  확장이 chrome.tabs.create({active:false}) 를 부르는 것만이 앱을 안 건드린다)
// ────────────────────────────────────────────────────────────

const HOST_NAME = 'dev.artifactdock.host';
let nativePort = null;

// 확장이 스스로 만든 탭은 onCreated 에서 다시 손대지 않도록 표시해 둔다.
const selfCreated = new Set();

function connectHost() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    console.warn('[ArtifactDock] native host 연결 실패 (install.sh 를 실행했나요?)', e);
    nativePort = null;
    return;
  }

  nativePort.onMessage.addListener(async (msg) => {
    if (!msg || msg.type === 'host:ready') return;
    if (msg.cmd !== 'open') return;
    let reply;
    try {
      reply = await openFromCli(msg);
    } catch (e) {
      reply = { ok: false, error: String(e) };
    }
    try { nativePort?.postMessage({ id: msg.id, ...reply }); } catch {}
  });

  nativePort.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message;
    if (err) console.warn('[ArtifactDock] native host 끊김:', err);
    nativePort = null;
  });
}

async function openFromCli({ url, activate = false }) {
  if (!url) return { ok: false, error: 'url 이 없습니다' };
  const cfg = await getConfig();
  const key = artifactKey(url, cfg);

  // 이미 열려 있으면 새로고침만 한다 (= 창이 늘어나지 않는다)
  if (key && cfg.dedupe) {
    const existing = await findTabByKey(key, cfg, -1);
    if (existing) {
      if (cfg.reloadOnDuplicate) {
        try { await chrome.tabs.reload(existing.id); } catch {}
      }
      if (activate) {
        try {
          await chrome.tabs.update(existing.id, { active: true });
          await chrome.windows.update(existing.windowId, { focused: true });
        } catch {}
      }
      await touchHistory(existing);
      notifyPanel();
      return { ok: true, reused: true, tabId: existing.id };
    }
  }

  const windowId = await pickTargetWindow();
  let tab;
  if (windowId == null) {
    // 창이 하나도 없을 때. focused:false 로 만들어 앱이 튀어나오지 않게 한다.
    const win = await chrome.windows.create({ url, focused: !!activate });
    tab = win.tabs[0];
  } else {
    tab = await chrome.tabs.create({ url, windowId, active: !!activate });
  }

  selfCreated.add(tab.id);
  if (cfg.autoGroup) await addToGroup(tab, cfg);
  await touchHistory(tab);
  await enforceTabLimit();
  notifyPanel();
  return { ok: true, reused: false, tabId: tab.id };
}

async function pickTargetWindow() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return win?.id ?? null;
  } catch {
    const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    return wins[0]?.id ?? null;
  }
}

// 서비스 워커가 죽었다 살아나도 다시 붙도록 여러 시점에 연결을 시도한다.
// (네이티브 메시징 연결이 살아 있는 동안은 서비스 워커도 잠들지 않는다)
chrome.runtime.onInstalled.addListener(connectHost);
chrome.runtime.onStartup.addListener(connectHost);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'dock:keepalive') connectHost();
});
chrome.alarms.create('dock:keepalive', { periodInMinutes: 1 });
connectHost();


// ────────────────────────────────────────────────────────────
// 이미 열려 있는 탭 정리 (sweep)
//
// dedup 은 "새로 열 때"만 동작한다. 확장을 켜기 전부터 쌓여 있던 탭은
// 아무도 건드리지 않으므로, 한 번에 훑어서 정리하는 경로가 따로 필요하다.
// ────────────────────────────────────────────────────────────

/**
 * 같은 문서를 가리키는 탭이 여러 개면 하나만 남긴다.
 * 남길 탭 고르는 순서: 현재 활성 탭 > 핀 고정된 탭 > 가장 최근에 본 탭
 */
async function sweepDuplicates() {
  const cfg = await getConfig();
  const tabs = await chrome.tabs.query({});
  const activeIds = new Set(
    (await chrome.tabs.query({ active: true })).map((t) => t.id)
  );

  const buckets = new Map(); // key -> tab[]
  for (const t of tabs) {
    const key = artifactKey(t.url || t.pendingUrl || '', cfg, t.title);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }

  const toClose = [];
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const act = Number(activeIds.has(b.id)) - Number(activeIds.has(a.id));
      if (act) return act;
      if (Boolean(b.pinned) !== Boolean(a.pinned)) return Number(b.pinned) - Number(a.pinned);
      return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    });
    // 첫 번째만 남기고 나머지는 닫는다. Chrome 의 탭 고정(pinned)은 닫지 않는다.
    toClose.push(...group.slice(1).filter((t) => !t.pinned).map((t) => t.id));
  }

  if (toClose.length) await chrome.tabs.remove(toClose);
  return { closed: toClose.length, groups: buckets.size };
}

/** 흩어져 있는 아티팩트 탭을 전부 탭그룹 하나로 모은다 (창별로). */
async function gatherIntoGroup() {
  const cfg = await getConfig();
  if (!cfg.autoGroup) return { grouped: 0 };

  const tabs = await chrome.tabs.query({});
  const byWindow = new Map();
  for (const t of tabs) {
    if (!artifactKey(t.url || t.pendingUrl || '', cfg, t.title)) continue;
    if (t.pinned) continue; // Chrome 고정탭은 그룹에 못 들어간다
    if (t.active && cfg.viewMode === 'solo') continue; // 보고 있는 탭을 넣으면 그룹이 펼쳐진다
    if (!byWindow.has(t.windowId)) byWindow.set(t.windowId, []);
    byWindow.get(t.windowId).push(t.id);
  }

  let grouped = 0;
  for (const [windowId, tabIds] of byWindow) {
    await groupTabs(tabIds, windowId, cfg);
    grouped += tabIds.length;
  }
  return { grouped };
}

async function sweepAll() {
  const dup = await sweepDuplicates();
  const grp = await gatherIntoGroup();
  await enforceTabLimit();
  notifyPanel();
  return { ...dup, ...grp };
}

// 브라우저를 켤 때 한 번 정리 (설정에서 끌 수 있다)
async function sweepOnStartIfEnabled() {
  const cfg = await getConfig();
  if (cfg.sweepOnStart) await sweepAll();
}
chrome.runtime.onStartup.addListener(sweepOnStartIfEnabled);
chrome.runtime.onInstalled.addListener(sweepOnStartIfEnabled);


// ────────────────────────────────────────────────────────────
// 접어둔 그룹을 다시 접는다
//
// Chrome 은 접힌 그룹 안의 탭을 활성화하면 그룹을 강제로 펼친다(막을 수 없다).
// 게다가 활성 탭이 들어 있는 그룹은 collapsed:true 로 되돌리는 것도 거부한다.
// 그래서 "활성 탭이 그 그룹 밖으로 나간 순간"이 다시 접을 수 있는 유일한 시점이다.
// ────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const cfg = await getConfig();
  if (!cfg.autoGroup || !cfg.collapseGroup) return;

  const tab = await getTab(tabId);
  if (!tab) return;

  try {
    const groups = await chrome.tabGroups.query({ windowId, title: cfg.groupTitle });
    for (const g of groups) {
      if (g.id === tab.groupId) continue; // 지금 보고 있는 그룹은 접을 수 없다
      if (!g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: true });
    }
  } catch (e) {
    // 사용자가 탭을 드래그 중이면 편집이 거부된다. 다음 전환 때 다시 시도된다.
  }
});

/**
 * 아티팩트 탭 수 상한. 넘으면 오래 안 본 것부터 닫는다.
 * 닫아도 사이드바의 '최근 닫힘'에 남아서 클릭 한 번으로 되살아나므로 잃는 게 없다.
 */
async function enforceTabLimit() {
  const cfg = await getConfig();
  const limit = Number(cfg.maxOpenTabs) || 0;
  if (limit <= 0) return;

  const { history = [] } = await chrome.storage.local.get('history');
  const pinnedKeys = new Set(history.filter((h) => h.pinned).map((h) => h.key));

  const tabs = await chrome.tabs.query({});
  const candidates = [];
  for (const t of tabs) {
    const key = artifactKey(t.url || t.pendingUrl || '', cfg, t.title);
    if (!key) continue;
    if (t.active || t.pinned || pinnedKeys.has(key)) continue; // 보고 있거나 고정한 건 건드리지 않는다
    candidates.push(t);
  }
  if (candidates.length <= limit) return;

  candidates.sort((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0));
  const excess = candidates.slice(0, candidates.length - limit).map((t) => t.id);
  if (excess.length) {
    await chrome.tabs.remove(excess);
    notifyPanel();
  }
}


// ────────────────────────────────────────────────────────────
// solo 보기 — 한 개만 꺼내서 본다
//
// 접힌 그룹의 탭을 활성화하면 Chrome 이 그룹을 통째로 펼쳐서 탭바가 파비콘으로 뒤덮인다.
// 그래서 볼 탭 하나만 그룹에서 꺼내고(ungroup) 나머지는 접힌 채로 둔다.
// 그 탭을 벗어나면 조용히 그룹으로 돌려보낸다.
// ────────────────────────────────────────────────────────────

const SOLO_KEY = 'soloTabId';

/** 사이드바에서 문서를 클릭했을 때의 진입점 */
async function focusTab(tabId) {
  const cfg = await getConfig();
  const tab = await getTab(tabId);
  if (!tab) return { ok: false, error: '탭이 이미 닫혔습니다' };

  // 되돌려야 할 그룹. ungroup 이나 활성화 과정에서 Chrome 이 그룹을 펼쳐 버리기 때문에
  // "원래 접혀 있었는가"를 미리 기억해 두고 마지막에 반드시 복원한다.
  let collapseBack = null;

  if (cfg.viewMode === 'solo' && cfg.autoGroup && tab.groupId > -1) {
    let wasCollapsed = false;
    try {
      wasCollapsed = (await chrome.tabGroups.get(tab.groupId)).collapsed;
    } catch {}

    await returnSoloToGroup(tabId); // 앞서 꺼내 둔 탭들을 먼저 제자리로
    try {
      await chrome.tabs.ungroup(tabId);
      await chrome.storage.session.set({
        [SOLO_KEY]: { tabId, groupId: tab.groupId, wasCollapsed },
      });
      if (wasCollapsed || cfg.collapseGroup) collapseBack = tab.groupId;
    } catch (e) {
      // 드래그 중 등으로 실패하면 그냥 평소대로 활성화한다
    }
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    return { ok: false, error: String(e) };
  }

  // 이제 활성 탭이 그룹 밖이라 접을 수 있다. (활성 탭이 든 그룹은 Chrome 이 접기를 거부한다)
  if (collapseBack != null) {
    try {
      await chrome.tabGroups.update(collapseBack, { collapsed: true });
      console.log('[ArtifactDock] solo 보기: 탭', tabId, '를 꺼내고 그룹', collapseBack, '를 다시 접음');
    } catch (e) {
      console.log('[ArtifactDock] 그룹을 다시 접지 못함', e?.message);
      // 마지막 탭이 빠져나가 그룹이 사라진 경우 — 접을 대상이 없으니 정상이다
    }
  }
  return { ok: true, solo: collapseBack != null };
}

/** 꺼내 뒀던 탭을 그룹으로 돌려보낸다 (exceptTabId 는 지금 보려는 탭이라 건너뛴다) */
async function returnSoloToGroup(exceptTabId) {
  const stored = (await chrome.storage.session.get(SOLO_KEY))[SOLO_KEY];
  const solo = typeof stored === 'number' ? { tabId: stored } : stored;
  if (solo?.tabId != null && solo.tabId !== exceptTabId) {
    await chrome.storage.session.remove(SOLO_KEY);
  }
  // 기록에 남은 그 탭만이 아니라, 그룹 밖으로 나와 있는 아티팩트 탭 전부를 정리한다.
  await tidyStrayArtifactTabs();
}

// 꺼내 둔 탭을 벗어나면 제자리로
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await returnSoloToGroup(tabId);
});
