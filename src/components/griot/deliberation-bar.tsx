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
  ChevronDown,
  FlaskConical,
  Lightbulb,
  Search,
  Shield,
  Swords,
  Target,
  TrendingUp,
  Wrench,
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
  { id: "gemini:gemini-3.6-flash", label: "Gemini 3.6 Flash (API)" },
  { id: "openai:gpt-4o", label: "GPT-4o (API)" },
  { id: "anthropic:claude-3-5-sonnet", label: "Claude 3.5 Sonnet (API)" },
  { id: "app:chatgpt", label: "ChatGPT (App Nativo)" },
  { id: "app:claude", label: "Claude (App Nativo)" },
  { id: "app:gemini", label: "Gemini (App Nativo)" },
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

      {/* Mission Dropdown Selector */}
      {missionOpen && (
        <div className="mt-2.5 rounded-2xl border border-hairline bg-background p-2 shadow-lg rise">
          <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("Escolher Missão da Sala")}
          </p>
          <div className="mt-1 space-y-1">
            {DELIBERATION_MISSIONS.map((mission) => (
              <button
                key={mission.id}
                type="button"
                onClick={() => {
                  onSelectMission(mission.id);
                  setMissionOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                  activeMission === mission.id
                    ? "bg-white/[0.06] font-medium text-foreground"
                    : "hover:bg-surface text-foreground/80"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <RoleIcon name={mission.icon} className="size-4 text-foreground/70" />
                  <div>
                    <p className="font-medium leading-none">{t(mission.label)}</p>
                    <p className="mt-1 text-[11.5px] text-muted-foreground leading-tight">
                      {t(mission.description)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Row: Active 4 Roles Bar */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {(["strategist", "analyst", "innovator", "critic"] as DeliberationRoleId[]).map((roleId) => {
          const role = DELIBERATION_ROLES[roleId];
          const engine = roleEngines[roleId] || role.defaultEngine;
          const engineObj = ENGINE_OPTIONS.find((e) => e.id === engine);

          return (
            <div key={roleId} className="relative">
              <button
                type="button"
                onClick={() =>
                  setRoleSelectOpen(roleSelectOpen === roleId ? null : roleId)
                }
                className="flex flex-col items-center justify-center w-full rounded-2xl border border-hairline bg-surface/40 px-2 py-2 text-center transition-all hover:border-foreground/20 active:scale-[0.97]"
              >
                <RoleIcon name={role.icon} className="size-5 text-foreground/80" />
                <span className="mt-1.5 text-[11px] font-medium text-foreground truncate max-w-full">
                  {role.label}
                </span>
                <span className="mt-0.5 text-[9.5px] text-muted-foreground/70 truncate max-w-full">
                  {engineObj ? engineObj.label.split(" ")[0] : "Gemini"}
                </span>
              </button>

              {/* Role Engine Selector Popover */}
              {roleSelectOpen === roleId && (
                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-2xl border border-hairline bg-background p-1.5 shadow-xl rise">
                  <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase">
                    <RoleIcon name={role.icon} className="size-3 text-foreground/60" />
                    {role.label}
                  </p>
                  <div className="space-y-0.5">
                    {ENGINE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          onChangeRoleEngine(roleId, opt.id);
                          setRoleSelectOpen(null);
                        }}
                        className={`w-full rounded-lg px-2 py-1.5 text-left text-[11.5px] transition-colors ${
                          engine === opt.id
                            ? "bg-white/[0.08] text-foreground font-medium"
                            : "hover:bg-surface text-foreground/80"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
