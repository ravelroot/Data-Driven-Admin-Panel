FROM node:22-alpine AS construcao

WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/package.json
COPY api/package.json api/package.json
RUN npm ci --no-audit --no-fund

COPY VERSION ./
COPY web ./web
COPY api ./api
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine

ENV NODE_ENV=production \
    BENTO_HOST=0.0.0.0 \
    BENTO_PORTA=8080

WORKDIR /app
RUN addgroup -S bento && adduser -S -G bento -h /app bento

COPY --from=construcao /app/package.json /app/VERSION ./
COPY --from=construcao /app/node_modules ./node_modules
COPY --from=construcao /app/api/package.json ./api/package.json
COPY --from=construcao /app/api/dist ./api/dist
COPY --from=construcao /app/api/migracoes ./api/migracoes
COPY --from=construcao /app/web/package.json ./web/package.json
COPY --from=construcao /app/web/dist ./web/dist
RUN mkdir -p dados && chown -R bento:bento /app

USER bento
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/api/v1/saude >/dev/null || exit 1
CMD ["node", "api/dist/servidor.js"]
