FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY afterloss ./afterloss
COPY site ./site
COPY mcp-app ./mcp-app
COPY data/estate_demo.json ./data/estate_demo.json
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev
ENV PORT=8300 AFTERLOSS_DB=/data/afterloss.sqlite3
VOLUME ["/data"]
EXPOSE 8300
CMD ["uv", "run", "--no-sync", "afterloss", "serve"]
