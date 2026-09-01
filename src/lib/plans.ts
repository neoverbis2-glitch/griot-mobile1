export interface PlanDefinition {
  id: "free" | "starter" | "plus" | "pro";
  name: string;
  tagline: string;
  badge?: string;
  priceMonthly: number;
  originalPriceMonthly?: number;
  savingsMonthly?: string;
  gcu: number;
  gcuLabel: string;
  modelOsLabel: string;
  integrationsLabel: string;
  limits: string[];
  features: string[];
  ctaLabel: string;
  footnote: string;
}

export const GRIOT_PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Para experimentar o GRIOT Studio sem compromisso.",
    priceMonthly: 0,
    gcu: 100,
    gcuLabel: "100 GCU / mês",
    modelOsLabel: "3 apps ModelOS",
    integrationsLabel: "GitHub (leitura)",
    limits: [
      "100 GCU por ciclo, sem acumulação",
      "Até 3 apps de chat IA no ModelOS",
      "1 workspace e 3 projetos ativos",
      "Preview limitado a 30 minutos por sessão",
      "Sem execução prioritária",
    ],
    features: ["Studio completo", "Editor Monaco", "Preview integrado", "Histórico de 7 dias"],
    ctaLabel: "Começar grátis",
    footnote: "Renovação automática. Cancelamento a qualquer momento.",
  },
  {
    id: "starter",
    name: "Starter",
    tagline: "Para quem constrói projetos pessoais com regularidade.",
    priceMonthly: 7,
    originalPriceMonthly: 12,
    savingsMonthly: "Poupa 42% · preço de lançamento",
    gcu: 200,
    gcuLabel: "200 GCU / mês",
    modelOsLabel: "4 apps ModelOS",
    integrationsLabel: "GitHub, Supabase",
    limits: [
      "200 GCU por ciclo, com alerta aos 80%",
      "Até 4 apps de chat IA no ModelOS",
      "10 projetos ativos",
      "Preview até 4 horas por sessão",
      "Sem agentes em segundo plano",
    ],
    features: ["Tudo do Free", "Histórico de 30 dias", "Deploys ilimitados", "Apoio por email"],
    ctaLabel: "Escolher Starter",
    footnote: "Renovação automática. Cancelamento a qualquer momento.",
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "Mais contexto, múltiplos modelos e agentes em segundo plano.",
    badge: "Recomendado",
    priceMonthly: 18,
    gcu: 500,
    gcuLabel: "500 GCU / mês",
    modelOsLabel: "6 apps ModelOS",
    integrationsLabel: "GitHub, Supabase, Vercel, Google Drive",
    limits: [
      "500 GCU por ciclo, acumulação até 1 ciclo",
      "Até 6 apps de chat IA no ModelOS",
      "30 projetos ativos",
      "2 agentes em segundo plano em simultâneo",
      "Preview persistente durante 24 horas",
    ],
    features: [
      "Tudo do Starter",
      "Workspaces partilhados",
      "Papéis básicos",
      "Histórico de 90 dias",
    ],
    ctaLabel: "Escolher Plus",
    footnote: "Renovação automática. Cancelamento a qualquer momento.",
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Para trabalho profissional contínuo e computação máxima.",
    priceMonthly: 39,
    gcu: 800,
    gcuLabel: "800 GCU / mês",
    modelOsLabel: "8 apps ModelOS (Todas)",
    integrationsLabel: "Todas as integrações disponíveis",
    limits: [
      "800 GCU por ciclo, acumulação até 2 ciclos",
      "Todas as 8 apps de chat IA no ModelOS",
      "Projetos ilimitados",
      "6 agentes em segundo plano em simultâneo",
      "Execução prioritária na fila",
    ],
    features: [
      "Tudo do Plus",
      "Auditoria do workspace",
      "Funções avançadas (Developer, Billing, Security)",
      "Apoio prioritário",
    ],
    ctaLabel: "Escolher Pro",
    footnote: "Renovação automática. Cancelamento a qualquer momento.",
  },
];
