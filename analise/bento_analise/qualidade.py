import base64
import binascii
import csv
import io
import re
import unicodedata
import zipfile

import numpy as np
import pandas as pd

from .dados import numero

PESOS = {"alta": 3, "media": 2, "baixa": 1}
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TELEFONE = re.compile(r"^\+?[\d\s().-]{8,20}$")
LIMITE_LINHAS = 20_000
LIMITE_COLUNAS = 200
LIMITE_DESCOMPACTADO = 60 * 1024 * 1024
RAZAO_MAXIMA = 120


class ErroDados(ValueError):
    pass
CAMPOS = {
    "nome": ["nome", "nomecompleto", "name", "fullname", "cliente", "contato"],
    "email": ["email", "mail", "emailaddress", "correioeletronico"],
    "papel": ["papel", "funcao", "perfil", "role"],
    "status": ["status", "situacao", "estado"],
    "cargo": ["cargo", "titulo", "jobtitle", "title"],
    "empresa": ["empresa", "organizacao", "company", "organization", "razaosocial"],
    "telefone": ["telefone", "fone", "celular", "phone", "whatsapp"],
    "pais": ["pais", "country"],
    "cidade": ["cidade", "city", "municipio"],
    "canal": ["canal", "origem", "channel", "source"],
}


def verificacao(codigo, titulo, severidade, afetados, total, recomendacao, exemplos=None, fator=10):
    proporcao = afetados / total if total else 0.0
    return {
        "codigo": codigo,
        "titulo": titulo,
        "severidade": severidade,
        "afetados": int(afetados),
        "total": int(total),
        "percentual": numero(proporcao),
        "saude": numero(max(0.0, 1 - proporcao * fator)),
        "recomendacao": recomendacao,
        "exemplos": (exemplos or [])[:5],
    }


