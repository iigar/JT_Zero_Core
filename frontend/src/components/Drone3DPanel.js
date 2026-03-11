import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function DroneModel({ roll, pitch, yaw, motors, altitude }) {
  const groupRef = useRef();
  const propRefs = [useRef(), useRef(), useRef(), useRef()];
  const ledRef = useRef(0);

  useFrame((_, delta) => {
    if (groupRef.current) {
      const targetR = (roll || 0) * Math.PI / 180;
      const targetP = (pitch || 0) * Math.PI / 180;
      const targetY = (yaw || 0) * Math.PI / 180;
      groupRef.current.rotation.z += (targetR - groupRef.current.rotation.z) * 0.15;
      groupRef.current.rotation.x += (targetP - groupRef.current.rotation.x) * 0.15;
      groupRef.current.rotation.y += (-targetY - groupRef.current.rotation.y) * 0.15;
    }
    propRefs.forEach((ref, i) => {
      if (ref.current) {
        const speed = (motors?.[i] || 0) * 40 + 5;
        ref.current.rotation.y += speed * delta;
      }
    });
    ledRef.current += delta;
  });

  const armLength = 0.65;
  const armPositions = [
    [armLength, 0, armLength],
    [-armLength, 0, armLength],
    [-armLength, 0, -armLength],
    [armLength, 0, -armLength],
  ];

  const motorColors = useMemo(() =>
    (motors || [0, 0, 0, 0]).map(m => {
      if (m > 0.6) return '#0891B2';
      if (m > 0.3) return '#059669';
      if (m > 0) return '#D97706';
      return '#94A3B8';
    }), [motors]);

  return (
    <group ref={groupRef}>
      {/* === CENTER BODY (multi-layer) === */}
      {/* Bottom plate */}
      <mesh position={[0, -0.03, 0]}>
        <boxGeometry args={[0.35, 0.02, 0.35]} />
        <meshStandardMaterial color="#64748B" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Main body */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.3, 0.07, 0.3]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* Top plate / flight controller */}
      <mesh position={[0, 0.045, 0]}>
        <boxGeometry args={[0.22, 0.02, 0.22]} />
        <meshStandardMaterial color="#0EA5E9" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* GPS tower */}
      <mesh position={[0, 0.12, -0.05]}>
        <cylinderGeometry args={[0.015, 0.015, 0.12, 8]} />
        <meshStandardMaterial color="#94A3B8" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.19, -0.05]}>
        <cylinderGeometry args={[0.04, 0.04, 0.02, 12]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Front indicator (red) */}
      <mesh position={[0, 0.02, 0.2]}>
        <boxGeometry args={[0.04, 0.03, 0.06]} />
        <meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={0.4} />
      </mesh>
      {/* Rear indicator (green) */}
      <mesh position={[0, 0.02, -0.2]}>
        <boxGeometry args={[0.04, 0.03, 0.06]} />
        <meshStandardMaterial color="#22C55E" emissive="#22C55E" emissiveIntensity={0.3} />
      </mesh>

      {/* === CAMERA GIMBAL === */}
      <group position={[0, -0.06, 0.08]}>
        {/* Gimbal mount */}
        <mesh>
          <boxGeometry args={[0.06, 0.03, 0.06]} />
          <meshStandardMaterial color="#64748B" metalness={0.6} roughness={0.3} />
        </mesh>
        {/* Camera lens */}
        <mesh position={[0, -0.02, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.025, 0.03, 12]} />
          <meshStandardMaterial color="#1E293B" metalness={0.8} roughness={0.2} />
        </mesh>
        {/* Lens glass */}
        <mesh position={[0, -0.02, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.018, 12]} />
          <meshStandardMaterial color="#0C4A6E" metalness={0.9} roughness={0.1} />
        </mesh>
      </group>

      {/* === BATTERY === */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[0.12, 0.04, 0.2]} />
        <meshStandardMaterial color="#334155" metalness={0.4} roughness={0.5} />
      </mesh>
      {/* Battery label */}
      <mesh position={[0, -0.05, 0.005]}>
        <boxGeometry args={[0.08, 0.02, 0.14]} />
        <meshStandardMaterial color="#0369A1" metalness={0.3} roughness={0.6} />
      </mesh>

      {/* === LANDING GEAR === */}
      {[[-0.15, 0, 0.18], [0.15, 0, 0.18], [-0.15, 0, -0.18], [0.15, 0, -0.18]].map((pos, i) => (
        <group key={`gear-${i}`}>
          {/* Leg strut */}
          <mesh position={[pos[0], -0.1, pos[2]]} rotation={[0, 0, pos[0] > 0 ? 0.15 : -0.15]}>
            <cylinderGeometry args={[0.008, 0.008, 0.12, 6]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* Foot pad */}
          <mesh position={[pos[0] * 1.1, -0.16, pos[2]]}>
            <sphereGeometry args={[0.015, 8, 8]} />
            <meshStandardMaterial color="#64748B" metalness={0.5} roughness={0.4} />
          </mesh>
        </group>
      ))}
      {/* Gear skids (front + rear) */}
      {[0.18, -0.18].map((z, i) => (
        <mesh key={`skid-${i}`} position={[0, -0.16, z]}>
          <boxGeometry args={[0.35, 0.01, 0.015]} />
          <meshStandardMaterial color="#94A3B8" metalness={0.6} roughness={0.3} />
        </mesh>
      ))}

      {/* === ARMS + MOTORS + PROPS === */}
      {armPositions.map((pos, i) => (
        <group key={i}>
          {/* Arm tube */}
          <mesh position={[pos[0] / 2, 0, pos[2] / 2]}
                rotation={[0, Math.atan2(pos[0], pos[2]), 0]}>
            <boxGeometry args={[0.045, 0.035, armLength * 1.05]} />
            <meshStandardMaterial color="#64748B" metalness={0.6} roughness={0.35} />
          </mesh>
          {/* Arm reinforcement */}
          <mesh position={[pos[0] / 2, -0.02, pos[2] / 2]}
                rotation={[0, Math.atan2(pos[0], pos[2]), 0]}>
            <boxGeometry args={[0.055, 0.008, armLength * 0.6]} />
            <meshStandardMaterial color="#94A3B8" metalness={0.5} roughness={0.4} />
          </mesh>

          {/* Motor housing */}
          <mesh position={pos}>
            <cylinderGeometry args={[0.055, 0.065, 0.05, 12]} />
            <meshStandardMaterial color={motorColors[i]} metalness={0.5} roughness={0.35}
              emissive={motorColors[i]} emissiveIntensity={(motors?.[i] || 0) * 0.2} />
          </mesh>
          {/* Motor top cap */}
          <mesh position={[pos[0], 0.03, pos[2]]}>
            <cylinderGeometry args={[0.04, 0.04, 0.015, 12]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.3} />
          </mesh>
          {/* Motor shaft */}
          <mesh position={[pos[0], 0.05, pos[2]]}>
            <cylinderGeometry args={[0.006, 0.006, 0.03, 6]} />
            <meshStandardMaterial color="#CBD5E1" metalness={0.8} roughness={0.2} />
          </mesh>

          {/* Propeller (2-blade) */}
          <group ref={propRefs[i]} position={[pos[0], 0.065, pos[2]]}>
            <mesh>
              <boxGeometry args={[0.42, 0.004, 0.035]} />
              <meshStandardMaterial color="#94A3B8" transparent opacity={0.5} side={THREE.DoubleSide} />
            </mesh>
            {/* Blade tips */}
            <mesh position={[0.2, 0, 0]}>
              <boxGeometry args={[0.04, 0.003, 0.025]} />
              <meshStandardMaterial color={i < 2 ? '#EF4444' : '#F8FAFC'} transparent opacity={0.6} />
            </mesh>
            <mesh position={[-0.2, 0, 0]}>
              <boxGeometry args={[0.04, 0.003, 0.025]} />
              <meshStandardMaterial color={i < 2 ? '#EF4444' : '#F8FAFC'} transparent opacity={0.6} />
            </mesh>
            {/* Hub */}
            <mesh>
              <cylinderGeometry args={[0.012, 0.012, 0.01, 8]} />
              <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.3} />
            </mesh>
          </group>

          {/* Arm LED */}
          <mesh position={[pos[0], -0.025, pos[2]]}>
            <sphereGeometry args={[0.01, 8, 8]} />
            <meshStandardMaterial
              color={i < 2 ? '#EF4444' : '#22C55E'}
              emissive={i < 2 ? '#EF4444' : '#22C55E'}
              emissiveIntensity={0.5}
            />
          </mesh>
        </group>
      ))}

      {/* === SENSOR ANTENNAS === */}
      {/* WiFi antenna */}
      <mesh position={[0.12, 0.08, -0.12]} rotation={[0.2, 0, 0.1]}>
        <cylinderGeometry args={[0.005, 0.005, 0.08, 6]} />
        <meshStandardMaterial color="#94A3B8" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0.12, 0.125, -0.12]}>
        <sphereGeometry args={[0.008, 6, 6]} />
        <meshStandardMaterial color="#64748B" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Ground({ altitude }) {
  const y = -(altitude || 0) * 0.1 - 2;
  const gridRef = useRef();

  return (
    <group position={[0, Math.max(y, -5), 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 20, 40, 40]} />
        <meshStandardMaterial color="#CBD5E1" wireframe transparent opacity={0.2} />
      </mesh>
      {/* Solid subtle ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#F1F5F9" transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

function AltitudeBar({ altitude, target }) {
  return (
    <group position={[2.2, 0, 0]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.08, 4, 0.08]} />
        <meshStandardMaterial color="#CBD5E1" transparent opacity={0.2} />
      </mesh>
      <mesh position={[0, Math.min((altitude || 0) / 5, 2) - 2, 0]}>
        <boxGeometry args={[0.15, 0.04, 0.15]} />
        <meshStandardMaterial color="#0891B2" emissive="#0891B2" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0, Math.min((target || 10) / 5, 2) - 2, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.02]} />
        <meshStandardMaterial color="#D97706" emissive="#D97706" emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

export default function Drone3DPanel({ state }) {
  const roll = state?.roll || 0;
  const pitch = state?.pitch || 0;
  const yaw = state?.yaw || 0;
  const altitude = state?.altitude_agl || 0;
  const target = state?.target_altitude || 10;
  const motors = state?.motor || [0, 0, 0, 0];

  return (
    <div className="relative overflow-hidden border border-slate-200/60 rounded-md"
         data-testid="drone-3d-panel"
         style={{ height: '100%', minHeight: '200px', background: '#F8FAFC' }}>
      <div className="absolute top-2 left-3 z-10">
        <h3 className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">3D View</h3>
      </div>

      <div className="absolute top-2 right-3 z-10 text-right">
        <div className="text-[9px] text-slate-400">ALT</div>
        <div className="text-sm font-bold text-cyan-700 tabular-nums">
          {altitude.toFixed(1)}<span className="text-[9px] text-slate-400 ml-0.5">m</span>
        </div>
      </div>

      <div className="absolute bottom-2 left-3 z-10 flex gap-1.5">
        {motors.map((m, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-3 h-8 bg-slate-200/60 rounded-sm overflow-hidden border border-slate-300/50 relative">
              <div className={`absolute bottom-0 w-full transition-all duration-200 ${
                m > 0.6 ? 'bg-cyan-500' : m > 0.3 ? 'bg-emerald-500' : m > 0 ? 'bg-amber-500' : 'bg-slate-300'
              }`} style={{ height: `${m * 100}%` }} />
            </div>
            <span className="text-[7px] text-slate-400 mt-0.5">M{i + 1}</span>
          </div>
        ))}
      </div>

      <div className="absolute bottom-2 right-3 z-10 text-[8px] text-slate-400 text-right space-y-0">
        <div>R <span className="text-slate-500 tabular-nums">{roll.toFixed(1)}</span></div>
        <div>P <span className="text-slate-500 tabular-nums">{pitch.toFixed(1)}</span></div>
        <div>Y <span className="text-slate-500 tabular-nums">{yaw.toFixed(0)}</span></div>
      </div>

      <Canvas
        camera={{ position: [2.5, 1.8, 2.5], fov: 45 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <color attach="background" args={['#F8FAFC']} />
        <fog attach="fog" args={['#F8FAFC', 8, 20]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 8, 5]} intensity={1.0} color="#F8FAFC" castShadow />
        <directionalLight position={[-3, 4, -3]} intensity={0.4} color="#E0F2FE" />
        <pointLight position={[0, 2, 0]} intensity={0.3} color="#0EA5E9" />
        <hemisphereLight intensity={0.3} color="#F0F9FF" groundColor="#E2E8F0" />

        <DroneModel roll={roll} pitch={pitch} yaw={yaw} motors={motors} altitude={altitude} />
        <Ground altitude={altitude} />
        <AltitudeBar altitude={altitude} target={target} />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.5}
          autoRotate={false}
        />
      </Canvas>
    </div>
  );
}
