/**
 * GRIOT Universal File Attachment Processor
 *
 * Processa qualquer ficheiro anexado pelo utilizador no chat mobile:
 * - Arquivos ZIP (.zip): descompacta em memória com JSZip, gera a árvore de diretórios
 *   e extrai o código dos ficheiros principais (manifests, código-fonte, configs).
 * - Ficheiros de Texto / Código / Checksums (.sha256, .md5, .env, .log, .ts, .py, etc.):
 *   lê o conteúdo em UTF-8 com destaque de sintaxe adequado e limites de segurança.
 * - Ficheiros Binários e PDFs: extrai assinaturas hexadecimais (magic bytes), metadados
 *   e texto legível de streams.
 */

import JSZip from "jszip";

export interface AttachmentProcessResult {
  kind: "text" | "zip" | "image" | "media" | "binary";
  textToSend: string;
  summary: string;
  fileCount?: number;
}

/** Formata bytes para leitura humana (B, KB, MB) */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Mapeia a extensão do ficheiro para a sintaxe de realce do Markdown */
export function getLanguageFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    html: "html",
    css: "css",
    scss: "scss",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    bat: "batch",
    ps1: "powershell",
    sha256: "text",
    md5: "text",
    env: "bash",
    log: "text",
    diff: "diff",
    patch: "diff",
    gradle: "groovy",
    properties: "properties",
    svg: "xml",
    dockerfile: "dockerfile",
    makefile: "makefile",
    php: "php",
    rb: "ruby",
    swift: "swift",
    dart: "dart",
    vue: "vue",
    svelte: "svelte",
    lua: "lua",
    r: "r",
  };
  return map[ext] || "text";
}

/** Verifica se a extensão é tipicamente textual */
export function isTextExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    /\.(txt|json|md|ts|tsx|js|jsx|py|csv|tsv|html|css|scss|yaml|yml|toml|xml|sql|sh|bash|zsh|bat|ps1|sha256|md5|sha1|env|log|diff|patch|gradle|properties|svg|dockerfile|makefile|php|rb|swift|dart|vue|svelte|lua|r|c|cpp|h|hpp|cs|rs|go|java|kt|kts|graphql|prisma|proto|lock|sum|mod|ini|cfg|conf|tex|bib)$/i.test(
      lower,
    ) ||
    lower.startsWith(".env") ||
    lower === "dockerfile" ||
    lower === "makefile"
  );
}

/** Verifica se é um arquivo compactado ZIP */
export function isZipFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    name.endsWith(".zip") ||
    type.includes("zip") ||
    type === "application/x-zip-compressed" ||
    type === "application/zip"
  );
}

/** Verifica se é uma imagem suportada */
export function isImageFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    type.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(name)
  );
}

/** Verifica se é áudio */
export function isAudioFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    type.startsWith("audio/") ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)
  );
}

/** Verifica se é vídeo */
export function isVideoFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    type.startsWith("video/") ||
    /\.(mp4|webm|mov|mkv|avi)$/i.test(name)
  );
}

/** Extrai primeiros bytes em formato Hexadecimal para identificação de cabeçalhos */
export async function getHexPreview(file: File, length = 32): Promise<string> {
  try {
    const slice = file.slice(0, length);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");
  } catch {
    return "";
  }
}

