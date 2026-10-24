"use client";

import { useEffect } from "react";

// All landing-page motion lives here: scroll progress for the hero fade, section reveals, video fade-in.
export function LandingEffects() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("bursting");

    let frame = 0;
    const updateScroll = () => {
      frame = 0;
      const progress = Math.min(window.scrollY / (window.innerHeight * 0.7), 1);
      root.style.setProperty("--scroll-progress", String(progress));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(updateScroll);
    };
    updateScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    const reveals = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in-view")),
      { threshold: 0.07 },
    );
    document.querySelectorAll(".reveal").forEach((el) => reveals.observe(el));

    const video = document.getElementById("hero-video") as HTMLVideoElement | null;
    const showVideo = () => video?.classList.add("loaded");
    if (video && video.readyState >= 3) showVideo();
    else video?.addEventListener("canplay", showVideo, { once: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      reveals.disconnect();
    };
  }, []);

  return null;
}
