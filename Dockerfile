FROM docker.io/library/node:24-bookworm-slim AS build
WORKDIR /app
ENV npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-fund --no-audit

FROM docker.io/library/node:24-bookworm-slim
LABEL org.opencontainers.image.title="Digitalni arhiv pogodb"
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TZ=Europe/Ljubljana
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY demo ./demo
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
