# Artifact Dock

> A Chrome extension + CLI that opens agent-generated local HTML reports and Claude artifacts
> **in a background tab, one tab per document, listed in a side panel** — without stealing focus.
> macOS only. [Privacy policy](PRIVACY.md) · MIT License

에이전트가 열어대는 로컬 HTML·Claude 아티팩트를 **포커스 안 뺏고 / 탭 하나만 / 사이드바 목록으로** 다루는 Chrome 확장 + CLI.

## 해결하는 것

| 증상 | 원인 | 이 프로젝트의 처리 |
|---|---|---|
| 파일 열 때마다 화면이 Chrome으로 넘어감 | `open` 이 **Chrome 앱 자체를** 앞으로 가져옴 | CLI가 소켓으로 확장에 부탁 → 확장이 `tabs.create({active:false})` 로 **백그라운드 탭** 생성 |
| 같은 리포트를 열 때마다 새 탭 | dedup 없음 | 파일 경로(또는 파일명) 기준으로 기존 탭 재사용 + 새로고침 |
| 탭이 많아 파비콘만 보임 | 탭바 포화 | 사이드 패널 목록 + 탭그룹으로 한 덩어리 |

### 왜 CLI만으로는 안 되나 (실측)

`open -g` (앱을 앞으로 안 가져오는 플래그)도, AppleScript `make new tab` 만으로도 **Chrome은 스스로 앞으로 나온다.**

```
base=Finder  →  0.3s: Google Chrome  0.7s: Google Chrome   ← open -g 를 써도 이렇다
```

확장이 연결돼 있을 때만 연다. `tabs.create({active:false})`로 백그라운드 탭을 만들고,
경로·파일명·제목 규칙으로 기존 탭을 재사용한다.

확장이 연결되지 않거나 응답이 실패하면 CLI도 실패한다. 예전 AppleScript 대체 경로는
2026-09-23에 제거했다. 포커스를 복원하려 시도하는 것보다 직접 열기를 시작하지 않는 것이 확실하다.

## 설치

확장은 Chrome 웹스토어 또는 소스(압축해제 로드) 중 하나로 설치한다. **어느 쪽이든 CLI·네이티브 호스트는
`install.sh` 로 따로 깐다** — 확장은 로컬 프로그램을 설치할 수 없어서다.

```bash
git clone https://github.com/woorichicken/artifact-dock.git
cd artifact-dock
./install.sh
```

`host/.extension-id` 에 적힌 확장 ID(소스 로드용 · 웹스토어용)를 모두 허용하므로 둘 중 무엇으로 깔아도 연결된다.

소스로 로드할 때는 Chrome에서:

