# ==============================================================================
# Nocturne Memory - Multi-stage Dockerfile
# 单容器部署：Caddy（前端静态 + 反代后端） + Uvicorn（FastAPI）
# ==============================================================================

# ---------- Stage 1: 构建前端 ----------
FROM node:20-alpine AS frontend-builder

# npm 使用清华源
RUN npm config set registry https://registry.npmmirror.com

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------- Stage 2: 最终运行镜像 ----------
FROM python:3.12-slim

# apt 使用清华源
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources

# 安装 Caddy（单二进制，无需 Supervisor）
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl debian-keyring debian-archive-keyring apt-transport-https && \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && \
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends caddy && \
    apt-get purge -y debian-keyring debian-archive-keyring apt-transport-https && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pip 使用清华源安装 Python 依赖
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# 复制后端代码
COPY backend/ ./backend/

# 复制 .env.example 作为默认配置
COPY .env.example ./.env.example

# 复制前端构建产物
COPY --from=frontend-builder /build/dist /srv/frontend

# 复制 Caddyfile
COPY docker/Caddyfile /etc/caddy/Caddyfile

# 复制启动脚本
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 创建数据目录
RUN mkdir -p /app/data

# 默认环境变量
ENV DATABASE_URL=sqlite+aiosqlite:////app/data/memory.db
ENV VALID_DOMAINS=core,writer,game,notes
ENV CORE_MEMORY_URIS=core://agent,core://my_user,core://agent/my_user

EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8000/api/health || exit 1

CMD ["/app/start.sh"]