def qualidade(diario: pd.DataFrame, assinaturas: pd.DataFrame, eventos: pd.DataFrame, planos: dict, referencia: pd.Timestamp):
    verificacoes = []
    ultimo_ano = diario.loc[referencia - pd.Timedelta(days=365) : referencia - pd.Timedelta(days=1)]
    vazios = ultimo_ano[(ultimo_ano.get("receita", 0) == 0) & (ultimo_ano.get("visitantes", 0) == 0)]
    verificacoes.append(verificacao("dias_vazios", "Dias sem receita e sem tráfego", "media", len(vazios), len(ultimo_ano), "Confira se a coleta de tráfego e as integrações de pagamento ficaram fora do ar nesses dias.", [d.strftime("%Y-%m-%d") for d in vazios.index[-5:]]))
    total = len(assinaturas)
    ids = assinaturas["id"].tolist() if total else []
    marcar = lambda mascara: [ids[i] for i in np.flatnonzero(mascara.to_numpy())]
    sem_canal = assinaturas["canal"].isna()
    verificacoes.append(verificacao("sem_canal", "Clientes sem canal de aquisição", "baixa", sem_canal.sum(), total, "Preencha o canal no cadastro para medir o retorno de cada origem.", marcar(sem_canal), fator=2))
    datas = (assinaturas["cancelada"].notna() & assinaturas["convertida"].notna() & (assinaturas["cancelada"] < assinaturas["convertida"])) | (assinaturas["convertida"].notna() & (assinaturas["convertida"] < assinaturas["inicio"]))
    verificacoes.append(verificacao("datas_invertidas", "Datas de assinatura fora de ordem", "alta", datas.sum(), total, "Corrija as datas de início, conversão e cancelamento dessas assinaturas.", marcar(datas), fator=50))
    vencidos = (assinaturas["status"] == "teste") & assinaturas["teste_ate"].notna() & (assinaturas["teste_ate"] < referencia - pd.Timedelta(days=2))
    verificacoes.append(verificacao("testes_vencidos", "Testes vencidos sem conversão nem cancelamento", "media", vencidos.sum(), max(int((assinaturas["status"] == "teste").sum()), 1), "Atualize o status: o período de teste terminou e a assinatura continua como teste.", marcar(vencidos), fator=2))
    tabela = {codigo: (mensal, anual) for codigo, (mensal, anual) in planos.items()}
    esperado = assinaturas.apply(lambda a: tabela.get(a["plano"], (None, None))[0 if a["ciclo"] == "mensal" else 1], axis=1) if total else pd.Series(dtype=float)
    divergente = esperado.notna() & (assinaturas["valor"] != esperado) & (assinaturas["status"] != "cancelada") if total else pd.Series(dtype=bool)
    verificacoes.append(verificacao("valor_divergente", "Valor diferente da tabela do plano", "baixa", divergente.sum(), total, "Confirme se são descontos negociados; se não forem, ajuste o valor cobrado.", marcar(divergente), fator=2))
    pagos = eventos[eventos["status"] == "paga"]
    if total and not eventos.empty:
        ultimo = pagos.groupby("indice")["dia"].max().reindex(range(total))
        mensal_ativa = (assinaturas["status"] == "ativa") & (assinaturas["ciclo"] == "mensal") & assinaturas["convertida"].notna() & (assinaturas["convertida"] < referencia - pd.Timedelta(days=45))
        sem_cobranca = mensal_ativa & (ultimo.isna().to_numpy() | (ultimo < referencia - pd.Timedelta(days=45)).to_numpy())
        verificacoes.append(verificacao("sem_cobranca", "Assinaturas mensais ativas sem pagamento há 45 dias", "alta", sem_cobranca.sum(), max(int(mensal_ativa.sum()), 1), "Verifique a régua de cobrança e o status dessas assinaturas.", marcar(sem_cobranca), fator=10))
        cancelada = assinaturas["cancelada"].reindex(pagos["indice"]).to_numpy()
        apos = pagos[(pd.notna(cancelada)) & (pagos["dia"].to_numpy() > cancelada + np.timedelta64(2, "D"))]
        verificacoes.append(verificacao("pago_apos_cancelar", "Pagamentos depois do cancelamento", "alta", len(apos), len(pagos), "Revise e, se for o caso, reembolse cobranças feitas após o cancelamento.", [ids[i] for i in apos["indice"].unique()[:5]], fator=50))
        duplicados = pagos.duplicated(subset=["indice", "dia", "valor", "tipo"], keep="first")
        verificacoes.append(verificacao("cobranca_duplicada", "Possíveis cobranças duplicadas no mesmo dia", "alta", int(duplicados.sum()), len(pagos), "Compare com o extrato do meio de pagamento e estorne o que for duplicado.", [ids[i] for i in pagos.loc[duplicados, "indice"].unique()[:5]], fator=50))
    receita = ultimo_ano.get("receita", pd.Series(dtype=float)).astype(float)
    if len(receita) >= 28:
        mediana = receita.median()
        desvio = (receita - mediana).abs().median() * 1.4826 or 1.0
        atipicos = receita[((receita - mediana).abs() / desvio) > 4.5]
        verificacoes.append(verificacao("receita_atipica", "Dias com receita muito fora do padrão", "baixa", len(atipicos), len(receita), "Confirme se são campanhas ou cobranças em lote; senão, investigue a origem.", [d.strftime("%Y-%m-%d") for d in atipicos.index[-5:]], fator=5))
    pesos = sum(PESOS[v["severidade"]] for v in verificacoes) or 1
    nota = sum(PESOS[v["severidade"]] * (v["saude"] or 0) for v in verificacoes) / pesos * 100
    campos = []
    for campo, rotulo in [("canal", "Canal de aquisição"), ("ultimo_acesso", "Último acesso"), ("convertida", "Data de conversão"), ("teste_ate", "Fim do teste")]:
        if total:
            campos.append({"campo": rotulo, "preenchimento": numero(float(assinaturas[campo].notna().mean()))})
    return {
        "nota": numero(nota, 1),
        "classificacao": "ótima" if nota >= 90 else "boa" if nota >= 75 else "regular" if nota >= 55 else "crítica",
        "verificacoes": sorted(verificacoes, key=lambda v: (v["saude"] or 0, -PESOS[v["severidade"]])),
        "campos": campos,
        "volumes": {"assinaturas": int(total), "eventos": int(len(eventos)), "dias": int(len(diario))},
    }


def normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFD", str(texto)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", sem_acento.lower())


def ler_planilha(nome: str, conteudo: str) -> pd.DataFrame:
    try:
        bruto = base64.b64decode(conteudo, validate=True)
    except (binascii.Error, ValueError) as erro:
        raise ErroDados("O conteúdo do arquivo não está em base64 válido.") from erro
    extensao = nome.lower().rsplit(".", 1)[-1]
    if extensao == "xlsx":
        conferir_xlsx(bruto)
        try:
            quadro = pd.read_excel(io.BytesIO(bruto), sheet_name=0, dtype=str, engine="openpyxl", nrows=LIMITE_LINHAS + 1)
        except Exception as erro:
            raise ErroDados("Não foi possível ler a planilha. Salve de novo como .xlsx e tente outra vez.") from erro
    elif extensao in {"csv", "txt"}:
        texto = bruto.decode("utf-8-sig", errors="replace")
        try:
            separador = csv.Sniffer().sniff(texto[:5_000], delimiters=",;\t|").delimiter
        except csv.Error:
            separador = ","
        if texto.split("\n", 1)[0].count(separador) >= LIMITE_COLUNAS:
            raise ErroDados(f"A planilha tem mais de {LIMITE_COLUNAS} colunas.")
        try:
            quadro = pd.read_csv(io.StringIO(texto), sep=separador, dtype=str, keep_default_na=False, nrows=LIMITE_LINHAS + 1)
        except Exception as erro:
            raise ErroDados("Não foi possível ler o CSV. Confira o separador e as aspas.") from erro
    else:
        raise ErroDados("Envie um arquivo .xlsx ou .csv.")
    if len(quadro.columns) > LIMITE_COLUNAS:
        raise ErroDados(f"A planilha tem mais de {LIMITE_COLUNAS} colunas.")
    quadro = quadro.replace({"": np.nan}).dropna(how="all").dropna(axis=1, how="all")
    quadro.columns = nomes_unicos([str(c).strip() or f"coluna_{i + 1}" for i, c in enumerate(quadro.columns)])
    return quadro.map(lambda v: v.strip() if isinstance(v, str) else v)


def conferir_xlsx(bruto: bytes):
    if not bruto.startswith(b"PK"):
        raise ErroDados("O arquivo não parece ser uma planilha .xlsx válida.")
    try:
        with zipfile.ZipFile(io.BytesIO(bruto)) as pacote:
            itens = pacote.infolist()
    except zipfile.BadZipFile as erro:
        raise ErroDados("O arquivo .xlsx está corrompido.") from erro
    descompactado = sum(item.file_size for item in itens)
    if descompactado > LIMITE_DESCOMPACTADO or descompactado > max(len(bruto), 1) * RAZAO_MAXIMA:
        raise ErroDados("A planilha descompactada é grande demais para analisar.")


def nomes_unicos(nomes: list[str]) -> list[str]:
    vistos: dict[str, int] = {}
    resultado = []
    for nome in nomes:
        chave = nome.lower()
        vistos[chave] = vistos.get(chave, 0) + 1
        resultado.append(nome if vistos[chave] == 1 else f"{nome} ({vistos[chave]})")
    return resultado


def inferir(serie: pd.Series) -> str:
    valores = serie.dropna().astype(str)
    if valores.empty:
        return "vazio"
    amostra = valores.head(500)
    if amostra.map(lambda v: bool(EMAIL.match(v))).mean() >= 0.8:
        return "email"
    if amostra.map(lambda v: bool(TELEFONE.match(v)) and sum(c.isdigit() for c in v) >= 8).mean() >= 0.8:
        return "telefone"
    if pd.to_numeric(amostra.str.replace(r"[R$\s.]", "", regex=True).str.replace(",", "."), errors="coerce").notna().mean() >= 0.9:
        return "numero"
    if pd.to_datetime(amostra, errors="coerce", dayfirst=True, format="mixed").notna().mean() >= 0.9:
        return "data"
    if valores.nunique() <= max(12, len(valores) * 0.05):
        return "categoria"
    return "texto"


