"use client";

import { useEffect, useRef } from "react";

// Cursor-reactive glitch over the hero video, ported from Iris.
// It draws the existing <video> into a WebGL canvas, so the video downloads once.
// If WebGL is missing or motion is reduced, the canvas stays hidden and the plain video shows.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes;      // canvas size (px)
uniform vec2 uTexRes;   // video size (px)
uniform vec2 uMouse;    // cursor in uv space (y up), offscreen = (-1, -1)
uniform float uTime;
uniform float uFocusX;  // like CSS object-position x, keeps the lantern in frame

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // object-fit: cover
  vec2 ratio = vec2(
    min((uRes.x / uRes.y) / (uTexRes.x / uTexRes.y), 1.0),
    min((uRes.y / uRes.x) / (uTexRes.y / uTexRes.x), 1.0)
  );
  vec2 uv = vec2(
    vUv.x * ratio.x + (1.0 - ratio.x) * uFocusX,
    (1.0 - vUv.y) * ratio.y + (1.0 - ratio.y) * 0.5
  );
  uv.x = 1.0 - uv.x; // mirror, so the figure sits on the right

  // strength falls off with distance from the cursor
  vec2 d = vUv - uMouse;
  d.x *= uRes.x / uRes.y;
  float infl = uMouse.x < -0.5 ? 0.0 : smoothstep(0.18, 0.0, length(d));

  // horizontal block displacement
  float blocks = floor(vUv.y * 22.0);
  float n = hash(vec2(blocks, floor(uTime * 9.0)));
  uv.x += (n - 0.5) * 0.06 * infl;

  // chromatic aberration
  float ca = 0.012 * infl;
  vec3 col = vec3(
    texture2D(uTex, uv + vec2(ca, 0.0)).r,
    texture2D(uTex, uv).g,
    texture2D(uTex, uv - vec2(ca, 0.0)).b
  );

  // scanline static near the cursor
  float scan = hash(vec2(floor(vUv.y * 240.0), floor(uTime * 24.0)));
  col += (scan - 0.5) * 0.1 * infl;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

export function GlitchCanvas({ videoId }: { videoId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = document.getElementById(videoId) as HTMLVideoElement | null;
    if (!canvas || !video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One oversized triangle covers the whole screen.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const uRes = gl.getUniformLocation(program, "uRes");
    const uTexRes = gl.getUniformLocation(program, "uTexRes");
    const uMouse = gl.getUniformLocation(program, "uMouse");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uFocusX = gl.getUniformLocation(program, "uFocusX");

    const mouse = { x: -1, y: -1 };
    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX / window.innerWidth;
      mouse.y = 1 - e.clientY / window.innerHeight;
    };
    const onLeave = () => {
      mouse.x = -1;
      mouse.y = -1;
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      // Skip work once the hero has scrolled away, or before the video has a frame.
      if (window.scrollY > window.innerHeight || video.readyState < 2) return;

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uTexRes, video.videoWidth, video.videoHeight);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.uniform1f(uFocusX, window.innerWidth <= 720 ? 0.16 : 0.3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.classList.add("loaded");
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(program);
    };
  }, [videoId]);

  return <canvas ref={canvasRef} className="glitch-canvas" aria-hidden="true" />;
}
