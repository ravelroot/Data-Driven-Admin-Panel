import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from .dados import numero

SEGMENTOS = {
    "campeoes": ("Campeões", "Pagam com frequência, gastam mais e compraram há pouco.", "Convide para indicações, depoimentos e acesso antecipado."),
    "leais": ("Leais", "Compram com regularidade há bastante tempo.", "Ofereça upgrade ou plano anual com benefício."),
    "potenciais": ("Potenciais leais", "Recentes e com algumas compras; podem virar leais.", "Mostre recursos avançados e incentive o segundo ciclo."),
    "novos": ("Novos", "Compraram pela primeira vez há pouco tempo.", "Faça onboarding guiado nas primeiras semanas."),
    "atencao": ("Precisam de atenção", "Frequência e recência medianas, sem compromisso firme.", "Envie novidades e uma oferta por tempo limitado."),
    "em_risco": ("Em risco", "Eram bons clientes, mas não compram há algum tempo.", "Contato pessoal do sucesso do cliente e oferta de retenção."),
    "hibernando": ("Hibernando", "Pouca frequência e última compra distante.", "Campanha de reativação com conteúdo de valor."),
    "perdidos": ("Perdidos", "Sem compras há muito tempo e com pouco histórico.", "Pesquisa de saída e campanha de recuperação pontual."),
}


def pontuar(serie: pd.Series, inverter: bool = False) -> np.ndarray:
    percentil = serie.rank(method="average", pct=True).to_numpy()
    if inverter:
        percentil = 1 - percentil + 1 / max(len(serie), 1)
    return np.clip(np.ceil(percentil * 5), 1, 5).astype(int)


def classificar(r: int, f: int) -> str:
    if r >= 4 and f >= 4:
        return "campeoes"
    if r >= 3 and f >= 4:
        return "leais"
    if r >= 4 and f >= 2:
        return "potenciais"
    if r >= 4:
        return "novos"
    if r == 3:
        return "atencao"
    if f >= 3:
        return "em_risco"
    if r == 2:
        return "hibernando"
    return "perdidos"


def rfm(assinaturas: pd.DataFrame, eventos: pd.DataFrame, referencia: pd.Timestamp) -> pd.DataFrame:
    pagos = eventos[(eventos["status"] == "paga") & (eventos["dia"] <= referencia)]
    if pagos.empty:
        return pd.DataFrame()
    grupo = pagos.groupby("indice").agg(ultima=("dia", "max"), frequencia=("dia", "size"), valor=("valor", "sum"))
    grupo["recencia"] = (referencia - grupo["ultima"]).dt.days.clip(lower=0)
    grupo["id"] = assinaturas.loc[grupo.index, "id"].to_numpy()
    grupo["plano"] = assinaturas.loc[grupo.index, "plano"].to_numpy()
    grupo["r"] = pontuar(grupo["recencia"], inverter=True)
    grupo["f"] = pontuar(grupo["frequencia"])
    grupo["m"] = pontuar(grupo["valor"])
    grupo["segmento"] = [classificar(r, f) for r, f in zip(grupo["r"], grupo["f"])]
    return grupo


def agrupar(tabela: pd.DataFrame, semente: int = 7):
    if len(tabela) < 30:
        return None
    x = StandardScaler().fit_transform(np.log1p(tabela[["recencia", "frequencia", "valor"]].to_numpy(dtype=float)))
    distintos = len(np.unique(np.round(x, 6), axis=0))
    gerador = np.random.default_rng(semente)
    amostra = gerador.choice(len(x), size=min(len(x), 4_000), replace=False)
    melhor = None
    for k in range(3, min(6, distintos - 1) + 1):
        modelo = KMeans(n_clusters=k, n_init=5, random_state=semente).fit(x)
        if len(np.unique(modelo.labels_[amostra])) < 2:
            continue
        nota = float(silhouette_score(x[amostra], modelo.labels_[amostra]))
        if melhor is None or nota > melhor[0]:
            melhor = (nota, k, modelo)
    if melhor is None:
        return None
    nota, k, modelo = melhor
    tabela = tabela.assign(grupo=modelo.labels_)
    perfis = []
    for rotulo, parte in tabela.groupby("grupo"):
        chave = classificar(int(round(parte["r"].median())), int(round(parte["f"].median())))
        perfis.append({
            "grupo": int(rotulo),
            "nome": SEGMENTOS[chave][0],
            "clientes": int(len(parte)),
            "recencia": numero(parte["recencia"].median(), 1),
            "frequencia": numero(parte["frequencia"].median(), 1),
            "valor": numero(parte["valor"].median(), 2),
            "receita": numero(parte["valor"].sum(), 2),
        })
    vistos = {}
    for perfil in sorted(perfis, key=lambda p: -p["receita"]):
        vistos[perfil["nome"]] = vistos.get(perfil["nome"], 0) + 1
        if vistos[perfil["nome"]] > 1:
            perfil["nome"] = f"{perfil['nome']} {vistos[perfil['nome']]}"
    pontos = tabela.iloc[gerador.choice(len(tabela), size=min(len(tabela), 500), replace=False)]
    return {
        "k": k,
        "silhueta": numero(nota),
        "perfis": sorted(perfis, key=lambda p: -p["receita"]),
        "pontos": [[int(r), int(f), numero(v, 2), int(g)] for r, f, v, g in pontos[["recencia", "frequencia", "valor", "grupo"]].to_numpy()],
    }


def segmentacao(assinaturas: pd.DataFrame, eventos: pd.DataFrame, referencia: pd.Timestamp):
    tabela = rfm(assinaturas, eventos, referencia)
    if tabela.empty:
        return None
    total = float(tabela["valor"].sum()) or 1.0
    segmentos = []
    for chave, (nome, descricao, acao) in SEGMENTOS.items():
        parte = tabela[tabela["segmento"] == chave]
        if parte.empty:
            continue
        segmentos.append({
            "codigo": chave,
            "nome": nome,
            "descricao": descricao,
            "acao": acao,
            "clientes": int(len(parte)),
            "receita": numero(parte["valor"].sum(), 2),
            "participacao": numero(parte["valor"].sum() / total),
            "ticket": numero(parte["valor"].sum() / parte["frequencia"].sum(), 2),
            "recencia": numero(parte["recencia"].median(), 1),
            "frequencia": numero(parte["frequencia"].mean(), 1),
            "exemplos": parte.sort_values("valor", ascending=False)["id"].head(8).tolist(),
        })
    matriz = tabela.groupby(["r", "f"]).size().unstack(fill_value=0).reindex(index=range(1, 6), columns=range(1, 6), fill_value=0)
    return {"clientes": int(len(tabela)), "segmentos": segmentos, "matriz": matriz.to_numpy().tolist(), "agrupamento": agrupar(tabela)}
