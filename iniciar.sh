#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
. scripts/env.sh

preparar_env
porta=$(porta_do_env)

if docker_disponivel; then
  docker compose up -d --build
  printf "Aguardando o Bento subir"
  if esperar_bento "$porta"; then
    echo
    echo "Pronto! Abra http://localhost:${porta} e entre com admin@bento.local / bento123"
    echo "Para usar com os seus dados: Configurações › Empresa › Começar com os meus dados."
    abrir_navegador "http://localhost:${porta}"
    exit 0
  fi
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
(sleep 6 && abrir_navegador "http://localhost:${porta}") &
npm start
