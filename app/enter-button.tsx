"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const BURST_MS = 900;

// "press ENTER to continue": light bursts out of the pill and fills the screen with morning, then we navigate.
// The animation itself is pure CSS (see .bursting in globals.css).
// Only one instance should set listenForEnter, or a single key press would fire twice.
export function EnterButton({ listenForEnter = false }: { listenForEnter?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);

  function enter() {
    const button = ref.current;
    const root = document.documentElement;
    if (!button || root.classList.contains("bursting")) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return router.push("/dashboard");

    const rect = button.getBoundingClientRect();
    root.style.setProperty("--burst-x", `${rect.left + rect.width / 2}px`);
    root.style.setProperty("--burst-y", `${rect.top + rect.height / 2}px`);
    void root.offsetWidth; // apply the new origin before animating, or the circle slides in from the center
    button.classList.add("pressed");
    root.classList.add("bursting");

    // The class stays on until the landing page mounts again, so there is no flash before the dashboard paints.
    setTimeout(() => router.push("/dashboard"), BURST_MS);
  }

  useEffect(() => {
    router.prefetch("/dashboard");
    if (!listenForEnter) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.repeat) enter();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listenForEnter, router]);

  return (
    <button ref={ref} type="button" className="enter-pill" onClick={enter}>
      <span className="enter-word-key">press</span>
      <span className="enter-word-tap">tap</span>
      <kbd className="enter-key">ENTER</kbd>
      to continue
    </button>
  );
}
