FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

ENV LITOPYS_GRAPH_PATH=/data/graph
RUN mkdir -p /data/graph
VOLUME ["/data/graph"]

ENTRYPOINT ["bun", "packages/cli/src/index.ts"]
CMD ["mcp", "stdio"]
