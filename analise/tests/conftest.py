from datetime import date, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

TOKEN = "teste-token-com-mais-de-24-caracteres"
REFERENCIA = date(2026, 11, 6)
PLANOS = [("essencial", "Essencial", 4_900, 49_000), ("profissional", "Profissional", 12_900, 129_000), ("equipe", "Equipe", 29_900, 299_000)]


def gerar(semente: int = 42, clientes: int = 700, dias: int = 540):
    gerador = np.random.default_rng(semente)
    inicio = REFERENCIA - timedelta(days=dias)
    diario = []
    for d in range(dias):
        dia = inicio + timedelta(days=d)
        sazonal = 1.25 if dia.weekday() < 5 else 0.7
        visitantes = int(gerador.poisson(400 * sazonal * (1 + d / dias)))
        diario.append({"dia": dia.isoformat(), "receita": float(gerador.normal(90_000 * sazonal * (1 + d / dias), 6_000)), "pagas": int(gerador.poisson(9 * sazonal)), "falhas": int(gerador.poisson(0.4)), "novos": int(gerador.poisson(3)), "visitantes": visitantes, "cadastros": int(visitantes * 0.03), "conversoes": int(visitantes * 0.01)})
    assinaturas, eventos = [], []
    for i in range(clientes):
        convertida = inicio + timedelta(days=int(gerador.integers(0, dias - 5)))
        plano = PLANOS[int(gerador.choice(3, p=[0.5, 0.35, 0.15]))]
        anual = gerador.random() < 0.2
        valor = plano[3] if anual else plano[2]
        cancelada = None
        meses = 0
        while True:
            meses += 12 if anual else 1
            renovacao = convertida + timedelta(days=int(meses * 30.44))
            if renovacao >= REFERENCIA:
                break
            if gerador.random() < (0.3 if anual else 0.03):
                cancelada = renovacao - timedelta(days=int(gerador.integers(0, 4)))
                break
        indice = len(assinaturas)
        momento = convertida
        while momento < (cancelada or REFERENCIA):
            falhou = gerador.random() < 0.03
            eventos.append([indice, momento.isoformat(), "falhou" if falhou else "paga", valor, "assinatura"])
            if falhou:
                eventos.append([indice, (momento + timedelta(days=2)).isoformat(), "paga", valor, "assinatura"])
            momento += timedelta(days=365 if anual else 30)
        assinaturas.append({
            "id": f"cli-{i:04d}",
            "plano": plano[0],
            "ciclo": "anual" if anual else "mensal",
            "metodo": str(gerador.choice(["cartao", "pix", "boleto"])),
            "canal": str(gerador.choice(["Orgânico", "Pago", "Social"])) if i % 17 else None,
            "valor": valor,
            "status": "cancelada" if cancelada else "ativa",
            "inicio": convertida.isoformat(),
            "convertida": convertida.isoformat(),
            "cancelada": cancelada.isoformat() if cancelada else None,
            "ultimo_acesso": (REFERENCIA - timedelta(days=int(gerador.integers(0, 60)))).isoformat(),
        })
    return {"referencia": REFERENCIA.isoformat(), "planos": [{"codigo": c, "nome": n, "preco_mensal": m, "preco_anual": a} for c, n, m, a in PLANOS], "diario": diario, "assinaturas": assinaturas, "eventos": eventos}


@pytest.fixture(scope="session")
def conjunto():
    return gerar()


@pytest.fixture()
def cliente(monkeypatch):
    monkeypatch.setenv("BENTO_ANALISE_TOKEN", TOKEN)
    from bento_analise.app import app

    return TestClient(app, headers={"X-Bento-Token": TOKEN})


@pytest.fixture(scope="session")
def analise(conjunto):
    import os

    os.environ["BENTO_ANALISE_TOKEN"] = TOKEN
    from bento_analise.app import app

    resposta = TestClient(app, headers={"X-Bento-Token": TOKEN}).post("/v1/analise", json=conjunto)
    assert resposta.status_code == 200, resposta.text
    return resposta.json()
