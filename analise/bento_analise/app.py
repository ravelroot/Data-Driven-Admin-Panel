import hmac
import logging
import os
import time
from datetime import datetime, timezone
from typing import Annotated

import numpy
import pandas
import sklearn
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import Field

from . import churn, coortes, excel, previsao, qualidade, segmentos
from .dados import quadro_assinaturas, quadro_diario, quadro_eventos
from .esquemas import Cenario, Conjunto, Modelo, Planilha
from .qualidade import ErroDados

VERSAO = "1.6.0"
LIMITE_CORPO = int(os.environ.get("BENTO_ANALISE_LIMITE_MB", "96")) * 1024 * 1024
registro = logging.getLogger("bento.analise")


class Relatorio(Modelo):
    analise: dict
    nomes: dict[Annotated[str, Field(max_length=64)], Annotated[str, Field(max_length=200)]] = Field(default_factory=dict, max_length=5_000)
    empresa: Annotated[str, Field(min_length=1, max_length=120)] = "Bento"


class LimiteCorpo:
    def __init__(self, app, limite: int):
        self.app = app
        self.limite = limite

    async def __call__(self, escopo, receber, enviar):
        if escopo["type"] != "http":
            return await self.app(escopo, receber, enviar)
        cabecalhos = dict(escopo.get("headers") or [])
        declarado = cabecalhos.get(b"content-length")
        if declarado is not None and declarado.isdigit() and int(declarado) > self.limite:
            return await JSONResponse({"erro": "CORPO_GRANDE", "mensagem": "Corpo da requisição acima do limite."}, status_code=413)(escopo, receber, enviar)
        recebido = 0

        async def contar():
            nonlocal recebido
            mensagem = await receber()
            if mensagem["type"] == "http.request":
                recebido += len(mensagem.get("body", b""))
                if recebido > self.limite:
                    raise HTTPException(status_code=413, detail="Corpo da requisição acima do limite.")
            return mensagem

        return await self.app(escopo, contar, enviar)


def token_configurado() -> str | None:
    token = os.environ.get("BENTO_ANALISE_TOKEN", "").strip()
    return token if len(token) >= 24 else None


def autenticar(x_bento_token: Annotated[str | None, Header()] = None):
    esperado = token_configurado()
    if esperado is None:
        raise HTTPException(status_code=503, detail="BENTO_ANALISE_TOKEN não configurado (mínimo de 24 caracteres).")
    if not x_bento_token or not hmac.compare_digest(x_bento_token.encode(), esperado.encode()):
        raise HTTPException(status_code=401, detail="Token inválido.")


app = FastAPI(title="Bento · motor analítico", version=VERSAO, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(LimiteCorpo, limite=LIMITE_CORPO)


@app.exception_handler(HTTPException)
async def erro_http(_: Request, erro: HTTPException):
    return JSONResponse({"erro": "HTTP_" + str(erro.status_code), "mensagem": erro.detail}, status_code=erro.status_code)


@app.exception_handler(ErroDados)
async def erro_dados(_: Request, erro: ErroDados):
    return JSONResponse({"erro": "DADOS_INVALIDOS", "mensagem": str(erro)}, status_code=422)


@app.exception_handler(ValueError)
async def erro_valor(_: Request, erro: ValueError):
    registro.warning("dados recusados: %s", erro)
    return JSONResponse({"erro": "DADOS_INVALIDOS", "mensagem": "Os dados enviados não puderam ser processados."}, status_code=422)


@app.exception_handler(Exception)
async def erro_geral(_: Request, erro: Exception):
    registro.exception("falha inesperada", exc_info=erro)
    return JSONResponse({"erro": "INTERNO", "mensagem": "Falha inesperada no motor analítico."}, status_code=500)


@app.get("/saude")
def saude():
    return {
        "status": "ok" if token_configurado() else "sem_token",
        "versao": VERSAO,
        "bibliotecas": {"numpy": numpy.__version__, "pandas": pandas.__version__, "scikit-learn": sklearn.__version__},
    }


def executar(nome: str, funcao, avisos: list, tempos: dict):
    inicio = time.perf_counter()
    try:
        return funcao()
    except Exception as erro:
        registro.exception("falha em %s", nome, exc_info=erro)
        avisos.append(f"Não foi possível calcular {nome}.")
        return None
    finally:
        tempos[nome] = round((time.perf_counter() - inicio) * 1000)


@app.post("/v1/analise", dependencies=[Depends(autenticar)])
def analisar(conjunto: Conjunto):
    inicio = time.perf_counter()
    referencia = pandas.Timestamp(conjunto.referencia)
    diario = quadro_diario(conjunto)
    assinaturas = quadro_assinaturas(conjunto)
    eventos = quadro_eventos(conjunto)
    planos = {p.codigo: p.nome for p in conjunto.planos}
    precos = {p.codigo: (p.preco_mensal, p.preco_anual) for p in conjunto.planos}
    avisos: list[str] = []
    tempos: dict[str, int] = {}
    resultado = {
        "previsoes": executar("previsões", lambda: previsao.previsoes(diario, assinaturas, referencia), avisos, tempos),
        "risco": executar("risco de cancelamento", lambda: churn.risco(assinaturas, eventos, referencia), avisos, tempos),
        "segmentos": executar("segmentos", lambda: segmentos.segmentacao(assinaturas, eventos, referencia), avisos, tempos),
        "coortes": executar("coortes", lambda: coortes.coortes(assinaturas, eventos, referencia), avisos, tempos),
        "ltv": executar("LTV", lambda: coortes.ltv(assinaturas, planos, referencia), avisos, tempos),
        "simulador": executar("base do simulador", lambda: coortes.base_simulador(assinaturas, referencia), avisos, tempos),
        "qualidade": executar("qualidade dos dados", lambda: qualidade.qualidade(diario, assinaturas, eventos, precos, referencia), avisos, tempos),
    }
    resultado["avisos"] = avisos
    resultado["tempos"] = tempos
    resultado["referencia"] = conjunto.referencia.isoformat()
    resultado["gerado_em"] = datetime.now(timezone.utc).isoformat()
    resultado["duracao_ms"] = round((time.perf_counter() - inicio) * 1000)
    resultado["versao"] = VERSAO
    return resultado


@app.post("/v1/simulador", dependencies=[Depends(autenticar)])
def simular(cenario: Cenario):
    return coortes.simular(cenario)


@app.post("/v1/relatorio", dependencies=[Depends(autenticar)])
def gerar_relatorio(pedido: Relatorio):
    conteudo = excel.relatorio(pedido.analise, pedido.nomes, pedido.empresa)
    return Response(conteudo, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.post("/v1/planilha", dependencies=[Depends(autenticar)])
def analisar_planilha(planilha: Planilha):
    return qualidade.perfil_planilha(planilha.nome, planilha.conteudo)