1. `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드** → 이 폴더 선택
3. 확장 상세에서 **"파일 URL에 대한 액세스 허용"** 켜기 (로컬 HTML을 다루므로)
4. 확인:

```bash
artifact-open --status     # "확장 연결: 살아있음" 이면 끝
```

> `--status` 가 "없음"이면 확장을 껐다 켜세요. 네이티브 호스트는 확장이 켜질 때 실행됩니다.

## 처음 설치하면

설치 직후 **설치 안내 탭**이 열린다. 파일 URL 접근·CLI 연결을 브라우저에 직접 물어 완료 여부를 표시하고,
에이전트에게 붙여넣을 프롬프트를 복사할 수 있다. 사이드바의 🤖 로도 같은 프롬프트를 복사한다.
닫은 뒤에는 설정 맨 위 「설치 안내 다시 보기」.

화면 언어는 브라우저 언어를 따른다 — 한국어·English·Español, 그 외는 영어. 문구 원본은 `_locales/<lang>/messages.json`.

## 사용

```bash
artifact-open report.html          # 백그라운드로 열기 (같은 파일이면 기존 탭 새로고침)
artifact-open a.html b.html        # 여러 개
artifact-open -f report.html       # 이번만 포커스 주면서
artifact-open --status
```

사이드바는 툴바 아이콘 클릭 또는 `Cmd+Shift+U`.

### 에이전트에게 설정 맡기기

설치 안내 4단계(또는 사이드바 🤖)에서 **설정 프롬프트**를 복사해 Claude Code·Codex 대화에 붙여넣는다.
에이전트가 직접 한다: 저장소 clone → `install.sh` → 셸 설정(`~/.zshrc`)에서 `~/.local/bin` 을 `/usr/bin`
앞에 두기 → `command -v open`·`artifact-open --status` 확인 → 임시 HTML 로 백그라운드 열기 확인.

지시문을 CLAUDE.md 에 적어 두는 방식 대신 **`open` 자체를 가로채는** 쪽을 택했다. 에이전트가 지시를
잊어도, 스크립트·Node 가 `open` 을 직접 불러도 같은 경로를 타기 때문이다(아래 절).

### HTML 직접 열기 차단 (2026-09-23)

`./install.sh --cli-only`는 기존 네이티브 호스트 등록을 건드리지 않고
`~/.local/bin/artifact-open`과 `~/.local/bin/open`만 연결한다. 기존의 다른 실행 파일은
덮어쓰지 않고 설치를 중단한다. `~/.local/bin`은 `/usr/bin`보다 PATH에서 앞에 있어야 한다.

- `open 보고서.html`과 Node `execFileSync("open", [파일])`도 실행 파일 래퍼를 통해
  Artifact Dock으로 간다. `.zshrc` 함수만으로는 Node의 직접 실행을 가로챌 수 없다.
- `.html`/`.htm`은 대소문자와 file/HTTP URL의 쿼리·프래그먼트를 구분한다.
  `-g`와 `-a 앱`/`-b 번들`은 받아도 HTML은 확장을 통해 백그라운드로 연다.
  HTML의 미지원 옵션이나 HTML+다른 파일 혼합 요청은 실행 전에 거부한다.
- HTML이 아닌 명령은 인자를 그대로 `/usr/bin/open`에 전달한다.
- 확장 미연결·오류·잘못된 응답이면 `artifact-open`은 실패로 종료한다.
  AppleScript나 macOS `open`으로 자동 대체하지 않는다. 예전 `_open_quietly.py`도 같은 규칙을 따른다.
- `/usr/bin/open` 절대경로 호출이나 PATH를 바꾸는 프로그램까지 막는 OS 보안 장치는 아니다.
  HTML 제작 스크립트의 직접 opener 호출도 회귀 검사해야 한다.

검증: `python3 tests/open_guard.test.py`. 가짜 소켓과 실행 명령으로 성공·실패·Node 경로를
검사하므로 실제 Chrome은 열리지 않는다. 제거는 `./install.sh --uninstall`이며 자기 CLI 링크만 지운다.

## 이미 열려 있는 탭 정리

dedup 은 **새로 열 때**만 동작한다. 확장을 켜기 전부터 쌓여 있던 탭은 사이드바 하단 **[정리]** 버튼으로 치운다.

- 같은 문서를 가리키는 탭을 하나만 남기고 닫는다 (활성 탭 > Chrome 고정탭 > 최근에 본 탭 순으로 남김)
- 흩어진 아티팩트 탭을 탭그룹 하나로 모은다
- 설정에서 **브라우저 켤 때 자동 정리** 로 바꿀 수 있다

목록에서 같은 문서는 한 줄로 묶여 `×3` 배지가 붙는다. 배지를 누르면 그 문서의 중복만 닫는다.

> 제목은 같은데 파일명이 다른 리포트가 쌓인다면 설정에서 **같은 문서 판정 기준 → 문서 제목** 으로 바꾼다.

## 탭바가 파비콘으로 뒤덮이는 문제

Chrome 은 **접힌 그룹 안의 탭을 활성화하면 그룹을 통째로 펼친다.** 막을 방법이 없고,
활성 탭이 든 그룹은 다시 접는 것도 거부한다. 그래서 두 가지로 우회한다.

| 설정 | 동작 |
|---|---|
| **한 개만 꺼내기** (기본) | 볼 탭만 그룹 밖으로 빼내 보여준다. 나머지는 접힌 채 그대로. 그 탭을 벗어나면 조용히 그룹으로 돌려보낸다 |
| | ↳ `ungroup` 과 활성화는 **그 자체로 그룹을 펼친다.** 그래서 원래 접혀 있었는지 기억해 뒀다가, 탭이 그룹 밖으로 나온 뒤(= 접기가 허용되는 유일한 시점) 반드시 되돌린다 |
| | ↳ **탭을 그룹에 넣을 때도 펼쳐진다.** 접힘 복원은 `groupTabs()` 한 곳에서만 하고 모든 경로가 그걸 통과한다 |
| | ↳ 꺼내 둔 탭은 기록이 아니라 **실제 상태**로 되돌린다 — "그룹 밖에 있는 아티팩트 탭"을 매번 훑어서 집어넣는다. 서비스 워커가 죽어 기록이 끊겨도 탭이 밖에 남지 않는다 |
| 그룹 펼치기 | 평범하게 활성화한다. 대신 다른 탭으로 나가는 순간 그룹을 자동으로 다시 접는다 |

탭 수 자체를 줄이려면 **아티팩트 탭 최대 개수**를 정한다. 넘으면 오래 안 본 것부터 닫히는데,
사이드바 목록에는 남아서 클릭 한 번으로 되살아난다. 고정(📌)한 문서와 보고 있는 탭은 닫지 않는다.
하단 **[탭 비우기]** 도 같다 — 탭만 닫고 목록은 남긴다.

## 같은 문서인데 안 합쳐질 때

- **macOS 심링크**: `/tmp` 는 `/private/tmp` 의 심링크라 Chrome 이 어느 형태로 URL 을 만드느냐에
  따라 같은 파일이 두 문서로 갈렸다. `/tmp`·`/var`·`/etc` 는 `/private` 접두사를 떼고 판정한다.
- **파일명은 같고 경로가 다르면** 기본(전체 경로)에서는 별개 문서다. 설정에서 `파일 이름만` 또는
  `문서 제목` 으로 바꾼다.

## [정리]가 안 끌고 가는 탭

| 탭 | 이유 |
|---|---|
| 지금 보고 있는 탭 | solo 모드에선 일부러 그룹 밖에 둔다(넣으면 그룹이 펼쳐진다) |
| Chrome 탭 고정한 탭 | 고정탭은 그룹에 못 들어간다 |
| 다른 창의 탭 | 창을 넘겨 옮기지 않는다. 그 창에 그룹이 따로 생긴다 |
| HTML 이 아닌 `file://` | PDF·이미지 등은 대상이 아니다 |

