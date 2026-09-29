// 사이드바 UI. 확장 페이지라서 chrome.* API 를 직접 쓸 수 있다.
// 상태를 따로 들고 있지 않고, 그릴 때마다 chrome.tabs 에서 다시 읽는다.
// (탭 상태의 진짜 원본은 브라우저이고, 사본을 만들면 반드시 어긋난다)

import { getConfig } from './lib/config.js';
import { artifactKey, displayName, subLabel } from './lib/keys.js';
import { t, applyI18n, copyAgentPrompt } from './lib/i18n.js';

applyI18n();

const listEl = document.getElementById('list');
const qEl = document.getElementById('q');
const countEl = document.getElementById('count');

let filter = '';
// CLI(네이티브 호스트) 연결 여부. 모르는 동안은 연결된 것으로 두어 경고가 깜빡이지 않게 한다.
let hostReady = true;

async function collect() {
  const cfg = await getConfig();
  const tabs = await chrome.tabs.query({});
  const [{ id: activeId } = {}] = await chrome.tabs.query({ active: true, currentWindow: true });

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

  const { history = [] } = await chrome.storage.local.get('history');
  const pinnedKeys = new Set(history.filter((h) => h.pinned).map((h) => h.key));
  open.forEach((o) => (o.pinned = pinnedKeys.has(o.key)));

  const closed = history
    .filter((h) => !openKeys.has(h.key))
    .map((h) => ({ ...h, title: h.title, sub: subLabel(h.url), closed: true }));

  // 핀 고정 → 그 외는 원래 순서
  open.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  closed.sort((a, b) => Number(b.pinned) - Number(a.pinned));

  return { open, closed, openTabCount };
}

function matches(item) {
  if (!filter) return true;
  const hay = `${item.title} ${item.sub} ${item.url}`.toLowerCase();
  return hay.includes(filter);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // innerHTML 을 쓰지 않는다 — 문서 제목이 그대로 들어오므로
  return n;
}

function makeRow(item) {
  const row = el('div', 'row' + (item.isActive ? ' active' : '') + (item.closed ? ' closed' : '') + (item.pinned ? ' pinned' : ''));
  row.title = item.url;

  if (item.favIconUrl && !item.closed) {
    const img = el('img', 'favicon');
    img.src = item.favIconUrl;
    img.onerror = () => img.replaceWith(fallbackIcon(item));
    row.append(img);
  } else {
    row.append(fallbackIcon(item));
  }

  const meta = el('div', 'meta');
  meta.append(el('div', 'name', item.title || t('untitled')));
  meta.append(el('div', 'sub', shortenPath(item.sub || '')));
  row.append(meta);

  if (item.dupes?.length) {
    const badge = el('span', 'badge', `×${item.dupes.length + 1}`);
    badge.title = t('dupBadgeTitle', item.dupes.length + 1);
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.tabs.remove(item.dupes);
      render();
    });
    row.append(badge);
  }

  const actions = el('div', 'actions');
  actions.append(
    iconBtn(item.pinned ? '📌' : '📍', item.pinned ? t('unpin') : t('pin'), async (e) => {
      e.stopPropagation();
      await togglePin(item);
    }, item.pinned ? 'pinned' : '')
  );
  if (!item.closed) {
    actions.append(iconBtn('⟳', t('reload'), (e) => {
      e.stopPropagation();
      chrome.tabs.reload(item.tabId);
    }));
    actions.append(iconBtn('✕', t('closeTab'), (e) => {
      e.stopPropagation();
      chrome.tabs.remove(item.tabId).then(render);
    }));
  } else {
    actions.append(iconBtn('✕', t('removeHistory'), async (e) => {
      e.stopPropagation();
      await removeHistory(item.key);
    }));
  }
  row.append(actions);

  row.addEventListener('click', () => activate(item));
  return row;
}

/** 긴 경로는 앞쪽을 …로 줄인다. 뒤쪽(어느 폴더인지)이 더 중요해서 뒤를 남긴다. */
function shortenPath(s, max = 46) {
  return s.length <= max ? s : '…' + s.slice(-(max - 1));
}

function fallbackIcon(item) {
  const n = el('div', 'favicon fallback', item.closed ? '·' : '▣');
  return n;
}

