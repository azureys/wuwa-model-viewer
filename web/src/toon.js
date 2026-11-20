// Cel-shading materials for the characters: a toon body shader that reacts to every
// light in the scene (directional, point, spot, hemisphere, ambient) and an inverted-hull outline.
import * as THREE from 'three';

// Shared, scene-wide settings the UI can change live.
export const toonGlobals = {
  uOutlineScale: { value: 1.0 },
  uOutlineOn: { value: 1.0 },
  uRimStrength: { value: 0.6 },
  uShadowSoft: { value: 1.0 },
  uSelfShadow: { value: 0.0 },
  uSpecStrength: { value: 1.0 },
  uSaturation: { value: 1.0 },
  uExposure: { value: 1.0 },
  uHighlight: { value: -1.0 }, // section/island highlight for the pick tool
};

const vertexCommon = /* glsl */`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec4 vcol;
attribute float hide;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vHide;
varying vec4 vCol;
`;

const toonVertex = /* glsl */`
${vertexCommon}
void main() {
  vUv = uv;
  vHide = hide;
  vCol = vcol;
  #include <morphinstance_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vNormalV = normalize(transformedNormal);
  vViewPos = -mvPosition.xyz;
}
`;

const toonFragment = /* glsl */`
#include <common>
#include <packing>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
uniform sampler2D map;
uniform sampler2D maskMap;
uniform vec3 uTint;
uniform vec3 uShadowTint;
uniform float uThreshold;
uniform float uSoftness;
uniform int uAlphaMode;     // 0 opaque, 1 masked, 2 blended
uniform float uAlphaCut;
uniform float uOpacity;
uniform int uKind;          // 0 common, 1 hair, 2 face, 3 eye, 4 effect
uniform float uHasMask;
uniform float uSpecPower;
uniform float uSectionId;
uniform float uOutlineScale;
uniform float uRimStrength;
uniform float uShadowSoft;
uniform float uSelfShadow;
uniform float uSpecStrength;
uniform float uSaturation;
uniform float uExposure;
uniform float uHighlight;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vHide;
varying vec4 vCol;

float toonStep(float ndl) {
  float h = ndl * 0.5 + 0.5;
  float w = max(uSoftness * uShadowSoft, 0.001);
  return smoothstep(uThreshold - w, uThreshold + w, h);
}

void main() {
  if (vHide > 0.5) discard;
  vec4 tex = texture2D(map, vUv);
  vec3 albedo = tex.rgb * uTint;
  float alpha = 1.0;
  if (uAlphaMode == 1) { if (tex.a < uAlphaCut) discard; }
  else if (uAlphaMode == 2) { alpha = clamp(tex.a * uOpacity, 0.0, 1.0); }

  vec3 N = normalize(vNormalV);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vViewPos);
  vec3 geometryPosition = -vViewPos;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 4.0);

  vec3 tint = uShadowTint;
  vec3 lightSum = ambientLightColor * tint;
  vec3 spec = vec3(0.0);
  vec3 rim = vec3(0.0);
  vec4 mask = uHasMask > 0.5 ? texture2D(maskMap, vUv) : vec4(0.0);
  IncidentLight directLight;

  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) {
    lightSum += getHemisphereLightIrradiance(hemisphereLights[i], N) * tint;
  }
  #endif

  #define TOON_ACCUM(L, C) { \\
    float ndl = dot(N, L); \\
    float s = toonStep(ndl); \\
    if (uKind == 2) s = smoothstep(-0.55, 0.35, ndl) * 0.85 + 0.15; \\
    lightSum += C * s * (vec3(1.0) - tint); \\
    vec3 H = normalize(L + V); \\
    float nh = max(dot(N, H), 0.0); \\
    if (uKind == 1) spec += C * s * mask.r * smoothstep(0.55, 0.9, nh) * 0.6 * uSpecStrength; \\
    else if (uKind == 0) spec += C * s * pow(nh, uSpecPower) * 0.12 * uSpecStrength; \\
    rim += C * fres * smoothstep(-0.2, 0.6, ndl) * smoothstep(-0.5, 0.2, -dot(L, V) * 0.5 + ndl * 0.5); \\
  }

  #if NUM_DIR_LIGHTS > 0
  DirectionalLight directionalLight;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow directionalLightShadow;
  #endif
  #pragma unroll_loop_start
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
    directionalLight = directionalLights[ i ];
    getDirectionalLightInfo(directionalLight, directLight);
    #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
    directionalLightShadow = directionalLightShadows[ i ];
    if (uSelfShadow > 0.5) directLight.color *= getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );
    #endif
    TOON_ACCUM(directLight.direction, directLight.color)
  }
  #pragma unroll_loop_end
  #endif

  #if NUM_POINT_LIGHTS > 0
  PointLight pointLight;
  #pragma unroll_loop_start
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    pointLight = pointLights[ i ];
    getPointLightInfo(pointLight, geometryPosition, directLight);
    TOON_ACCUM(directLight.direction, directLight.color)
  }
  #pragma unroll_loop_end
  #endif

  #if NUM_SPOT_LIGHTS > 0
  SpotLight spotLight;
  #pragma unroll_loop_start
  for (int i = 0; i < NUM_SPOT_LIGHTS; i++) {
    spotLight = spotLights[ i ];
    getSpotLightInfo(spotLight, geometryPosition, directLight);
    TOON_ACCUM(directLight.direction, directLight.color)
  }
  #pragma unroll_loop_end
  #endif

  vec3 color;
  if (uKind == 3 || uKind == 4) {
    // Eyes and effects: mostly self-lit
    float l = dot(lightSum, vec3(0.333));
    color = albedo * mix(1.0, clamp(l, 0.0, 1.6), 0.35);
  } else {
    // lit areas reach the full albedo, unlit areas fall to albedo * shadow tint
    color = albedo * lightSum;
  }
  color += spec * mix(albedo, vec3(1.0), 0.5);
  color += rim * uRimStrength * mix(albedo, vec3(1.0), 0.35) * 0.5;

  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(luma), color, uSaturation) * uExposure;
  if (uHighlight >= 0.0 && abs(uHighlight - uSectionId) < 0.5) color = mix(color, vec3(1.0, 0.35, 0.6), 0.45);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const outlineVertex = /* glsl */`
