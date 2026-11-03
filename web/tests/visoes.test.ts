import { test } from "node:test";
import assert from "node:assert/strict";
import { adicionarVisao, limparNomeVisao, normalizarConsulta, removerVisao, validarVisoes, visaoAtiva, LIMITE_VISOES } from "../src/ts/nucleo/visoes.ts";

test("normalizarConsulta ordena, descarta vazios, página e parâmetros ignorados", () => {
  assert.equal(normalizarConsulta("?status=paga&metodo=pix&pagina=3&q="), "metodo=pix&status=paga");
  assert.equal(normalizarConsulta("transacao=abc&tipo=avulsa", ["transacao"]), "tipo=avulsa");
  assert.equal(normalizarConsulta(""), "");
});

test("limparNomeVisao junta espaços e corta no limite", () => {
  assert.equal(limparNomeVisao("  Pix   pendentes \n hoje "), "Pix pendentes hoje");
  assert.equal(limparNomeVisao("x".repeat(60)).length, 40);
});

test("adicionarVisao substitui a mesma consulta ou o mesmo nome e respeita o limite", () => {
  let lista = adicionarVisao([], "Pix", "status=pendente&metodo=pix");
  lista = adicionarVisao(lista, "Pix pendentes", "metodo=pix&status=pendente");
  assert.equal(lista.length, 1);
  assert.equal(lista[0]?.nome, "Pix pendentes");
  lista = adicionarVisao(lista, "pix pendentes", "status=falhou");
  assert.equal(lista.length, 1);
  assert.equal(lista[0]?.consulta, "status=falhou");
  for (let i = 0; i < LIMITE_VISOES + 3; i += 1) lista = adicionarVisao(lista, `Visão ${i}`, `q=${i}`);
  assert.equal(lista.length, LIMITE_VISOES);
  assert.equal(adicionarVisao(lista, "   ", "q=novo").length, LIMITE_VISOES);
});

test("visaoAtiva encontra a visão da URL e removerVisao tira pelo id", () => {
  const lista = adicionarVisao([], "Reembolsos", "tipo=reembolso");
  const ativa = visaoAtiva(lista, "?pagina=2&tipo=reembolso");
  assert.equal(ativa?.nome, "Reembolsos");
  assert.equal(removerVisao(lista, ativa?.id ?? "").length, 0);
  assert.equal(visaoAtiva(lista, "tipo=avulsa"), undefined);
});

test("validarVisoes ignora dados corrompidos do armazenamento", () => {
  assert.deepEqual(validarVisoes("lixo"), []);
  const validas = validarVisoes([{ id: "a", nome: " Pagas ", consulta: "status=paga" }, { id: 1 }, null, { id: "b", nome: "", consulta: "" }]);
  assert.equal(validas.length, 1);
  assert.equal(validas[0]?.nome, "Pagas");
});