function iconBtn(label, title, onClick, extra = '') {
  const b = el('button', 'icon-btn ' + extra, label);
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

async function activate(item) {
  if (item.closed) {
    // 사용자가 직접 여는 것이므로 포커스 가드를 잠시 끄라고 백그라운드에 알린다.
    await chrome.runtime.sendMessage({ type: 'dock:openIntent' }).catch(() => {});
    await chrome.tabs.create({ url: item.url, active: true });
  } else {
    // 직접 activate 하지 않고 백그라운드에 맡긴다.
    // solo 모드면 그 탭만 그룹에서 꺼내야 해서 탭그룹 조작이 함께 필요하다.
    const res = await chrome.runtime.sendMessage({ type: 'dock:focus', tabId: item.tabId }).catch(() => null);
    if (!res?.ok) {
      await chrome.tabs.update(item.tabId, { active: true }).catch(() => {});
      await chrome.windows.update(item.windowId, { focused: true }).catch(() => {});
    }
  }
  render();
}

async function togglePin(item) {
  const { history = [] } = await chrome.storage.local.get('history');
  const idx = history.findIndex((h) => h.key === item.key);
  if (idx >= 0) {
    history[idx].pinned = !history[idx].pinned;
  } else {
    history.unshift({ key: item.key, url: item.url, title: item.title, at: Date.now(), pinned: true });
  }
  await chrome.storage.local.set({ history });
  render();
}

async function removeHistory(key) {
  const { history = [] } = await chrome.storage.local.get('history');
  await chrome.storage.local.set({ history: history.filter((h) => h.key !== key) });
  render();
}

async function render() {
  const { open, closed } = await collect();
  const shownOpen = open.filter(matches);
  const shownClosed = closed.filter(matches);

  listEl.replaceChildren();

  if (!shownOpen.length && !shownClosed.length) {
    const e = el('div', 'empty');
    if (filter) {
      e.append(el('div', null, t('noResults')));
    } else if (hostReady) {
      e.append(el('div', null, t('emptyTitle')), el('div', 'muted', t('emptyHintCli')));
    } else {
      // CLI 가 없으면 "artifact-open 으로 열어보세요" 는 따라 할 수 없는 안내다. 설치 안내로 보낸다.
      const btn = el('button', 'primary', t('openSetup'));
      btn.addEventListener('click', openWelcome);
      e.append(el('div', null, t('emptyTitle')), el('div', 'muted', t('emptyHintSetup')), btn);
    }
    listEl.append(e);
  } else {
    if (shownOpen.length) {
      listEl.append(el('div', 'section', t('sectionOpen', shownOpen.length)));
      shownOpen.forEach((i) => listEl.append(makeRow(i)));
    }
    if (shownClosed.length) {
      listEl.append(el('div', 'section', t('sectionClosed')));
      shownClosed.forEach((i) => listEl.append(makeRow(i)));
    }
  }

  const dupTotal = open.reduce((n, o) => n + o.dupes.length, 0);
  const cfg = await getConfig();
  // 버전과 모드를 같이 보여준다 — 확장을 다시 로드했는지, 어떤 모드로 도는지
  // 물어보지 않고 바로 확인할 수 있어야 진단이 빨라진다.
  const mode = cfg.viewMode === 'solo' ? t('modeSolo') : t('modeExpand');
  const base = dupTotal ? t('countDocsDup', open.length, dupTotal) : t('countOpen', open.length);
  countEl.textContent = `${base} · ${mode} · v${chrome.runtime.getManifest().version}`;
  countEl.title = t('countTitle');
}

// ── 이벤트 배선 ──────────────────────────────────────────────

qEl.addEventListener('input', () => {
  filter = qEl.value.trim().toLowerCase();
  render();
});

document.getElementById('settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

const toast = el('div', 'toast');
document.body.append(toast);
let toastTimer;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 2200);
}

document.getElementById('sweep').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'dock:sweep' });
    showToast(
      res?.closed
        ? t('toastSweepClosed', res.closed, res.grouped)
        : t('toastSweepNone', res?.grouped ?? 0)
    );
  } catch {
    showToast(t('toastSweepFail'));
  } finally {
    btn.disabled = false;
    render();
  }
});

document.getElementById('closeAll').addEventListener('click', async () => {
  const { open } = await collect();
  // 핀 고정하지 않은 문서의 모든 탭(중복 포함)을 닫는다
  const ids = open.filter((o) => !o.pinned).flatMap((o) => [o.tabId, ...o.dupes]);
  if (ids.length) await chrome.tabs.remove(ids);
  render();
});

// 백그라운드가 알려주는 변화 + 브라우저 이벤트 양쪽을 듣는다.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'dock:refresh') render();
  if (msg?.type === 'dock:hostStatus') setHostStatus(msg.ready);
});
chrome.tabs.onActivated.addListener(render);
chrome.tabs.onRemoved.addListener(render);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.title || info.favIconUrl || info.status === 'complete') render();
});

// ── CLI 연결 상태 ─────────────────────────────────────────────
// 연결이 끊긴 상태는 콘솔에만 찍히던 것이라, 사용자는 "왜 안 열리지"만 보게 된다. 화면에 올린다.
const hostEl = document.getElementById('hostStatus');

function setHostStatus(ready) {
  const changed = hostReady !== ready;
  hostReady = ready;
  hostEl.hidden = false;
  hostEl.className = 'host-status ' + (ready ? 'ok' : 'warn');
  hostEl.textContent = ready ? `● ${t('statusConnected')}` : `● ${t('statusDisconnected')} · ${t('openSetup')}`;
  hostEl.title = ready ? t('statusConnectedTitle') : t('statusDisconnectedTitle');
  hostEl.disabled = ready;
  if (changed) render();
}

function openWelcome() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/welcome.html'), active: true });
}

hostEl.addEventListener('click', openWelcome);

document.getElementById('agentPrompt').addEventListener('click', async () => {
  showToast((await copyAgentPrompt()) ? t('toastPromptCopied') : t('toastCopyFail'));
});

chrome.runtime.sendMessage({ type: 'dock:status' })
  .then((res) => setHostStatus(!!res?.hostReady))
  .catch(() => setHostStatus(false));

render();
