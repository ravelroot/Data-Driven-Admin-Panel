import numpy as np
import pandas as pd

from .dados import ativas_em, fim_de_mes, numero, rotulo_mes
from .esquemas import Cenario

LIMITE_MESES_VIDA = 60


def coortes(assinaturas: pd.DataFrame, eventos: pd.DataFrame, referencia: pd.Timestamp, quantidade: int = 12):
    pagantes = assinaturas[assinaturas["convertida"].notna()].copy()
    if pagantes.empty:
        return None
    pagantes["coorte"] = pagantes["convertida"].dt.to_period("M")
    atual = referencia.to_period("M")
    escolhidas = [atual - i for i in range(quantidade - 1, -1, -1)]
    pagos = eventos[(eventos["status"] == "paga") & eventos["indice"].isin(pagantes.index)].copy()
    pagos["coorte"] = pagantes.loc[pagos["indice"], "coorte"].to_numpy()
    pagos["mes"] = (pagos["dia"].dt.year * 12 + pagos["dia"].dt.month).to_numpy() - pagantes.loc[pagos["indice"], "convertida"].pipe(lambda c: c.dt.year * 12 + c.dt.month).to_numpy()
    linhas = []
    for coorte in escolhidas:
        membros = pagantes[pagantes["coorte"] == coorte]
        tamanho = len(membros)
        idade = (atual - coorte).n
        retencao, receita = [], []
        acumulado = 0.0
        for mes in range(idade + 1):
            instante = min(fim_de_mes((coorte + mes).to_timestamp()), referencia)
            retencao.append(numero(ativas_em(membros, instante).mean() if tamanho else None))
            parte = pagos[(pagos["coorte"] == coorte) & (pagos["mes"] == mes)]
            acumulado += float(parte["valor"].sum())
            receita.append(numero(acumulado / tamanho, 2) if tamanho else None)
        linhas.append({"coorte": rotulo_mes(coorte.to_timestamp()), "clientes": int(tamanho), "retencao": retencao, "receita": receita})
    pesos = np.zeros(quantidade)
    somas = np.zeros(quantidade)
    for linha in linhas:
        for mes, valor in enumerate(linha["retencao"]):
            if valor is not None and linha["clientes"]:
                pesos[mes] += linha["clientes"]
                somas[mes] += valor * linha["clientes"]
    media = [numero(somas[i] / pesos[i]) if pesos[i] else None for i in range(quantidade)]
    return {"linhas": linhas, "media": media}


def taxa_churn(grupo: pd.DataFrame, referencia: pd.Timestamp, meses: int = 6) -> tuple[float, float]:
    inicio = referencia - pd.DateOffset(months=meses)
    convertida = grupo["convertida"].clip(lower=inicio)
    fim = grupo["cancelada"].fillna(referencia).clip(upper=referencia)
    exposicao = ((fim - convertida).dt.days.clip(lower=0) / 30.44).sum()
    cancelamentos = (grupo["cancelada"].notna() & (grupo["cancelada"] > inicio) & (grupo["cancelada"] <= referencia)).sum()
    return (float(cancelamentos / exposicao) if exposicao > 0 else 0.0), float(exposicao)


def ltv(assinaturas: pd.DataFrame, planos: dict, referencia: pd.Timestamp):
    pagantes = assinaturas[assinaturas["convertida"].notna()]
    if pagantes.empty:
        return None
    resultado = []
    grupos = [("Todos", pagantes)] + [(planos.get(codigo, codigo), parte) for codigo, parte in pagantes.groupby("plano")]
    for nome, parte in grupos:
        ativos = parte[ativas_em(parte, referencia)]
        taxa, exposicao = taxa_churn(parte, referencia)
        arpu = float(ativos["valor_mensal"].mean()) if len(ativos) else float(parte["valor_mensal"].mean())
        vida = min(LIMITE_MESES_VIDA, 1 / taxa) if taxa > 0 else LIMITE_MESES_VIDA
        resultado.append({
            "plano": nome,
            "ativos": int(len(ativos)),
            "arpu": numero(arpu, 2),
            "churn": numero(taxa),
            "vida_meses": numero(vida, 1),
            "ltv": numero(arpu * vida, 2),
            "exposicao": numero(exposicao, 1),
        })
    return resultado


