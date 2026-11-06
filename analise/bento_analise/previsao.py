from itertools import product

import numpy as np
import pandas as pd

from .dados import ativas_em, fim_de_mes, numero, rotulo_mes

Z80 = 1.2816
Z95 = 1.96
GRADE_SAZONAL = list(product([0.05, 0.1, 0.2, 0.35, 0.5], [0.0, 0.02, 0.08], [0.05, 0.15, 0.3], [0.9, 0.98]))
GRADE_TENDENCIA = list(product([0.2, 0.4, 0.6, 0.8], [0.05, 0.2, 0.4], [0.8, 0.9, 0.98]))
SERIES = {
    "receita": ("Receita paga", "moeda"),
    "pagas": ("Transações pagas", "numero"),
    "cadastros": ("Cadastros", "numero"),
    "conversoes": ("Conversões", "numero"),
    "visitantes": ("Visitantes", "numero"),
}


def suavizar(y: np.ndarray, periodo: int, alfa: float, beta: float, gama: float, phi: float):
    nivel = y[:periodo].mean()
    tendencia = (y[periodo : 2 * periodo].mean() - nivel) / periodo if len(y) >= 2 * periodo else 0.0
    sazonal = (y[:periodo] - nivel).astype(float) if periodo > 1 else np.zeros(1)
    ajustado = np.empty(len(y))
    for t, valor in enumerate(y):
        indice = t % periodo
        ajustado[t] = nivel + phi * tendencia + sazonal[indice]
        anterior = nivel
        nivel = alfa * (valor - sazonal[indice]) + (1 - alfa) * (nivel + phi * tendencia)
        tendencia = beta * (nivel - anterior) + (1 - beta) * phi * tendencia
        if periodo > 1:
            sazonal[indice] = gama * (valor - nivel) + (1 - gama) * sazonal[indice]
    return ajustado, nivel, tendencia, sazonal


def projetar(estado, n: int, periodo: int, phi: float, horizonte: int) -> np.ndarray:
    _, nivel, tendencia, sazonal = estado
    passos = np.arange(1, horizonte + 1)
    amortecido = np.cumsum(phi**passos)
    indices = (n + passos - 1) % periodo
    return nivel + amortecido * tendencia + (sazonal[indices] if periodo > 1 else 0)


