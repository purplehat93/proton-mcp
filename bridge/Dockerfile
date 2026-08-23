FROM debian:bookworm-slim

ARG BRIDGE_VERSION=3.25.0
ARG BRIDGE_REVISION=1

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       debsig-verify \
       debian-keyring \
       gnupg \
       pass \
       procps \
    && rm -rf /var/lib/apt/lists/*

# Install Proton's signing key/policy, verify the downloaded package, then install it.
RUN set -eux; \
    curl -fsSLo /tmp/bridge_pubkey.gpg https://proton.me/download/bridge/bridge_pubkey.gpg; \
    gpg --batch --dearmor --output /tmp/debsig.gpg /tmp/bridge_pubkey.gpg; \
    mkdir -p /usr/share/debsig/keyrings/E2C75D68E6234B07; \
    mv /tmp/debsig.gpg /usr/share/debsig/keyrings/E2C75D68E6234B07/debsig.gpg; \
    curl -fsSLo /tmp/bridge.pol https://proton.me/download/bridge/bridge.pol; \
    mkdir -p /etc/debsig/policies/E2C75D68E6234B07; \
    cp /tmp/bridge.pol /etc/debsig/policies/E2C75D68E6234B07/bridge.pol; \
    curl -fsSLo /tmp/protonmail-bridge.deb \
      "https://proton.me/download/bridge/protonmail-bridge_${BRIDGE_VERSION}-${BRIDGE_REVISION}_amd64.deb"; \
    debsig-verify /tmp/protonmail-bridge.deb; \
    apt-get update; \
    apt-get install -y --no-install-recommends /tmp/protonmail-bridge.deb; \
    rm -rf /var/lib/apt/lists/* /tmp/protonmail-bridge.deb /tmp/bridge_pubkey.gpg /tmp/bridge.pol

COPY bridge/entrypoint.sh /usr/local/bin/proton-bridge-entrypoint
RUN chmod 0755 /usr/local/bin/proton-bridge-entrypoint

ENV BRIDGE_HOME=/data
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/proton-bridge-entrypoint"]
CMD ["run"]
