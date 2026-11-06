import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from .dados import ativas_em, numero

JANELA = 30
INSTANTANEOS = 12
BASICAS = {
    "meses": "Tempo de casa",
    "valor": "Valor mensal",
    "anual": "Ciclo anual",
    "renovacao": "Renovação anual nos próximos 30 dias",
    "falhas": "Falhas de pagamento recentes",
    "reembolsos": "Reembolso nos últimos 12 meses",
    "upgrade": "Fez upgrade de plano",
    "inativo": "Sem acessar há mais de 30 dias",
}
ROTULOS = {"cartao": "cartão", "pix": "Pix", "boleto": "boleto", "desconhecido": "não informado"}
DIRECOES = {"meses": ("Muito tempo de casa", "Pouco tempo de casa"), "valor": ("Valor mensal alto", "Valor mensal baixo")}
ACOES = {
    "renovacao": "Ofereça condição especial de renovação antes do vencimento.",
    "falhas": "Peça a atualização do meio de pagamento e ofereça Pix.",
    "meses": "Reforce o onboarding com uma sessão de boas-vindas.",
    "reembolsos": "Entenda o motivo do reembolso com um contato pessoal.",
    "valor": "Apresente os recursos do plano que justificam o valor.",
    "inativo": "Reative o uso com conteúdo e lembretes do produto.",
    "metodo_boleto": "Sugira cartão ou Pix recorrente para evitar atrasos.",
}


def caracteristicas(assinaturas: pd.DataFrame, eventos: pd.DataFrame, instante: pd.Timestamp, categorias: dict):
    ativas = assinaturas[ativas_em(assinaturas, instante)]
    if ativas.empty:
        return ativas, pd.DataFrame()
    dias = (instante - ativas["convertida"]).dt.days.to_numpy()
    anual = (ativas["ciclo"] == "anual").to_numpy()
    restante = 365 - np.mod(dias, 365)
    janela = eventos[(eventos["dia"] <= instante) & (eventos["indice"].isin(ativas.index))]
    recente = janela[janela["dia"] > instante - pd.Timedelta(days=90)]
    ano = janela[janela["dia"] > instante - pd.Timedelta(days=365)]
    contar = lambda quadro: quadro.groupby("indice").size().reindex(ativas.index, fill_value=0).to_numpy()
    matriz = pd.DataFrame(index=ativas.index)
    matriz["meses"] = np.log1p(dias / 30.44)
    matriz["valor"] = np.log1p(ativas["valor_mensal"].to_numpy() / 100)
    matriz["anual"] = anual.astype(float)
    matriz["renovacao"] = (anual & (restante <= JANELA)).astype(float)
    matriz["falhas"] = np.minimum(contar(recente[recente["status"] == "falhou"]), 5)
    matriz["reembolsos"] = np.minimum(contar(ano[ano["status"] == "reembolsada"]), 3)
    matriz["upgrade"] = (contar(janela[janela["tipo"] == "upgrade"]) > 0).astype(float)
    for campo, valores in categorias.items():
        for valor in valores:
            matriz[f"{campo}_{valor}"] = (ativas[campo].fillna("desconhecido") == valor).astype(float).to_numpy()
    return ativas, matriz


def rotulos(ativas: pd.DataFrame, instante: pd.Timestamp) -> np.ndarray:
    cancelada = ativas["cancelada"]
    return (cancelada.notna() & (cancelada > instante) & (cancelada <= instante + pd.Timedelta(days=JANELA))).astype(int).to_numpy()


def nome_fator(coluna: str, desvio: float | None = None) -> str:
    if desvio is not None and coluna in DIRECOES:
        return DIRECOES[coluna][0 if desvio > 0 else 1]
    if coluna in BASICAS:
        return BASICAS[coluna]
    campo, valor = coluna.split("_", 1)
    prefixo = {"metodo": "Pagamento via", "canal": "Canal", "plano": "Plano"}[campo]
    return f"{prefixo} {ROTULOS.get(valor, valor.capitalize() if campo == 'plano' else valor)}"


