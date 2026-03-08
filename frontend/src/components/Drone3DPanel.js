import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

function DroneModel({ roll, pitch, yaw, motors, altitude }) {
  const groupRef = useRef();
  const propRefs = [useRef(), useRef(), useRef(), useRef()];

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
  });

  const armLength = 0.6;
  const armPositions = [
    [armLength, 0, armLength],
    [-armLength, 0, armLength],
    [-armLength, 0, -armLength],
    [armLength, 0, -armLength],
  ];

  const motorColors = useMemo(() => 
    (motors || [0,0,0,0]).map(m => {
      if (m > 0.6) return '#00F0FF';
      if (m > 0.3) return '#10B981';
      if (m > 0) return '#F59E0B';
      return '#374151';
    }), [motors]);

  return (
    <group ref={groupRef}>
      {/* Center body */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.3, 0.08, 0.3]} />
        <meshStandardMaterial color="#1E293B" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Body top plate */}
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[0.25, 0.02, 0.25]} />
        <meshStandardMaterial color="#0EA5E9" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Front indicator */}
      <mesh position={[0, 0.02, 0.2]}>
        <boxGeometry args={[0.04, 0.04, 0.08]} />
        <meshStandardMaterial color="#EF4444" emissive="#EF4444" emissiveIntensity={0.5} />
      </mesh>

      {/* Arms + Motors + Props */}
      {armPositions.map((pos, i) => (
        <group key={i}>
          {/* Arm */}
          <mesh position={[pos[0] / 2, 0, pos[2] / 2]} 
                rotation={[0, Math.atan2(pos[0], pos[2]), 0]}>
            <boxGeometry args={[0.06, 0.04, armLength * 1.1]} />
            <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Motor housing */}
          <mesh position={pos}>
            <cylinderGeometry args={[0.06, 0.08, 0.06, 8]} />
            <meshStandardMaterial color={motorColors[i]} metalness={0.6} roughness={0.3}
              emissive={motorColors[i]} emissiveIntensity={(motors?.[i] || 0) * 0.3} />
          </mesh>
          {/* Propeller */}
          <group ref={propRefs[i]} position={[pos[0], 0.06, pos[2]]}>
            <mesh>
              <boxGeometry args={[0.4, 0.005, 0.04]} />
              <meshStandardMaterial color="#94A3B8" transparent opacity={0.6} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

function Ground({ altitude }) {
  const y = -(altitude || 0) * 0.1 - 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Math.max(y, -5), 0]}>
      <planeGeometry args={[20, 20, 20, 20]} />
      <meshStandardMaterial color="#0F172A" wireframe transparent opacity={0.3} />
    </mesh>
  );
}

function AltitudeBar({ altitude, target }) {
  return (
    <group position={[2.2, 0, 0]}>
      {/* Bar background */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.08, 4, 0.08]} />
        <meshStandardMaterial color="#1E293B" transparent opacity={0.3} />
      </mesh>
      {/* Current altitude marker */}
      <mesh position={[0, Math.min((altitude || 0) / 5, 2) - 2, 0]}>
        <boxGeometry args={[0.15, 0.04, 0.15]} />
        <meshStandardMaterial color="#00F0FF" emissive="#00F0FF" emissiveIntensity={0.5} />
      </mesh>
      {/* Target altitude marker */}
      <mesh position={[0, Math.min((target || 10) / 5, 2) - 2, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.02]} />
        <meshStandardMaterial color="#F59E0B" emissive="#F59E0B" emissiveIntensity={0.3} />
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
  const motors = state?.motor || [0,0,0,0];

  return (
    <div className="panel-glass relative corner-bracket overflow-hidden" data-testid="drone-3d-panel"
         style={{ height: '100%', minHeight: '200px' }}>
      <div className="absolute top-2 left-3 z-10">
        <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">3D View</h3>
      </div>

      {/* Altitude overlay */}
      <div className="absolute top-2 right-3 z-10 text-right">
        <div className="text-[9px] text-slate-600">ALT</div>
        <div className="text-sm font-bold text-[#00F0FF] tabular-nums glow-text">
          {altitude.toFixed(1)}<span className="text-[9px] text-slate-500 ml-0.5">m</span>
        </div>
      </div>

      {/* Motor indicators */}
      <div className="absolute bottom-2 left-3 z-10 flex gap-1.5">
        {motors.map((m, i) => (
          <div key={i} className="flex flex-col items-center">
            <div className="w-3 h-8 bg-black/40 rounded-sm overflow-hidden border border-[#1E293B]/50 relative">
              <div className={`absolute bottom-0 w-full transition-all duration-200 ${
                m > 0.6 ? 'bg-[#00F0FF]' : m > 0.3 ? 'bg-emerald-500' : m > 0 ? 'bg-amber-400' : 'bg-slate-700'
              }`} style={{ height: `${m * 100}%` }} />
            </div>
            <span className="text-[7px] text-slate-600 mt-0.5">M{i+1}</span>
          </div>
        ))}
      </div>

      {/* Attitude numbers */}
      <div className="absolute bottom-2 right-3 z-10 text-[8px] text-slate-600 text-right space-y-0">
        <div>R <span className="text-slate-400 tabular-nums">{roll.toFixed(1)}</span></div>
        <div>P <span className="text-slate-400 tabular-nums">{pitch.toFixed(1)}</span></div>
        <div>Y <span className="text-slate-400 tabular-nums">{yaw.toFixed(0)}</span></div>
      </div>

      <Canvas
        camera={{ position: [2.5, 1.8, 2.5], fov: 45 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} color="#E2E8F0" />
        <pointLight position={[0, 2, 0]} intensity={0.4} color="#00F0FF" />

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
