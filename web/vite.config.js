import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL(".", import.meta.url));
const paginas = ["index", "analytics", "usuarios", "notificacoes", "relatorios", "configuracoes", "componentes", "entrar"];
const portaApi = process.env.BENTO_PORTA || "8080";

const rotasLimpas = () => ({
  name: "bento-rotas-limpas",
  configureServer(servidor) {
    servidor.middlewares.use((requisicao, _resposta, proximo) => {
      const caminho = (requisicao.url || "").split("?")[0];
      const nome = caminho.replace(/^\/|\/$/g, "");
      if (nome && paginas.includes(nome) && nome !== "index") {
        requisicao.url = `/${nome}.html${requisicao.url.slice(caminho.length)}`;
      }
      proximo();
    });
  },
});

export default defineConfig({
  root: raiz,
  plugins: [tailwindcss(), rotasLimpas()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${portaApi}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: Object.fromEntries(paginas.map((pagina) => [pagina, resolve(raiz, `${pagina}.html`)])),
      output: {
        manualChunks(id) {
          if (id.includes("apexcharts")) return "graficos";
          if (id.includes("lucide")) return "icones";
          return undefined;
        },
      },
    },
  },
});
