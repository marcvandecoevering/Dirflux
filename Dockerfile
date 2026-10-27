FROM node:24-alpine AS assets
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY scripts/assets.js ./scripts/assets.js
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8094 FILES_DIR=/files CONFIG_DIR=/config
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY --from=assets /build/public ./public
COPY LICENSE LICENSE.droppy THIRD_PARTY_NOTICES.md ./
RUN mkdir /files /config && chown node:node /files /config
USER node
VOLUME ["/files", "/config"]
EXPOSE 8094
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8094/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
