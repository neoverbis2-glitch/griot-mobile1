import React, { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

interface MarkdownContentProps {
  content: string;
  className?: string;
  isUser?: boolean;
}

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      toast.success("Código copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  };

  const displayLang = language.trim() || "code";

  return (
    <div className="my-3.5 overflow-hidden rounded-2xl border border-hairline/80 bg-neutral-950/90 text-neutral-100 shadow-md">
      {/* Barra de cabeçalho do código */}
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[11px] font-mono text-neutral-400">
        <div className="flex items-center gap-1.5">
          <Terminal className="size-3.5 text-neutral-400" />
          <span className="uppercase tracking-wider">{displayLang}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copiar código"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-neutral-300 transition-colors hover:bg-white/10 active:scale-95"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-400" />
              <span className="text-emerald-400">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>

      {/* Conteúdo com rolagem horizontal fluida */}
      <div className="overflow-x-auto p-3.5 text-[13px] leading-relaxed font-mono">
        <pre className="m-0 font-mono whitespace-pre">{code}</pre>
      </div>
    </div>
  );
}

/**
 * Renderizador de Markdown e texto estruturado com streaming progressivo para mobile.
 */
export const MarkdownContent = React.memo(function MarkdownContent({
  content,
  className = "",
  isUser = false,
}: MarkdownContentProps) {
  if (!content) return null;

  // Se for mensagem do utilizador, renderiza simples com quebra preservada
  if (isUser) {
    return (
      <div className={`whitespace-pre-wrap break-words ${className}`}>
        {content}
      </div>
    );
  }

  // Decomposição de blocos de código markdown (```lang ... ```)
  const segments: React.ReactNode[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index);
    if (textBefore) {
      segments.push(renderFormattedText(textBefore, `text-${lastIndex}`));
    }

    const language = match[1] || "";
    const code = match[2]?.replace(/\n$/, "") || "";
    segments.push(
      <CodeBlock key={`code-${match.index}`} language={language} code={code} />,
    );

    lastIndex = match.index + match[0].length;
  }

  const remainingText = content.slice(lastIndex);
  if (remainingText) {
    segments.push(renderFormattedText(remainingText, `text-${lastIndex}`));
  }

  return (
    <div className={`space-y-1.5 text-[15px] leading-relaxed text-foreground ${className}`}>
      {segments}
    </div>
  );
});

/** Formata texto enriquecido com inline code, negrito, itálico, listas e títulos */
function renderFormattedText(text: string, keyPrefix: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentList: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;

  const flushList = (idx: number) => {
    if (!currentList) return;
    if (currentList.type === "ul") {
      elements.push(
        <ul key={`ul-${keyPrefix}-${idx}`} className="my-2 space-y-1 pl-4 list-disc text-foreground/90">
          {currentList.items}
        </ul>,
      );
    } else {
      elements.push(
        <ol key={`ol-${keyPrefix}-${idx}`} className="my-2 space-y-1 pl-5 list-decimal text-foreground/90">
          {currentList.items}
        </ol>,
      );
    }
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Títulos Markdown (#, ##, ###)
    if (trimmed.startsWith("### ")) {
      flushList(i);
      elements.push(
        <h4 key={`${keyPrefix}-${i}`} className="mt-3.5 mb-1.5 text-[16px] font-semibold text-foreground tracking-tight">
          {renderInlineFormatting(trimmed.slice(4))}
        </h4>,
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushList(i);
      elements.push(
        <h3 key={`${keyPrefix}-${i}`} className="mt-4 mb-2 text-[17.5px] font-bold text-foreground tracking-tight">
          {renderInlineFormatting(trimmed.slice(3))}
        </h3>,
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushList(i);
      elements.push(
        <h2 key={`${keyPrefix}-${i}`} className="mt-4 mb-2 text-[19px] font-bold text-foreground tracking-tight">
          {renderInlineFormatting(trimmed.slice(2))}
        </h2>,
      );
      continue;
    }

    // Listas com marcadores (- ou *)
    const ulMatch = line.match(/^(\s*)[-*•]\s+(.*)$/);
    if (ulMatch) {
      if (!currentList || currentList.type !== "ul") {
        flushList(i);
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(
        <li key={`li-${i}`} className="pl-1 leading-relaxed">
          {renderInlineFormatting(ulMatch[2]!)}
        </li>,
      );
      continue;
    }

    // Listas numeradas (1. 2. etc.)
    const olMatch = line.match(/^(\s*)\d+[\.\)]\s+(.*)$/);
    if (olMatch) {
      if (!currentList || currentList.type !== "ol") {
        flushList(i);
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(
        <li key={`oli-${i}`} className="pl-1 leading-relaxed">
          {renderInlineFormatting(olMatch[2]!)}
        </li>,
      );
      continue;
    }

    // Citações em bloco (> )
    if (trimmed.startsWith("> ")) {
      flushList(i);
      elements.push(
        <blockquote
          key={`${keyPrefix}-${i}`}
          className="my-2.5 rounded-r-xl border-l-2 border-primary/60 bg-secondary/30 px-3.5 py-2 text-[14px] italic text-muted-foreground"
        >
          {renderInlineFormatting(trimmed.slice(2))}
        </blockquote>,
      );
      continue;
    }

    // Linha horizontal (--- ou ***)
    if (trimmed === "---" || trimmed === "***") {
      flushList(i);
      elements.push(<hr key={`${keyPrefix}-${i}`} className="my-3 border-hairline" />);
      continue;
    }

    // Linha vazia
    if (!trimmed) {
      flushList(i);
      elements.push(<div key={`${keyPrefix}-${i}`} className="h-1.5" />);
      continue;
    }

    // Parágrafo regular
    flushList(i);
    elements.push(
      <p key={`${keyPrefix}-${i}`} className="leading-relaxed">
        {renderInlineFormatting(line)}
      </p>,
    );
  }

  flushList(lines.length);

  return <React.Fragment key={keyPrefix}>{elements}</React.Fragment>;
}

/** Formata inline: código `code`, negrito **bold**, itálico *italic* e links */
function renderInlineFormatting(text: string): React.ReactNode {
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      const code = part.slice(1, -1);
      return (
        <code
          key={index}
          className="rounded-md border border-hairline/60 bg-secondary/60 px-1.5 py-0.5 font-mono text-[13px] text-foreground"
        >
          {code}
        </code>
      );
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={index} className="italic text-foreground/90">
          {part.slice(1, -1)}
        </em>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-3 transition-opacity hover:opacity-80"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={index}>{part}</span>;
  });
}
