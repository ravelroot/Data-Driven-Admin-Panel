import io
from datetime import datetime

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

MOEDA = '"R$" #,##0.00'
PERCENTUAL = "0.0%"
COR = "1F2937"
DESTAQUE = "E8F0FE"
TITULO = Font(bold=True, size=14, color=COR)
CABECALHO = Font(bold=True, color="FFFFFF")
FUNDO = PatternFill("solid", fgColor="334155")
PERIGOSOS = ("=", "+", "-", "@", "\t", "\r")


def seguro(valor):
    if isinstance(valor, str):
        valor = ILLEGAL_CHARACTERS_RE.sub("", valor)
        if valor.startswith(PERIGOSOS):
            return "'" + valor
    return valor


def reais(valor):
    return None if valor is None else round(float(valor) / 100, 2)


def tabela(planilha, linha: int, cabecalhos: list, dados: list, formatos: dict | None = None) -> int:
    for coluna, texto in enumerate(cabecalhos, start=1):
        celula = planilha.cell(row=linha, column=coluna, value=texto)
        celula.font = CABECALHO
        celula.fill = FUNDO
        celula.alignment = Alignment(vertical="center")
    for deslocamento, registro in enumerate(dados, start=1):
        for coluna, valor in enumerate(registro, start=1):
            celula = planilha.cell(row=linha + deslocamento, column=coluna, value=seguro(valor))
            if formatos and coluna in formatos:
                celula.number_format = formatos[coluna]
    planilha.freeze_panes = planilha.cell(row=linha + 1, column=1)
    for coluna, texto in enumerate(cabecalhos, start=1):
        largura = max([len(str(texto))] + [len(str(r[coluna - 1])) for r in dados[:200] if coluna - 1 < len(r) and r[coluna - 1] is not None])
        planilha.column_dimensions[get_column_letter(coluna)].width = min(60, max(10, largura + 2))
    return linha + len(dados)


def cabecalho(planilha, titulo: str, subtitulo: str):
    planilha["A1"] = seguro(titulo)
    planilha["A1"].font = TITULO
    planilha["A2"] = seguro(subtitulo)
    planilha["A2"].font = Font(italic=True, color="64748B")


def grafico_linha(planilha, titulo: str, ancora: str, colunas: range, linha_inicio: int, linha_fim: int, eixo_y: str):
    grafico = LineChart()
    grafico.title = titulo
    grafico.height = 8
    grafico.width = 22
    grafico.y_axis.title = eixo_y
    for coluna in colunas:
        grafico.add_data(Reference(planilha, min_col=coluna, min_row=linha_inicio - 1, max_row=linha_fim), titles_from_data=True)
    grafico.set_categories(Reference(planilha, min_col=1, min_row=linha_inicio, max_row=linha_fim))
    planilha.add_chart(grafico, ancora)


