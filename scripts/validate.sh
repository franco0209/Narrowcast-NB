#!/usr/bin/env bash
# Valida la Fase 1: núcleo arriba, UE simulado registrado y con IP, ping por el túnel.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
check() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi; }

for s in mongo mme hss sgwc sgwu pgwc pgwu pcrf webui; do
  check "$s corriendo" "[ -n \"\$(docker compose ps --status running -q $s)\" ]"
done
check "S1 Setup (eNB conectado al MME)" "docker compose exec -T mme grep -Eq 'eNB-S1 accepted|S1-Setup' /var/log/open5gs/mme.log"
check "Attach completo" "docker compose exec -T mme grep -Eq 'Attach complete|Attach request' /var/log/open5gs/mme.log"
check "UE obtuvo IP" "docker compose exec -T ue ip -4 addr show tun_srsue | grep -q 'inet 10.58.'"
check "Ping por el túnel al UPF" "docker compose exec -T ue ping -c 3 -W 2 -I tun_srsue 10.58.0.1"
exit $fail
