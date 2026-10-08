// 사이드바 검색 규칙. 한글 검색이 안 되던 원인(NFD 파일명 · %인코딩 URL · 조합 중인 글자)을 고정한다.
import { matchesQuery, queryVariants, fold } from '../src/lib/search.js';
import { subLabel } from '../src/lib/keys.js';

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// macOS Finder·다운로드가 만든 파일명은 NFD 로 들어온다. 제목이 없으면 파일명이 그대로 제목이 된다.
const nfdName = '주간 보고서.html'.normalize('NFD');
const nfdUrl = 'file:///tmp/' + encodeURIComponent(nfdName);
const fromFile = { title: nfdName, sub: subLabel(nfdUrl), url: nfdUrl };
eq('전제: NFD 파일명은 NFC 입력과 그냥은 안 맞는다', nfdName.includes('보고서'), false);
eq('NFD 파일명을 NFC 로 검색', matchesQuery(fromFile, '보고서'), true);

// 제목은 영어인데 경로(폴더)에만 한글이 있는 경우 — URL 이 %인코딩이라 예전에는 안 걸렸다
const dirUrl = 'file:///Users/me/' + encodeURIComponent('회의록'.normalize('NFD')) + '/notes.html';
const inDir = { title: 'Weekly notes', sub: subLabel(dirUrl), url: dirUrl };
eq('폴더 이름(%인코딩)의 한글로 검색', matchesQuery(inDir, '회의록'), true);
eq('부제는 ~ 로 줄어도 경로 전체로 찾는다', matchesQuery(inDir, 'users/me'), true);

const titled = { title: '배포 체크리스트', sub: '~/work', url: 'file:///Users/me/work/deploy.html' };
eq('제목 한글 검색', matchesQuery(titled, '체크'), true);
eq('없는 단어', matchesQuery(titled, '회고'), false);
eq('빈 검색어는 전부', matchesQuery(titled, '   '), true);
eq('영문 대소문자 무시', matchesQuery(titled, 'DEPLOY'), true);
eq('단어 여러 개는 모두 포함', matchesQuery(titled, '배포 deploy'), true);
eq('단어 하나라도 없으면 제외', matchesQuery(titled, '배포 회고'), false);

// 조합 중인 마지막 글자 — "체크리스트" 를 치는 동안 지나가는 상태들
eq('낱자로 끝남(체ㅋ)', matchesQuery(titled, '체ㅋ'), true);
eq('받침이 다음 초성이 될 글자(체킄 → 체크)', queryVariants('체킄').includes('체크'), true);
eq('받침 후보로 일치(배폿 → 배포)', matchesQuery(titled, '배폿'), true);
eq('완성된 글자는 원래 그대로도 후보', queryVariants('배포')[0], '배포');
eq('받침 없는 글자는 후보를 늘리지 않는다', queryVariants('배포').length, 1);
eq('앞 단어는 너그럽게 보지 않는다(배폿 체크)', matchesQuery(titled, '배폿 체크'), false);

eq('fold 는 NFC 로 합친다', fold('한글'.normalize('NFD')), '한글');
eq('claude 아티팩트(파일 아님)도 URL 로 찾는다',
  matchesQuery({ title: 'Plan', sub: 'Claude', url: 'https://claude.ai/code/artifact/abc-123' }, 'abc-123'), true);
eq('깨진 %시퀀스여도 죽지 않는다', matchesQuery({ title: 'x', sub: '', url: 'https://claude.ai/%E0%A4%A' }, 'zz'), false);

if (fail) { console.log(`\n${fail}건 실패`); process.exit(1); }
console.log('\nOK');
