FROM node:24-bookworm-slim
WORKDIR /app/cloud
COPY cloud/package.json cloud/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY cloud/src ./src
COPY cloud/tools/smoke.js ./tools/smoke.js
COPY fly-host/src /app/fly-host/src
USER node
ENV HOST=0.0.0.0 PORT=9000 MODEL_DIR=/model NEURAL_TOKEN_FILE=/run/secrets/neural_token
EXPOSE 9000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:9000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
