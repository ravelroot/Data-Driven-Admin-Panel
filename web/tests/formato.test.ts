import { test } from "node:test";
import assert from "node:assert/strict";
import { moeda, numero, percentual, variacao, iniciais, corAvatar, dataCurta, bytes, plural, dataIso, somarDias } from "../src/ts/nucleo/formato.ts";

const semEspacoFixo = (texto: string): string => texto.replace(/ | /g, " ");

test("moeda formata centavos em reais", () => {
  assert.equal(semEspacoFixo(moeda(12990)), "R$ 129,90");
  assert.equal(semEspacoFixo(moeda(0)), "R$ 0,00");
  assert.equal(semEspacoFixo(moeda(15000000, { compacto: true })), "R$ 150 mil");
});

test("numero, percentual e variacao", () => {
  assert.equal(numero(2395), "2.395");
  assert.equal(percentual(12.345), "12,3%");
  assert.equal(percentual(null), "—");
  assert.equal(variacao(8.4), "+8,4%");
  assert.equal(variacao(-2), "−2,0%");
});

test("iniciais usa primeiro e último nome", () => {
  assert.equal(iniciais("Ana Martins"), "AM");
  assert.equal(iniciais("Carla de Souza Dias"), "CD");
  assert.equal(iniciais(""), "?");
});

test("corAvatar é estável e fica entre 0 e 7", () => {
  const cor = corAvatar("ana@bento.local");
  assert.equal(cor, corAvatar("ana@bento.local"));
  assert.ok(cor >= 0 && cor <= 7);
});

test("datas sem hora não voltam um dia por causa do fuso", () => {
  assert.equal(dataCurta("2026-09-23"), "23/09/2026");
  assert.equal(dataIso(somarDias(new Date(2026, 0, 31), 1)), "2026-02-01");
});

test("bytes e plural", () => {
  assert.equal(bytes(512), "512 B");
  assert.equal(bytes(2048), "2,0 KB");
  assert.equal(plural(1, "conta"), "1 conta");
  assert.equal(plural(3, "conta"), "3 contas");
});
