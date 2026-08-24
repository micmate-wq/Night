import React, { useState, useRef } from 'react';

const INITIAL_NODES = [
  { id: 1, label: 'Track 1', x: 100, y: 100, color: '#4fc3f7' },
  { id: 2, label: 'Track 2', x: 300, y: 100, color: '#81c784' },
  { id: 3, label: 'Track 3', x: 100, y: 300, color: '#ffb74d' },
  { id: 4, label: 'Track 4', x: 300, y: 300, color: '#ba68c8' },
];

export default function GravityMixer() {
  const [nodes, setNodes] = useState(INITIAL_NODES);
  const [draggingId, setDraggingId] = useState(null);
  const svgRef = useRef(null);

  const getSvgCoordinates = (e) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 400;
    const y = ((e.clientY - rect.top) / rect.height) * 400;
    return {
      x: Math.max(30, Math.min(370, x)),
      y: Math.max(30, Math.min(370, y)),
    };
  };

  const handlePointerDown = (id, e) => {
    e.target.setPointerCapture(e.pointerId);
    setDraggingId(id);
  };

  const handlePointerMove = (e) => {
    if (draggingId === null) return;
    const { x, y } = getSvgCoordinates(e);
    setNodes((prev) =>
      prev.map((node) => (node.id === draggingId ? { ...node, x, y } : node))
    );
  };

  const handlePointerUp = (e) => {
    if (draggingId !== null) {
      if (e.target.hasPointerCapture && e.target.hasPointerCapture(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId);
      }
      setDraggingId(null);
    }
  };

  return (
    <div className="gravity-mixer-container">
      <svg
        ref={svgRef}
        viewBox="0 0 400 400"
        className="mixer-canvas"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Subtle Grid Lines */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="#242424"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="400" height="400" fill="url(#grid)" />
        <line x1="200" y1="0" x2="200" y2="400" stroke="#333333" strokeWidth="1.5" strokeDasharray="4 4" />
        <line x1="0" y1="200" x2="400" y2="200" stroke="#333333" strokeWidth="1.5" strokeDasharray="4 4" />
        <circle cx="200" cy="200" r="100" fill="none" stroke="#262626" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx="200" cy="200" r="160" fill="none" stroke="#202020" strokeWidth="1" strokeDasharray="3 3" />

        {/* Draggable Track Nodes */}
        {nodes.map((node) => (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            onPointerDown={(e) => handlePointerDown(node.id, e)}
            style={{ cursor: 'grab', touchAction: 'none' }}
          >
            <circle
              r="26"
              fill={node.color}
              fillOpacity={draggingId === node.id ? 0.9 : 0.75}
              stroke="#ffffff"
              strokeWidth={draggingId === node.id ? 2.5 : 1.5}
            />
            <text
              textAnchor="middle"
              dy="4"
              fill="#000000"
              fontSize="11"
              fontWeight="600"
              style={{ userSelect: 'none', pointerEvents: 'none' }}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
