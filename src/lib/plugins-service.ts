/**
 * GRIOT Plugins & Integrations Service
 * Local-first persistence and state management for 30 integrated external services.
 */

export type PluginCategory = "all" | "dev_cloud" | "database" | "productivity" | "ai_tools";

export interface PluginDefinition {
  id: string;
  name: string;
  logoName: string;
  category: PluginCategory;
  categoryLabel: string;
  description: string;
  authType: "api_key" | "token" | "oauth" | "webhook";
  placeholder: string;
  docsUrl: string;
}

export interface ConnectedPluginData {
  id: string;
  connected: boolean;
  connectedAt: string;
  secretHint?: string;
  apiKey?: string;
  accountName?: string;
  customEndpoint?: string;
}

const STORAGE_KEY = "griot_connected_plugins";

export const PLUGINS_LIST: PluginDefinition[] = [
  // Dev & Cloud
  {
    id: "github",
    name: "GitHub",
    logoName: "GithubLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Controlo de versões, gestão de repositórios, PRs e issues.",
    authType: "token",
    placeholder: "ghp_...",
    docsUrl: "https://github.com/settings/tokens",
  },
  {
    id: "gitlab",
    name: "GitLab",
    logoName: "GitlabLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Pipelines CI/CD, repositórios e orquestração de entregas.",
    authType: "token",
    placeholder: "glpat-...",
    docsUrl: "https://gitlab.com/-/profile/personal_access_tokens",
  },
  {
    id: "vercel",
    name: "Vercel",
    logoName: "VercelLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Deployments instantâneos de frontend, preview URLs e serverless.",
    authType: "token",
    placeholder: "vercel_token_...",
    docsUrl: "https://vercel.com/account/tokens",
  },
  {
    id: "supabase",
    name: "Supabase",
    logoName: "SupabaseLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Postgres serverless, Edge Functions, autenticação e realtime.",
    authType: "api_key",
    placeholder: "sbp_...",
    docsUrl: "https://supabase.com/dashboard/account/tokens",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    logoName: "CloudflareLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Workers serverless, DNS global, CDN e proteção de borda.",
    authType: "token",
    placeholder: "Bearer token de API...",
    docsUrl: "https://dash.cloudflare.com/profile/api-tokens",
  },
  {
    id: "azure",
    name: "Microsoft Azure",
    logoName: "AzureLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Infraestrutura em nuvem, instâncias computacionais e Azure AI.",
    authType: "api_key",
    placeholder: "Chave de subscrição Azure...",
    docsUrl: "https://portal.azure.com",
  },
  {
    id: "docker",
    name: "Docker",
    logoName: "DockerLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Containerização, registo de imagens Docker Hub e runners.",
    authType: "token",
    placeholder: "dckr_pat_...",
    docsUrl: "https://hub.docker.com/settings/security",
  },
  {
    id: "sentry",
    name: "Sentry",
    logoName: "SentryLogo",
    category: "dev_cloud",
    categoryLabel: "Dev & Cloud",
    description: "Monitorização de falhas, logs de erro e telemetria de produção.",
    authType: "token",
    placeholder: "sntrys_...",
    docsUrl: "https://sentry.io/settings/account/api/auth-tokens/",
  },

  // Bases de Dados
  {
    id: "neon",
    name: "Neon Postgres",
    logoName: "NeonLogo",
    category: "database",
    categoryLabel: "Bases de Dados",
    description: "Postgres Serverless moderno com ramificação instantânea.",
    authType: "token",
    placeholder: "neon_api_key_...",
    docsUrl: "https://console.neon.tech/app/settings/api-keys",
  },
  {
    id: "mongodb",
    name: "MongoDB Atlas",
    logoName: "MongoDbLogo",
    category: "database",
    categoryLabel: "Bases de Dados",
    description: "Base de dados NoSQL orientada a documentos com alta escala.",
    authType: "api_key",
    placeholder: "Chave pública/privada Atlas...",
    docsUrl: "https://cloud.mongodb.com",
  },
  {
    id: "planetscale",
    name: "PlanetScale",
    logoName: "PlanetScaleLogo",
    category: "database",
    categoryLabel: "Bases de Dados",
    description: "MySQL serverless com tolerância a falhas e branching de schemas.",
    authType: "token",
    placeholder: "pscale_tkn_...",
    docsUrl: "https://planetscale.com",
  },
  {
    id: "redis",
    name: "Redis",
    logoName: "RedisLogo",
    category: "database",
    categoryLabel: "Bases de Dados",
    description: "Estruturas de dados em memória, caching e barramento de eventos.",
    authType: "api_key",
    placeholder: "redis://default:token@host:port",
    docsUrl: "https://redis.io",
  },
  {
    id: "upstash",
    name: "Upstash",
    logoName: "UpstashLogo",
    category: "database",
    categoryLabel: "Bases de Dados",
    description: "Redis e Kafka serverless via HTTP com precificação por consumo.",
    authType: "token",
    placeholder: "UPSTASH_REDIS_REST_TOKEN...",
    docsUrl: "https://console.upstash.com",
  },
  {
    id: "qdrant",
    name: "Qdrant",
    logoName: "QdrantLogo",
    category: "database",
    categoryLabel: "Bases de Dados",
    description: "Base de dados vetorial de alto desempenho para busca semântica e RAG.",
    authType: "api_key",
    placeholder: "Chave de cluster Qdrant...",
    docsUrl: "https://cloud.qdrant.io",
  },

  // Produtividade & Gestão
  {
    id: "linear",
    name: "Linear",
    logoName: "LinearLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Gestão de issues de alto ritmo, ciclos e roadmaps de engenharia.",
    authType: "token",
    placeholder: "lin_api_...",
    docsUrl: "https://linear.app/settings/api",
  },
  {
    id: "trello",
    name: "Trello",
    logoName: "TrelloLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Quadros Kanban flexíveis para organização de equipas e tarefas.",
    authType: "api_key",
    placeholder: "Trello API Key + Token...",
    docsUrl: "https://trello.com/power-ups/admin",
  },
  {
    id: "slack",
    name: "Slack",
    logoName: "SlackLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Canais de equipa, alertas dos agentes GRIOT e comandos remotos.",
    authType: "webhook",
    placeholder: "https://hooks.slack.com/services/...",
    docsUrl: "https://api.slack.com/apps",
  },
  {
    id: "notion",
    name: "Notion",
    logoName: "NotionLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Documentação integrada, wikis de projetos e base de conhecimento.",
    authType: "token",
    placeholder: "secret_...",
    docsUrl: "https://www.notion.so/my-integrations",
  },
  {
    id: "stripe",
    name: "Stripe",
    logoName: "StripeLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Faturação, gestão de subscrições e fluxo de pagamentos online.",
    authType: "api_key",
    placeholder: "rk_live_... ou sk_test_...",
    docsUrl: "https://dashboard.stripe.com/apikeys",
  },
  {
    id: "google_drive",
    name: "Google Drive",
    logoName: "GoogleDriveLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Leitura e sincronização de ficheiros, pastas e backups na nuvem.",
    authType: "token",
    placeholder: "OAuth Access Token / Service Account...",
    docsUrl: "https://console.cloud.google.com",
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    logoName: "GoogleSheetsLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Exportação e leitura de relatórios tabulares e orçamentos em tempo real.",
    authType: "token",
    placeholder: "Google Sheets API Token...",
    docsUrl: "https://developers.google.com/sheets/api",
  },
  {
    id: "gmail",
    name: "Gmail",
    logoName: "GmailLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Envio de relatórios automáticos, resumos de reuniões e alertas por e-mail.",
    authType: "token",
    placeholder: "Gmail OAuth / App Password...",
    docsUrl: "https://myaccount.google.com/apppasswords",
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    logoName: "OutlookLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Integração com correspondência corporativa Microsoft 365 e calendário.",
    authType: "token",
    placeholder: "Microsoft Graph Token...",
    docsUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    logoName: "DropboxLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Armazenamento em nuvem para ficheiros de grande porte e capturas.",
    authType: "token",
    placeholder: "sl.u....",
    docsUrl: "https://www.dropbox.com/developers/apps",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    logoName: "SalesforceLogo",
    category: "productivity",
    categoryLabel: "Produtividade",
    description: "Sincronização de leads, contas e oportunidades comerciais.",
    authType: "oauth",
    placeholder: "Instância Salesforce + Token...",
    docsUrl: "https://developer.salesforce.com",
  },

  // IA, Design & Analytics
  {
    id: "huggingface",
    name: "Hugging Face",
    logoName: "HuggingFaceLogo",
    category: "ai_tools",
    categoryLabel: "IA & Ferramentas",
    description: "Acesso a modelos open-source, Spaces e Serverless Inference API.",
    authType: "token",
    placeholder: "hf_...",
    docsUrl: "https://huggingface.co/settings/tokens",
  },
  {
    id: "google_colab",
    name: "Google Colab",
    logoName: "GoogleColabLogo",
    category: "ai_tools",
    categoryLabel: "IA & Ferramentas",
    description: "Execução remota de cadernos interativos de computação com GPU.",
    authType: "token",
    placeholder: "Token de execução remota...",
    docsUrl: "https://colab.research.google.com",
  },
  {
    id: "google_analytics",
    name: "Google Analytics",
    logoName: "GoogleAnalyticsLogo",
    category: "ai_tools",
    categoryLabel: "IA & Ferramentas",
    description: "Métricas de utilização, retenção e comportamento da aplicação.",
    authType: "api_key",
    placeholder: "ID de medição (G-...) ou API Secret...",
    docsUrl: "https://analytics.google.com",
  },
  {
    id: "figma",
    name: "Figma",
    logoName: "FigmaLogo",
    category: "ai_tools",
    categoryLabel: "IA & Ferramentas",
    description: "Inspeção de ficheiros de design, extração de assets e tokens visuais.",
    authType: "token",
    placeholder: "figd_...",
    docsUrl: "https://www.figma.com/developers/api#access-tokens",
  },
  {
    id: "canva",
    name: "Canva",
    logoName: "CanvaLogo",
    category: "ai_tools",
    categoryLabel: "IA & Ferramentas",
    description: "Exportação de designs, templates e geração de artes promocionais.",
    authType: "token",
    placeholder: "Canva Connect API Key...",
    docsUrl: "https://www.canva.com/developers/",
  },
];

