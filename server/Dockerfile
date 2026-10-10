FROM node:20-alpine
WORKDIR /app
COPY server.js huangdou-bridge.js yeguo-bridge.js ./
ENV PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.js"]
