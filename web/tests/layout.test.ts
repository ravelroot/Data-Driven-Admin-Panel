import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarModelo, iguaisLayouts, layoutPadrao, moverEntreVisiveis, moverItem, normalizarLayout, type DefinicaoCartao } from "../src/ts/nucleo/layout.ts";

const DEFINICOES: DefinicaoCartao[] = [
  { id: "a", nome: "A", larguras: ["metade", "inteiro"], alturas: ["normal", "alto"], largura: "metade", altura: "normal" },
  { id: "b", nome: "B", larguras: ["metade"], alturas: ["normal"], largura: "metade", altura: "normal" },
  { id: "c", nome: "C", larguras: ["terco", "dois-tercos"], alturas: ["normal"], largura: "terco", altura: "normal" },
  { id: "d", nome: "D", larguras: ["dois-tercos"], alturas: ["alto"], largura: "dois-tercos", altura: "alto" },
];

const ids = (layout: { id: string }[]): string[] => layout.map((item) => item.id);

test("normalizarLayout usa o padrão sem layout salvo", () => {
  assert.deepEqual(normalizarLayout(DEFINICOES, null), layoutPadrao(DEFINICOES));
  assert.deepEqual(normalizarLayout(DEFINICOES, []), layoutPadrao(DEFINICOES));
});

test("normalizarLayout mantém a ordem salva, descarta desconhecidos e repetidos e corrige tamanhos não permitidos", () => {
  const layout = normalizarLayout(DEFINICOES, [
    { id: "c", largura: "dois-tercos", altura: "normal", oculto: false },
    { id: "x", largura: "metade", altura: "normal", oculto: false },
    { id: "a", largura: "quarto", altura: "alto", oculto: true },
    { id: "c", largura: "terco", altura: "normal", oculto: false },
  ]);
  assert.deepEqual(ids(layout), ["c", "d", "a", "b"]);
  assert.equal(layout[0]?.largura, "dois-tercos");
  assert.equal(layout[2]?.largura, "metade");
  assert.equal(layout[2]?.altura, "alto");
  assert.equal(layout[2]?.oculto, true);
});

test("cartões novos entram logo depois do vizinho que vinha antes no padrão", () => {
  const layout = normalizarLayout(DEFINICOES, [
    { id: "d", largura: "dois-tercos", altura: "alto", oculto: false },
    { id: "a", largura: "metade", altura: "normal", oculto: false },
  ]);
  assert.deepEqual(ids(layout), ["d", "a", "b", "c"]);
});

test("moverItem e moverEntreVisiveis reordenam sem perder cartões", () => {
  const padrao = layoutPadrao(DEFINICOES);
  assert.deepEqual(ids(moverItem(padrao, "d", 0)), ["d", "a", "b", "c"]);
  assert.deepEqual(ids(moverItem(padrao, "a", 99)), ["b", "c", "d", "a"]);
  assert.equal(moverItem(padrao, "z", 0), padrao);
  const comOculto = padrao.map((item) => (item.id === "b" ? { ...item, oculto: true } : item));
  assert.deepEqual(ids(moverEntreVisiveis(comOculto, "c", -1)), ["c", "a", "b", "d"]);
  assert.deepEqual(ids(moverEntreVisiveis(comOculto, "a", -1)), ["a", "b", "c", "d"]);
});

test("aplicarModelo esconde quem ficou de fora e iguaisLayouts compara item a item", () => {
  const layout = aplicarModelo(DEFINICOES, { id: "m", nome: "M", descricao: "", itens: [{ id: "c", largura: "dois-tercos", altura: "normal", oculto: false }] });
  assert.deepEqual(ids(layout), ["c", "a", "b", "d"]);
  assert.deepEqual(layout.filter((item) => item.oculto).map((item) => item.id), ["a", "b", "d"]);
  assert.equal(iguaisLayouts(layoutPadrao(DEFINICOES), layoutPadrao(DEFINICOES)), true);
  assert.equal(iguaisLayouts(layout, layoutPadrao(DEFINICOES)), false);
});
