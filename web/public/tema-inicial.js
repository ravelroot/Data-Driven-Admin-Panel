(function () {
  var raiz = document.documentElement;
  var ler = function (chave, padrao) {
    try {
      return localStorage.getItem("bento:" + chave) || padrao;
    } catch (erro) {
      return padrao;
    }
  };
  var tema = ler("tema", "sistema");
  var escuro = tema === "escuro" || (tema === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (escuro) raiz.classList.add("dark");
  raiz.dataset.tema = tema;
  raiz.dataset.paleta = ler("paleta", "bento");
  raiz.dataset.densidade = ler("densidade", "confortavel");
})();
