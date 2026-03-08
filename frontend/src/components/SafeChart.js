import { useState, useEffect } from 'react';
import { ResponsiveContainer } from 'recharts';

export default function SafeChart({ children, height = '100%', minHeight = 1 }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div style={{ width: '100%', height, minHeight }}>
      {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