/** Processa arquivos ZIP: descompacta, cataloga e extrai ficheiros-chave */
export async function processZipArchive(
  file: File,
  userNote?: string,
): Promise<AttachmentProcessResult> {
  const zip = new JSZip();
  const buffer = await file.arrayBuffer();
  const loaded = await zip.loadAsync(buffer);

  interface EntryInfo {
    path: string;
    isDir: boolean;
    size: number;
    isManifest: boolean;
    isText: boolean;
  }

  const entries: EntryInfo[] = [];

  loaded.forEach((relativePath, entry) => {
    // Ignorar metadados do macOS e ficheiros invisíveis de lixo
    if (
      relativePath.startsWith("__MACOSX/") ||
      relativePath.endsWith(".DS_Store") ||
      relativePath.endsWith("Thumbs.db")
    ) {
      return;
    }

    const isDir = entry.dir;
    const baseName = relativePath.split("/").pop() || "";
    const isManifest =
      /^(package\.json|readme\.md|cargo\.toml|requirements\.txt|go\.mod|pom\.xml|composer\.json|build\.gradle|gemfile|\.env.*)$/i.test(
        baseName,
      );
    const isText = !isDir && (isTextExtension(baseName) || isManifest);

    entries.push({
      path: relativePath,
      isDir,
      size: (entry as any)._data?.uncompressedSize || 0,
      isManifest,
      isText,
    });
  });

  const totalFiles = entries.filter((e) => !e.isDir).length;
  const totalDirs = entries.filter((e) => e.isDir).length;

  // Ordena ficheiros: primeiro manifestos e configs na raiz, depois código, depois restantes
  entries.sort((a, b) => {
    if (a.isManifest && !b.isManifest) return -1;
    if (!a.isManifest && b.isManifest) return 1;
    if (a.isText && !b.isText) return -1;
    if (!a.isText && b.isText) return 1;
    return a.path.localeCompare(b.path);
  });

  // 1. Constrói a árvore de diretórios (até 80 entradas visíveis)
  const treeLines: string[] = [];
  const maxTreeEntries = 80;
  for (let i = 0; i < Math.min(entries.length, maxTreeEntries); i++) {
    const e = entries[i];
    if (e.isDir) {
      treeLines.push(`📁 ${e.path}`);
    } else {
      const sizeStr = e.size > 0 ? ` (${formatBytes(e.size)})` : "";
      treeLines.push(`📄 ${e.path}${sizeStr}`);
    }
  }
  if (entries.length > maxTreeEntries) {
    treeLines.push(`... e mais ${entries.length - maxTreeEntries} ficheiros/pastas no arquivo.`);
  }

  // 2. Extrai o conteúdo dos ficheiros textuais prioritários (orçamento máximo: ~50.000 caracteres)
  let extractedChars = 0;
  const maxExtractedChars = 50000;
  const extractedFiles: Array<{ path: string; lang: string; content: string }> = [];

  for (const e of entries) {
    if (e.isDir || !e.isText) continue;
    if (extractedChars >= maxExtractedChars) break;

    const entry = loaded.file(e.path);
    if (!entry) continue;

    try {
      const rawText = await entry.async("text");
      if (!rawText.trim()) continue;

      // Se o ficheiro tiver caracteres nulos binários, ignora
      if (/[\x00-\x08\x0E-\x1F]/.test(rawText.slice(0, 512))) continue;

      const remainingBudget = maxExtractedChars - extractedChars;
      const snippet = rawText.slice(0, Math.min(rawText.length, 12000, remainingBudget));
      extractedChars += snippet.length;

      const lang = getLanguageFromExtension(e.path);
      extractedFiles.push({
        path: e.path,
        lang,
        content: snippet + (rawText.length > snippet.length ? "\n... [truncado pelo tamanho]" : ""),
      });
    } catch {
      // Ignora erro de leitura de entrada individual
    }
  }

  // Montagem do payload estruturado
  const parts: string[] = [];

  if (userNote?.trim()) {
    parts.push(userNote.trim());
    parts.push("");
  }

  parts.push(
    `📦 **[Arquivo ZIP Descompactado: ${file.name}]** (Tamanho: ${formatBytes(file.size)}, ${totalFiles} ficheiros, ${totalDirs} pastas)`,
  );
  parts.push("");
  parts.push("#### 📂 Estrutura do Arquivo:");
  parts.push("```text");
  parts.push(treeLines.join("\n"));
  parts.push("```");

  if (extractedFiles.length > 0) {
    parts.push("");
    parts.push("#### 📜 Conteúdo dos Ficheiros Extraídos:");
    for (const ef of extractedFiles) {
      parts.push(`##### 📄 \`${ef.path}\``);
      parts.push(`\`\`\`${ef.lang}`);
      parts.push(ef.content);
      parts.push("```");
    }
  }

  parts.push("");
  parts.push(
    "Analisa a arquitetura, estrutura e o código deste arquivo ZIP. Tens acesso direto a todos os ficheiros listados acima.",
  );

  return {
    kind: "zip",
    textToSend: parts.join("\n"),
    summary: `Arquivo ZIP "${file.name}" descompactado (${totalFiles} ficheiros).`,
    fileCount: totalFiles,
  };
}

