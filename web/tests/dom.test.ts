import { test } from "node:test";
import assert from "node:assert/strict";
import { html, escapar, seguro } from "../src/ts/nucleo/dom.ts";

test("escapar neutraliza HTML", () => {
  assert.equal(escapar('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("html escapa valores e mantém marcação segura", () => {
  const nome = "<b>Ana</b>";
  assert.equal(String(html`<p>${nome}</p>`), "<p>&lt;b&gt;Ana&lt;/b&gt;</p>");
  assert.equal(String(html`<p>${seguro("<b>Ana</b>")}</p>`), "<p><b>Ana</b></p>");
});

test("html junta listas e trata vazios e booleanos", () => {
  const itens = ["um", "dois"].map((item) => html`<li>${item}</li>`);
  assert.equal(String(html`<ul>${itens}</ul>`), "<ul><li>um</li><li>dois</li></ul>");
  assert.equal(String(html`<i>${null}${undefined}</i>`), "<i></i>");
  assert.equal(String(html`<b aria-pressed="${false}" data-x="${true}"></b>`), '<b aria-pressed="false" data-x="true"></b>');
});
