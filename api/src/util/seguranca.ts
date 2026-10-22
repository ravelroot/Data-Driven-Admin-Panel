import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

const PREFIXO_CIFRA = 'enc:v1:';
const ALFABETO_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function hashSha256(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

export function assinarHmac(segredo: string, corpo: string): string {
  return createHmac('sha256', segredo).update(corpo).digest('hex');
}

export function tokenAleatorio(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function senhaTemporaria(tamanho = 12): string {
  let senha = '';
  for (let i = 0; i < tamanho; i += 1) senha += ALFABETO_SENHA[randomInt(ALFABETO_SENHA.length)];
  return senha;
}

export function segredoChaveApi(): string {
  let corpo = '';
  for (let i = 0; i < 40; i += 1) corpo += ALFABETO_SENHA[randomInt(ALFABETO_SENHA.length)];
  return `bnt_${corpo}`;
}

function chaveCifra(segredo: string): Buffer {
  return createHash('sha256').update(`bento:integracoes:${segredo}`).digest();
}

export function cifrar(texto: string, segredo: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv('aes-256-gcm', chaveCifra(segredo), iv);
  const dados = Buffer.concat([cifra.update(texto, 'utf8'), cifra.final()]);
  const etiqueta = cifra.getAuthTag();
  return `${PREFIXO_CIFRA}${iv.toString('base64url')}:${etiqueta.toString('base64url')}:${dados.toString('base64url')}`;
}

export function decifrar(valor: string, segredo: string): string {
  if (!valor.startsWith(PREFIXO_CIFRA)) return valor;
  const [iv, etiqueta, dados] = valor.slice(PREFIXO_CIFRA.length).split(':');
  try {
    const decifra = createDecipheriv('aes-256-gcm', chaveCifra(segredo), Buffer.from(iv, 'base64url'));
    decifra.setAuthTag(Buffer.from(etiqueta, 'base64url'));
    return Buffer.concat([decifra.update(Buffer.from(dados, 'base64url')), decifra.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function mascarar(valor: string): string {
  if (!valor) return '';
  return `••••${valor.slice(-4)}`;
}