${vertexCommon}
attribute vec3 olNormal;
uniform float uWidth;
uniform float uOutlineScale;
uniform float uOutlineOn;
void main() {
  vUv = uv;
  vHide = hide;
  vCol = vcol;
  #include <morphinstance_vertex>
  vec3 objectNormal = olNormal;
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec3 nV = normalize(normalMatrix * objectNormal);
  float w = uWidth * uOutlineScale * uOutlineOn * vcol.g * 0.0011 * clamp(-mvPosition.z, 0.4, 5.0);
  mvPosition.xyz += nV * w;
  gl_Position = projectionMatrix * mvPosition;
  vViewPos = -mvPosition.xyz;
  vNormalV = nV;
  if (uOutlineOn < 0.5 || vcol.g < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const outlineFragment = /* glsl */`
#include <common>
uniform sampler2D map;
uniform float uUseMap;
uniform vec3 uColor;
uniform vec3 uColorTint;
uniform float uExposure;
varying vec2 vUv;
varying float vHide;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec4 vCol;
void main() {
  if (vHide > 0.5) discard;
  vec3 c = uUseMap > 0.5 ? texture2D(map, vUv).rgb * uColorTint : uColor;
  gl_FragColor = vec4(c * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const toLinear = (c) => (c ? new THREE.Color().setRGB(c.R, c.G, c.B, THREE.LinearSRGBColorSpace) : null);
const clampColor = (c, max = 1) => new THREE.Color(Math.min(c.r, max), Math.min(c.g, max), Math.min(c.b, max));

export function classifyMaterial(name, mat) {
  const model = mat?.raw?.Properties?.BasePropertyOverrides?.ShadingModel ?? '';
  if (/ToonHair/i.test(model) || /hair|bangs/i.test(name)) return 1;
  if (/eye/i.test(name)) return 3;
  if (/ToonFace/i.test(model) || /face/i.test(name)) return 2;
  if (!/Toon/i.test(model) && mat && (mat.blendMode === 2 || mat.blendMode === 3)) return 4;
  return 0;
}

export function makeToonMaterial({ name, mat, map, maskMap, sectionId }) {
  const kind = classifyMaterial(name, mat);
  const scal = mat?.scalars ?? {};
  const cols = mat?.colors ?? {};
  const blendStr = mat?.raw?.Properties?.BasePropertyOverrides?.BlendMode ?? '';
  let alphaMode = 0;
  if (mat?.blendMode === 1 || /Masked/i.test(blendStr)) alphaMode = 1;
  if (mat?.blendMode === 2 || mat?.blendMode === 3 || /Translucent|Additive/i.test(blendStr)) alphaMode = 2;
  const sub = toLinear(kind === 2 ? (cols.SkinSubsurfaceColor ?? cols.SubsurfaceColor) : cols.SubsurfaceColor);
  const shadowTint = sub ? clampColor(sub).lerp(new THREE.Color(1, 1, 1), 0.15) : new THREE.Color(0.72, 0.72, 0.8);
  const tintC = toLinear(cols.BaseColorTint);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {
    map: { value: map },
    maskMap: { value: maskMap ?? null },
    uHasMask: { value: maskMap ? 1 : 0 },
    uTint: { value: tintC ? clampColor(tintC, 1.5) : new THREE.Color(1, 1, 1) },
    uShadowTint: { value: shadowTint },
    uThreshold: { value: Math.min(Math.max((scal.ShadowProcess ?? 0.55) * 0.9, 0.2), 0.8) },
    uSoftness: { value: Math.min(Math.max(scal.ShadowWidth ?? 0.08, 0.02), 0.25) },
    uAlphaMode: { value: alphaMode },
    uAlphaCut: { value: mat?.raw?.Properties?.BasePropertyOverrides?.OpacityMaskClipValue ?? 0.33 },
    uOpacity: { value: scal.OpacityIntensity ?? 1 },
    uKind: { value: kind },
    uSpecPower: { value: Math.max(scal.SpecularPower ?? 12, 2) * 3 },
    uSectionId: { value: sectionId },
  }]);
  // UniformsUtils.merge clones textures; put the shared originals back.
  uniforms.map.value = map;
  uniforms.maskMap.value = maskMap ?? null;
  Object.assign(uniforms, toonGlobals);
  const m = new THREE.ShaderMaterial({
    name, uniforms, vertexShader: toonVertex, fragmentShader: toonFragment, lights: true,
    side: THREE.DoubleSide, transparent: alphaMode === 2, depthWrite: alphaMode !== 2,
  });
  if (alphaMode === 2 && /Additive/i.test(blendStr)) m.blending = THREE.AdditiveBlending;
  m.userData.kind = kind;
  return m;
}

export function makeOutlineMaterial({ name, ol, map, albedoMap }) {
  const cols = ol?.colors ?? {};
  const scal = ol?.scalars ?? {};
  const useMap = !!(ol?.switches?.UseMainTex && map);
  const base = toLinear(cols.OutlineColor) ?? new THREE.Color(0.08, 0.06, 0.07);
  const tint = toLinear(cols.OutlineColorTint) ?? new THREE.Color(0.75, 0.75, 0.75);
  const width = ol ? (scal.OutlineClipWidth ?? 1) : 0.8;
  const m = new THREE.ShaderMaterial({
    name: name + '_outline',
    uniforms: {
      map: { value: useMap ? map : albedoMap },
      uUseMap: { value: useMap || (!ol && albedoMap) ? 1 : 0 },
      uColor: { value: base },
      uColorTint: { value: useMap ? tint : new THREE.Color(0.35, 0.3, 0.32) },
      uWidth: { value: width },
      uOutlineScale: toonGlobals.uOutlineScale,
      uOutlineOn: toonGlobals.uOutlineOn,
      uExposure: toonGlobals.uExposure,
    },
    vertexShader: outlineVertex, fragmentShader: outlineFragment, side: THREE.BackSide,
  });
  m.userData.baseWidth = width;
  return m;
}
