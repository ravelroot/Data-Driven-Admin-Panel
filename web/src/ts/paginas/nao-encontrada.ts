import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "../../css/bento.css";

import { exigir } from "../nucleo/dom.ts";
import { hidratarIcones } from "../nucleo/icones.ts";
import { iniciarTema } from "../nucleo/tema.ts";

iniciarTema();
hidratarIcones(document);

const lerCaminho = (): string => {
  try {
    return decodeURIComponent(location.pathname).slice(0, 80);
  } catch {
    return location.pathname.slice(0, 80);
  }
};

const caminho = lerCaminho();
if (caminho && caminho !== "/404.html") exigir("[data-caminho]").textContent = `Não há nada em ${caminho}.`;

const voltar = exigir<HTMLButtonElement>("[data-voltar]");
if (history.length <= 1) voltar.hidden = true;
voltar.addEventListener("click", () => history.back());

document.body.dataset.pronto = "true";
