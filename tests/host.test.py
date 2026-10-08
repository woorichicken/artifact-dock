"""host 를 Chrome 인 척 띄워서 CLI → host → 확장 경로를 실측한다."""
import json, os, struct, subprocess, sys, threading, time

HOST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "host", "artifact_dock_host.py")
# 실제로 돌고 있는 확장의 소켓을 건드리면 안 되므로 테스트 전용 경로를 쓴다
TEST_SOCK = f"/tmp/artifact-dock-test-{os.getpid()}.sock"
env = {**os.environ, "ARTIFACT_DOCK_SOCKET": TEST_SOCK}
p = subprocess.Popen([sys.executable, HOST], stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)

def read_msg():
    h = p.stdout.read(4)
    if len(h) < 4: return None
    (n,) = struct.unpack("<I", h)
    return json.loads(p.stdout.read(n))

def send_msg(o):
    b = json.dumps(o).encode()
    p.stdin.write(struct.pack("<I", len(b)) + b); p.stdin.flush()

ready = read_msg()
print("1) host:ready 수신 =", ready)
assert ready and ready.get("type") == "host:ready", "host:ready 안 옴"

# 확장 역할: 요청이 오면 성공 응답을 돌려준다
result = {}
def fake_extension():
    msg = read_msg()
    result["req"] = msg
    send_msg({"id": msg["id"], "ok": True, "reused": False, "tabId": 42})
threading.Thread(target=fake_extension, daemon=True).start()

time.sleep(0.4)
CLI = os.path.join(os.path.dirname(HOST), "..", "bin", "artifact-open")
open("/tmp/dock-test-a.html", "w").write("<h1>a</h1>")
cli = subprocess.run(["bash", CLI, "/tmp/dock-test-a.html"],
                     capture_output=True, text=True, env=env)
print("2) CLI exit =", cli.returncode, "| stderr:", cli.stderr.strip()[:120])
time.sleep(0.3)
print("3) host 가 확장에 전달한 요청 =", result.get("req"))

ok = cli.returncode == 0 and result.get("req", {}).get("url", "").startswith("file:///tmp/dock-test-a")
print("\nRESULT:", "PASS" if ok else "FAIL")

# 한글/공백 파일명도 확인
os.makedirs("/tmp/dock 테스트", exist_ok=True)
open("/tmp/dock 테스트/보고서 v2.html", "w").write("<h1>ko</h1>")
result.clear()
threading.Thread(target=fake_extension, daemon=True).start()
time.sleep(0.2)
cli2 = subprocess.run(["bash", CLI, "/tmp/dock 테스트/보고서 v2.html"],
                      capture_output=True, text=True, env=env)
time.sleep(0.3)
print("4) 한글+공백 경로 exit =", cli2.returncode, "url =", result.get("req", {}).get("url"))

# 확장 → host 질의: 파일이 아직 있는가 (지워진 파일 정리용)
print("5) host:ready caps =", ready.get("caps"))
send_msg({"id": "ext-1", "cmd": "exists",
          "paths": ["/tmp/dock-test-a.html", "/private/tmp/dock-test-a.html",
                    "/tmp/dock 테스트/보고서 v2.html", "/tmp/dock-없는-파일.html", "relative.html"]})
reply = read_msg()
print("6) exists 응답 =", reply)
want = {"/tmp/dock-test-a.html": True, "/private/tmp/dock-test-a.html": True,
        "/tmp/dock 테스트/보고서 v2.html": True, "/tmp/dock-없는-파일.html": False}
exists_ok = ("exists" in (ready.get("caps") or [])
             and reply and reply.get("type") == "host:reply" and reply.get("id") == "ext-1"
             and reply.get("exists") == want)
print("   exists RESULT:", "PASS" if exists_ok else "FAIL")
ok = ok and exists_ok

p.stdin.close(); p.terminate()
for f in ("/tmp/dock-test-a.html", "/tmp/dock 테스트/보고서 v2.html"):
    try: os.remove(f)
    except OSError: pass
sys.exit(0 if ok else 1)
