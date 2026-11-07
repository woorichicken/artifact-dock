// 사이드바와 `list` 명령이 같이 쓰는 목록 규칙. 순서가 갈리면 폰의 Dock 이 사이드바와 달라진다.
import fs from 'node:fs';
import { buildDockList, listRow, sessionIdFrom, DOCK_LIST_PROTOCOL } from '../src/lib/dockList.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

const cfg = { matchMode: 'path', trackClaudeArtifacts: true };
const file = (name) => `file:///Users/me/work/${name}.html`;
const key = (name) => `file:/Users/me/work/${name}.html`;
const tab = (id, name, extra = {}) => ({ id, windowId: 1, url: file(name), title: name, ...extra });
const hist = (name, at, extra = {}) => ({ key: key(name), url: file(name), title: name, at, pinned: false, ...extra });
const titles = (rows) => rows.map((r) => r.title);

// 고정 → 최근(at) → 나중에 연 탭(tabId)
{
  const { open } = buildDockList({
    tabs: [tab(1, 'old'), tab(2, 'pinned'), tab(3, 'new'), tab(4, 'nohistA'), tab(5, 'nohistB')],
    history: [hist('old', 100), hist('new', 300), hist('pinned', 50, { pinned: true })],
    activeId: undefined,
    cfg,
  });
  eq('고정 → at → tabId', titles(open), ['pinned', 'new', 'old', 'nohistB', 'nohistA']);
}

// 같은 문서 탭 여럿은 한 줄, 활성 탭이 대표
{
  const { open, openTabCount } = buildDockList({
    tabs: [tab(1, 'dup'), tab(2, 'dup'), tab(3, 'dup')],
    history: [],
    activeId: 2,
    cfg,
  });
  eq('중복은 한 줄', open.length, 1);
  eq('활성 탭이 대표', open[0].tabId, 2);
  eq('나머지는 dupes', [...open[0].dupes].sort(), [1, 3]);
  eq('탭 수는 세 개', openTabCount, 3);
}

// 관리 대상이 아닌 탭은 빠지고, 열린 문서는 닫힌 묶음에 안 나온다
{
  const { open, closed } = buildDockList({
    tabs: [tab(1, 'a'), { id: 2, windowId: 1, url: 'https://example.com/', title: 'x' }],
    history: [hist('a', 10), hist('b', 30), hist('c', 20, { pinned: true })],
    activeId: 1,
    cfg,
  });
  eq('열린 문서', titles(open), ['a']);
  eq('닫힌 묶음도 같은 정렬', titles(closed), ['c', 'b']);
  eq('닫힌 표시', closed.every((c) => c.closed === true), true);
}

// sessionId 는 기록에서 온다 — 열린 문서·닫힌 문서 모두
{
  const { open, closed } = buildDockList({
    tabs: [tab(1, 'a')],
    history: [hist('a', 10, { sessionId: 's-open' }), hist('b', 5, { sessionId: 's-closed' }), hist('c', 1)],
    activeId: 1,
    cfg,
  });
  eq('열린 문서의 sessionId', open[0].sessionId, 's-open');
  eq('닫힌 문서의 sessionId', closed[0].sessionId, 's-closed');
  eq('없으면 없음', closed[1].sessionId, undefined);
}

// 소켓으로 나가는 행: 정해진 칸만
{
  const { open, closed } = buildDockList({
    tabs: [tab(7, 'a', { favIconUrl: 'data:image/png;base64,AAAA' })],
    history: [hist('a', 10, { sessionId: 's1' }), hist('b', 5)],
    activeId: 7,
    cfg,
  });
  const missing = new Set([key('b')]);
  eq('열린 행 칸', Object.keys(listRow(open[0], missing)).sort(), ['at', 'key', 'missing', 'pinned', 'sessionId', 'sub', 'title', 'url']);
  eq('탭·창·활성·파비콘은 안 나간다', ['tabId', 'windowId', 'isActive', 'favIconUrl', 'dupes'].some((k) => k in listRow(open[0], missing)), false);
  eq('닫힌 행 지워짐 표시', listRow(closed[0], missing).missing, true);
  eq('세션 없는 행은 칸이 없다', 'sessionId' in listRow(closed[0], missing), false);
}

// sessionId 검사: 터미널 환경변수에서 오는 글이라 그대로 믿지 않는다
eq('정상 id', sessionIdFrom('a75709d6-1b2c-4d3e'), 'a75709d6-1b2c-4d3e');
eq('64자 까지', sessionIdFrom('a'.repeat(64)), 'a'.repeat(64));
eq('65자는 버림', sessionIdFrom('a'.repeat(65)), undefined);
eq('경로 문자 버림', sessionIdFrom('../etc'), undefined);
eq('줄바꿈 버림', sessionIdFrom('abc\n'), undefined);
eq('빈 값 버림', sessionIdFrom(''), undefined);
eq('문자열 아님 버림', sessionIdFrom(42), undefined);
eq('프로토콜 번호', DOCK_LIST_PROTOCOL, 1);

// 정렬 원본은 한 곳이다. 사이드바에 정렬이 다시 생기면 폰과 갈린다.
const panel = fs.readFileSync(new URL('../src/sidepanel.js', import.meta.url), 'utf8');
eq('sidepanel.js 에 자체 정렬 없음', /\.sort\(/.test(panel), false);
eq('sidepanel.js 는 공용 함수를 쓴다', /buildDockList\(/.test(panel), true);
const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');
eq('background.js 도 공용 함수를 쓴다', /buildDockList\(/.test(background), true);

process.exit(fail ? 1 : 0);
