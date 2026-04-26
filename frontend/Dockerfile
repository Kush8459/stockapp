# syntax=docker/dockerfile:1.7
# ---- Build stage ---------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps in their own layer for Docker cache re-use.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .

# Vite picks up these env vars at build time. Defaults work against a sibling
# backend service on the same Docker network (see docker-compose.prod.yml).
ARG VITE_API_URL=http://localhost:8080
ARG VITE_WS_URL=ws://localhost:8080
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_WS_URL=${VITE_WS_URL}

RUN npm run build

# ---- Runtime stage -------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# SPA nginx config: every unknown path falls back to index.html so
# client-side routing works on a direct URL.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1/ || exit 1
