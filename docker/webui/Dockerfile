FROM node:20-bookworm-slim

ARG OPEN5GS_VERSION=v2.7.5
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone --depth 1 --branch "${OPEN5GS_VERSION}" https://github.com/open5gs/open5gs.git \
    && cd open5gs/webui && npm ci && npm run build

WORKDIR /opt/open5gs/webui
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=9999
EXPOSE 9999
CMD ["npm", "run", "start"]
