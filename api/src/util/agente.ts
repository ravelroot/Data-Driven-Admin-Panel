export function descreverAgente(agente: string | null | undefined): { navegador: string; sistema: string } {
  const texto = agente ?? '';
  let navegador = 'Navegador desconhecido';
  if (/Edg\//.test(texto)) navegador = 'Edge';
  else if (/OPR\/|Opera/.test(texto)) navegador = 'Opera';
  else if (/Firefox\//.test(texto)) navegador = 'Firefox';
  else if (/Chrome\//.test(texto)) navegador = 'Chrome';
  else if (/Safari\//.test(texto)) navegador = 'Safari';
  else if (/curl\//i.test(texto)) navegador = 'curl';
  else if (/node|undici/i.test(texto)) navegador = 'Node.js';

  let sistema = 'Sistema desconhecido';
  if (/Windows/.test(texto)) sistema = 'Windows';
  else if (/Android/.test(texto)) sistema = 'Android';
  else if (/iPhone|iPad|iOS/.test(texto)) sistema = 'iOS';
  else if (/Mac OS X|Macintosh/.test(texto)) sistema = 'macOS';
  else if (/Linux/.test(texto)) sistema = 'Linux';

  return { navegador, sistema };
}
