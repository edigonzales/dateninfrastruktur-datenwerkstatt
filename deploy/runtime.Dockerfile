# Test the exact runtime stage using the already built, hash-checked local distribution.
FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648
COPY dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
RUN setcap -r /usr/bin/caddy
ENV HOME=/tmp XDG_CONFIG_HOME=/tmp/config XDG_DATA_HOME=/tmp/data
USER 10001:0
EXPOSE 8080
ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
