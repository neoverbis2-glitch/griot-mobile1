import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AgentDeckDetail } from "@/lib/agent-capabilities";

export function PitchDeckVisualPreview({
  presentation,
}: {
  presentation: AgentDeckDetail["presentation"];
}) {
  const [index, setIndex] = useState(0);
  const total = presentation.slides.length + 1;
  const slide = index > 0 ? presentation.slides[index - 1] : null;

  useEffect(() => {
    setIndex(0);
  }, [presentation]);

  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={slide ? `Slide ${index + 1}: ${slide.title}` : `Capa: ${presentation.title}`}
        className="relative aspect-video overflow-hidden rounded-xl border border-[#27405E] bg-[#0B1220] text-[#F7FAFF] shadow-lg"
      >
        {slide ? (
          <div className="relative flex h-full flex-col px-[6%] py-[5%]">
            <div className="absolute inset-x-0 top-0 h-[2%] bg-[#6BE4C5]" />
            <p className="mb-[5%] text-[clamp(8px,1.5vw,13px)] font-semibold tracking-widest text-[#6BE4C5]">
              {String(index).padStart(2, "0")} / {String(total - 1).padStart(2, "0")}
            </p>
            <h5 className="mb-[5%] line-clamp-2 text-[clamp(13px,3vw,30px)] font-semibold leading-tight">
              {slide.title}
            </h5>
            <div className="flex min-h-0 flex-1 gap-[4%]">
              <div className="flex min-w-0 flex-1 flex-col gap-[4%]">
                {slide.bullets.map((bullet, bulletIndex) => (
                  <div key={bulletIndex} className="flex items-start gap-2">
                    <span className="mt-[0.4em] size-[clamp(4px,0.7vw,7px)] shrink-0 rounded-full bg-[#6BE4C5]" />
                    <span className="line-clamp-2 text-[clamp(8px,1.55vw,16px)] leading-snug">
                      {bullet}
                    </span>
                  </div>
                ))}
              </div>
              {slide.metrics.length > 0 && (
                <div className="flex w-[31%] flex-col gap-[5%]">
                  {slide.metrics.map((metric, metricIndex) => (
                    <div key={metricIndex} className="min-h-0 rounded-lg border border-[#253C58] bg-[#122039] p-[7%]">
                      <div className="truncate text-[clamp(10px,2.25vw,22px)] font-semibold leading-tight text-[#6BE4C5]">
                        {metric.value}
                      </div>
                      <p className="line-clamp-2 text-[clamp(7px,1.1vw,12px)] text-[#A8B8D1]">
                        {metric.label}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-auto flex items-end justify-between border-t border-[#27405E] pt-[2%] text-[clamp(6px,1vw,10px)] text-[#A8B8D1]">
              <span>GRIOT / AGENT NATIVE</span>
              <span>{slide.evidence.toUpperCase()}</span>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col border-l-[clamp(3px,0.8vw,8px)] border-[#6BE4C5] px-[7%] py-[8%]">
            <p className="mb-[7%] text-[clamp(8px,1.45vw,14px)] font-semibold tracking-widest text-[#6BE4C5]">
              GRIOT / PITCH DECK
            </p>
            <h5 className="line-clamp-3 text-[clamp(16px,4.3vw,42px)] font-bold leading-tight">
              {presentation.title}
            </h5>
            {presentation.subtitle && (
              <p className="mt-auto line-clamp-2 text-[clamp(9px,2vw,20px)] text-[#A8B8D1]">
                {presentation.subtitle}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <button type="button" disabled={index <= 0} onClick={() => setIndex((v) => Math.max(0, v - 1))}
          className="rounded-lg border border-hairline p-2 disabled:opacity-30" aria-label="Slide anterior">
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          Slide {index + 1} de {total}
        </span>
        <button type="button" disabled={index >= total - 1} onClick={() => setIndex((v) => Math.min(total - 1, v + 1))}
          className="rounded-lg border border-hairline p-2 disabled:opacity-30" aria-label="Slide seguinte">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
