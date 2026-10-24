"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { Vec2 } from "@/lib/types";
import { IN_TO_M } from "@/lib/world/geometry";

const AMBER = "#f5a54a";

// The person, as an estimate: glides toward each new position (never teleports), with a ring that grows
// when the estimate is less certain and a short arrow for the direction of travel.
export function Avatar({ target, confidence, velocity }: { target: Vec2; confidence: number; velocity?: Vec2 }) {
  const group = useRef<THREE.Group>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const cur = useRef(new THREE.Vector3(target.x * IN_TO_M, 0, target.y * IN_TO_M));
  const goal = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    goal.current.set(target.x * IN_TO_M, 0, target.y * IN_TO_M);
    cur.current.lerp(goal.current, 1 - Math.exp(-6 * dt)); // critically damped feel; no jumps
    group.current.position.copy(cur.current);
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.06;
    const spread = 1 + (1 - Math.max(0, Math.min(1, confidence))) * 2.5;
    ring.current.scale.setScalar(spread * pulse);
  });

  const speed = velocity ? Math.hypot(velocity.x, velocity.y) : 0;
  const heading = velocity && speed > 5 ? Math.atan2(velocity.y, velocity.x) : undefined;

  return (
    <group ref={group}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.22, 1.0, 8, 16]} />
        <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={0.6} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.35, 0.45, 48]} />
        <meshBasicMaterial color={AMBER} transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {heading !== undefined && (
        <mesh rotation={[0, -heading, 0]} position={[0, 0.03, 0]}>
          <mesh position={[0.75, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.12, 0.3, 16]} />
            <meshBasicMaterial color={AMBER} />
          </mesh>
        </mesh>
      )}
      <pointLight color={AMBER} intensity={1.2} distance={3.5} position={[0, 1.2, 0]} />
    </group>
  );
}
