#!/bin/sh
# Generates /etc/drachtio.conf.xml from env vars and starts drachtio-server.
# All vars have sane defaults so the container starts even without full config,
# but real calls require DRACHTIO_SIP_CONTACT to match the Railway-assigned public addr.
set -e

SECRET="${DRACHTIO_SECRET:-cymru}"
CONTACT="${DRACHTIO_SIP_CONTACT:-sip:0.0.0.0:5060}"
ROKE_HOST="${ROKE_TRUNK_HOST:-41.191.76.76}"
ROKE_PORT="${ROKE_TRUNK_PORT:-5060}"
LOG_LEVEL="${DRACHTIO_LOG_LEVEL:-info}"

# drachtio-server uses TCP for SIP on Railway (Railway TCP proxy does not support UDP).
# If Roke is configured to use TCP transport this will work directly; for UDP add a
# UDP-capable reverse-proxy or move drachtio-server to a VPS with port 5060/udp open.

cat > /etc/drachtio.conf.xml << CONF
<drachtio>
  <secret>${SECRET}</secret>
  <loglevel>${LOG_LEVEL}</loglevel>
  <sip>
    <contacts>
      <contact>${CONTACT};transport=tcp</contact>
    </contacts>
    <outbound-proxy>sip:${ROKE_HOST}:${ROKE_PORT};transport=tcp</outbound-proxy>
    <port>5060</port>
    <udp-mtu>4096</udp-mtu>
  </sip>
</drachtio>
CONF

echo "[drachtio-entrypoint] Config written — contact=${CONTACT}, roke=${ROKE_HOST}:${ROKE_PORT}"
exec drachtio -f /etc/drachtio.conf.xml
