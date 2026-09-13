import React, { useState } from "react";
import { FolderArchive, FileCheck, FileText, Check, ChevronDown } from "lucide-react";
import { MarkdownContent } from "./markdown-content";
import { UserActions, AssistantActions } from "./message-actions";
import { parseAttachmentMeta, type AttachmentMetadata } from "@/lib/file-attachment-processor";

function AttachmentBubble({
  meta,
  cleanContent,
}: {
  meta: AttachmentMetadata;
  cleanContent: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isZip = meta.kind === "zip";
  const isSha =
    meta.fileName.toLowerCase().endsWith(".sha256") ||
    meta.fileName.toLowerCase().endsWith(".md5");

  return (
    <div className="flex flex-col gap-2 w-full max-w-full">
      {meta.userNote ? (
        <div className="text-[15.5px] leading-relaxed text-primary-foreground font-normal break-words">
          {meta.userNote}
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-black/30 px-3.5 py-2.5 backdrop-blur-md shadow-xs max-w-full overflow-hidden">
        {/* Ícone estilizado */}
        <div
          className={`grid size-10 shrink-0 place-items-center rounded-xl border ${
            isZip
              ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
              : isSha
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                : "border-sky-500/40 bg-sky-500/20 text-sky-300"
          }`}
        >
          {isZip ? (
            <FolderArchive className="size-5" />
          ) : isSha ? (
            <FileCheck className="size-5" />
          ) : (
            <FileText className="size-5" />
          )}
        </div>

        {/* Informações do ficheiro */}
        <div className="flex-1 min-w-0 pr-1">
          <p
            className="text-[13.5px] font-semibold text-white truncate leading-tight"
            title={meta.fileName}
          >
            {meta.fileName}
          </p>
          <p className="text-[11.5px] text-white/75 mt-0.5 truncate flex items-center gap-1.5">
            <span>{isZip ? "Arquivo ZIP" : isSha ? "Checksum" : "Ficheiro"}</span>
            <span>·</span>
            <span>{meta.fileSize}</span>
            {typeof meta.fileCount === "number" ? (
              <>
                <span>·</span>
                <span>{meta.fileCount} ficheiros</span>
              </>
            ) : null}
          </p>
        </div>

        {/* Badge de status */}
        <div className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 rounded-full px-2 py-0.5">
          <Check className="size-3" />
          <span>{isZip ? "Pronto" : "Anexado"}</span>
        </div>
      </div>

      {/* Botão sutil para inspeção técnica opcional */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="self-end flex items-center gap-1 text-[11px] text-white/70 hover:text-white transition-colors py-0.5 px-1 mt-0.5"
      >
        <span>{expanded ? "Ocultar detalhes técnicos" : "Ver estrutura enviada"}</span>
        <ChevronDown className={`size-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded ? (
        <div className="rounded-xl border border-white/10 bg-black/40 p-2.5 text-[11.5px] font-mono text-white/80 max-h-48 overflow-y-auto no-scrollbar break-all">
          <pre className="whitespace-pre-wrap">{cleanContent}</pre>
        </div>
      ) : null}
    </div>
  );
}

export interface ChatMessageItemProps {
  message: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    model?: string;
    feedback?: 1 | -1 | null;
  };
  scope: "main" | "quick";
  onEdit: (id: string) => void;
  onFeedback: (id: string, value: 1 | -1) => void;
  onRegenerate: (id: string) => void;
  t: (key: string) => string;
  parseQuickSegments: (content: string) => Array<{ roleRaw: string; content: string }>;
  getPersonaConfig: (roleRaw: string) => {
    name: string;
    badge: string;
    avatarBg: string;
    icon: React.ReactNode;
  };
  modelLabel: (model?: string) => string;
}

export const ChatMessageItem = React.memo(
  function ChatMessageItem({
    message,
    scope,
    onEdit,
    onFeedback,
    onRegenerate,
    t,
    parseQuickSegments,
    getPersonaConfig,
    modelLabel,
  }: ChatMessageItemProps) {
    if (message.role === "user") {
      const parsedAttachment = parseAttachmentMeta(message.content);

      return (
        <div className="flex flex-col items-end max-w-full">
          <div className="max-w-[88%] rounded-3xl bg-primary px-4 py-2.5 text-[15.5px] leading-relaxed text-primary-foreground shadow-xs overflow-hidden">
            {parsedAttachment.meta ? (
              <AttachmentBubble
                meta={parsedAttachment.meta}
                cleanContent={parsedAttachment.cleanContent}
              />
            ) : (
              <MarkdownContent content={message.content} isUser />
            )}
          </div>
          <UserActions content={message.content} onEdit={() => onEdit(message.id)} />
        </div>
      );
    }

    if (scope === "quick") {
      const segments = parseQuickSegments(message.content);
      return (
        <div className="space-y-3">
          {segments.map((segment, sIdx) => {
            const cfg = getPersonaConfig(segment.roleRaw);
            return (
              <div key={sIdx} className="flex items-start gap-2.5 my-2 animate-fade-in">
                <div
                  className={`relative grid size-9 shrink-0 place-items-center rounded-full border shadow-xs ${cfg.avatarBg}`}
                  title={cfg.name}
                >
                  {cfg.icon}
                </div>

                <div className="flex-1 min-w-0 max-w-[88%]">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-[12px] font-semibold text-foreground tracking-tight">
                      {cfg.name}
                    </span>
                    <span className="rounded-md bg-secondary/80 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                      {cfg.badge}
                    </span>
                  </div>
                  <div className="rounded-3xl rounded-tl-sm border border-hairline/80 bg-surface/90 px-4 py-3 text-[15px] leading-relaxed text-foreground shadow-xs">
                    <MarkdownContent content={segment.content} />
                  </div>
                </div>
              </div>
            );
          })}
          <AssistantActions
            content={message.content}
            feedback={message.feedback ?? null}
            onFeedback={(value) => onFeedback(message.id, value)}
            onRegenerate={() => onRegenerate(message.id)}
          />
        </div>
      );
    }

    // Modo Main Chat
    const isAppModel = (message.model || "").startsWith("app:");
    return (
      <div>
        {isAppModel ? (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>{modelLabel(message.model)}</span>
            <span className="text-muted-foreground/60 text-[10.5px]">· {t("Chat Fixo")}</span>
          </div>
        ) : null}
        <MarkdownContent content={message.content} />
        <AssistantActions
          content={message.content}
          feedback={message.feedback ?? null}
          onFeedback={(value) => onFeedback(message.id, value)}
          onRegenerate={() => onRegenerate(message.id)}
        />
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.message.id === next.message.id &&
      prev.message.content === next.message.content &&
      prev.message.feedback === next.message.feedback &&
      prev.message.model === next.message.model &&
      prev.scope === next.scope
    );
  },
);
