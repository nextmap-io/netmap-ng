FROM python:3.12-slim

# rrdtool CLI only: the app shells out to `rrdtool xport`, no Python binding.
RUN apt-get update && apt-get install -y --no-install-recommends rrdtool && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run unprivileged; /app/data holds the SQLite database (volume).
RUN useradd --system --uid 10001 --home-dir /app netmap && \
    mkdir -p /app/data && chown netmap /app/data
USER netmap

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
