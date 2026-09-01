export type PluginId = "search" | "web" | "weather" | "fx" | "news" | "time";

export type PluginDef = {
  id: PluginId;
  label: string;
  vendor: string;
  short: string;
  /** Descrição usada no System Prompt e na barra de permissão. */
  purpose: string;
  args: string;
};

export const PLUGINS: PluginDef[] = [
  {
    id: "search",
    label: "Pesquisa",
    vendor: "Wikipedia",
    short: "PQ",
    purpose: "procurar factos e resumos enciclopédicos",
    args: '{"query":"termo a pesquisar"}',
  },
  {
    id: "web",
    label: "Leitor Web",
    vendor: "HTTP",
    short: "WB",
    purpose: "abrir um endereço e ler o texto da página",
    args: '{"url":"https://exemplo.com"}',
  },
  {
    id: "weather",
    label: "Meteorologia",
    vendor: "Open-Meteo",
    short: "MT",
    purpose: "obter tempo atual e previsão de um local",
    args: '{"place":"Lisboa"}',
  },
  {
    id: "fx",
    label: "Câmbios",
    vendor: "Frankfurter",
    short: "FX",
    purpose: "converter moedas com taxas reais",
    args: '{"from":"EUR","to":"USD","amount":100}',
  },
  {
    id: "news",
    label: "Notícias Tech",
    vendor: "Hacker News",
    short: "NW",
    purpose: "ler o que se publica agora em tecnologia",
    args: '{"query":"tema"}',
  },
  {
    id: "time",
    label: "Hora Mundial",
    vendor: "Sistema",
    short: "HR",
    purpose: "saber a data e hora exatas num fuso horário",
    args: '{"timezone":"Europe/Lisbon"}',
  },
];

export function pluginById(id: string) {
  return PLUGINS.find((plugin) => plugin.id === id);
}

export type PluginCall = { id: PluginId; args: Record<string, unknown>; raw: string };

const CALL = /<plugin\s+name="([a-z]+)"(?:\s+args='([^']*)')?\s*\/?>(?:<\/plugin>)?/gi;

/** Lê pedidos de plugin emitidos pelo modelo e devolve o texto sem os blocos. */
export function parsePluginCalls(text: string): { calls: PluginCall[]; clean: string } {
  const calls: PluginCall[] = [];
  let clean = text;
  for (const match of text.matchAll(CALL)) {
    const def = pluginById(match[1]!.toLowerCase());
    if (!def) continue;
    let args: Record<string, unknown> = {};
    try {
      args = match[2] ? (JSON.parse(match[2]) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    calls.push({ id: def.id, args, raw: match[0]! });
    clean = clean.replace(match[0]!, "");
  }
  return { calls, clean: clean.trim() };
}

/** Esconde um bloco a meio de streaming para não piscar markup na conversa. */
export function stripPartialPlugin(text: string) {
  const index = text.lastIndexOf("<plugin");
  if (index === -1) return text;
  return text.slice(index).includes(">") ? text : text.slice(0, index);
}

export function describeArgs(args: Record<string, unknown>) {
  return Object.entries(args)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

const KEY = "griot-plugins";

export function connectedPlugins(): PluginId[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PluginId[]) : [];
  } catch {
    return [];
  }
}

export function setPluginConnected(id: PluginId, on: boolean) {
  const current = new Set(connectedPlugins());
  if (on) current.add(id);
  else current.delete(id);
  window.localStorage.setItem(KEY, JSON.stringify([...current]));
  return [...current];
}
