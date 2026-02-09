# Pakao backend — Google Cloud Run (min-instances: 1 for zero cold starts)
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run sets PORT at runtime; default for local runs
ENV PORT=8080
EXPOSE 8080

# Shell form so $PORT is expanded at runtime
CMD uvicorn main:app --host 0.0.0.0 --port $PORT