def treinar(assinaturas: pd.DataFrame, eventos: pd.DataFrame, referencia: pd.Timestamp):
    categorias = {campo: sorted(assinaturas[campo].fillna("desconhecido").unique().tolist()) for campo in ["metodo", "canal", "plano"]}
    blocos = []
    for k in range(1, INSTANTANEOS + 1):
        instante = referencia - pd.Timedelta(days=JANELA * k)
        ativas, matriz = caracteristicas(assinaturas, eventos, instante, categorias)
        if not matriz.empty:
            blocos.append((k, matriz, rotulos(ativas, instante)))
    if not blocos:
        return None
    x = pd.concat([b[1] for b in blocos])
    y = np.concatenate([b[2] for b in blocos])
    grupos = np.concatenate([np.full(len(b[2]), b[0]) for b in blocos])
    if y.sum() < 8 or (1 - y).sum() < 8:
        return None
    colunas = x.columns.tolist()
    teste = grupos <= 2
    auc = None
    if teste.any() and (~teste).any() and 0 < y[teste].sum() < teste.sum() and 0 < y[~teste].sum():
        escala = StandardScaler().fit(x[~teste])
        modelo = LogisticRegression(C=0.5, max_iter=2_000).fit(escala.transform(x[~teste]), y[~teste])
        auc = float(roc_auc_score(y[teste], modelo.predict_proba(escala.transform(x[teste]))[:, 1]))
    escala = StandardScaler().fit(x)
    modelo = LogisticRegression(C=0.5, max_iter=2_000).fit(escala.transform(x), y)
    return {"modelo": modelo, "escala": escala, "colunas": colunas, "categorias": categorias, "auc": auc, "base": float(y.mean()), "amostras": int(len(y)), "eventos": int(y.sum()), "instantaneos": len(blocos)}


def risco(assinaturas: pd.DataFrame, eventos: pd.DataFrame, referencia: pd.Timestamp, limite: int = 60):
    treino = treinar(assinaturas, eventos, referencia)
    if treino is None:
        return None
    ativas, matriz = caracteristicas(assinaturas, eventos, referencia, treino["categorias"])
    if matriz.empty:
        return None
    matriz = matriz[treino["colunas"]]
    padronizado = treino["escala"].transform(matriz)
    probabilidade = treino["modelo"].predict_proba(padronizado)[:, 1]
    coeficientes = treino["modelo"].coef_[0]
    contribuicoes = padronizado * coeficientes
    base = treino["base"]
    faixa = np.where(probabilidade >= 3 * base, "alta", np.where(probabilidade >= 1.5 * base, "media", "baixa"))
    acesso = ativas["ultimo_acesso"]
    inativo = (acesso.notna() & ((referencia - acesso).dt.days > 30)).to_numpy()
    mrr = ativas["valor_mensal"].to_numpy()
    ordem = np.argsort(-probabilidade)
    clientes = []
    valores = matriz.to_numpy()
    continuas = {treino["colunas"].index(c) for c in DIRECOES}
    for posicao in ordem[:limite]:
        indices = [i for i in np.argsort(-contribuicoes[posicao]) if contribuicoes[posicao, i] > 0.15 and (i in continuas or valores[posicao, i] > 0)][:3]
        motivos = [nome_fator(treino["colunas"][i], padronizado[posicao, i]) for i in indices]
        chaves = [treino["colunas"][i] if treino["colunas"][i] not in DIRECOES or padronizado[posicao, i] < 0 else "" for i in indices]
        if inativo[posicao]:
            motivos.append(BASICAS["inativo"])
            chaves.append("inativo")
        acao = next((ACOES[c] for c in chaves if c in ACOES), "Faça um contato de sucesso do cliente para entender o momento.")
        clientes.append({
            "id": ativas.iloc[posicao]["id"],
            "probabilidade": numero(probabilidade[posicao]),
            "faixa": str(faixa[posicao]),
            "mrr": numero(mrr[posicao], 2),
            "plano": ativas.iloc[posicao]["plano"],
            "ciclo": ativas.iloc[posicao]["ciclo"],
            "meses": int((referencia - ativas.iloc[posicao]["convertida"]).days // 30),
            "motivos": motivos,
            "acao": acao,
        })
    pesos = sorted(zip(treino["colunas"], coeficientes), key=lambda par: -abs(par[1]))[:8]
    bordas = np.linspace(0, max(0.05, float(probabilidade.max())), 11)
    contagem, _ = np.histogram(probabilidade, bins=bordas)
    return {
        "modelo": {
            "tipo": "Regressão logística (scikit-learn)",
            "janela_dias": JANELA,
            "auc": numero(treino["auc"]),
            "taxa_base": numero(base),
            "amostras": treino["amostras"],
            "cancelamentos": treino["eventos"],
            "instantaneos": treino["instantaneos"],
        },
        "resumo": {
            "ativos": int(len(ativas)),
            "alto": int((faixa == "alta").sum()),
            "medio": int((faixa == "media").sum()),
            "esperados": numero(float(probabilidade.sum()), 1),
            "mrr_em_risco": numero(float((probabilidade * mrr).sum()), 2),
            "mrr_alto": numero(float(mrr[faixa == "alta"].sum()), 2),
        },
        "fatores": [{"fator": nome_fator(c), "peso": numero(p), "efeito": "aumenta" if p > 0 else "reduz"} for c, p in pesos],
        "distribuicao": {"bordas": [numero(b) for b in bordas], "contagem": contagem.tolist()},
        "clientes": clientes,
    }
