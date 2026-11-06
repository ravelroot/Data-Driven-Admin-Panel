import base64
import io

import numpy as np
import pandas as pd
from openpyxl import load_workbook

from bento_analise import previsao
from bento_analise.coortes import simular
from bento_analise.esquemas import Cenario
from conftest import REFERENCIA, TOKEN


def test_saude_sem_autenticacao(cliente):
    resposta = cliente.get("/saude")
    assert resposta.status_code == 200
    assert resposta.json()["status"] == "ok"


def test_token_obrigatorio(cliente, conjunto):
    resposta = cliente.post("/v1/analise", json=conjunto, headers={"X-Bento-Token": "errado"})
    assert resposta.status_code == 401
    resposta = cliente.post("/v1/simulador", json={}, headers={"X-Bento-Token": ""})
    assert resposta.status_code == 401


def test_sem_token_configurado(monkeypatch, cliente):
    monkeypatch.setenv("BENTO_ANALISE_TOKEN", "curto")
    resposta = cliente.post("/v1/simulador", json={})
    assert resposta.status_code == 503


def test_campos_extras_sao_rejeitados(cliente, conjunto):
    resposta = cliente.post("/v1/analise", json={**conjunto, "senha": "x"})
    assert resposta.status_code == 422


def test_corpo_grande(cliente):
    resposta = cliente.post("/v1/planilha", content=b"{}", headers={"Content-Length": str(10**12), "Content-Type": "application/json"})
    assert resposta.status_code == 413


def test_holt_winters_recupera_sazonalidade():
    dias = np.arange(140)
    y = 100 + dias * 0.5 + np.where(dias % 7 < 5, 20, -30)
    pontos, escala, _, _ = previsao.prever_serie(y.astype(float), 7, 14)
    esperado = 100 + np.arange(140, 154) * 0.5 + np.where(np.arange(140, 154) % 7 < 5, 20, -30)
    assert np.abs(pontos - esperado).max() < 6
    assert (np.diff(escala) >= 0).all()


def test_previsoes(analise):
    series = {s["codigo"]: s for s in analise["previsoes"]["series"]}
    receita = series["receita"]
    assert len(receita["previsao"]["valores"]) == 30
    assert receita["mes"]["minimo"] <= receita["mes"]["previsto"] <= receita["mes"]["maximo"]
    assert all(a <= v <= b for a, v, b in zip(receita["previsao"]["min80"], receita["previsao"]["valores"], receita["previsao"]["max80"]))
    assert receita["modelo"]["teste"]["acuracia"] > 0.8
    assert analise["previsoes"]["mrr"]["atual"] > 0


def test_risco_de_cancelamento(analise):
    risco = analise["risco"]
    assert risco["modelo"]["auc"] is None or risco["modelo"]["auc"] > 0.55
    assert risco["clientes"]
    probabilidades = [c["probabilidade"] for c in risco["clientes"]]
    assert probabilidades == sorted(probabilidades, reverse=True)
    assert all(0 <= p <= 1 for p in probabilidades)
    assert any("Renovação anual" in m for c in risco["clientes"] for m in c["motivos"])
    assert sum(risco["distribuicao"]["contagem"]) == risco["resumo"]["ativos"]


def test_segmentos(analise):
    segmentos = analise["segmentos"]
    assert sum(s["clientes"] for s in segmentos["segmentos"]) == segmentos["clientes"]
    assert abs(sum(s["participacao"] for s in segmentos["segmentos"]) - 1) < 0.01
    assert 3 <= segmentos["agrupamento"]["k"] <= 6
    assert sum(sum(linha) for linha in segmentos["matriz"]) == segmentos["clientes"]


def test_coortes_e_ltv(analise):
    linhas = analise["coortes"]["linhas"]
    assert len(linhas) == 12
    for linha in linhas:
        valores = [v for v in linha["retencao"] if v is not None]
        assert all(0 <= v <= 1 for v in valores)
        assert valores == sorted(valores, reverse=True)
    assert analise["ltv"][0]["plano"] == "Todos"
    assert all(l["ltv"] >= 0 for l in analise["ltv"])


def test_simulador():
    base = Cenario(ativos=500, arpu=10_000, churn=0.03, novos=30, referencia=REFERENCIA)
    neutro = simular(base)
    assert neutro["resumo"]["diferenca_mrr"] == 0
    aumento = simular(base.model_copy(update={"preco": 10}))
    assert aumento["resumo"]["mrr_cenario"] > aumento["resumo"]["mrr_base"]
    reacao = simular(base.model_copy(update={"preco": 10, "elasticidade": 3}))
    assert reacao["resumo"]["churn_cenario"] > base.churn
    melhor = simular(base.model_copy(update={"churn_pp": -1}))
    assert melhor["resumo"]["ativos_cenario"] > melhor["resumo"]["ativos_base"]
    assert len(melhor["rotulos"]) == 12


def test_qualidade_detecta_problemas(cliente, conjunto):
    copia = {**conjunto, "assinaturas": [dict(a) for a in conjunto["assinaturas"]], "eventos": [list(e) for e in conjunto["eventos"]]}
    copia["assinaturas"][0]["valor"] = 1
    alvo = next(i for i, a in enumerate(copia["assinaturas"]) if a["cancelada"])
    copia["eventos"].append([alvo, "2026-11-05", "paga", 4_900, "assinatura"])
    copia["eventos"].append(list(copia["eventos"][0]))
    resposta = cliente.post("/v1/analise", json=copia).json()
    itens = {v["codigo"]: v for v in resposta["qualidade"]["verificacoes"]}
    assert itens["valor_divergente"]["afetados"] >= 1
    assert itens["pago_apos_cancelar"]["afetados"] >= 1
    assert itens["cobranca_duplicada"]["afetados"] >= 1
    assert 0 <= resposta["qualidade"]["nota"] <= 100


