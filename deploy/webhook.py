#!/usr/bin/env python3
"""
教学工作台 · GitHub Webhook 自动部署接收器（零依赖，仅标准库）

原理：GitHub push 事件 → POST /hooks/deploy → 校验签名 → git pull → 站点即时更新。

服务器端部署步骤（一次性）：
  1) 克隆仓库：  git clone <你的仓库地址> /var/www/teaching-workbench
  2) 配置密钥：  修改下方 SECRET 为随机长字符串（与 GitHub Webhook Secret 一致）
  3) 启动服务：  python3 webhook.py  （建议用 systemd 常驻，见 webhook.service）
  4) GitHub 仓库 → Settings → Webhooks → Add webhook：
       Payload URL : http://<你的域名>/hooks/deploy   （经 nginx 反代到 127.0.0.1:9000）
       Content type: application/json
       Secret      : 与下方 SECRET 一致
       触发事件    : Just the push event
"""

import hashlib
import hmac
import json
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer

SECRET = b"please-change-me-to-a-long-random-string"   # 必须修改！
REPO_DIR = "/var/www/teaching-workbench"               # 服务器上的仓库目录
PORT = 9000
LOG = "/var/log/teaching-workbench-deploy.log"


def log(msg: str) -> None:
    from datetime import datetime
    line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}\n"
    print(line, end="")
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass


def verify_signature(payload: bytes, signature: str) -> bool:
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(SECRET, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature[7:], expected)


def deploy() -> None:
    log("开始拉取最新代码 ...")
    r = subprocess.run(
        ["git", "-C", REPO_DIR, "pull", "--ff-only"],
        capture_output=True, text=True,
    )
    log(f"git pull 退出码 {r.returncode}：{(r.stdout + r.stderr).strip()[:500]}")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/hooks/deploy":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = self.rfile.read(length)
        sig = self.headers.get("X-Hub-Signature-256", "")
        event = self.headers.get("X-GitHub-Event", "")

        if not verify_signature(payload, sig):
            log("签名校验失败，拒绝请求")
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b"invalid signature")
            return

        if event == "ping":
            log("GitHub webhook 握手成功（ping）")
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"pong")
            return

        try:
            body = json.loads(payload or b"{}")
            branch = (body.get("ref") or "").rsplit("/", 1)[-1]
            log(f"收到 push 事件，分支：{branch}")
            if branch in ("main", "master"):
                deploy()
        except Exception as e:  # noqa: BLE001
            log(f"部署异常：{e}")

        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"deployed")

    def log_message(self, *args):  # 静默默认访问日志
        pass


if __name__ == "__main__":
    log(f"webhook 接收器启动，监听 127.0.0.1:{PORT}")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
