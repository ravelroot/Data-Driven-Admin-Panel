import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITE_RECENTES, mesclarRecente, type ItemRecente } from "../src/ts/nucleo/recentes.ts";
import { alternarOculta, configuraveis, normalizarOcultas, ocultasPadrao, type ColunaConfiguravel } from "../src/ts/nucleo/colunas.ts";
import { hrefPaginaInicial, PAGINAS_INICIAIS, paginaPorId } from "../src/ts/layout/navegacao.ts";
import { codigoCurto, ErroApi, mensagemDeErro } from "../src/ts/nucleo/api.ts";

const item = (id: string, tipo: ItemRecente["tipo"] = "usuario"): ItemRecente => ({ tipo, id, titulo: `Item ${id}`, href: `/usuarios?usuario=${id}`, em: "2026-11-04T12:00:00.000Z" });

test("mesclarRecente põe o item no topo, sem repetir, e respeita o limite", () => {
  let lista: ItemRecente[] = [];
  lista = mesclarRecente(lista, item("a"));
  lista = mesclarRecente(lista, item("b"));
  lista = mesclarRecente(lista, item("a"));
  assert.deepEqual(lista.map((registro) => registro.id), ["a", "b"]);
  lista = mesclarRecente(lista, item("a", "transacao"));
  assert.equal(lista.length, 3);
  for (let indice = 0; indice < LIMITE_RECENTES + 4; indice += 1) lista = mesclarRecente(lista, item(`x${indice}`));
  assert.equal(lista.length, LIMITE_RECENTES);
  assert.equal(lista[0]?.id, `x${LIMITE_RECENTES + 3}`);
});

const COLUNAS: ColunaConfiguravel[] = [
  { campo: "nome", titulo: "Usuário", fixa: true },
  { campo: "papel", titulo: "Papel" },
  { campo: "plano", titulo: "Plano" },
  { campo: "ip", titulo: "IP", escondidaPorPadrao: true },
  { campo: "acoes", titulo: "Ações", oculto: true },
];

test("só colunas que não são fixas nem ocultas podem ser escondidas", () => {
  assert.deepEqual(configuraveis(COLUNAS).map((coluna) => coluna.campo), ["papel", "plano", "ip"]);
  assert.deepEqual(ocultasPadrao(COLUNAS), ["ip"]);
});

test("normalizarOcultas descarta campos desconhecidos, repetidos e nunca esconde todas", () => {
  assert.deepEqual(normalizarOcultas(COLUNAS, null), ["ip"]);
  assert.deepEqual(normalizarOcultas(COLUNAS, ["plano", "plano", "nome", "acoes", "inexistente", 3]), ["plano"]);
  assert.equal(normalizarOcultas(COLUNAS, ["papel", "plano", "ip"]).length, 2);
  assert.deepEqual(alternarOculta(["plano"], "plano"), []);
  assert.deepEqual(alternarOculta([], "papel"), ["papel"]);
});

test("hrefPaginaInicial só leva a páginas conhecidas e permitidas", () => {
  assert.equal(hrefPaginaInicial("transacoes"), "/transacoes");
  assert.equal(hrefPaginaInicial("componentes"), "/");
  assert.equal(hrefPaginaInicial("https://outro.site"), "/");
  assert.equal(hrefPaginaInicial(undefined), "/");
  assert.equal(hrefPaginaInicial("auditoria", (permissao) => permissao !== "auditoria.ver"), "/");
  for (const id of PAGINAS_INICIAIS) assert.ok(paginaPorId(id), id);
});

test("erros 500 mostram um código curto para achar a requisição nos logs", () => {
  assert.equal(codigoCurto("3f2a9c1e-7b4d-4e2a-9a10-0c8f6e5d4b3a"), "3f2a9c1e");
  const interno = new ErroApi(500, "INTERNO", "Algo deu errado do nosso lado.", undefined, "3f2a9c1e-7b4d-4e2a-9a10-0c8f6e5d4b3a");
  assert.equal(mensagemDeErro(interno), "Algo deu errado do nosso lado. Código do erro: 3f2a9c1e.");
  const manutencao = new ErroApi(503, "MANUTENCAO", "O painel está em manutenção.", undefined, "abc12345");
  assert.equal(mensagemDeErro(manutencao), "O painel está em manutenção.");
  assert.equal(mensagemDeErro(new ErroApi(422, "VALIDACAO", "Nome inválido.")), "Nome inválido.");
});
