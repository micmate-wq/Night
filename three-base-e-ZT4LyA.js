import {
  ShaderMaterial,
  UniformsUtils,
  Vector2,
  WebGLRenderTarget,
  HalfFloatType,
  NormalBlending,
  Color,
  Vector3,
  AdditiveBlending,
  MeshBasicMaterial,
  RawShaderMaterial,
  ColorManagement,
  SRGBTransfer,
  LinearToneMapping,
  ReinhardToneMapping,
  CineonToneMapping,
  ACESFilmicToneMapping,
  AgXToneMapping,
  NeutralToneMapping,
  CustomToneMapping
} from 'https://unpkg.com/three@0.165.0/build/three.module.js';

class Timer {
  constructor() {
    this._previousTime = performance.now();
    this._delta = 0;
  }
  update() {
    const now = performance.now();
    this._delta = (now - this._previousTime) / 1000;
    this._previousTime = now;
  }
  getDelta() {
    return this._delta;
  }
}

export {
  ShaderMaterial as e,
  UniformsUtils as U,
  Vector2 as V,
  WebGLRenderTarget as W,
  HalfFloatType as H,
  NormalBlending as N,
  Timer as f,
  Color as C,
  Vector3 as g,
  AdditiveBlending as A,
  MeshBasicMaterial as M,
  RawShaderMaterial as R,
  ColorManagement as h,
  SRGBTransfer as i,
  LinearToneMapping as L,
  ReinhardToneMapping as j,
  CineonToneMapping as k,
  ACESFilmicToneMapping as l,
  AgXToneMapping as m,
  NeutralToneMapping as n,
  CustomToneMapping as o
};
