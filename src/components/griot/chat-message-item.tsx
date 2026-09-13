import React from "react";
import {
  FolderArchive,
  FileCheck,
  FileText,
  ChevronRight,
  ImageIcon,
  Mic,
  Video,
  FileCode,
  FileSpreadsheet,
  File,
} from "lucide-react";
import { MarkdownContent } from "./markdown-content";
import { UserActions, AssistantActions } from "./message-actions";
import { parseAttachmentMeta, type AttachmentMetadata } from "@/lib/file-attachment-processor";

function getAttachmentDisplay(meta: AttachmentMetadata) {
  const name = (meta.fileName || "").toLowerCase();
  const kind = meta.kind;

  if (kind === "image" || /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i.test(name)) {
    const ext = name.split(".").pop()?.toUpperCase();
    return {
      Icon: ImageIcon,
      label: ext ? `Imagem ${ext}` : "Imagem",
    };
  }

  if (kind === "audio" || /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i.test(name)) {
    return {
      Icon: Mic,
      label: "Áudio",
    };
  }

  if (kind === "video" || /\.(mp4|webm|mov|mkv|avi)$/i.test(name)) {
    return {
      Icon: Video,
      label: "Vídeo",
    };
  }

  if (kind === "zip" || /\.(zip|tar|gz|bz2|7z|rar)$/i.test(name)) {
    return {
      Icon: FolderArchive,
      label: "Arquivo ZIP",
    };
  }

  if (/\.(xlsx?|csv|tsv|ods)$/i.test(name)) {
    return {
      Icon: FileSpreadsheet,
      label: "Folha de Cálculo",
    };
  }

  if (kind === "document" || /\.(pdf|docx?|odt|rtf|pptx?)$/i.test(name)) {
    const ext = name.split(".").pop()?.toUpperCase();
    return {
      Icon: FileText,
      label: ext ? `Documento ${ext}` : "Documento",
    };
  }

  if (
    kind === "code" ||
    /\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|cs|php|rb|swift|kt|sql|html|css|json|yaml|yml|toml)$/i.test(name)
  ) {
    return {
      Icon: FileCode,
      label: "Código-fonte",
    };
  }

  if (name.endsWith(".sha256") || name.endsWith(".md5") || name.endsWith(".sha1")) {
    return {
      Icon: FileCheck,
      label: "Checksum",
    };
  }

  return {
    Icon: File,
    label: "Ficheiro",
  };
}

function AttachmentBubble({ meta }: { meta: AttachmentMetadata }) {
  const { Icon, label } = getAttachmentDisplay(meta);

  return (
    <div className="flex flex-col gap-1.5 w-full max-w-[92%] sm:max-w-md items-end">
      {meta.userNote ? (
        <div className="rounded-3xl bg-primary px-4 py-2.5 text-[15.5px] leading-relaxed text-primary-foreground shadow-xs overflow-hidden break-words mb-1 self-end">
          {meta.userNote}
        </div>
      ) : null}

      <div className="flex items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.08] px-3.5 py-2.5 backdrop-blur-md shadow-xs w-full max-w-full overflow-hidden transition-colors">
        {/* Ícone monocromático / neutro sem cores gritantes */}
        <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-black/10 bg-black/[0.04] text-zinc-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200">
          <Icon className="size-5" />
        </div>

        {/* Informações do ficheiro */}
        <div className="flex-1 min-w-0 pr-1">
          <p
            className="text-[13.5px] font-medium text-foreground truncate leading-tight"
            title={meta.fileName}
          >
            {meta.fileName}
          </p>
          <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate flex items-center gap-1.5">
            <span>{label}</span>
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

        {/* Ícone sutil lateral */}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
      </div>
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

      if (parsedAttachment.meta) {
        return (
          <div className="flex flex-col items-end max-w-full">
            <AttachmentBubble meta={parsedAttachment.meta} />
            <UserActions content={message.content} onEdit={() => onEdit(message.id)} />
          </div>
        );
      }

      return (
        <div className="flex flex-col items-end max-w-full">
          <div className="max-w-[88%] rounded-3xl bg-primary px-4 py-2.5 text-[15.5px] leading-relaxed text-primary-foreground shadow-xs overflow-hidden">
            <MarkdownContent content={message.content} isUser />
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
