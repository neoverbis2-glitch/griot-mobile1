FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git bash ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.mjs ./
RUN useradd --create-home --uid 10001 griot && mkdir -p /workspace && chown -R griot:griot /app /workspace
USER griot
ENV PORT=8080
ENV WORKSPACE_ROOT=/workspace
EXPOSE 8080
CMD ["node", "server.mjs"]
