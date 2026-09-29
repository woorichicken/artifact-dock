import { artifactKey, displayName, subLabel } from '../src/lib/keys.js';

const path = { matchMode: 'path', trackClaudeArtifacts: true };
const name = { matchMode: 'filename', trackClaudeArtifacts: true };
let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

eq('기본 file', artifactKey('file:///tmp/a.html', path), 'file:/tmp/a.html');
eq('쿼리/해시 무시', artifactKey('file:///tmp/a.html?t=99#x', path), 'file:/tmp/a.html');
eq('공백 디코딩', artifactKey('file:///tmp/my%20report.html', path), 'file:/tmp/my report.html');
eq('경로 모드는 디렉토리 구분', artifactKey('file:///b/r.html', path) === artifactKey('file:///a/r.html', path), false);
eq('파일명 모드는 합침', artifactKey('file:///b/r.html', name), artifactKey('file:///a/r.html', name));
eq('html 아니면 대상 아님', artifactKey('file:///tmp/a.pdf', path), null);
eq('일반 웹은 대상 아님', artifactKey('https://google.com/x.html', path), null);
eq('claude 아티팩트(public)', artifactKey('https://claude.ai/public/artifacts/abc-123', path), 'artifact:abc-123');
eq('claude code 아티팩트(단수 경로)',
   artifactKey('https://claude.ai/code/artifact/bb968be8-0152-43e1-9d79-8101248a5b47?via=auto_preview', path),
   'artifact:bb968be8-0152-43e1-9d79-8101248a5b47');
eq('쿼리 달라도 같은 아티팩트',
   artifactKey('https://claude.ai/code/artifact/bb968be8?via=auto_preview', path),
   artifactKey('https://claude.ai/code/artifact/bb968be8', path));
eq('claude.site 공유 링크', artifactKey('https://claude.site/artifacts/xyz789', path), 'artifact:xyz789');
eq('claude.ai 일반 페이지는 대상 아님', artifactKey('https://claude.ai/chat/abc', path), null);
eq('아티팩트 부제', subLabel('https://claude.ai/code/artifact/bb968be8'), 'Claude 아티팩트');
eq('claude 끄면 무시', artifactKey('https://claude.ai/public/artifacts/abc-123', { ...path, trackClaudeArtifacts: false }), null);
eq('빈 url', artifactKey('', path), null);
// macOS 심링크: /tmp 와 /private/tmp 는 같은 파일이다
eq('/private/tmp 정규화', artifactKey('file:///private/tmp/a/x.html', path), 'file:/tmp/a/x.html');
eq('/tmp 와 /private/tmp 는 같은 문서',
   artifactKey('file:///tmp/claude-501/s/data.html', path),
   artifactKey('file:///private/tmp/claude-501/s/data.html', path));
eq('/private/var 정규화', artifactKey('file:///private/var/f/x.html', path), 'file:/var/f/x.html');
eq('/privatestuff 는 건드리지 않음', artifactKey('file:///privatestuff/x.html', path), 'file:/privatestuff/x.html');
eq('/private/home 은 대상 아님', artifactKey('file:///private/home/x.html', path), 'file:/private/home/x.html');
const title = { matchMode: 'title', trackClaudeArtifacts: true };
eq('제목 모드는 파일명 달라도 합침',
   artifactKey('file:///a/flow-v1.html', title, '검증 기록'),
   artifactKey('file:///b/flow-v2.html', title, '검증 기록'));
eq('제목 모드인데 제목 없으면 경로로', artifactKey('file:///a/x.html', title, ''), 'file:/a/x.html');
eq('제목이 파일명뿐이면 경로로', artifactKey('file:///a/x.html', title, 'x.html'), 'file:/a/x.html');
eq('제목 달라지면 다른 문서',
   artifactKey('file:///a/x.html', title, 'A') === artifactKey('file:///a/y.html', title, 'B'), false);
eq('about:blank', artifactKey('about:blank', path), null);
eq('표시명(제목 있음)', displayName('file:///tmp/a.html', '분기 리포트'), '분기 리포트');
eq('표시명(제목=파일명)', displayName('file:///tmp/a.html', 'a.html'), 'a.html');
eq('부제 홈 축약', subLabel('file:///Users/foo/Downloads/x.html'), '~/Downloads');

console.log(fail ? `\n${fail}건 실패` : '\n전부 통과');
process.exit(fail ? 1 : 0);
