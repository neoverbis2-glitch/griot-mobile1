import { useState, type ReactNode } from "react";
import { Check, ChevronRight, Search, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/** Grupo agrupado moderno de definições (estilo sistema operacional nativo) */
export function SettingsGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="px-3 pt-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t(title)}
        </h3>
        {note ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground/70 leading-normal">{t(note)}</p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-xs">
        {children}
      </div>
    </div>
  );
}

/** Linha base com divisor subtil */
export function Row({ children }: { children: ReactNode }) {
  return <div className="border-b border-hairline px-4 py-3.5 last:border-b-0">{children}</div>;
}

/** Toggle moderno e acessível (com área de clique em toda a linha) */
export function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <Row>
      <div
        onClick={() => !disabled && onChange(!value)}
        className={`flex items-center justify-between gap-3.5 cursor-pointer select-none ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium leading-snug text-foreground">
            {t(label)}
          </span>
          {hint ? (
            <span className="block mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
              {t(hint)}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          role="switch"
          disabled={disabled}
          aria-checked={value}
          aria-label={t(label)}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onChange(!value);
          }}
          className={`relative box-border inline-flex h-[28px] w-[48px] shrink-0 items-center rounded-full border transition-colors duration-200 ${
            value ? "border-primary bg-primary" : "border-hairline bg-muted/80"
          }`}
        >
          <span
            className={`pointer-events-none block size-[22px] rounded-full shadow-sm transition-transform duration-200 ${
              value ? "bg-primary-foreground translate-x-[22px]" : "bg-background translate-x-[3px]"
            }`}
          />
        </button>
      </div>
    </Row>
  );
}

/** Seletor de Opções com Bottom-Sheet Modal Nativo e Pesquisa (sem deformar o layout inline) */
export function SelectRow({
  label,
  value,
  options,
  onChange,
  hint,
  searchable = false,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  hint?: string;
  searchable?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const formatOption = (opt: string) => {
    if (opt.includes("(") && opt.includes(")")) return opt;
    if (opt.includes("/") || opt.includes("-")) return opt;
    return t(opt);
  };

  const filtered = query
    ? options.filter(
        (option) =>
          formatOption(option).toLowerCase().includes(query.toLowerCase()) ||
          option.toLowerCase().includes(query.toLowerCase()),
      )
    : options;

  return (
    <Row>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 text-left transition-colors active:opacity-70"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium leading-snug text-foreground">
            {t(label)}
          </span>
          {hint ? (
            <span className="block mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
              {t(hint)}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 max-w-[140px] truncate text-[13.5px] text-muted-foreground">
          {formatOption(value)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
        >
          <div
            className="w-full max-w-lg max-h-[82vh] flex flex-col rounded-t-[28px] sm:rounded-2xl border border-hairline bg-card shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabeçalho do Seletor */}
            <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
              <div>
                <h4 className="text-[16px] font-semibold text-foreground">{t(label)}</h4>
                <p className="text-[12px] text-muted-foreground">
                  {options.length} {t("opções disponíveis")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
                className="grid size-8 place-items-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Caixa de Pesquisa (quando há mais de 5 itens ou searchable) */}
            {searchable || options.length > 5 ? (
              <div className="border-b border-hairline p-3">
                <div className="flex items-center gap-2 rounded-xl bg-secondary/70 px-3.5 py-2 border border-hairline">
                  <Search className="size-4 text-muted-foreground shrink-0" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Procurar...")}
                    className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
                  />
                  {query ? (
                    <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Lista com scroll nativo suave */}
            <div className="max-h-[58vh] overflow-y-auto divide-y divide-hairline/40 overscroll-contain">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-[13.5px] text-muted-foreground">
                  {t("Nenhum resultado encontrado")}
                </div>
              ) : (
                filtered.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      onChange(option);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors active:bg-secondary ${
                      option === value
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-secondary/40 text-foreground"
                    }`}
                  >
                    <span className="min-w-0 truncate text-[14px]">{formatOption(option)}</span>
                    {option === value ? (
                      <Check className="size-4 shrink-0 text-primary stroke-[2.5]" />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Row>
  );
}

/** Linha de Informação Tabular */
export function InfoRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const t = useT();
  return (
    <Row>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-medium leading-snug text-foreground">
            {t(label)}
          </span>
          {hint ? (
            <span className="block mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
              {t(hint)}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[13.5px] tabular-nums text-muted-foreground font-medium">
          {t(value)}
        </span>
      </div>
    </Row>
  );
}

/** Linha de Ação Interativa */
export function ActionRow({
  label,
  hint,
  value,
  onClick,
  danger = false,
}: {
  label: string;
  hint?: string;
  value?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const t = useT();
  return (
    <Row>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between gap-3 text-left transition-colors active:opacity-70"
      >
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[14.5px] font-medium leading-snug ${
              danger ? "text-destructive font-semibold" : "text-foreground"
            }`}
          >
            {t(label)}
          </span>
          {hint ? (
            <span className="block mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
              {t(hint)}
            </span>
          ) : null}
        </span>
        {value ? (
          <span className="shrink-0 text-[13px] text-muted-foreground font-medium mr-1">
            {t(value)}
          </span>
        ) : null}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
      </button>
    </Row>
  );
}
