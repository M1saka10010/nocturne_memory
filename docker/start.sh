#!/bin/sh
set -e

# 启动 REST API 后端（后台运行）
cd /app/backend
python -m uvicorn main:app --host 127.0.0.1 --port 8001 &

# 启动 MCP SSE Server（后台运行）
PORT=8002 HOST=127.0.0.1 python run_sse.py &

# 启动 Caddy（前台运行，作为 PID 1）
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
