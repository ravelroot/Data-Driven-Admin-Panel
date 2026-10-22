import PDFDocument from 'pdfkit';
import { formatarCelula, type Coluna, type FormatoColuna } from './csv.js';

export interface EntradaPdf {
  titulo: string;
  subtitulo: string;
  periodo: string;
  geradoEm: string;
  colunas: Coluna[];
  linhas: Record<string, unknown>[];
  resumo: { rotulo: string; valor: number; formato: FormatoColuna }[];
  fuso: string;
}

const CORES = {
  preto: '#000000',
  grafite: '#333232',
  chumbo: '#4D4B4B',
  cinza: '#BAB7B6',
  branco: '#FFFFFF',
  superficie: '#F5F4F4',
  zebra: '#F7F6F6',
};

const MARGEM = 40;
const ALTURA_LINHA = 18;
const ALTURA_CABECALHO_TABELA = 22;
const LIMITE_LINHAS_PDF = 5_000;

type Documento = InstanceType<typeof PDFDocument>;

function desenharMarca(doc: Documento, x: number, y: number, tamanho: number): void {
  const escala = tamanho / 100;
  doc.save();
  doc.rect(x, y, tamanho, tamanho).fill('#000000');
  doc.fillColor('#FFFFFF');
  doc.rect(x + 18 * escala, y + 18 * escala, 30 * escala, 64 * escala).fill();
  doc.rect(x + 52 * escala, y + 18 * escala, 30 * escala, 30 * escala).fill();
  doc
    .lineWidth(7 * escala)
    .rect(x + 55.5 * escala, y + 55.5 * escala, 23 * escala, 23 * escala)
    .stroke('#FFFFFF');
  doc.restore();
}

function alinhamento(formato: FormatoColuna): 'left' | 'right' {
  return formato === 'moeda' || formato === 'numero' || formato === 'percentual' ? 'right' : 'left';
}

function calcularLarguras(doc: Documento, colunas: Coluna[], linhas: Record<string, unknown>[], fuso: string, disponivel: number): number[] {
  doc.font('Helvetica').fontSize(8);
  const amostra = linhas.slice(0, 200);
  const desejadas = colunas.map((coluna) => {
    let maior = doc.font('Helvetica-Bold').widthOfString(coluna.titulo);
    doc.font('Helvetica');
    for (const linha of amostra) {
      const largura = doc.widthOfString(formatarCelula(linha[coluna.campo], coluna.formato, fuso, true));
      if (largura > maior) maior = largura;
    }
    return Math.min(Math.max(maior + 14, 44), 220);
  });
  const soma = desejadas.reduce((total, largura) => total + largura, 0);
  return desejadas.map((largura) => (largura / soma) * disponivel);
}

function desenharCabecalhoPagina(doc: Documento, entrada: EntradaPdf): number {
  const largura = doc.page.width;
  desenharMarca(doc, MARGEM, MARGEM, 26);
  doc.fillColor(CORES.preto).font('Helvetica-Bold').fontSize(15).text('Bento', MARGEM + 36, MARGEM + 5, { lineBreak: false });
  doc
    .fillColor(CORES.chumbo)
    .font('Helvetica')
    .fontSize(8)
    .text(`Gerado em ${entrada.geradoEm}`, MARGEM, MARGEM + 9, { width: largura - MARGEM * 2, align: 'right', lineBreak: false });
  doc
    .moveTo(MARGEM, MARGEM + 38)
    .lineTo(largura - MARGEM, MARGEM + 38)
    .lineWidth(0.6)
    .strokeColor(CORES.cinza)
    .stroke();
  return MARGEM + 50;
}

function desenharCabecalhoTabela(doc: Documento, colunas: Coluna[], larguras: number[], y: number): number {
  const largura = larguras.reduce((total, valor) => total + valor, 0);
  doc.rect(MARGEM, y, largura, ALTURA_CABECALHO_TABELA).fill(CORES.preto);
  let x = MARGEM;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(CORES.branco);
  colunas.forEach((coluna, indice) => {
    doc.text(coluna.titulo, x + 6, y + 7, {
      width: larguras[indice] - 12,
      align: alinhamento(coluna.formato),
      lineBreak: false,
      ellipsis: true,
    });
    x += larguras[indice];
  });
  return y + ALTURA_CABECALHO_TABELA;
}

