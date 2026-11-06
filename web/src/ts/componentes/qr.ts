import qrcode from "qrcode-generator";
import { escapar } from "../nucleo/dom.ts";

export const svgQr = (texto: string, rotulo: string): string => {
  const codigo = qrcode(0, "M");
  codigo.addData(texto);
  codigo.make();
  const modulos = codigo.getModuleCount();
  const margem = 3;
  const total = modulos + margem * 2;
  let caminho = "";
  for (let linha = 0; linha < modulos; linha += 1) {
    for (let coluna = 0; coluna < modulos; coluna += 1) {
      if (codigo.isDark(linha, coluna)) caminho += `M${coluna + margem} ${linha + margem}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="${escapar(rotulo)}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${caminho}" fill="#111111"/></svg>`;
};
