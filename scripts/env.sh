aleatorio() {
  head -c 2048 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c "$1"
}

preparar_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    sed -i.bak \
      -e "s|^BENTO_DB_SENHA=.*|BENTO_DB_SENHA=$(aleatorio 32)|" \
      -e "s|^BENTO_SEGREDO_JWT=.*|BENTO_SEGREDO_JWT=$(aleatorio 64)|" \
      -e "s|^BENTO_ANALISE_TOKEN=.*|BENTO_ANALISE_TOKEN=$(aleatorio 48)|" .env
    rm -f .env.bak
    echo "Arquivo .env criado com senha e chaves aleatórias."
    return
  fi
  adicionadas=""
  while IFS= read -r linha || [ -n "$linha" ]; do
    case "$linha" in
      [A-Z]*=*) ;;
      *) continue ;;
    esac
    nome=${linha%%=*}
    if grep -qE "^[[:space:]]*${nome}=" .env; then continue; fi
    case "$nome" in
      BENTO_SEGREDO_JWT | BENTO_DB_SENHA) continue ;;
      BENTO_ANALISE_TOKEN) linha="${nome}=$(aleatorio 48)" ;;
    esac
    if [ -n "$(tail -c 1 .env)" ]; then echo >>.env; fi
    echo "$linha" >>.env
    adicionadas="${adicionadas} ${nome}"
  done <.env.example
  if [ -n "$adicionadas" ]; then echo "Variáveis novas acrescentadas ao .env:${adicionadas}"; fi
}

porta_do_env() {
  porta=$(grep -E '^BENTO_PORTA=' .env | tail -n 1 | cut -d= -f2 | tr -d '[:space:]')
  echo "${porta:-8080}"
}

abrir_navegador() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true; fi
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true; fi
}

docker_disponivel() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

esperar_bento() {
  for _ in $(seq 1 90); do
    if curl -fsS "http://localhost:$1/api/v1/saude/pronto" >/dev/null 2>&1; then return 0; fi
    printf "."
    sleep 2
  done
  return 1
}
