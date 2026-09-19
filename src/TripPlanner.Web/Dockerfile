FROM node:22-alpine
WORKDIR /workspace/src/TripPlanner.Web

COPY src/TripPlanner.Web/package.json src/TripPlanner.Web/pnpm-lock.yaml src/TripPlanner.Web/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY src/TripPlanner.Web/ ./
EXPOSE 5173
CMD ["pnpm", "run", "dev"]