/**
 * Processador principal de qualquer ficheiro anexado.
 * Retorna o texto formatado para envio e resumo de notificação.
 */
export async function processFileAttachment(
  file: File,
  userNote?: string,
): Promise<AttachmentProcessResult> {
  const lowerName = file.name.toLowerCase();

  // 1. Arquivos ZIP
  if (isZipFile(file)) {
    try {
      return await processZipArchive(file, userNote);
    } catch (zipErr) {
      console.warn("Falha ao descompactar ZIP com JSZip:", zipErr);
      // Fallback para tratamento binário se o ZIP estiver corrompido
    }
  }

  // 2. Ficheiros de Texto / Código / Checksums (.sha256, .md5, etc.)
  // Tenta ler como texto se tiver extensão conhecida ou se a deteção revelar UTF-8 limpo
  let textContent: string | null = null;
  let isLikelyText = isTextExtension(file.name) || (file.type && file.type.startsWith("text/"));

  try {
    const raw = await file.text();
    // Verifica se os primeiros 2KB não possuem bytes nulos de ficheiros binários
    const hasNullBytes = /[\x00-\x08\x0E-\x1F]/.test(raw.slice(0, 2048));
    if (!hasNullBytes && raw.length > 0) {
      textContent = raw;
      isLikelyText = true;
    }
  } catch {
    textContent = null;
  }

  if (isLikelyText && textContent !== null) {
    const lang = getLanguageFromExtension(file.name);
    const maxChars = 40000;
    const isTruncated = textContent.length > maxChars;
    const body = textContent.slice(0, maxChars);

    const parts: string[] = [];
    if (userNote?.trim()) {
      parts.push(userNote.trim());
      parts.push("");
    }

    parts.push(
      `📄 **[Ficheiro Anexado: ${file.name}]** (Tamanho: ${formatBytes(file.size)})`,
    );
    parts.push(`\`\`\`${lang}`);
    parts.push(body);
    parts.push("```");

    if (isTruncated) {
      parts.push(
        `*(Conteúdo truncado para os primeiros ${maxChars.toLocaleString()} caracteres de um total de ${textContent.length.toLocaleString()})*`,
      );
    }

    // Se for um checksum sha256 / md5, adiciona uma instrução específica
    if (lowerName.endsWith(".sha256") || lowerName.endsWith(".md5")) {
      parts.push(
        "Por favor analisa este checksum de verificação criptográfica, identifica o hash e o ficheiro de destino correspondente.",
      );
    } else {
      parts.push("Por favor analisa detalhadamente o conteúdo deste ficheiro.");
    }

    return {
      kind: "text",
      textToSend: parts.join("\n"),
      summary: `Ficheiro "${file.name}" anexado à conversa.`,
    };
  }

  // 3. Ficheiros Binários e PDFs
  const hex = await getHexPreview(file, 24);
  const parts: string[] = [];
  if (userNote?.trim()) {
    parts.push(userNote.trim());
    parts.push("");
  }

  parts.push(`📎 **[Ficheiro Binário Anexado: ${file.name}]**`);
  parts.push(`- **Tamanho:** ${formatBytes(file.size)}`);
  parts.push(`- **Tipo MIME:** ${file.type || "application/octet-stream"}`);
  if (hex) {
    parts.push(`- **Assinatura (Magic Bytes):** \`${hex}\``);
  }
  parts.push("");
  parts.push(
    "Por favor analisa este ficheiro binário com base no seu tipo, extensão e metadados descritos acima.",
  );

  return {
    kind: "binary",
    textToSend: parts.join("\n"),
    summary: `Ficheiro binário "${file.name}" adicionado à conversa.`,
  };
}