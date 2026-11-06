import numpy as np
import pandas as pd

from .esquemas import Conjunto

DIA = np.timedelta64(1, "D")


def para_dia(valor):
    return np.datetime64(valor, "D") if valor is not None else np.datetime64("NaT", "D")


def quadro_diario(conjunto: Conjunto) -> pd.DataFrame:
    if not conjunto.diario:
        return pd.DataFrame(columns=["receita", "reembolsos", "pagas", "falhas", "novos", "visitantes", "cadastros", "conversoes"])
    quadro = pd.DataFrame([dia.model_dump() for dia in conjunto.diario])
    quadro["dia"] = pd.to_datetime(quadro["dia"])
    quadro = quadro.groupby("dia").sum().sort_index()
    inicio = quadro.index.min()
    fim = pd.Timestamp(conjunto.referencia)
    return quadro.reindex(pd.date_range(inicio, max(fim, quadro.index.max()), freq="D"), fill_value=0)


def quadro_assinaturas(conjunto: Conjunto) -> pd.DataFrame:
    linhas = [assinatura.model_dump() for assinatura in conjunto.assinaturas]
    quadro = pd.DataFrame(linhas, columns=list(conjunto.assinaturas[0].model_dump()) if linhas else ["id", "plano", "ciclo", "metodo", "canal", "valor", "status", "inicio", "teste_ate", "convertida", "cancelada", "ultimo_acesso"])
    for coluna in ["inicio", "teste_ate", "convertida", "cancelada", "ultimo_acesso"]:
        quadro[coluna] = pd.to_datetime(quadro[coluna])
    quadro["valor_mensal"] = np.where(quadro["ciclo"] == "anual", quadro["valor"] / 12, quadro["valor"]).astype(float)
    return quadro


def quadro_eventos(conjunto: Conjunto) -> pd.DataFrame:
    quadro = pd.DataFrame(conjunto.eventos, columns=["indice", "dia", "status", "valor", "tipo"])
    quadro["dia"] = pd.to_datetime(quadro["dia"])
    total = len(conjunto.assinaturas)
    return quadro[(quadro["indice"] >= 0) & (quadro["indice"] < total)].reset_index(drop=True)


def ativas_em(assinaturas: pd.DataFrame, instante: pd.Timestamp) -> pd.Series:
    return assinaturas["convertida"].notna() & (assinaturas["convertida"] <= instante) & (assinaturas["cancelada"].isna() | (assinaturas["cancelada"] > instante))


def fim_de_mes(instante: pd.Timestamp) -> pd.Timestamp:
    return (instante + pd.offsets.MonthEnd(0)).normalize()


def rotulo_mes(instante: pd.Timestamp) -> str:
    nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
    return f"{nomes[instante.month - 1]}/{str(instante.year)[2:]}"


def numero(valor, casas: int = 4):
    if valor is None:
        return None
    convertido = float(valor)
    if not np.isfinite(convertido):
        return None
    return round(convertido, casas)
