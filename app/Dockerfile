# Etapa 1: compila el front (React + Vite + TypeScript) a archivos estáticos.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Etapa 2: el panel (FastAPI) sirve esos estáticos y la API.
FROM python:3.12-slim
WORKDIR /app
# iproute2: el laboratorio (simlab) crea una interfaz TUN y reglas de enrutamiento por IP de origen.
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=web /web/dist /app/static
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
