// 새 문서를 열 창 고르기. 지정한 받는 창이 닫혔을 때 원래 동작으로 돌아가는지가 핵심이다.
import { chooseTargetWindow } from '../src/lib/windows.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  got=${got} want=${want}`);
};

eq('받는 창이 열려 있으면 그 창',
  chooseTargetWindow({ dockWindowId: 2, windowIds: [1, 2, 3], lastFocusedId: 3 }), 2);
eq('받는 창이 닫혔으면 마지막에 포커스된 창',
  chooseTargetWindow({ dockWindowId: 9, windowIds: [1, 2, 3], lastFocusedId: 3 }), 3);
eq('지정이 없으면 마지막에 포커스된 창',
  chooseTargetWindow({ dockWindowId: undefined, windowIds: [1, 2], lastFocusedId: 1 }), 1);
eq('받는 창 id 가 0 이어도 지정으로 본다',
  chooseTargetWindow({ dockWindowId: 0, windowIds: [0, 5], lastFocusedId: 5 }), 0);
eq('마지막 포커스 창을 모르면 아무 창',
  chooseTargetWindow({ dockWindowId: null, windowIds: [4, 5], lastFocusedId: null }), 4);
eq('마지막 포커스 창이 일반 창 목록에 없으면(팝업 등) 아무 창',
  chooseTargetWindow({ dockWindowId: null, windowIds: [4, 5], lastFocusedId: 99 }), 4);
eq('창이 하나도 없으면 null → 호출부가 새 창을 만든다',
  chooseTargetWindow({ dockWindowId: 2, windowIds: [], lastFocusedId: null }), null);

eq('사이드바가 열린 창이 하나면 마지막 포커스가 다른 창이어도 그 창',
  chooseTargetWindow({ dockWindowId: null, windowIds: [1, 2], lastFocusedId: 2, panelWindowIds: [1] }), 1);
eq('마지막 포커스 창에 사이드바가 있으면 그 창',
  chooseTargetWindow({ dockWindowId: null, windowIds: [1, 2], lastFocusedId: 2, panelWindowIds: [1, 2] }), 2);
eq('사이드바 창이 여럿이고 마지막 포커스는 사이드바 없는 창이면 가장 최근에 포커스된 사이드바 창',
  chooseTargetWindow({ dockWindowId: null, windowIds: [1, 2, 3], lastFocusedId: 3, panelWindowIds: [1, 2], focusAt: { 1: 10, 2: 20 } }), 2);
eq('받는 창 지정이 사이드바 창보다 우선',
  chooseTargetWindow({ dockWindowId: 2, windowIds: [1, 2], lastFocusedId: 1, panelWindowIds: [1] }), 2);
eq('닫힌 창의 사이드바 기록은 무시',
  chooseTargetWindow({ dockWindowId: null, windowIds: [2], lastFocusedId: 2, panelWindowIds: [9] }), 2);

process.exit(fail ? 1 : 0);
