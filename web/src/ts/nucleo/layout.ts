import type { AlturaCartao, ItemLayout, LarguraCartao } from "./tipos.ts";

export interface DefinicaoCartao {
  id: string;
  nome: string;
  larguras: LarguraCartao[];
  alturas: AlturaCartao[];
  largura: LarguraCartao;
  altura: AlturaCartao;
}

export interface ModeloLayout {
  id: string;
  nome: string;
  descricao: string;
  itens: ItemLayout[];
}

export const ROTULOS_LARGURA: Record<LarguraCartao, string> = {
  quarto: "Um quarto",
  terco: "Um terço",
  "cinco-doze": "Cinco doze avos",
  metade: "Metade",
  "sete-doze": "Sete doze avos",
  "dois-tercos": "Dois terços",
  "tres-quartos": "Três quartos",
  inteiro: "Largura inteira",
};

export const COLUNAS_LARGURA: Record<LarguraCartao, number> = {
  quarto: 3,
  terco: 4,
  "cinco-doze": 5,
  metade: 6,
  "sete-doze": 7,
  "dois-tercos": 8,
  "tres-quartos": 9,
  inteiro: 12,
};

export const CLASSES_LARGURA = Object.keys(COLUNAS_LARGURA).map((largura) => `bento-${largura}`);

export const layoutPadrao = (definicoes: DefinicaoCartao[]): ItemLayout[] =>
  definicoes.map((definicao) => ({ id: definicao.id, largura: definicao.largura, altura: definicao.altura, oculto: false }));

export const normalizarLayout = (definicoes: DefinicaoCartao[], salvo: ItemLayout[] | null | undefined): ItemLayout[] => {
  const padrao = layoutPadrao(definicoes);
  if (!salvo?.length) return padrao;
  const porId = new Map(definicoes.map((definicao) => [definicao.id, definicao]));
  const vistos = new Set<string>();
  const resultado: ItemLayout[] = [];
  for (const item of salvo) {
    const definicao = porId.get(item.id);
    if (!definicao || vistos.has(item.id)) continue;
    vistos.add(item.id);
    resultado.push({
      id: item.id,
      largura: definicao.larguras.includes(item.largura) ? item.largura : definicao.largura,
      altura: definicao.alturas.includes(item.altura) ? item.altura : definicao.altura,
      oculto: Boolean(item.oculto),
    });
  }
  padrao.forEach((item, indice) => {
    if (vistos.has(item.id)) return;
    const anterior = padrao.slice(0, indice).reverse().find((candidato) => vistos.has(candidato.id));
    const posicao = anterior ? resultado.findIndex((existente) => existente.id === anterior.id) + 1 : 0;
    resultado.splice(posicao, 0, item);
    vistos.add(item.id);
  });
  return resultado;
};

export const moverItem = (layout: ItemLayout[], id: string, destino: number): ItemLayout[] => {
  const origem = layout.findIndex((item) => item.id === id);
  if (origem < 0) return layout;
  const copia = [...layout];
  const [item] = copia.splice(origem, 1);
  const limite = Math.max(0, Math.min(copia.length, destino));
  copia.splice(limite, 0, item);
  return copia;
};

export const moverEntreVisiveis = (layout: ItemLayout[], id: string, passo: number): ItemLayout[] => {
  const visiveis = layout.filter((item) => !item.oculto);
  const atual = visiveis.findIndex((item) => item.id === id);
  if (atual < 0) return layout;
  const alvo = visiveis[Math.max(0, Math.min(visiveis.length - 1, atual + passo))];
  if (!alvo || alvo.id === id) return layout;
  const indiceAlvo = layout.findIndex((item) => item.id === alvo.id);
  return moverItem(layout, id, indiceAlvo);
};

export const iguaisLayouts = (a: ItemLayout[], b: ItemLayout[]): boolean =>
  a.length === b.length && a.every((item, indice) => {
    const outro = b[indice];
    return outro && outro.id === item.id && outro.largura === item.largura && outro.altura === item.altura && outro.oculto === item.oculto;
  });

export const aplicarModelo = (definicoes: DefinicaoCartao[], modelo: ModeloLayout): ItemLayout[] => {
  const incluidos = new Set(modelo.itens.map((item) => item.id));
  const ocultos = layoutPadrao(definicoes)
    .filter((item) => !incluidos.has(item.id))
    .map((item) => ({ ...item, oculto: true }));
  return normalizarLayout(definicoes, [...modelo.itens, ...ocultos]);
};
