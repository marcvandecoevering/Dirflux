FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS assets
WORKDIR /build
COPY package*.json ./
RUN apk upgrade --no-cache && npm ci
COPY scripts/assets.js ./scripts/assets.js
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 FILES_DIR=/files CONFIG_DIR=/config
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.revision=$SOURCE_REVISION \
      org.opencontainers.image.title="Dirflux" \
      org.opencontainers.image.source="https://github.com/marcvandecoevering/Dirflux" \
      org.opencontainers.image.licenses="BSD-2-Clause"
WORKDIR /app
COPY package*.json ./
RUN apk upgrade --no-cache && npm ci --omit=dev && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY server.js ./
COPY lib ./lib
COPY --from=assets /build/public ./public
COPY LICENSE LICENSE.droppy THIRD_PARTY_NOTICES.md ./
RUN mkdir /files /config && chown node:node /files /config
USER root
ENTRYPOINT ["node", "/app/lib/container-entrypoint.js"]
VOLUME ["/files", "/config"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD ["node", "lib/health-check.js"]
CMD ["node", "server.js"]
