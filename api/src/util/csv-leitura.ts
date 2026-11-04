export type Delimitador = ',' | ';' | '\t';

export function detectarDelimitador(texto: string): Delimitador {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const contagens: [Delimitador, number][] = [',', ';', '\t'].map((delimitador) => {
    let total = 0;
    let aspas = false;
    for (const caractere of primeira) {
      if (caractere === '"') aspas = !aspas;
      else if (!aspas && caractere === delimitador) total += 1;
    }
    return [delimitador as Delimitador, total];
  });
  contagens.sort((a, b) => b[1] - a[1]);
  return contagens[0]?.[1] ? contagens[0][0] : ',';
}

export function lerCsv(conteudo: string, delimitador: Delimitador = detectarDelimitador(conteudo)): string[][] {
  const texto = conteudo.replace(/^﻿/, '');
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = '';
  let aspas = false;
  for (let indice = 0; indice < texto.length; indice += 1) {
    const caractere = texto[indice];
    if (aspas) {
      if (caractere === '"') {
        if (texto[indice + 1] === '"') {
          campo += '"';
          indice += 1;
        } else {
          aspas = false;
        }
      } else {
        campo += caractere;
      }
      continue;
    }
    if (caractere === '"' && campo === '') {
      aspas = true;
    } else if (caractere === delimitador) {
      linha.push(campo);
      campo = '';
    } else if (caractere === '\n' || caractere === '\r') {
      if (caractere === '\r' && texto[indice + 1] === '\n') indice += 1;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += caractere;
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((celulas) => celulas.some((celula) => celula.trim() !== ''));
}

export function normalizarCabecalho(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
