# CourseHub 前端 → nginx 静态产物镜像
# 由 EchoMind/docker-compose.yml 的 nginx 服务构建;
# nginx.conf 仍由 EchoMind/config/nginx/nginx.conf 卷挂载提供。

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
