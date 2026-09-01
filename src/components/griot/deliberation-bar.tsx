/**
 * GRIOT AI Deliberation Room Bar Component
 * Rendered at the top of Quick Mode in Chat. Matches native GRIOT UI design.
 */

import { useState } from "react";
import {
  DELIBERATION_MISSIONS,
  DELIBERATION_ROLES,
  type DeliberationMissionId,
  type DeliberationRoleId,
} from "@/lib/runtime/deliberation-room";
import { useT } from "@/lib/i18n";
import { Sparkles, ChevronDown, Cpu, Layers } from "lucide-react";

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
    <div className="w-full border-b border-hairline bg-surface/80 backdrop-blur-md px-4 py-2.5 transition-all">
      {/* Top Row: Mission Selector */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMissionOpen(!missionOpen)}
          className="flex items-center gap-2 rounded-xl border border-hairline bg-background/60 px-3 py-1.5 text-[13px] font-medium text-foreground transition-transform active:scale-[0.98]"
        >
          <span className="text-[15px]">{currentMissionObj.icon}</span>
          <span className="truncate max-w-[200px]">{t(currentMissionObj.label)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
          <Sparkles className="size-3 text-primary animate-pulse" />
          <span>Quick Deliberation Room</span>
        </div>
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
                    ? "bg-primary/10 font-medium text-primary"
                    : "hover:bg-surface text-foreground"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-[16px]">{mission.icon}</span>
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
      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        {(["strategist", "analyst", "innovator", "critic"] as DeliberationRoleId[]).map((roleId) => {
          const role = DELIBERATION_ROLES[roleId];
          const engine = roleEngines[roleId] || role.defaultEngine;
          const engineObj = ENGINE_OPTIONS.find((e) => e.id === engine);
          const isApp = engine.startsWith("app:");

          return (
            <div key={roleId} className="relative">
              <button
                type="button"
                onClick={() =>
                  setRoleSelectOpen(roleSelectOpen === roleId ? null : roleId)
                }
                className="flex flex-col items-center justify-center w-full rounded-xl border border-hairline bg-background/80 px-2 py-1.5 text-center transition-all hover:border-primary/40 active:scale-[0.97]"
              >
                <span className="text-[14px] leading-none">{role.icon}</span>
                <span className="mt-1 text-[11px] font-medium text-foreground truncate max-w-full">
                  {role.label}
                </span>
                <span
                  className={`mt-0.5 text-[9.5px] font-mono px-1 rounded truncate max-w-full ${
                    isApp ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary"
                  }`}
                >
                  {engineObj ? engineObj.label.split(" ")[0] : "Gemini"}
                </span>
              </button>

              {/* Role Engine Selector Popover */}
              {roleSelectOpen === roleId && (
                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-2xl border border-hairline bg-background p-1.5 shadow-xl rise">
                  <p className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase">
                    {role.icon} {role.label} IA Engine
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
                            ? "bg-primary text-primary-foreground font-medium"
                            : "hover:bg-surface text-foreground"
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
