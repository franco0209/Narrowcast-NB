#!/bin/sh
set -eu
: "${MQTT_USER:?}" "${MQTT_PASS:?}"
rm -f /tmp/passwd
mosquitto_passwd -b -c /tmp/passwd "$MQTT_USER" "$MQTT_PASS"
chown mosquitto:mosquitto /tmp/passwd && chmod 600 /tmp/passwd
exec mosquitto -c /mosquitto/config/mosquitto.conf