def base_simulador(assinaturas: pd.DataFrame, referencia: pd.Timestamp):
    pagantes = assinaturas[assinaturas["convertida"].notna()]
    ativos = pagantes[ativas_em(pagantes, referencia)]
    taxa, _ = taxa_churn(pagantes, referencia) if len(pagantes) else (0.0, 0.0)
    inicio = referencia - pd.DateOffset(months=3)
    novos = float(((pagantes["convertida"] > inicio) & (pagantes["convertida"] <= referencia)).sum()) / 3
    return {
        "ativos": int(len(ativos)),
        "arpu": numero(float(ativos["valor_mensal"].mean()) if len(ativos) else 0.0, 2),
        "churn": numero(taxa),
        "novos": numero(novos, 1),
        "mrr": numero(float(ativos["valor_mensal"].sum()), 2),
    }


def projetar(ativos: float, arpu: float, churn: float, novos: float, meses: int):
    contagem, receita = [], []
    for _ in range(meses):
        ativos = ativos * (1 - churn) + novos
        contagem.append(ativos)
        receita.append(ativos * arpu)
    return np.array(contagem), np.array(receita)


def simular(cenario: Cenario):
    referencia = pd.Timestamp(cenario.referencia)
    arpu = cenario.arpu * (1 + cenario.preco / 100)
    reacao = cenario.elasticidade * max(cenario.preco, 0) / 100 * cenario.churn
    churn = float(np.clip(cenario.churn + cenario.churn_pp / 100 + reacao, 0, 0.95))
    novos = cenario.novos * (1 + cenario.aquisicao / 100)
    base_ativos, base_mrr = projetar(cenario.ativos, cenario.arpu, cenario.churn, cenario.novos, cenario.meses)
    novo_ativos, novo_mrr = projetar(cenario.ativos, arpu, churn, novos, cenario.meses)
    vida = lambda taxa: min(LIMITE_MESES_VIDA, 1 / taxa) if taxa > 0 else LIMITE_MESES_VIDA
    rotulos = [rotulo_mes(fim_de_mes(referencia + pd.DateOffset(months=i))) for i in range(1, cenario.meses + 1)]
    equilibrio = cenario.novos * (1 + cenario.aquisicao / 100) / churn if churn > 0 else None
    return {
        "rotulos": rotulos,
        "base": {"ativos": [numero(v, 1) for v in base_ativos], "mrr": [numero(v, 2) for v in base_mrr]},
        "cenario": {"ativos": [numero(v, 1) for v in novo_ativos], "mrr": [numero(v, 2) for v in novo_mrr]},
        "resumo": {
            "mrr_base": numero(base_mrr[-1], 2),
            "mrr_cenario": numero(novo_mrr[-1], 2),
            "diferenca_mrr": numero(novo_mrr[-1] - base_mrr[-1], 2),
            "receita_base": numero(base_mrr.sum(), 2),
            "receita_cenario": numero(novo_mrr.sum(), 2),
            "diferenca_receita": numero(novo_mrr.sum() - base_mrr.sum(), 2),
            "ativos_base": numero(base_ativos[-1], 1),
            "ativos_cenario": numero(novo_ativos[-1], 1),
            "churn_cenario": numero(churn),
            "arpu_cenario": numero(arpu, 2),
            "ltv_base": numero(cenario.arpu * vida(cenario.churn), 2),
            "ltv_cenario": numero(arpu * vida(churn), 2),
            "equilibrio": numero(equilibrio, 1),
        },
    }
