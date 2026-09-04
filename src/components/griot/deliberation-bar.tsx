/**
 * GRIOT AI Deliberation Room Bar Component
 * Rendered at the center of Quick Mode in Chat. Pure GRIOT monochrome design.
 */

import { useState } from "react";
import {
  DELIBERATION_MISSIONS,
  DELIBERATION_ROLES,
  type DeliberationMissionId,
  type DeliberationRoleId,
} from "@/lib/runtime/deliberation-room";
import { useT } from "@/lib/i18n";
import {
  Brain,
  Check,
  ChevronDown,
  FlaskConical,
  Lightbulb,
  Search,
  Shield,
  Swords,
  Target,
  TrendingUp,
  Wrench,
  X,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  brain: Brain,
  search: Search,
  lightbulb: Lightbulb,
  shield: Shield,
  swords: Swords,
  wrench: Wrench,
  "trending-up": TrendingUp,
  "flask-conical": FlaskConical,
  target: Target,
};

function RoleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name];
  if (Icon) return <Icon className={className} />;
  return <Brain className={className} />;
}

interface DeliberationBarProps {
  activeMission: DeliberationMissionId;
  roleEngines: Record<DeliberationRoleId, string>;
  onSelectMission: (mission: DeliberationMissionId) => void;
  onChangeRoleEngine: (roleId: DeliberationRoleId, engine: string) => void;
}

const ENGINE_OPTIONS = [
  { id: "gemini:gemini-2.0-flash", label: "Google Gemini 2.0 Flash (API)" },
  { id: "gemini:gemini-1.5-pro", label: "Google Gemini 1.5 Pro (API)" },
  { id: "openai:gpt-4o", label: "OpenAI GPT-4o (API)" },
  { id: "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini (API)" },
  { id: "anthropic:claude-3-5-sonnet", label: "Claude 3.5 Sonnet (API)" },
  { id: "deepseek:deepseek-r1", label: "DeepSeek R1 (API)" },
  { id: "deepseek:deepseek-v3", label: "DeepSeek V3 (API)" },
  { id: "groq:llama-3.3-70b", label: "Groq Llama 3.3 70B (API)" },
];

export function DeliberationBar({
  activeMission,
  roleEngines,
  onSelectMission,
  onChangeRoleEngine,
}: DeliberationBarProps) {
  const t = useT();
  const [missionOpen, setMissionOpen] = useState(false);
  const [roleSelectOpen, setRoleSelectOpen] = useState<DeliberationRoleId | null>(null);

  const currentMissionObj =
    DELIBERATION_MISSIONS.find((m) => m.id === activeMission) || DELIBERATION_MISSIONS[0];

  return (
    <div className="w-full px-4 py-3">
      {/* Top Row: Mission Selector */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMissionOpen(!missionOpen)}
          className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface/60 px-3.5 py-2 text-[13px] font-medium text-foreground transition-transform active:scale-[0.98]"
        >
          <RoleIcon name={currentMissionObj.icon} className="size-4 text-foreground/80" />
          <span className="truncate max-w-[200px]">{t(currentMissionObj.label)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>

        <span className="text-[10.5px] font-medium tracking-wider text-muted-foreground/60 uppercase">
          {t("Quick Deliberation Room")}
        </span>
      </div>

      {/* Mission Modal Selector */}
      {missionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-hairline bg-surface/95 p-3.5 shadow-2xl backdrop-blur-2xl rise">
            <div className="flex items-center justify-between px-1 pb-2.5 border-b border-hairline">
              <p className="text-[13px] font-semibold text-foreground">
                {t("Escolher Missão da Sala")}
              </p>
              <button
                type="button"
                onClick={() => setMissionOpen(false)}
                className="grid size-7 place-items-center rounded-full bg-secondary text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="mt-2 space-y-1 max-h-[55vh] overflow-y-auto no-scrollbar">
              {DELIBERATION_MISSIONS.map((mission) => (
                <button
                  key={mission.id}
                  type="button"
                  onClick={() => {
                    onSelectMission(mission.id);
                    setMissionOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-[13px] transition-colors ${
                    activeMission === mission.id
                      ? "bg-white/[0.08] font-medium text-foreground"
                      : "hover:bg-white/[0.04] text-foreground/80"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <RoleIcon name={mission.icon} className="size-4 text-foreground/80 shrink-0" />
                    <div>
                      <p className="font-medium leading-none">{t(mission.label)}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-tight">
                        {t(mission.description)}
                      </p>
                    </div>
                  </div>
                  {activeMission === mission.id && (
                    <Check className="size-4 text-foreground shrink-0 ml-2" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Row: Active 4 Roles Bar */}
      <div className="mt-2.5 grid grid-cols-4 gap-1.5 w-full">
        {(["strategist", "analyst", "innovator", "critic"] as DeliberationRoleId[]).map((roleId) => {
          const role = DELIBERATION_ROLES[roleId];
          const engine = roleEngines[roleId] || role.defaultEngine;
          const engineObj = ENGINE_OPTIONS.find((e) => e.id === engine);

          return (
            <button
              key={roleId}
              type="button"
              onClick={() => setRoleSelectOpen(roleId)}
              className="flex min-w-0 flex-col items-center justify-center rounded-2xl border border-hairline bg-surface/60 px-1 py-2 text-center transition-all hover:border-foreground/20 active:scale-[0.97]"
            >
              <RoleIcon name={role.icon} className="size-4 text-foreground/80 shrink-0" />
              <span className="mt-1 text-[10.5px] font-medium text-foreground truncate w-full px-0.5">
                {role.label}
              </span>
              <span className="mt-0.5 text-[9px] text-muted-foreground/75 truncate w-full px-0.5">
                {engineObj ? engineObj.label.split(" ")[0] : "Gemini"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Role Engine Selector Centered Modal */}
      {roleSelectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-xs overflow-hidden rounded-3xl border border-hairline bg-surface/95 p-3.5 shadow-2xl backdrop-blur-2xl rise">
            <div className="flex items-center justify-between px-1 pb-2 border-b border-hairline">
              <div className="flex items-center gap-2">
                <RoleIcon name={DELIBERATION_ROLES[roleSelectOpen].icon} className="size-4 text-foreground/80" />
                <p className="text-[13px] font-semibold text-foreground">
                  {DELIBERATION_ROLES[roleSelectOpen].label}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
                Motor IA
              </span>
            </div>

            <div className="mt-2 space-y-1 max-h-[45vh] overflow-y-auto no-scrollbar">
              {ENGINE_OPTIONS.map((opt) => {
                const currentEngine =
                  roleEngines[roleSelectOpen] || DELIBERATION_ROLES[roleSelectOpen].defaultEngine;
                const isSelected = currentEngine === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      onChangeRoleEngine(roleSelectOpen, opt.id);
                      setRoleSelectOpen(null);
                    }}
                    className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                      isSelected
                        ? "bg-white/[0.08] text-foreground font-medium"
                        : "hover:bg-white/[0.04] text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isSelected && <Check className="size-3.5 text-foreground shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setRoleSelectOpen(null)}
              className="mt-3 w-full rounded-xl bg-secondary py-2 text-center text-[12px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98]"
            >
              {t("Fechar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