def sugerir(coluna: str, tipo: str, usados: set) -> str | None:
    chave = normalizar(coluna)
    for campo, sinonimos in CAMPOS.items():
        if campo not in usados and (chave in sinonimos or any(chave.startswith(s) for s in sinonimos if len(s) >= 4)):
            return campo
    if tipo == "email" and "email" not in usados:
        return "email"
    if tipo == "telefone" and "telefone" not in usados:
        return "telefone"
    return None


def perfil_planilha(nome: str, conteudo: str):
    quadro = ler_planilha(nome, conteudo)
    truncado = len(quadro) > LIMITE_LINHAS
    quadro = quadro.head(LIMITE_LINHAS)
    usados: set = set()
    colunas = []
    for coluna in quadro.columns:
        serie = quadro[coluna]
        tipo = inferir(serie)
        campo = sugerir(coluna, tipo, usados)
        if campo:
            usados.add(campo)
        colunas.append({
            "nome": coluna,
            "tipo": tipo,
            "preenchimento": numero(float(serie.notna().mean()) if len(serie) else 0.0),
            "unicos": int(serie.nunique()),
            "exemplos": serie.dropna().astype(str).head(3).tolist(),
            "campo": campo,
        })
    mapa = {c["nome"]: c["campo"] for c in colunas if c["campo"]}
    problemas = []
    duplicadas = int(quadro.duplicated().sum())
    if duplicadas:
        problemas.append({"tipo": "linhas_duplicadas", "mensagem": f"{duplicadas} linha(s) repetida(s) serão ignoradas.", "quantidade": duplicadas})
    coluna_email = next((c for c, campo in mapa.items() if campo == "email"), None)
    unicas = quadro.drop_duplicates()
    if coluna_email:
        emails = unicas[coluna_email].dropna().astype(str).str.lower()
        invalidos = int((~emails.map(lambda v: bool(EMAIL.match(v)))).sum())
        repetidos = int(emails.duplicated().sum())
        sem_email = int(unicas[coluna_email].isna().sum())
        if invalidos:
            problemas.append({"tipo": "email_invalido", "mensagem": f"{invalidos} e-mail(s) com formato inválido.", "quantidade": invalidos})
        if repetidos:
            problemas.append({"tipo": "email_repetido", "mensagem": f"{repetidos} e-mail(s) aparecem mais de uma vez.", "quantidade": repetidos})
        if sem_email:
            problemas.append({"tipo": "sem_email", "mensagem": f"{sem_email} linha(s) sem e-mail.", "quantidade": sem_email})
    else:
        problemas.append({"tipo": "sem_coluna_email", "mensagem": "Nenhuma coluna de e-mail foi reconhecida.", "quantidade": len(quadro)})
    if "nome" not in mapa.values():
        problemas.append({"tipo": "sem_coluna_nome", "mensagem": "Nenhuma coluna de nome foi reconhecida.", "quantidade": len(quadro)})
    normalizado = unicas[list(mapa)].rename(columns=mapa)
    if "email" in normalizado:
        normalizado["email"] = normalizado["email"].str.lower()
    saida = io.StringIO()
    normalizado.to_csv(saida, index=False, lineterminator="\n")
    pontos = 100 - min(100, sum(p["quantidade"] for p in problemas if p["tipo"] not in {"sem_coluna_email", "sem_coluna_nome"}) / max(len(quadro), 1) * 100)
    if not coluna_email or "nome" not in mapa.values():
        pontos = min(pontos, 40)
    return {
        "linhas": int(len(quadro)),
        "truncado": truncado,
        "colunas": colunas,
        "mapa": mapa,
        "problemas": problemas,
        "nota": numero(pontos, 1),
        "csv": saida.getvalue() if mapa else "",
    }
