import { test } from "node:test";
import assert from "node:assert/strict";
import { ACOES_RAPIDAS, IR_PARA, NAVEGACAO, paginaPorId } from "../src/ts/layout/navegacao.ts";

const paginas = NAVEGACAO.flatMap((grupo) => grupo.itens);

test("cada página do menu tem id único e endereço absoluto", () => {
  const ids = paginas.map((pagina) => pagina.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const pagina of paginas) assert.match(pagina.href, /^\//, pagina.id);
});

test("todo atalho g + tecla aponta para uma página do menu", () => {
  for (const [tecla, id] of Object.entries(IR_PARA)) {
    assert.equal(tecla.length, 1, `tecla ${tecla}`);
    assert.ok(paginaPorId(id), `atalho g ${tecla} aponta para "${id}", que não está no menu`);
  }
  assert.equal(new Set(Object.values(IR_PARA)).size, Object.keys(IR_PARA).length);
});

test("comandos da paleta têm id único e um destino ou uma ação", () => {
  const ids = ACOES_RAPIDAS.map((acao) => acao.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const acao of ACOES_RAPIDAS) assert.ok(acao.href || acao.acao, acao.id);
});

test("páginas novas da 1.1 ficam protegidas por permissão", () => {
  assert.equal(paginaPorId("transacoes")?.permissao, "transacoes.ver");
  assert.equal(paginaPorId("auditoria")?.permissao, "auditoria.ver");
});
