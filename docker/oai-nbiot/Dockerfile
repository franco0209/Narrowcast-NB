# eNB NB-IoT de OpenAirInterface (rama develop-nb-iot, 2020). Solo soporta Ubuntu 14.04/16.04.
FROM ubuntu:16.04

ARG DEBIAN_FRONTEND=noninteractive
ARG OAI_REPO=https://gitlab.eurecom.fr/oai/openairinterface5g.git
ARG OAI_BRANCH=develop-nb-iot
ARG OAI_COMMIT=677bbab27b0d1d3ca0ad54e7c32748dc64a0a690
# Hardware del eNB: USRP (UHD). Cambiar a "none" para compilar sin radio (solo S1/stack).
ARG OAI_HW=USRP

RUN apt-get update \
    && apt-get install -y --no-install-recommends sudo git ca-certificates lsb-release iproute2 iputils-ping \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
# Clon superficial (~50 MB); el historial completo pesa varios GB. El commit fijado debe ser la punta de la rama.
RUN git clone --depth 1 --branch "${OAI_BRANCH}" "${OAI_REPO}" oai \
    && cd oai \
    && test "$(git rev-parse HEAD)" = "${OAI_COMMIT}"

WORKDIR /opt/oai
# El script de OAI clona protobuf-c sin fijar versión; la actual exige C++17 (no existe en Ubuntu 16.04).
# Se fija v1.3.3, compatible con el protobuf 2.6.1 que instala el mismo script.
RUN sed -i 's#git clone https://github.com/protobuf-c/protobuf-c.git#git clone --branch v1.3.3 --depth 1 https://github.com/protobuf-c/protobuf-c.git#' cmake_targets/tools/build_helper \
    && grep -q 'branch v1.3.3' cmake_targets/tools/build_helper
RUN . ./oaienv && cd cmake_targets \
    && ./build_oai -I --eNB -x -w "${OAI_HW}" --install-system-files 2>&1 | tail -n 200 \
    && ls -l lte_build_oai/build/lte-softmodem \
    && rm -rf /var/lib/apt/lists/* /opt/oai/.git

COPY entrypoint.sh /usr/local/bin/nb-oai-entrypoint
RUN chmod +x /usr/local/bin/nb-oai-entrypoint
ENTRYPOINT ["nb-oai-entrypoint"]
