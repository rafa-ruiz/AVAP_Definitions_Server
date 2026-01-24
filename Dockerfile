FROM node:22-alpine

# Init system para manejo correcto de señales
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && npm cache clean --force

# Copiar código fuente Y el archivo proto
COPY src/ ./src/
COPY avap.proto .

# Usuario sin privilegios
USER node

EXPOSE 50051

CMD ["node", "src/server.js"]