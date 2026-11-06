FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --system --uid 10001 --no-create-home analise
COPY bento_analise ./bento_analise
USER analise
EXPOSE 8090
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8090/saude', timeout=4).status == 200 else 1)"
CMD ["uvicorn", "bento_analise.app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "2", "--no-server-header"]
