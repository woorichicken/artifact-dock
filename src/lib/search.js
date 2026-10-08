// 사이드바 검색 규칙. 순수 함수만 둬서 확장을 로드하지 않고 테스트한다(tests/search.test.mjs).
//
// 한글 검색이 안 되던 이유 두 가지:
//  1) macOS 는 파일 이름을 NFD(자모 분리형)로 준다. "보고서" 를 입력해도(NFC) 파일명 쪽은
//     ㅂ+ㅗ+ㄱ+ㅗ+ㅅ+ㅓ 라서 includes 가 실패한다 → 양쪽을 NFC 로 맞춘다.
//  2) URL 은 %EB%B3%B4… 로 인코딩돼 있어서 경로 속 한글이 검색에 안 걸린다 → 디코딩한 경로를 쓴다.

import { filePathOf } from './keys.js';

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JONG_COUNT = 28; // 종성 개수(없음 포함). 음절 코드 = base + (초성*21 + 중성)*28 + 종성
const COMPAT_JAMO = /[ㄱ-ㆎ]$/; // 낱자 ㄱ·ㅏ 처럼 아직 음절이 안 된 글자

/** 비교용으로 맞춘다: 자모 합치기(NFC) + 소문자 */
export function fold(s) {
  return String(s ?? '').normalize('NFC').toLowerCase();
}

/**
 * 입력 중인 한글의 마지막 글자는 아직 확정이 아니다.
 * "보고서" 를 치는 동안 입력창은 보 → 보ㄱ → 보고 → 보곳 → 보고서 로 지나가는데,
 * 그대로 비교하면 중간마다 "검색 결과 없음" 이 깜빡인다. 그래서 마지막 글자를 너그럽게 본다:
 *  - 낱자(ㄱ)로 끝나면 그 낱자를 뗀 것도 후보
 *  - 받침이 있는 음절(곳)로 끝나면 받침을 뗀 것(고)도 후보 — 받침이 다음 음절의 초성이 될 수 있다
 */
export function queryVariants(query) {
  const q = fold(query).trim();
  if (!q) return [];
  const out = [q];
  if (COMPAT_JAMO.test(q)) {
    const cut = q.slice(0, -1).trim();
    if (cut) out.push(cut);
    return out;
  }
  const last = q.codePointAt(q.length - 1);
  if (last >= HANGUL_BASE && last <= HANGUL_LAST) {
    const jong = (last - HANGUL_BASE) % JONG_COUNT;
    if (jong) out.push(q.slice(0, -1) + String.fromCodePoint(last - jong));
  }
  return out;
}

/** 항목에서 검색 대상이 되는 문자열 (제목 · 부제 · 디코딩한 경로 또는 URL) */
export function haystackOf(item) {
  const path = filePathOf(item.url || '');
  return fold(`${item.title || ''} ${item.sub || ''} ${path ?? safeDecode(item.url || '')}`);
}

/** 공백으로 나눈 단어가 전부 들어 있으면 일치. 마지막 단어만 입력 중인 것으로 본다. */
export function matchesQuery(item, query) {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = haystackOf(item);
  const done = words.slice(0, -1);
  if (!done.every((w) => hay.includes(w))) return false;
  return queryVariants(words[words.length - 1]).some((v) => hay.includes(v));
}

function safeDecode(s) {
  try {
    return decodeURI(s);
  } catch {
    return s; // 깨진 %시퀀스면 원문 그대로
  }
}
