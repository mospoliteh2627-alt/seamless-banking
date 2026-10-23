FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY apps ./apps
COPY packages ./packages

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

CMD ["node", "apps/api/src/server.js"]
