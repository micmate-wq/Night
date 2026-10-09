import React from 'react';
import GravityMixer from './components/GravityMixer';
import DropZone from './components/DropZone';

export default function App() {
  return (
    <div className="mobile-shell">
      <main className="app-container">
        <section className="section-mixer">
          <GravityMixer />
        </section>
        <section className="section-dropzone">
          <DropZone />
        </section>
      </main>
    </div>
  );
}