def relatorio(analise: dict, nomes: dict, empresa: str) -> bytes:
    livro = Workbook()
    gerado = datetime.now().strftime("%d/%m/%Y %H:%M")
    subtitulo = f"{empresa} · gerado em {gerado} pelo motor analítico do Bento"
    resumo = livro.active
    resumo.title = "Resumo"
    cabecalho(resumo, "Inteligência de dados", subtitulo)
    previsoes = analise.get("previsoes") or {}
    receita = next((s for s in previsoes.get("series", []) if s.get("codigo") == "receita"), None)
    mrr = previsoes.get("mrr") or {}
    risco = analise.get("risco") or {}
    qualidade = analise.get("qualidade") or {}
    simulador = analise.get("simulador") or {}
    indicadores = []
    if receita:
        mes = receita["mes"]
        indicadores += [
            (f"Receita prevista para {mes['rotulo']}", reais(mes["previsto"]), MOEDA),
            ("Faixa provável (80%) — mínimo", reais(mes["minimo"]), MOEDA),
            ("Faixa provável (80%) — máximo", reais(mes["maximo"]), MOEDA),
            ("Receita prevista nos próximos 30 dias", reais(receita["proximos30"]), MOEDA),
        ]
    if mrr:
        indicadores += [("MRR atual", reais(mrr.get("atual")), MOEDA), ("MRR previsto em 6 meses", reais(mrr.get("em6")), MOEDA)]
    if simulador:
        indicadores += [("Clientes pagantes ativos", simulador.get("ativos"), "0"), ("Churn mensal (6 meses)", simulador.get("churn"), PERCENTUAL)]
    if risco:
        indicadores += [
            ("Clientes com risco alto", risco["resumo"]["alto"], "0"),
            ("MRR em risco (esperado)", reais(risco["resumo"]["mrr_em_risco"]), MOEDA),
            ("AUC do modelo de cancelamento", risco["modelo"]["auc"], "0.000"),
        ]
    if qualidade:
        indicadores.append(("Nota de qualidade dos dados", qualidade.get("nota"), "0.0"))
    tabela(resumo, 4, ["Indicador", "Valor"], [(n, v) for n, v, _ in indicadores], None)
    for deslocamento, (_, _, formato) in enumerate(indicadores, start=5):
        resumo.cell(row=deslocamento, column=2).number_format = formato
    resumo.column_dimensions["A"].width = 46
    resumo.column_dimensions["B"].width = 22
    for serie in previsoes.get("series", []):
        if serie["codigo"] not in {"receita", "cadastros", "conversoes"}:
            continue
        planilha = livro.create_sheet(f"Previsão {serie['nome']}"[:31])
        cabecalho(planilha, f"Previsão — {serie['nome']}", serie["modelo"]["tipo"])
        moeda = serie["unidade"] == "moeda"
        conv = reais if moeda else (lambda v: v)
        linhas = [(d, conv(v), None, None, None) for d, v in zip(serie["historico"]["datas"], serie["historico"]["valores"])]
        p = serie["previsao"]
        linhas += [(d, None, conv(v), conv(a), conv(b)) for d, v, a, b in zip(p["datas"], p["valores"], p["min80"], p["max80"])]
        formato = MOEDA if moeda else "0.0"
        fim = tabela(planilha, 4, ["Dia", "Realizado", "Previsto", "Mínimo (80%)", "Máximo (80%)"], linhas, {2: formato, 3: formato, 4: formato, 5: formato})
        grafico_linha(planilha, serie["nome"], "G4", range(2, 6), 5, fim, "R$" if moeda else "Quantidade")
    if mrr:
        planilha = livro.create_sheet("MRR")
        cabecalho(planilha, "MRR — histórico e previsão", mrr["modelo"]["tipo"])
        linhas = [(r, reais(v), None) for r, v in zip(mrr["historico"]["rotulos"], mrr["historico"]["valores"])]
        linhas += [(r, None, reais(v)) for r, v in zip(mrr["previsao"]["rotulos"], mrr["previsao"]["valores"])]
        fim = tabela(planilha, 4, ["Mês", "MRR realizado", "MRR previsto"], linhas, {2: MOEDA, 3: MOEDA})
        grafico_linha(planilha, "MRR", "E4", range(2, 4), 5, fim, "R$")
    if risco:
        planilha = livro.create_sheet("Risco de cancelamento")
        cabecalho(planilha, "Clientes com maior risco de cancelar em 30 dias", f"{risco['modelo']['tipo']} · AUC {risco['modelo']['auc']}")
        linhas = [(nomes.get(c["id"], c["id"]), c["plano"], c["ciclo"], reais(c["mrr"]), c["probabilidade"], c["faixa"], c["meses"], "; ".join(c["motivos"]), c["acao"]) for c in risco["clientes"]]
        fim = tabela(planilha, 4, ["Cliente", "Plano", "Ciclo", "MRR", "Probabilidade", "Risco", "Meses de casa", "Motivos", "Ação sugerida"], linhas, {4: MOEDA, 5: PERCENTUAL})
        if linhas:
            planilha.conditional_formatting.add(f"E5:E{fim}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="EF4444"))
        inicio = fim + 3
        planilha.cell(row=inicio - 1, column=1, value="Fatores do modelo").font = Font(bold=True)
        tabela(planilha, inicio, ["Fator", "Peso", "Efeito"], [(f["fator"], f["peso"], f["efeito"]) for f in risco["fatores"]], {2: "0.000"})
        planilha.freeze_panes = "A5"
    segmentos = analise.get("segmentos") or {}
    if segmentos:
        planilha = livro.create_sheet("Segmentos RFM")
        cabecalho(planilha, "Segmentação de clientes (RFM)", "Recência, frequência e valor; ações recomendadas por segmento")
        linhas = [(s["nome"], s["clientes"], reais(s["receita"]), s["participacao"], reais(s["ticket"]), s["recencia"], s["frequencia"], s["acao"]) for s in segmentos["segmentos"]]
        fim = tabela(planilha, 4, ["Segmento", "Clientes", "Receita", "Participação", "Ticket médio", "Recência (dias)", "Frequência média", "Ação recomendada"], linhas, {3: MOEDA, 4: PERCENTUAL, 5: MOEDA})
        grafico = BarChart()
        grafico.type = "bar"
        grafico.title = "Clientes por segmento"
        grafico.height = 8
        grafico.width = 18
        grafico.add_data(Reference(planilha, min_col=2, min_row=4, max_row=fim), titles_from_data=True)
        grafico.set_categories(Reference(planilha, min_col=1, min_row=5, max_row=fim))
        planilha.add_chart(grafico, f"A{fim + 3}")
    coortes = analise.get("coortes") or {}
    if coortes:
        planilha = livro.create_sheet("Coortes")
        cabecalho(planilha, "Retenção por coorte de conversão", "Percentual de clientes ainda ativos ao fim de cada mês")
        meses = max(len(l["retencao"]) for l in coortes["linhas"])
        linhas = [[l["coorte"], l["clientes"]] + l["retencao"] + [None] * (meses - len(l["retencao"])) for l in coortes["linhas"]]
        formatos = {c: PERCENTUAL for c in range(3, meses + 3)}
        fim = tabela(planilha, 4, ["Coorte", "Clientes"] + [f"Mês {i}" for i in range(meses)], linhas, formatos)
        planilha.conditional_formatting.add(f"C5:{get_column_letter(meses + 2)}{fim}", ColorScaleRule(start_type="num", start_value=0, start_color="FEE2E2", mid_type="num", mid_value=0.6, mid_color="FEF9C3", end_type="num", end_value=1, end_color="DCFCE7"))
    ltv = analise.get("ltv") or []
    if ltv:
        planilha = livro.create_sheet("LTV")
        cabecalho(planilha, "Valor do tempo de vida (LTV) por plano", "LTV = ticket mensal ÷ churn mensal dos últimos 6 meses (limite de 60 meses)")
        tabela(planilha, 4, ["Plano", "Ativos", "Ticket mensal", "Churn mensal", "Vida média (meses)", "LTV"], [(l["plano"], l["ativos"], reais(l["arpu"]), l["churn"], l["vida_meses"], reais(l["ltv"])) for l in ltv], {3: MOEDA, 4: PERCENTUAL, 6: MOEDA})
    if qualidade:
        planilha = livro.create_sheet("Qualidade dos dados")
        cabecalho(planilha, f"Qualidade dos dados — nota {qualidade['nota']} ({qualidade['classificacao']})", "Verificações automáticas de consistência")
        fim = tabela(planilha, 4, ["Verificação", "Severidade", "Afetados", "Total", "Percentual", "Saúde", "Recomendação"], [(v["titulo"], v["severidade"], v["afetados"], v["total"], v["percentual"], v["saude"], v["recomendacao"]) for v in qualidade["verificacoes"]], {5: PERCENTUAL, 6: PERCENTUAL})
        planilha.conditional_formatting.add(f"F5:F{fim}", ColorScaleRule(start_type="num", start_value=0, start_color="FECACA", end_type="num", end_value=1, end_color="BBF7D0"))
    for planilha in livro.worksheets:
        planilha.sheet_view.showGridLines = False
        planilha.sheet_properties.tabColor = DESTAQUE
    livro.properties.creator = "Bento"
    livro.properties.title = "Inteligência de dados"
    saida = io.BytesIO()
    livro.save(saida)
    return saida.getvalue()