export function gerarPdf(entrada: EntradaPdf): Promise<Buffer> {
  const paisagem = entrada.colunas.length > 6;
  const doc = new PDFDocument({
    size: 'A4',
    layout: paisagem ? 'landscape' : 'portrait',
    margins: { top: MARGEM, bottom: MARGEM, left: MARGEM, right: MARGEM },
    bufferPages: true,
    info: { Title: entrada.titulo, Author: 'Bento', Creator: 'Bento', Subject: entrada.subtitulo },
  });
  const partes: Buffer[] = [];
  doc.on('data', (parte: Buffer) => partes.push(parte));
  const concluido = new Promise<Buffer>((resolver, rejeitar) => {
    doc.on('end', () => resolver(Buffer.concat(partes)));
    doc.on('error', rejeitar);
  });

  const largura = doc.page.width;
  const disponivel = largura - MARGEM * 2;
  let y = desenharCabecalhoPagina(doc, entrada);

  doc.fillColor(CORES.preto).font('Helvetica-Bold').fontSize(18).text(entrada.titulo, MARGEM, y, { width: disponivel });
  y = doc.y + 4;
  doc.fillColor(CORES.chumbo).font('Helvetica').fontSize(9.5).text(`${entrada.subtitulo} · Período: ${entrada.periodo}`, MARGEM, y, {
    width: disponivel,
  });
  y = doc.y + 14;

  if (entrada.resumo.length > 0) {
    const espaco = 10;
    const quantidade = entrada.resumo.length;
    const larguraCartao = (disponivel - espaco * (quantidade - 1)) / quantidade;
    entrada.resumo.forEach((item, indice) => {
      const x = MARGEM + indice * (larguraCartao + espaco);
      doc.rect(x, y, larguraCartao, 50).fillAndStroke(CORES.superficie, CORES.cinza);
      doc
        .fillColor(CORES.chumbo)
        .font('Helvetica-Bold')
        .fontSize(7)
        .text(item.rotulo.toUpperCase(), x + 10, y + 10, { width: larguraCartao - 20, lineBreak: false, ellipsis: true });
      doc
        .fillColor(CORES.preto)
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(formatarCelula(item.valor, item.formato, entrada.fuso, true), x + 10, y + 25, {
          width: larguraCartao - 20,
          lineBreak: false,
          ellipsis: true,
        });
    });
    y += 66;
  }

  const linhas = entrada.linhas.slice(0, LIMITE_LINHAS_PDF);
  if (entrada.linhas.length > LIMITE_LINHAS_PDF) {
    doc
      .fillColor(CORES.grafite)
      .font('Helvetica-Oblique')
      .fontSize(8.5)
      .text(
        `Mostrando as primeiras ${LIMITE_LINHAS_PDF.toLocaleString('pt-BR')} de ${entrada.linhas.length.toLocaleString('pt-BR')} linhas. Gere em CSV para ver tudo.`,
        MARGEM,
        y,
        { width: disponivel },
      );
    y = doc.y + 8;
  }

  const larguras = calcularLarguras(doc, entrada.colunas, linhas, entrada.fuso, disponivel);
  const limiteInferior = doc.page.height - MARGEM - 24;
  y = desenharCabecalhoTabela(doc, entrada.colunas, larguras, y);

  if (linhas.length === 0) {
    doc.fillColor(CORES.chumbo).font('Helvetica').fontSize(9).text('Nenhum registro no período.', MARGEM + 6, y + 8, {
      width: disponivel - 12,
    });
  }

  linhas.forEach((linha, indiceLinha) => {
    if (y + ALTURA_LINHA > limiteInferior) {
      doc.addPage();
      y = desenharCabecalhoPagina(doc, entrada);
      y = desenharCabecalhoTabela(doc, entrada.colunas, larguras, y);
    }
    if (indiceLinha % 2 === 1) doc.rect(MARGEM, y, disponivel, ALTURA_LINHA).fill(CORES.zebra);
    let x = MARGEM;
    doc.font('Helvetica').fontSize(8).fillColor(CORES.preto);
    entrada.colunas.forEach((coluna, indice) => {
      doc.text(formatarCelula(linha[coluna.campo], coluna.formato, entrada.fuso, true), x + 6, y + 5.5, {
        width: larguras[indice] - 12,
        align: alinhamento(coluna.formato),
        lineBreak: false,
        ellipsis: true,
      });
      x += larguras[indice];
    });
    y += ALTURA_LINHA;
  });

  const paginas = doc.bufferedPageRange();
  for (let indice = 0; indice < paginas.count; indice += 1) {
    doc.switchToPage(paginas.start + indice);
    const margemOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const base = doc.page.height - MARGEM + 6;
    doc
      .moveTo(MARGEM, base - 8)
      .lineTo(largura - MARGEM, base - 8)
      .lineWidth(0.6)
      .strokeColor(CORES.cinza)
      .stroke();
    doc.fillColor(CORES.chumbo).font('Helvetica').fontSize(7.5);
    doc.text(entrada.titulo, MARGEM, base, { width: disponivel / 2, lineBreak: false, ellipsis: true });
    doc.text(`Bento · página ${indice + 1} de ${paginas.count}`, MARGEM + disponivel / 2, base, {
      width: disponivel / 2,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = margemOriginal;
  }

  doc.end();
  return concluido;
}
