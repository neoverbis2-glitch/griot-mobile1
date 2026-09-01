import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { GriotMark } from "@/components/griot/logo";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      void navigate({ to: "/home", replace: true });
    }, 400);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div
      onClick={() => void navigate({ to: "/home", replace: true })}
      className="fixed inset-0 z-50 flex min-h-screen w-full items-center justify-center bg-[#060608] px-4 cursor-pointer select-none"
    >
      <div className="flex flex-col items-center justify-center transition-transform duration-300">
        <GriotMark className="size-32 rounded-[28px] max-w-[40vw] max-h-[40vw]" />
      </div>
    </div>
  );
}
