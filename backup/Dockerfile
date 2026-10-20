FROM alpine:3.22

ARG SUPERCRONIC_URL=https://github.com/aptible/supercronic/releases/download/v0.2.50/supercronic-linux-amd64
ARG SUPERCRONIC_SHA1SUM=0795da10bf6303e9680a2c2bd8dd6b9aa33ebda2

RUN apk add --no-cache restic postgresql17-client curl tzdata bash jq \
 && curl -fsSL "$SUPERCRONIC_URL" -o /usr/local/bin/supercronic \
 && echo "${SUPERCRONIC_SHA1SUM}  /usr/local/bin/supercronic" | sha1sum -c - \
 && chmod +x /usr/local/bin/supercronic \
 && apk del curl

COPY run-backup.sh /usr/local/bin/run-backup.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/*.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
