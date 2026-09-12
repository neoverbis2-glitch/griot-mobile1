import React from "react";
import { MarkdownContent } from "./markdown-content";
import { UserActions, AssistantActions } from "./message-actions";

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
      return (
        <div className="flex flex-col items-end">
          <div className="max-w-[85%] rounded-3xl bg-primary px-4 py-2.5 text-[15.5px] leading-relaxed text-primary-foreground shadow-xs">
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