/** Carrega o mapa de plugins conectados guardados no dispositivo */
export function getConnectedPlugins(): Record<string, ConnectedPluginData> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Erro ao ler conexões de plugins:", err);
    return {};
  }
}

/** Verifica se um plugin específico está ativo */
export function isPluginConnected(pluginId: string): boolean {
  const map = getConnectedPlugins();
  return Boolean(map[pluginId]?.connected);
}

/** Conecta e guarda a configuração de um plugin */
export function connectPlugin(
  pluginId: string,
  data?: { apiKey?: string; accountName?: string; customEndpoint?: string },
): void {
  if (typeof window === "undefined") return;
  const map = getConnectedPlugins();
  const trimmed = data?.apiKey?.trim() || "";

  map[pluginId] = {
    id: pluginId,
    connected: true,
    connectedAt: new Date().toISOString(),
    apiKey: trimmed,
    accountName: data?.accountName?.trim() || undefined,
    customEndpoint: data?.customEndpoint?.trim() || undefined,
    secretHint: trimmed ? `••••${trimmed.slice(-4)}` : undefined,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(
      new CustomEvent("griot-plugins-updated", { detail: { pluginId, connected: true } }),
    );
  } catch (err) {
    console.error("Falha ao guardar plugin:", err);
  }
}

/** Desconecta um plugin */
export function disconnectPlugin(pluginId: string): void {
  if (typeof window === "undefined") return;
  const map = getConnectedPlugins();
  delete map[pluginId];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(
      new CustomEvent("griot-plugins-updated", { detail: { pluginId, connected: false } }),
    );
  } catch (err) {
    console.error("Falha ao remover plugin:", err);
  }
}

/** Conta de plugins ativos */
export function countConnectedPlugins(): number {
  const map = getConnectedPlugins();
  return Object.values(map).filter((p) => p.connected).length;
}
