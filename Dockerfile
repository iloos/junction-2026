# SvelteKit (adapter-node) image for Aiven Runtime or a plain VM.
# Runtime secrets come from the platform's env vars, never from the image.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
# Read at runtime: SQL migrations (drizzle migrate) and demo seeds.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/fixtures ./fixtures
EXPOSE 3000
USER node
CMD ["node", "build"]
