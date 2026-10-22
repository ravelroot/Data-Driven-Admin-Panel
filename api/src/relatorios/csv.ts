import { dataBr, dataHoraBr } from '../util/datas.js';

export type FormatoColuna = 'texto' | 'moeda' | 'numero' | 'data' | 'percentual';

export interface Coluna {
  campo: string;
  titulo: string;
  formato: FormatoColuna;
}

export function formatarCelula(valor: unknown, formato: FormatoColuna, fuso: string, paraPdf = false): string {
  if (valor === null || valor === undefined || valor === '') return '';
  switch (formato) {
    case 'moeda': {
      const reais = Number(valor) / 100;
      if (paraPdf) {
        return reais.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
      }
      return reais.toFixed(2).replace('.', ',');
    }
    case 'numero':
      return paraPdf ? Number(valor).toLocaleString('pt-BR') : String(valor);
    case 'percentual': {
      const texto = Number(valor).toFixed(1).replace('.', ',');
      return paraPdf ? `${texto}%` : texto;
    }
    case 'data': {
      const bruto = String(valor);
      if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return dataBr(bruto);
      const data = new Date(bruto);
      return Number.isNaN(data.getTime()) ? bruto : dataHoraBr(data, fuso);
    }
    default:
      return String(valor);
  }
}

function escapar(texto: string): string {
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function gerarCsv(colunas: Coluna[], linhas: Record<string, unknown>[], fuso: string): Buffer {
  const cabecalho = colunas.map((coluna) => escapar(coluna.titulo)).join(';');
  const corpo = linhas.map((linha) =>
    colunas.map((coluna) => escapar(formatarCelula(linha[coluna.campo], coluna.formato, fuso))).join(';'),
  );
  return Buffer.from(`﻿${[cabecalho, ...corpo].join('\r\n')}\r\n`, 'utf8');
}
