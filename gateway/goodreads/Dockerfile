ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
COPY quota.ts ./quota.ts
COPY goodreads/model.mjs goodreads/danibooks.mjs goodreads/service.mjs goodreads/run.mjs ./goodreads/
COPY goodreads/nli/ ./goodreads/nli/
USER node
ENV NODE_OPTIONS=--max-old-space-size=96
EXPOSE 4333
CMD ["node", "goodreads/run.mjs"]
