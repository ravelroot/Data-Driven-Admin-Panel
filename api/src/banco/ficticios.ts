import { slug } from '../util/formato.js';

export type Sorteio = () => number;

export function criarSorteio(semente: number): Sorteio {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function escolherPonderado<T extends { peso: number }>(sorteio: Sorteio, opcoes: readonly T[]): T {
  const total = opcoes.reduce((soma, opcao) => soma + opcao.peso, 0);
  let alvo = sorteio() * total;
  for (const opcao of opcoes) {
    alvo -= opcao.peso;
    if (alvo <= 0) return opcao;
  }
  return opcoes[opcoes.length - 1];
}

export function escolher<T>(sorteio: Sorteio, opcoes: readonly T[]): T {
  return opcoes[Math.floor(sorteio() * opcoes.length)];
}

export const PRIMEIROS_NOMES = [
  'Ana', 'Beatriz', 'Camila', 'Daniela', 'Eduarda', 'Fernanda', 'Gabriela', 'Helena', 'Isabela', 'Juliana',
  'Larissa', 'Mariana', 'Natália', 'Olívia', 'Patrícia', 'Rafaela', 'Sofia', 'Tatiane', 'Valéria', 'Yasmin',
  'Alice', 'Bianca', 'Cecília', 'Débora', 'Elisa', 'Flávia', 'Giovana', 'Heloísa', 'Ingrid', 'Joana',
  'André', 'Bernardo', 'Caio', 'Davi', 'Eduardo', 'Felipe', 'Gustavo', 'Henrique', 'Igor', 'João',
  'Leonardo', 'Marcelo', 'Nicolas', 'Otávio', 'Pedro', 'Rafael', 'Samuel', 'Thiago', 'Vinícius', 'Wagner',
  'Arthur', 'Bruno', 'César', 'Danilo', 'Enzo', 'Fábio', 'Gabriel', 'Heitor', 'Lucas', 'Mateus',
];

export const SOBRENOMES = [
  'Almeida', 'Barbosa', 'Cardoso', 'Carvalho', 'Castro', 'Correia', 'Cunha', 'Duarte', 'Farias', 'Fernandes',
  'Freitas', 'Gomes', 'Lima', 'Lopes', 'Machado', 'Medeiros', 'Melo', 'Mendes', 'Monteiro', 'Moreira',
  'Nascimento', 'Nogueira', 'Oliveira', 'Pereira', 'Pinto', 'Queiroz', 'Ramos', 'Reis', 'Ribeiro', 'Rodrigues',
  'Santana', 'Santos', 'Silva', 'Siqueira', 'Soares', 'Souza', 'Teixeira', 'Torres', 'Vasconcelos', 'Vieira',
  'Aragão', 'Bastos', 'Campos', 'Dantas', 'Esteves', 'Figueiredo', 'Guimarães', 'Leal', 'Macedo', 'Neves',
];

export const PAISES = [
  { codigo: 'BR', nome: 'Brasil', peso: 78 },
  { codigo: 'PT', nome: 'Portugal', peso: 6 },
  { codigo: 'US', nome: 'Estados Unidos', peso: 4 },
  { codigo: 'AR', nome: 'Argentina', peso: 3 },
  { codigo: 'MX', nome: 'México', peso: 3 },
  { codigo: 'CL', nome: 'Chile', peso: 2 },
  { codigo: 'CO', nome: 'Colômbia', peso: 2 },
  { codigo: 'ES', nome: 'Espanha', peso: 2 },
] as const;

export const PAISES_TRAFEGO = [
  { codigo: 'BR', peso: 66 },
  { codigo: 'PT', peso: 8 },
  { codigo: 'US', peso: 7 },
  { codigo: 'AR', peso: 4 },
  { codigo: 'MX', peso: 4 },
  { codigo: 'ES', peso: 3 },
  { codigo: 'CL', peso: 3 },
  { codigo: 'CO', peso: 3 },
  { codigo: 'UY', peso: 1 },
  { codigo: 'DE', peso: 1 },
] as const;

export const CIDADES: Record<string, string[]> = {
  BR: [
    'São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Curitiba', 'Porto Alegre', 'Recife', 'Salvador', 'Fortaleza',
    'Brasília', 'Florianópolis', 'Campinas', 'Goiânia', 'Manaus', 'Vitória', 'Belém', 'Natal',
  ],
  PT: ['Lisboa', 'Porto', 'Braga', 'Coimbra'],
  US: ['Miami', 'Nova York', 'Boston', 'Orlando'],
  AR: ['Buenos Aires', 'Córdoba', 'Rosário'],
  MX: ['Cidade do México', 'Guadalajara', 'Monterrey'],
  CL: ['Santiago', 'Valparaíso'],
  CO: ['Bogotá', 'Medellín'],
  ES: ['Madri', 'Barcelona', 'Valência'],
};

export const CANAIS = [
  { nome: 'Orgânico', peso: 30 },
  { nome: 'Direto', peso: 20 },
  { nome: 'Pago', peso: 18 },
  { nome: 'Social', peso: 13 },
  { nome: 'Indicação', peso: 11 },
  { nome: 'E-mail', peso: 8 },
] as const;

export const DISPOSITIVOS = [
  { nome: 'Desktop', peso: 56 },
  { nome: 'Celular', peso: 38 },
  { nome: 'Tablet', peso: 6 },
] as const;

const PREFIXOS_EMPRESA = [
  'Alvorada', 'Brisa', 'Cerne', 'Duna', 'Eixo', 'Faísca', 'Garoa', 'Horizonte', 'Ipê', 'Jangada', 'Lótus', 'Maré',
  'Nascente', 'Onda', 'Pétala', 'Quartzo', 'Raiz', 'Seiva', 'Trama', 'Umbu', 'Vereda', 'Zênite', 'Aroeira', 'Baobá',
];

const SUFIXOS_EMPRESA = [
  'Tecnologia', 'Digital', 'Consultoria', 'Labs', 'Comércio', 'Studio', 'Educação', 'Logística', 'Saúde', 'Finanças',
  'Arquitetura', 'Alimentos',
];

export const CARGOS = [
  'CEO', 'Sócio(a)', 'Diretor(a) de Operações', 'Gerente de Marketing', 'Analista Financeiro', 'Coordenador(a) de Vendas',
  'Desenvolvedor(a)', 'Designer', 'Gerente de Projetos', 'Consultor(a)', 'Head de Produto', 'Analista de Dados',
];

export function gerarEmpresa(sorteio: Sorteio): string {
  return `${escolher(sorteio, PREFIXOS_EMPRESA)} ${escolher(sorteio, SUFIXOS_EMPRESA)}`;
}

export function gerarNomeFicticio(sorteio: Sorteio, sufixo: string): { nome: string; email: string } {
  const primeiro = escolher(sorteio, PRIMEIROS_NOMES);
  const sobrenome = escolher(sorteio, SOBRENOMES);
  const nome = `${primeiro} ${sobrenome}`;
  return { nome, email: `${slug(primeiro)}.${slug(sobrenome)}.${sufixo}@exemplo.com` };
}
