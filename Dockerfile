# ============================================================
# Stage 1: Build / Install Python dependencies
# ============================================================
FROM python:3.13-slim AS builder

WORKDIR /app

# Install system build deps for Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements (inline) and install Python packages
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# ============================================================
# Stage 2: Runtime image
# ============================================================
FROM python:3.13-slim AS runtime

WORKDIR /app

# Install Node.js 24
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && NODE_MAJOR=24 \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Python site-packages from builder stage
COPY --from=builder /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application files
COPY server/ ./server/
COPY scripts/ ./scripts/
COPY public/ ./public/
COPY views/ ./views/
COPY data/ ./data/
COPY world-cup-data/ ./world-cup-data/
COPY histroy-match-data/ ./histroy-match-data/

# Create runtime directories (for backtest reports, predictions, etc.)
RUN mkdir -p ./models/ ./data/backtest/reports ./data/backtest/predictions

# Exclude .env — must be injected via environment variables at runtime
# (not copying .env; if present locally, it won't be in the image)

EXPOSE 3000

CMD ["node", "server/index.js"]
