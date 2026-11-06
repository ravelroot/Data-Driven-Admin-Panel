import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALFABETO_RECUPERACAO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PASSO_SEGUNDOS = 30;
export const DIGITOS = 6;
export const TOTAL_CODIGOS_RECUPERACAO = 10;

export function paraBase32(dados: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of dados) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let valor = 0;
  for (const caractere of limpo) {
    const indice = ALFABETO_BASE32.indexOf(caractere);
    if (indice < 0) throw new Error('Segredo base32 inválido');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function gerarSegredoTotp(): string {
  return paraBase32(randomBytes(20));
}

export function passoDe(instante = Date.now()): number {
  return Math.floor(instante / 1000 / PASSO_SEGUNDOS);
}

export function codigoTotp(segredo: string, passo: number): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const resumo = createHmac('sha1', deBase32(segredo)).update(contador).digest();
  const deslocamento = resumo[resumo.length - 1] & 0x0f;
  const numero = (resumo.readUInt32BE(deslocamento) & 0x7fffffff) % 10 ** DIGITOS;
  return numero.toString().padStart(DIGITOS, '0');
}

function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function conferirTotp(segredo: string, codigo: string, ultimoPasso: number | null, instante = Date.now(), tolerancia = 1): number | null {
  const limpo = codigo.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${DIGITOS}}$`).test(limpo)) return null;
  const atual = passoDe(instante);
  let encontrado: number | null = null;
  for (let desvio = -tolerancia; desvio <= tolerancia; desvio += 1) {
    const passo = atual + desvio;
    if (ultimoPasso !== null && passo <= ultimoPasso) continue;
    if (iguais(codigoTotp(segredo, passo), limpo) && encontrado === null) encontrado = passo;
  }
  return encontrado;
}

export function uriTotp(emissor: string, conta: string, segredo: string): string {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  const parametros = new URLSearchParams({ secret: segredo, issuer: emissor, algorithm: 'SHA1', digits: String(DIGITOS), period: String(PASSO_SEGUNDOS) });
  return `otpauth://totp/${rotulo}?${parametros.toString()}`;
}

export function gerarCodigosRecuperacao(total = TOTAL_CODIGOS_RECUPERACAO): string[] {
  const codigos = new Set<string>();
  while (codigos.size < total) {
    let corpo = '';
    for (let i = 0; i < 8; i += 1) corpo += ALFABETO_RECUPERACAO[randomInt(ALFABETO_RECUPERACAO.length)];
    codigos.add(`${corpo.slice(0, 4)}-${corpo.slice(4)}`);
  }
  return [...codigos];
}

export function normalizarCodigoRecuperacao(codigo: string): string | null {
  const limpo = codigo.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8}$/.test(limpo) ? limpo : null;
}
