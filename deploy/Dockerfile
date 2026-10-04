FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS build
WORKDIR /build
RUN npm install --global npm@11.18.0
COPY package.json package-lock.json .npmrc ./
COPY scripts/patch-sqlrooms.mjs scripts/patch-sqlrooms.mjs
RUN npm ci
COPY . .
ARG APP_BASE_PATH=/
ARG WEBR_CHANNEL=post-message
ARG BUILD_ID=local-pilot-not-released
ENV APP_BASE_PATH=$APP_BASE_PATH
RUN npm run build && WEBR_CHANNEL=$WEBR_CHANNEL BUILD_ID=$BUILD_ID node scripts/deployment.mjs

FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS runtime
COPY --from=build /build/dist /srv
COPY --from=build /build/deploy/generated/Caddyfile /etc/caddy/Caddyfile
RUN setcap -r /usr/bin/caddy
ENV HOME=/tmp XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
USER 10001:0
EXPOSE 8080
ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