def test_conjunto_vazio(cliente):
    resposta = cliente.post("/v1/analise", json={"referencia": "2026-11-06"})
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["risco"] is None and corpo["segmentos"] is None


def test_relatorio_excel(cliente, analise):
    nomes = {analise["risco"]["clientes"][0]["id"]: "=HYPERLINK(\"http://x\")"}
    resposta = cliente.post("/v1/relatorio", json={"analise": analise, "nomes": nomes, "empresa": "Bento"})
    assert resposta.status_code == 200
    livro = load_workbook(io.BytesIO(resposta.content))
    assert {"Resumo", "Risco de cancelamento", "Segmentos RFM", "Coortes", "LTV", "Qualidade dos dados", "MRR"} <= set(livro.sheetnames)
    assert livro["Risco de cancelamento"]["A5"].value.startswith("'=")
    assert livro["Previsão Receita paga"]._charts


def test_planilha_xlsx(cliente):
    quadro = pd.DataFrame({"Nome completo": ["Ana Lima", "Bruno Reis", "Bruno Reis", "Carla"], "E-mail": ["ana@exemplo.com", "bruno@exemplo.com", "bruno@exemplo.com", "carla-invalido"], "Celular": ["(11) 99999-0000", "(21) 98888-1111", "(21) 98888-1111", "(31) 97777-2222"], "Origem": ["Pago", "Social", "Social", "Orgânico"]})
    arquivo = io.BytesIO()
    quadro.to_excel(arquivo, index=False)
    resposta = cliente.post("/v1/planilha", json={"nome": "clientes.xlsx", "conteudo": base64.b64encode(arquivo.getvalue()).decode()})
    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["mapa"] == {"Nome completo": "nome", "E-mail": "email", "Celular": "telefone", "Origem": "canal"}
    tipos = {p["tipo"] for p in corpo["problemas"]}
    assert {"linhas_duplicadas", "email_invalido"} <= tipos
    assert corpo["csv"].splitlines()[0] == "nome,email,telefone,canal"
    assert len(corpo["csv"].splitlines()) == 4


def test_planilha_csv_ponto_e_virgula(cliente):
    texto = "nome;email;cidade\nAna;ana@exemplo.com;Recife\nLuiz;luiz@exemplo.com;Natal\n"
    resposta = cliente.post("/v1/planilha", json={"nome": "lista.csv", "conteudo": base64.b64encode(texto.encode()).decode()})
    corpo = resposta.json()
    assert corpo["mapa"] == {"nome": "nome", "email": "email", "cidade": "cidade"}
    assert corpo["nota"] == 100


def test_planilha_invalida(cliente):
    resposta = cliente.post("/v1/planilha", json={"nome": "x.xlsx", "conteudo": base64.b64encode(b"nao e zip").decode()})
    assert resposta.status_code == 422
    resposta = cliente.post("/v1/planilha", json={"nome": "x.exe", "conteudo": base64.b64encode(b"a").decode()})
    assert resposta.status_code == 422
    resposta = cliente.post("/v1/planilha", json={"nome": "x.csv", "conteudo": "%%%"})
    assert resposta.status_code == 422


def test_planilha_larga_e_bomba_sao_recusadas(cliente):
    larga = ",".join(f"c{i}" for i in range(500)) + "\n" + ",".join("x" for _ in range(500)) + "\n"
    resposta = cliente.post("/v1/planilha", json={"nome": "larga.csv", "conteudo": base64.b64encode(larga.encode()).decode()})
    assert resposta.status_code == 422
    assert "colunas" in resposta.json()["mensagem"]
    import zipfile

    pacote = io.BytesIO()
    with zipfile.ZipFile(pacote, "w", zipfile.ZIP_DEFLATED) as arquivo:
        arquivo.writestr("xl/worksheets/sheet1.xml", "0" * 20_000_000)
    resposta = cliente.post("/v1/planilha", json={"nome": "bomba.xlsx", "conteudo": base64.b64encode(pacote.getvalue()).decode()})
    assert resposta.status_code == 422
    assert "grande demais" in resposta.json()["mensagem"]
    resposta = cliente.post("/v1/planilha", json={"nome": "quebrada.xlsx", "conteudo": base64.b64encode(b"PK\x03\x04lixo").decode()})
    assert resposta.status_code == 422


def test_planilha_com_colunas_repetidas(cliente):
    texto = "email,email ,nome\nana@exemplo.com,ana@exemplo.com,Ana\n"
    resposta = cliente.post("/v1/planilha", json={"nome": "rep.csv", "conteudo": base64.b64encode(texto.encode()).decode()})
    assert resposta.status_code == 200
    assert resposta.json()["mapa"]["email"] == "email"


def test_excel_resiste_a_caracteres_de_controle_e_formulas(cliente, analise):
    nomes = {analise["risco"]["clientes"][0]["id"]: "Ana\x01Silva"}
    resposta = cliente.post("/v1/relatorio", json={"analise": analise, "nomes": nomes, "empresa": "=HYPERLINK(\"http://x\")"})
    assert resposta.status_code == 200
    livro = load_workbook(io.BytesIO(resposta.content))
    assert livro["Risco de cancelamento"]["A5"].value == "AnaSilva"
    assert livro["Resumo"]["A2"].data_type != "f"


def test_segmentos_com_clientes_identicos():
    from bento_analise.segmentos import agrupar

    tabela = pd.DataFrame({"recencia": [10] * 40, "frequencia": [3] * 40, "valor": [9_000] * 40, "r": [3] * 40, "f": [3] * 40, "m": [3] * 40})
    assert agrupar(tabela) is None
