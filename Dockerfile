# Single image serving both the API and the built client, so there is one
# origin and the session cookie needs no cross-site relaxation.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/domain ./src/domain
COPY src/state/seed.ts ./src/state/seed.ts
COPY tsconfig.server.json ./

# The database and attachments live on a mounted volume, not in the image.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
ENV AEGIS_DATA_DIR=/data AEGIS_DB=/data/aegis.db AEGIS_SERVE_CLIENT=1 PORT=4000

# Never as root.
USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "server/index.ts"]