## 문제가 생기면

```bash
./doctor.sh        # 호스트 등록·프로세스·소켓·CLI·Chrome 을 한 번에 점검
```

사이드바 왼쪽 아래에 `26개 열림 · 한 개만 · v0.2.0` 처럼 **버전과 모드**가 찍힌다.
확장을 고친 뒤에는 이 버전이 올라갔는지부터 본다 — 안 올라갔으면 `chrome://extensions` 에서
⟳ 를 누르지 않은 것이고, 그 상태에서 무엇을 고쳐도 반영되지 않는다.

## 설정 (확장 아이콘 → ⚙)

| 항목 | 기본 | 설명 |
|---|---|---|
| 같은 문서 판정 | 전체 경로 | `파일 이름만`(경로 무시) / `문서 제목`(파일명이 달라도 title 이 같으면) 로 바꿀 수 있음 |
| 재사용할 때 새로고침 | 켬 | 에이전트가 파일을 다시 썼을 테니 |
| 포커스 가드 | 켬 | 외부에서 열린 탭이면 직전 탭으로 되돌림. 페이지 내 링크 클릭은 건드리지 않음 |
| 탭 그룹 | 켬 | 그룹 이름·색. 기본으로 **접어둔다** |
| 사이드바에서 볼 때 | 한 개만 꺼내기 | 탭바가 펼쳐지지 않게 그 탭만 그룹 밖으로 |
| 아티팩트 탭 최대 개수 | 0 (무제한) | 넘으면 오래된 것부터 닫음 (목록은 유지) |
| 시작할 때 자동 정리 | 끔 | 브라우저를 켤 때 중복 탭을 자동으로 닫음 |
| Claude 아티팩트 | 켬 | `claude.ai/code/artifact/…`, `/public/artifacts/…`, `claude.site/artifacts/…` 를 함께 관리. 끄면 로컬 파일만 |

## 구조

```
manifest.json            확장 매니페스트 (key 고정 → ID 가 항상 hanplflofffhnolmbildckncaclkjbmf)
src/background.js        dedup · 포커스 복원 · 탭그룹 · 네이티브 호스트 연결
src/lib/keys.js          "같은 문서인가" 판정 규칙 (dedup 의 핵심)
src/lib/config.js        설정 기본값
src/sidepanel.*          사이드바 목록 UI
src/options.*            설정 화면
host/artifact_dock_host.py   CLI(unix socket) ↔ 확장(native messaging) 다리
bin/artifact-open        CLI. 소켓 실패 시 nonzero 중단(직접 열기 금지)
install.sh               네이티브 호스트 등록 + CLI 링크 (--uninstall 로 제거)
scripts/build-cws.sh     웹스토어 업로드용 zip (manifest key 제거) → dist/
PRIVACY.md               개인정보 처리방침 (웹스토어 등록 필수)
run-tests.sh             확장 없이 돌릴 수 있는 검증
```

## 검증

```bash
./run-tests.sh
```

- `tests/i18n.test.mjs` — 언어별 키·치환자 일치, 코드가 쓰는 키 존재, en/es 에 한글 잔존 없음, 스토어 글자 수 제한
- `tests/keys.test.mjs` — dedup 키 규칙 14케이스 (쿼리 무시, 파일명 모드, 한글/공백, 비대상 판정)
- `tests/host.test.py` — 호스트를 Chrome 인 척 띄워 CLI→호스트→확장 왕복 실측
- `tests/open_guard.test.py` — Node/셸 HTML 라우팅, 실패 시 직접 열기 금지, CLI 설치 충돌 검사

확장 안에서 도는 것(백그라운드 탭 생성, 포커스 복원, 탭그룹)은 브라우저에 로드해야 확인된다.

## 알려진 한계

- **macOS 전용**. HTML이 아닌 파일의 `/usr/bin/open` 위임과 소켓 경로가 macOS 기준.
- Chrome 창이 **하나도 없을 때** 여는 경우, 새 창은 `focused:false` 로 만들지만 OS가 앱을 앞으로 낼 수 있다.
- 파일 내용이 바뀌어도 **자동 새로고침은 하지 않는다**. 같은 경로로 다시 `artifact-open` 하면 새로고침된다.
- 네이티브 호스트는 확장이 켜져 있을 때만 산다. 연결이 없으면 CLI는 오류로 중단한다.
