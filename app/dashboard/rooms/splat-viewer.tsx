"use client";

import { useEffect, useRef, useState } from "react";

// Renders a World Labs Gaussian splat (.spz) with Spark on top of three.js.
// three and Spark are loaded only when this component mounts, so the rest of the dashboard stays light.
// Drag to look around, scroll to move in and out.
export function SplatViewer({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let stopped = false;
    let cleanup = () => {};

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const { SparkRenderer, SplatMesh } = await import("@sparkjsdev/spark");
        if (stopped) return;

        const renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.05, 100);
        scene.add(new SparkRenderer({ renderer }));

        const splat = new SplatMesh({ url });
        splat.quaternion.set(1, 0, 0, 0); // Marble worlds are y-down; flip them upright
        scene.add(splat);
        await splat.initialized;
        if (stopped) return;

        // Stand in the middle of the room and look around.
        camera.position.set(0, 0, 0.01);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 0, 0);
        controls.enableDamping = true;
        controls.rotateSpeed = -0.4; // drag feels like turning your head

        const resize = () => {
          camera.aspect = mount.clientWidth / mount.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener("resize", resize);
        renderer.setAnimationLoop(() => {
          controls.update();
          renderer.render(scene, camera);
        });
        setState("ready");

        cleanup = () => {
          window.removeEventListener("resize", resize);
          renderer.setAnimationLoop(null);
          controls.dispose();
          splat.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        console.error("Splat viewer failed:", e);
        if (!stopped) setState("failed");
      }
    })();

    return () => {
      stopped = true;
      cleanup();
    };
  }, [url]);

  if (state === "failed") return <>{fallback}</>;
  return (
    <div className="splat" ref={mountRef}>
      {state === "loading" && <p className="splat-status muted">Loading 3D preview...</p>}
    </div>
  );
}