def ajustar(y: np.ndarray, periodo: int):
    grade = GRADE_SAZONAL if periodo > 1 else [(a, b, 0.0, p) for a, b, p in GRADE_TENDENCIA]
    aquecimento = min(len(y) // 3, 2 * periodo if periodo > 1 else 3)
    melhor = None
    for alfa, beta, gama, phi in grade:
        estado = suavizar(y, periodo, alfa, beta, gama, phi)
        erro = float(np.mean((y[aquecimento:] - estado[0][aquecimento:]) ** 2))
        if melhor is None or erro < melhor[0]:
            melhor = (erro, (alfa, beta, gama, phi), estado)
    return melhor


def prever_serie(y: np.ndarray, periodo: int, horizonte: int):
    erro, parametros, estado = ajustar(y, periodo)
    alfa, _, _, phi = parametros
    pontos = projetar(estado, len(y), periodo, phi, horizonte)
    sigma = float(np.sqrt(erro))
    passos = np.arange(1, horizonte + 1)
    escala = sigma * np.sqrt(1 + (passos - 1) * alfa**2)
    return pontos, escala, parametros, sigma


def avaliar(y: np.ndarray, periodo: int, janela: int):
    if len(y) < janela + 4 * periodo:
        return None
    treino, teste = y[:-janela], y[-janela:]
    pontos, _, _, _ = prever_serie(treino, periodo, janela)
    ingenuo = np.array([treino[len(treino) - periodo + (i % periodo)] for i in range(janela)])
    soma = float(np.abs(teste).sum()) or 1.0
    wape = float(np.abs(teste - np.maximum(pontos, 0)).sum()) / soma
    wape_ingenuo = float(np.abs(teste - ingenuo).sum()) / soma
    return {"wape": numero(wape), "wape_ingenuo": numero(wape_ingenuo), "acuracia": numero(max(0.0, 1 - wape)), "ganho": numero(wape_ingenuo - wape), "janela": janela}


def previsao_diaria(diario: pd.DataFrame, referencia: pd.Timestamp, coluna: str, horizonte: int = 30):
    serie = diario.loc[: referencia - pd.Timedelta(days=1), coluna].astype(float).tail(365)
    if len(serie) < 28:
        return None
    y = serie.to_numpy()
    pontos, escala, parametros, sigma = prever_serie(y, 7, horizonte)
    pontos = np.maximum(pontos, 0)
    datas = pd.date_range(referencia, periods=horizonte, freq="D")
    historico = serie.tail(60)
    fim_mes = fim_de_mes(referencia)
    no_mes = datas <= fim_mes
    realizado = float(diario.loc[referencia.replace(day=1) : referencia - pd.Timedelta(days=1), coluna].sum())
    restante = float(pontos[no_mes].sum())
    desvio_mes = float(np.sqrt((escala[no_mes] ** 2).sum())) if no_mes.any() else 0.0
    nome, unidade = SERIES[coluna]
    return {
        "codigo": coluna,
        "nome": nome,
        "unidade": unidade,
        "historico": {"datas": [d.strftime("%Y-%m-%d") for d in historico.index], "valores": [numero(v, 2) for v in historico.to_numpy()]},
        "previsao": {
            "datas": [d.strftime("%Y-%m-%d") for d in datas],
            "valores": [numero(v, 2) for v in pontos],
            "min80": [numero(max(0.0, v), 2) for v in pontos - Z80 * escala],
            "max80": [numero(v, 2) for v in pontos + Z80 * escala],
            "min95": [numero(max(0.0, v), 2) for v in pontos - Z95 * escala],
            "max95": [numero(v, 2) for v in pontos + Z95 * escala],
        },
        "mes": {
            "rotulo": rotulo_mes(referencia),
            "realizado": numero(realizado, 2),
            "previsto": numero(realizado + restante, 2),
            "minimo": numero(realizado + max(0.0, restante - Z80 * desvio_mes), 2),
            "maximo": numero(realizado + restante + Z80 * desvio_mes, 2),
        },
        "proximos30": numero(float(pontos.sum()), 2),
        "media_recente": numero(float(serie.tail(28).mean()), 2),
        "modelo": {
            "tipo": "Holt-Winters aditivo amortecido (sazonalidade semanal)",
            "parametros": {"alfa": parametros[0], "beta": parametros[1], "gama": parametros[2], "phi": parametros[3]},
            "erro_padrao": numero(sigma, 2),
            "teste": avaliar(y, 7, 28),
        },
    }


def serie_mrr(assinaturas: pd.DataFrame, referencia: pd.Timestamp, meses: int = 24):
    finais = [fim_de_mes(referencia - pd.DateOffset(months=i)) for i in range(meses - 1, 0, -1)] + [referencia]
    valores = []
    for instante in finais:
        valores.append(float(assinaturas.loc[ativas_em(assinaturas, instante), "valor_mensal"].sum()))
    return finais, np.array(valores)


def previsao_mrr(assinaturas: pd.DataFrame, referencia: pd.Timestamp, horizonte: int = 6):
    if assinaturas.empty:
        return None
    finais, valores = serie_mrr(assinaturas, referencia)
    primeiro = int(np.argmax(valores > 0)) if (valores > 0).any() else len(valores)
    valores, finais = valores[primeiro:], finais[primeiro:]
    if len(valores) < 4:
        return None
    pontos, escala, parametros, sigma = prever_serie(valores, 1, horizonte)
    futuros = [fim_de_mes(referencia + pd.DateOffset(months=i)) for i in range(1, horizonte + 1)]
    crescimento = (pontos[-1] / valores[-1] - 1) if valores[-1] > 0 else None
    return {
        "historico": {"rotulos": [rotulo_mes(d) for d in finais], "valores": [numero(v, 2) for v in valores]},
        "previsao": {
            "rotulos": [rotulo_mes(d) for d in futuros],
            "valores": [numero(max(0.0, v), 2) for v in pontos],
            "min80": [numero(max(0.0, v), 2) for v in pontos - Z80 * escala],
            "max80": [numero(v, 2) for v in pontos + Z80 * escala],
        },
        "atual": numero(valores[-1], 2),
        "em6": numero(max(0.0, pontos[-1]), 2),
        "crescimento": numero(crescimento),
        "modelo": {"tipo": "Holt com tendência amortecida", "parametros": {"alfa": parametros[0], "beta": parametros[1], "phi": parametros[3]}, "erro_padrao": numero(sigma, 2), "teste": avaliar(valores, 1, 3)},
    }


def previsoes(diario: pd.DataFrame, assinaturas: pd.DataFrame, referencia: pd.Timestamp):
    series = [previsao_diaria(diario, referencia, coluna) for coluna in SERIES if coluna in diario.columns]
    return {"series": [s for s in series if s is not None], "mrr": previsao_mrr(assinaturas, referencia)}
