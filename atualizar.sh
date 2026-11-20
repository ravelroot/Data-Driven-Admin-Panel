#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
. scripts/env.sh

echo "1/5 Conferindo o .env"
preparar_env
porta=$(porta_do_env)

if docker_disponivel; then
  echo "2/5 Gravando um backup antes de atualizar"
  if [ -n "$(docker compose ps -q bento 2>/dev/null)" ]; then
    docker compose exec -T bento node api/dist/cli.js backup
  else
    echo "    O Bento não está rodando; sem backup novo (os automáticos continuam em dados/backups)."
  fi
  echo "3/5 Baixando a versão nova"
  if [ -d .git ] && command -v git >/dev/null 2>&1; then git pull --ff-only; else echo "    Sem Git: copie os arquivos da versão nova por cima desta pasta antes de rodar o script."; fi
  echo "4/5 Reconstruindo e subindo"
  docker compose up -d --build
  printf "    Aguardando o Bento"
  if ! esperar_bento "$porta"; then
    echo
    echo "O Bento não ficou pronto. Veja o motivo com: docker compose logs --tail 80 bento"
    exit 1
  fi
  echo
  echo "5/5 Conferindo a instalação"
  docker compose exec -T bento node api/dist/cli.js diagnostico || true
  echo "Atualizado. Painel em http://localhost:${porta}"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Instale o Docker ou o Node.js 22+ e rode de novo."
  exit 1
fi

echo "2/5 Gravando um backup antes de atualizar (pare o servidor se estiver usando o banco embutido)"
npm run --silent backup || echo "    Backup não gravado; continue só se já tiver um recente."
echo "3/5 Baixando a versão nova"
if [ -d .git ] && command -v git >/dev/null 2>&1; then git pull --ff-only; fi
echo "4/5 Instalando e compilando"
npm install --no-audit --no-fund
npm run build
echo "5/5 Conferindo a instalação"
npm run --silent diagnostico || true
echo "Atualizado. Suba de novo com: npm start"
