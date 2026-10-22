#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

criar_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    senha=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
    chave=$(head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 64)
    sed -i.bak -e "s|^BENTO_DB_SENHA=.*|BENTO_DB_SENHA=${senha}|" -e "s|^BENTO_SEGREDO_JWT=.*|BENTO_SEGREDO_JWT=${chave}|" .env
    rm -f .env.bak
    echo "Arquivo .env criado com senha e chave aleatórias."
  fi
}

abrir() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true; fi
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true; fi
}

criar_env
porta=$(grep -E '^BENTO_PORTA=' .env | cut -d= -f2)
porta=${porta:-8080}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d --build
  printf "Aguardando o Bento subir"
  for _ in $(seq 1 90); do
    if curl -fsS "http://localhost:${porta}/api/v1/saude" >/dev/null 2>&1; then
      echo
      echo "Pronto! Abra http://localhost:${porta} e entre com admin@bento.local / bento123"
      abrir "http://localhost:${porta}"
      exit 0
    fi
    printf "."
    sleep 2
  done
  echo
  echo "O Bento ainda está subindo. Acompanhe com: docker compose logs -f bento"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Instale o Docker (https://docs.docker.com/get-docker/) ou o Node.js 22+ (https://nodejs.org) e rode de novo."
  exit 1
fi

echo "Docker não encontrado: usando Node.js com o banco embutido (PGlite)."
npm install --no-audit --no-fund
npm run build
(sleep 6 && abrir "http://localhost:${porta}") &
npm start
