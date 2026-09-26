precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform int uShape;
uniform float uOutline;
uniform vec3 uInnerColor;
uniform float uGlow;
uniform float uComplexity;
uniform float uSymmetry;
uniform float uWarp;

#define PI 3.14159265359

// Signed Distance Field (SDF) 2D primitive helpers
float sdCircle(vec2 p, float r) {
    return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdEquilateralTriangle(vec2 p, float r) {
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

float sdStar(vec2 p, float r, int n, float m) {
    float an = PI / float(n);
    float en = PI / m;
    vec2 acs = vec2(cos(an), sin(an));
    vec2 ecs = vec2(cos(en), sin(en));

    float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
    p = length(p) * vec2(cos(bn), abs(sin(bn)));
    p -= r * acs;
    p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
    return length(p) * sign(p.x);
}

void main() {
    // Normalized centered UV coordinates [-1, 1] corrected for aspect ratio
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);

    // 1. Symmetry fold
    if (uSymmetry > 1.0) {
        float angle = atan(uv.y, uv.x);
        float r = length(uv);
        float sector = (2.0 * PI) / floor(uSymmetry);
        angle = mod(angle + 0.5 * sector, sector) - 0.5 * sector;
        angle = abs(angle);
        uv = vec2(cos(angle), sin(angle)) * r;
    }

    // 2. Domain Warp
    if (uWarp > 0.001) {
        float warpSpeed = uTime * 0.8;
        vec2 warpOffset = vec2(
            sin(uv.y * 7.0 + warpSpeed) + cos(uv.x * 4.0 - warpSpeed * 0.5),
            cos(uv.x * 7.0 - warpSpeed) + sin(uv.y * 4.0 + warpSpeed * 0.5)
        ) * (uWarp * 0.12);
        uv += warpOffset;
    }

    // 3. Complexity harmonics
    float harmonicMod = 0.0;
    float theta = atan(uv.y, uv.x);
    for (float i = 1.0; i <= 8.0; i += 1.0) {
        if (i > uComplexity) break;
        harmonicMod += sin(theta * (i * 2.0) + uTime * (0.6 * i)) / (i * 2.5);
    }
    float complexityScale = (uComplexity / 8.0) * 0.08;

    // 4. Shape Selection
    float d = 0.0;
    float baseRadius = 0.32;

    if (uShape == 0) {
        // Circle / Pulsing Orb
        d = sdCircle(uv, baseRadius + harmonicMod * complexityScale);
    } else if (uShape == 1) {
        // Star / Polygon
        int points = int(clamp(floor(uSymmetry > 2.0 ? uSymmetry : 5.0), 3.0, 10.0));
        d = sdStar(uv, baseRadius, points, 3.0 + uComplexity * 0.5) + harmonicMod * complexityScale;
    } else if (uShape == 2) {
        // Ring / Torus Slice
        float ringThick = 0.04 + (1.0 - uOutline) * 0.05;
        d = abs(sdCircle(uv, baseRadius + harmonicMod * complexityScale)) - ringThick;
    } else if (uShape == 3) {
        // Lotus / Mandala Flower
        float petals = max(3.0, floor(uSymmetry));
        float flowerR = baseRadius + sin(theta * petals + uTime * 0.5) * 0.1 * (1.0 + uComplexity * 0.3);
        d = length(uv) - flowerR + harmonicMod * complexityScale;
    } else {
        // Rounded Square / Crystal
        d = sdBox(uv, vec2(baseRadius * 0.75)) - 0.06 + harmonicMod * complexityScale;
    }

    // 5. Coloring: Inner Fill + Outline + Glow
    float shapeMask = smoothstep(0.005, -0.005, d);
    vec3 inner = uInnerColor * shapeMask;

    // Outline band
    float outlineWidth = max(0.002, uOutline * 0.035);
    float outlineMask = smoothstep(outlineWidth, 0.0, abs(d));
    vec3 outlineColor = mix(vec3(1.0), uInnerColor * 1.5, 0.4);
    vec3 stroke = outlineColor * outlineMask;

    // Outer and Inner Glow
    float glowDist = abs(d);
    float glowIntensity = (uGlow * 0.03) / (glowDist + 0.015);
    vec3 glowColor = mix(uInnerColor, vec3(0.0, 1.0, 0.8), 0.3) * glowIntensity;

    vec3 finalColor = inner + stroke + glowColor;

    gl_FragColor = vec4(finalColor, 1.0);
}
