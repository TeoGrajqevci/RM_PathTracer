// shaders.js
// Exporting all shader source codes

//
// 1) Vertex Shader
//
export const vertexShaderSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

//
// 2) Path Tracer Fragment Shader
//
export const pathTracerFS = `#version 300 es
precision highp float;

// --------------------------------------------------------------------------------------
// VARYINGS
// --------------------------------------------------------------------------------------
in vec2 v_uv;
out vec4 outColor;

// --------------------------------------------------------------------------------------
// UNIFORMS
// --------------------------------------------------------------------------------------
uniform float u_time;
uniform int   u_frameCount;
uniform vec2  u_resolution;
uniform vec4  u_randomSeed;

// Camera
uniform vec3  u_cameraPos;
uniform vec3  u_cameraRot;
uniform float u_cameraFov;

// Depth of field
uniform float u_cameraAperture;       // Aperture diameter
uniform float u_cameraFocusDistance;  // Focus plane distance

// Lens + vignette + chromatic aberration
uniform vec2  u_lensDistortionK;      // primary radial distortion factors (k1, k2)
uniform float u_chromaticAberration;  // how much channels separate
uniform float u_vignetteStrength;     // how quickly corners darken

// Light
uniform vec3  u_lightPos;
uniform vec2  u_lightSize;
uniform float u_lightIntensity;
uniform vec3  u_lightColor;
uniform vec3  u_lightRot; 

uniform vec3 u_ambientLightColor;
uniform float u_ambientLightIntensity;

// Sphere #1
uniform vec3  u_spherePos;
uniform float u_sphereRadius;
uniform vec3  u_sphereAlbedo;
uniform float u_sphereRoughness;
uniform float u_sphereMetalness;
uniform vec3  u_sphereEmissive;

// Subsurface for sphere #1
uniform float u_sphereSubsurface;         
uniform float u_sphereSubsurfaceRadius;  
uniform vec3  u_sphereSubsurfaceColor;    
uniform int   u_sphereSubsurfaceType;     

// Sphere #2
uniform vec3  u_sphere02Pos;
uniform float u_sphere02Radius;
uniform vec3  u_sphere02Albedo;
uniform float u_sphere02Roughness;
uniform float u_sphere02Metalness;
uniform vec3  u_sphere02Emissive;

// Subsurface for sphere #2
uniform float u_sphere02Subsurface;       
uniform float u_sphere02SubsurfaceRadius; 
uniform vec3  u_sphere02SubsurfaceColor;  
uniform int   u_sphere02SubsurfaceType;   

// --------------------------------------------------------------------------------------
// VOLUME (PARTICIPATING MEDIA) UNIFORMS
// --------------------------------------------------------------------------------------
uniform float u_volumeSigmaA;   // absorption coefficient
uniform float u_volumeSigmaS;   // scattering coefficient
uniform float u_volumeG;        // Henyey-Greenstein phase g parameter (-1..1)
uniform vec3  u_volumeAlbedo;   // color tint for scattering
uniform vec3  u_volumeEmission; // emissive (e.g., if the volume glows)

const vec3  u_volumeMin = vec3(-10.0, -1.0, -10.0); // bounding box min
const vec3  u_volumeMax = vec3( 10.0,  5.0,  10.0); // bounding box max
const bool  u_enableVolume = true;   // whether volume is active

// --------------------------------------------------------------------------------------
// CONSTANTS
// --------------------------------------------------------------------------------------
const int   MAX_BOUNCES = 8;
const float EPSILON     = 0.00001;
const float M_PI        = 3.14159265358979323846;

// Camera
const vec3  camTarget = vec3(0.0, 0.0, 0.0);
const vec3  camUp     = vec3(0.0, 1.0, 0.0);

// --------------------------------------------------------------------------------------
// MATERIAL STRUCT
// --------------------------------------------------------------------------------------
struct Material {
    vec3  albedo;
    float roughness;
    float metalness;
    float ior;
    float transmission;
    float subsurface;
    float subsurfaceRadius;
    vec3  subsurfaceColor;
    int   subsurfaceType;
    float anisotropy;
    vec3  emission;
};

Material sphereMat = Material(
    vec3(0.9, 0.0, 0.0),
    0.1,
    0.0,
    1.5,
    0.0,
    0.0,
    0.0,
    vec3(0.0),
    0,
    0.0,
    vec3(0.0)
);

Material sphereMat2 = Material(
    vec3(0.0, 0.0, 0.9),
    0.1,
    0.0,
    1.5,
    0.0,
    0.0,
    0.0,
    vec3(0.0),
    0,
    0.0,
    vec3(0.0)
);

Material planeMat = Material(
    vec3(0.8, 0.8, 0.8),
    0.5,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    vec3(0.0),
    0,
    0.0,
    vec3(0.0)
);

// --------------------------------------------------------------------------------------
// PRNG (hash-based) 
// --------------------------------------------------------------------------------------
uint hash_uvec4(uvec4 x) {
    x = (x ^ (x >> 17U)) * 0xED5AD4BBU;
    x = (x ^ (x >> 11U)) * 0xAC4C1B51U;
    x = (x ^ (x >> 15U)) * 0x31848BABU;
    return x.x ^ x.y ^ x.z ^ x.w;
}

float random(inout uvec4 seed) {
    seed.x += 0x9E3779B9U;      // Knuth's constant
    seed = uvec4(hash_uvec4(seed));
    return float(seed.x) / 4294967295.0;
}

uvec4 seedFromVec4(vec4 v){
    return uvec4(
        floatBitsToUint(v.x),
        floatBitsToUint(v.y),
        floatBitsToUint(v.z),
        floatBitsToUint(v.w)
    );
}

// --------------------------------------------------------------------------------------
// CAMERA + ROTATION
// --------------------------------------------------------------------------------------
mat3 calcCameraMatrix(vec3 origin, vec3 target, vec3 up) {
    vec3 fw = normalize(target - origin);
    vec3 r  = normalize(cross(fw, up));
    vec3 u  = cross(r, fw);
    return mat3(r, u, fw);
}

mat3 rotationX(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(
        1.0, 0.0, 0.0,
        0.0, c,   -s,
        0.0, s,    c
    );
}

mat3 rotationY(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(
         c,  0.0,  s,
         0.0,1.0, 0.0,
        -s,  0.0,  c
    );
}

mat3 rotationZ(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat3(
         c, -s, 0.0,
         s,  c, 0.0,
        0.0,0.0,1.0
    );
}

// --------------------------------------------------------------------------------------
// SDF SCENE
// --------------------------------------------------------------------------------------
float sphere2SDF(vec3 p) {
    return length(p - u_spherePos) - u_sphereRadius;
}
float sphereSDF(vec3 p) {
    return length(p - u_sphere02Pos) - u_sphere02Radius;
}
float planeSDF(vec3 p) {
    return p.y + 1.0;
}

// Example round box
float roundBoxSDF(vec3 p, vec3 b, float r){
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// A fractal or something else
float mandelbulbSDF(vec3 p){
    vec3 z = p;
    float dr = 1.0;
    float r = 0.0;
    for(int i=0; i<5; i++){
        r = length(z);
        if(r>2.0) break;
        float theta = acos(z.z/r);
        float phi   = atan(z.y, z.x);
        dr = pow(r, 8.0)*8.0*dr + 1.0;

        float zr = pow(r, 8.0);
        theta = theta*8.0;
        phi   = phi*8.0;
        z = zr*vec3(sin(theta)*cos(phi), sin(phi)*sin(theta), cos(theta)) + p;
    }
    return 0.5*log(r)*r/dr;
}

float smin(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5*(d2 - d1)/k, 0.0, 1.0);
    return mix(d2, d1, h) - k*h*(1.0 - h);
}

// Scene composition
struct HitInfo {
    float dist;
    int   id;
    float blend;
};

struct SceneHit {
    bool hit;
    int  id;
    vec3 pos;
    vec3 normal;
    float blend;
};

HitInfo sceneSDF(vec3 p){
    // Smooth union of a roundBox and a sphere, then union with a plane
    float k  = 0.5;
    float s1 = roundBoxSDF(p - u_sphere02Pos, vec3(u_sphere02Radius), 0.3);
    float s2 = sphere2SDF(p);
    float d_smooth = smin(s1, s2, k);

    // blend factor
    float h = clamp(0.5 + 0.5*(s2 - s1)/k, 0.0, 1.0);

    // plane
    float sdPlane = planeSDF(p);

    float d     = d_smooth;
    int   id    = 1;
    float blend = h;

    if(sdPlane < d){
        d     = sdPlane;
        id    = 2;
        blend = 0.0;
    }

    HitInfo hi;
    hi.dist  = d;
    hi.id    = id;
    hi.blend = blend;
    return hi;
}

vec3 calcNormal(vec3 p){
    float h = 0.005;
    float d = sceneSDF(p).dist;
    vec3 n  = vec3(
        sceneSDF(p + vec3(h,0,0)).dist - d,
        sceneSDF(p + vec3(0,h,0)).dist - d,
        sceneSDF(p + vec3(0,0,h)).dist - d
    );
    return normalize(n);
}

SceneHit rayMarch(vec3 ro, vec3 rd){
    float t = 0.0;
    for(int i=0; i<256; i++){
        vec3 p = ro + rd*t;
        HitInfo h = sceneSDF(p);
        if(h.dist < EPSILON){
            SceneHit sh;
            sh.hit    = true;
            sh.id     = h.id;
            sh.pos    = p;
            sh.normal = calcNormal(p);
            sh.blend  = h.blend;
            return sh;
        }
        if(t>50.0) break;
        t += h.dist;
    }
    SceneHit nh;
    nh.hit = false;
    return nh;
}

// --------------------------------------------------------------------------------------
// MATERIALS
// --------------------------------------------------------------------------------------
Material getBlendedMaterial(float blend){
    Material m;
    m.albedo           = mix(u_sphereAlbedo,           u_sphere02Albedo,           blend);
    m.roughness        = mix(u_sphereRoughness,        u_sphere02Roughness,        blend);
    m.metalness        = mix(u_sphereMetalness,        u_sphere02Metalness,        blend);
    m.ior              = mix(sphereMat.ior,            sphereMat2.ior,             blend);
    m.transmission     = mix(sphereMat.transmission,   sphereMat2.transmission,    blend);
    m.subsurface       = mix(u_sphereSubsurface,       u_sphere02Subsurface,       blend);
    m.subsurfaceRadius = mix(u_sphereSubsurfaceRadius, u_sphere02SubsurfaceRadius, blend);
    m.subsurfaceColor  = mix(u_sphereSubsurfaceColor,  u_sphere02SubsurfaceColor,  blend);

    float tType = float(u_sphereSubsurfaceType)*(1.0-blend) + float(u_sphere02SubsurfaceType)*blend + 0.5;
    m.subsurfaceType = int(floor(tType));

    m.anisotropy = mix(sphereMat.anisotropy, sphereMat2.anisotropy, blend);
    m.emission   = mix(u_sphereEmissive,     u_sphere02Emissive,    blend);
    return m;
}

Material getMaterial(int id, float blend){
    if(id == 1){
        return getBlendedMaterial(blend);
    }
    else if(id == 2){
        return planeMat;
    }
    return sphereMat; // fallback
}

// --------------------------------------------------------------------------------------
// TANGENT FRAME
// --------------------------------------------------------------------------------------
void buildTangentFrame(vec3 N, out vec3 T, out vec3 B){
    if(abs(N.x) > abs(N.z)){
        T = vec3(-N.y, N.x, 0.0);
    } else {
        T = vec3(0.0, -N.z, N.y);
    }
    T = normalize(T);
    B = cross(N, T);
}

// --------------------------------------------------------------------------------------
// UTILS: FRESNEL & GGX
// --------------------------------------------------------------------------------------
vec3 fresnelSchlick(float cosTheta, vec3 F0){
    return F0 + (1.0 - F0)*pow(1.0 - cosTheta, 5.0);
}

float D_GGX(vec3 N, vec3 H, float r){
    float a  = r*r;
    float a2 = a*a;
    float NdotH = max(dot(N,H), 0.0);
    float denom = (NdotH*NdotH*(a2 - 1.0) + 1.0);
    return a2/(M_PI * denom * denom);
}

float G_SmithGGXCorrelated(float NdotV, float NdotL, float r){
    float k = (r+1.0)*(r+1.0)/8.0;
    float gv = NdotV/(NdotV*(1.0 - k)+k);
    float gl = NdotL/(NdotL*(1.0 - k)+k);
    return gv*gl;
}

// --------------------------------------------------------------------------------------
// IMPORTANCE SAMPLING
// --------------------------------------------------------------------------------------
vec3 sampleGGXHemisphere(vec3 N, float r, float r1, float r2){
    float a  = r*r;
    float phi = 2.0*M_PI*r1;
    float cosT = sqrt((1.0 - r2)/(1.0 + (a*a - 1.0)*r2));
    float sinT = sqrt(1.0 - cosT*cosT);
    vec3 T,B;
    buildTangentFrame(N,T,B);
    vec3 H = T*(cos(phi)*sinT) + B*(sin(phi)*sinT) + N*cosT;
    return normalize(H);
}

vec3 sampleHemisphereCosine(vec3 N, float r1, float r2){
    float phi  = 2.0*M_PI*r1;
    float cosT = sqrt(1.0 - r2);
    float sinT = sqrt(r2);
    vec3 T,B;
    buildTangentFrame(N,T,B);
    vec3 L = T*(cos(phi)*sinT) + B*(sin(phi)*sinT) + N*cosT;
    return normalize(L);
}

// --------------------------------------------------------------------------------------
// SUBSURFACE APPROX
// --------------------------------------------------------------------------------------
vec3 evalSubsurface(
    int   sssType,
    float subsurfaceWeight,
    float subsurfaceRadius,
    vec3  subsurfaceColor,
    vec3  N,
    vec3  L,
    vec3  V
){
    float ndl = dot(N,L);
    float ndv = dot(N,V);

    float pndl = clamp(ndl, 0.0, 1.0);
    float pndv = clamp(ndv, 0.0, 1.0);

    float sssFactor = 0.0;
    if(sssType == 0){
        // Exponential
        float scale = 3.0/(subsurfaceRadius+0.001);
        float f = pow(1.0 - pndl, scale)*pow(1.0 - pndv, scale);
        sssFactor = 0.2 * f;
    } else {
        // Gaussian
        float distL = abs(ndl)/(subsurfaceRadius+0.001);
        float distV = abs(ndv)/(subsurfaceRadius+0.001);
        float f = exp(-3.0*distL) * exp(-3.0*distV);
        sssFactor = 0.2 * f;
    }

    sssFactor *= subsurfaceWeight;
    return sssFactor * subsurfaceColor;
}

// --------------------------------------------------------------------------------------
// EVAL BSDF
// --------------------------------------------------------------------------------------
vec3 evalBSDF(Material mat, vec3 N, vec3 V, vec3 L, out float pdf){
    vec3 H      = normalize(L + V);
    float NdotL = max(dot(N,L), 0.0);
    float NdotV = max(dot(N,V), 0.0);
    float NdotH = max(dot(N,H), 0.0);
    float VdotH = max(dot(V,H), 0.0);

    // Base color
    vec3 baseColor = mat.albedo;
    vec3 F0 = mix(vec3(0.04), baseColor, mat.metalness);

    float diffW = (1.0 - mat.metalness)*(1.0 - mat.transmission);
    // Lambert
    vec3 diffuse = diffW * baseColor / M_PI;

    // GGX
    float D = D_GGX(N, H, mat.roughness);
    float G = G_SmithGGXCorrelated(NdotV, NdotL, mat.roughness);
    vec3  F = fresnelSchlick(VdotH, F0);
    vec3  spec = (D * G * F)/(3.0*NdotV*NdotL + 0.0001);

    // SSS
    vec3 sssLobe = vec3(0.0);
    if(mat.subsurface > 1e-5){
        sssLobe = evalSubsurface(
            mat.subsurfaceType,
            mat.subsurface,
            mat.subsurfaceRadius,
            mat.subsurfaceColor,
            N, L, V
        );
    }

    vec3 bsdf = diffuse + spec + sssLobe;

    // PDF
    float pdfDiffuse = diffW>0.0 ? (NdotL / M_PI) : 0.0;
    float pdfSpec    = (NdotH * D)/(4.0*VdotH + 0.0001);

    // Weighted approach
    float wD = 0.5;
    float wS = 0.5;
    pdf = wD*pdfDiffuse + wS*pdfSpec + 1e-8;

    return bsdf;
}

// --------------------------------------------------------------------------------------
// HELPER: CREATE LIGHT ROTATION + NORMAL
// --------------------------------------------------------------------------------------
mat3 buildLightRotation(vec3 rot){
    // You can choose to interpret rot in degrees or radians.
    // Here, we assume they are in radians:
    return rotationX(rot.x) * rotationY(rot.y) * rotationZ(rot.z);
}

// --------------------------------------------------------------------------------------
// AREA LIGHT
// --------------------------------------------------------------------------------------
float areaLightPDF(vec3 Lpos, vec3 hp, vec3 N){
    // 1) Compute the direction from hit point to light point
    vec3 ld    = Lpos - hp;
    float dist2 = dot(ld, ld);
    float dist  = sqrt(dist2);

    // 2) The area of the rectangle is just .x * .y
    //    The normal is rotated from the local (0,1,0) by u_lightRot.
    float area  = u_lightSize.x * u_lightSize.y;

    // 3) The light's normal after rotation:
    mat3 lRot = buildLightRotation(u_lightRot);
    vec3 lightNormal = lRot * vec3(0.0, 1.0, 0.0);

    // 4) Evaluate the geometric term for sampling
    float NdotL_light = max(dot(normalize(ld), lightNormal), 0.0);
    if(NdotL_light > 0.0){
        // dist2 / (NdotL_light * area)
        return dist2/(NdotL_light * area);
    }
    return 0.0;
}

vec3 areaLightEmission(vec3 Lpos, vec3 hp){
    // You can do a falloff if you want, or keep it constant:
    return u_lightColor * u_lightIntensity;
}

vec3 sampleAreaLight(inout uvec4 seed){
    // 1) Sample random in [0..1]
    float r1 = random(seed);
    float r2 = random(seed);

    // 2) Compute local coordinates in the rectangle's local plane
    //    We assume the rectangle is local XY or XZ. In this code, it's effectively:
    //    width along X, length along Z (like the original code).
    //    That was: (x, 0, z). Let’s keep that approach but define an offset along XZ.
    //    We can also place the rectangle in XY or XZ, but let's be consistent
    //    with how the PDF was originally done. The code used: (x, 0, z).
    vec3 localPos = vec3(
        (r1 - 0.5)*u_lightSize.x, 
         0.0,
        (r2 - 0.5)*u_lightSize.y
    );

    // 3) Rotate that localPos by the light rotation
    mat3 lRot = buildLightRotation(u_lightRot);
    vec3 rotatedLocal = lRot * localPos;

    // 4) Translate by the light's world position
    vec3 pos = u_lightPos + rotatedLocal;
    return pos;
}

// --------------------------------------------------------------------------------------
// DEPTH OF FIELD + LENS UTILS
// --------------------------------------------------------------------------------------
vec2 sampleDisk(inout uvec4 seed){
    float r0   = random(seed);
    float r1   = random(seed);
    float rad  = sqrt(r0);
    float theta= 2.0*M_PI*r1;
    return vec2(rad*cos(theta), rad*sin(theta));
}

// Radial lens distortion function
vec2 distortUV(vec2 uv, float k1, float k2){
    float r2 = dot(uv, uv);
    float f  = 1.0 + k1*r2 + k2*(r2*r2);
    return uv * f;
}

// --------------------------------------------------------------------------------------
// VOLUME FUNCTIONS
// --------------------------------------------------------------------------------------

// 1) Check if a ray intersects the volume bounding box.
bool intersectsVolumeBBox(vec3 ro, vec3 rd, out float tmin, out float tmax){
    vec3 invR = vec3(1.0/rd.x, 1.0/rd.y, 1.0/rd.z);
    vec3 t0s = (u_volumeMin - ro)*invR;
    vec3 t1s = (u_volumeMax - ro)*invR;

    vec3 tsmaller = min(t0s, t1s);
    vec3 tbigger  = max(t0s, t1s);

    tmin = max(tsmaller.x, max(tsmaller.y, tsmaller.z));
    tmax = min(tbigger.x,  min(tbigger.y,  tbigger.z));
    return (tmax > max(tmin, 0.0));
}

// 2) Sample distance to the next scattering event (homogeneous medium).
float sampleDistance(inout uvec4 seed, float sigma_t){
    float xi = random(seed);
    return -log(xi)/sigma_t;
}

// 3) Henyey-Greenstein phase function sampling
vec3 samplePhaseHenyeyGreenstein(vec3 w, float g, inout uvec4 seed){
    float xi1 = random(seed);
    float xi2 = random(seed);

    float cosTheta = 0.0;
    if(abs(g) < 1e-3){
        cosTheta = 1.0 - 2.0*xi1;
    } else {
        float tmp = (1.0 - g*g)/(1.0 - g + 2.0*g*xi1);
        cosTheta = (1.0 + g*g - tmp*tmp)/(2.0*g);
    }

    float sinTheta = sqrt(max(0.0, 1.0 - cosTheta*cosTheta));
    float phi      = 2.0*M_PI * xi2;

    // Build local frame
    vec3 t, b;
    buildTangentFrame(w, t, b);

    float cp = cos(phi);
    float sp = sin(phi);

    // direction in local spherical coords
    vec3 dLocal = vec3(cp*sinTheta, sp*sinTheta, cosTheta);
    return normalize(dLocal.x*t + dLocal.y*b + dLocal.z*w);
}

// 4) Evaluate the transmittance
float transmittance(float sigma_t, float dist){
    return exp(-sigma_t*dist);
}

// --------------------------------------------------------------------------------------
// PATH TRACING WITH VOLUME
// --------------------------------------------------------------------------------------
struct MediumInteraction {
    bool  happened;
    vec3  position;
    float distTraveled;
};

MediumInteraction sampleVolumeInteraction(vec3 ro, vec3 rd, inout uvec4 seed){
    MediumInteraction mi;
    mi.happened     = false;
    mi.position     = vec3(0.0);
    mi.distTraveled = 0.0;

    if(!u_enableVolume) {
        return mi; 
    }

    float tmin, tmax;
    bool intersects = intersectsVolumeBBox(ro, rd, tmin, tmax);
    if(!intersects){
        return mi; 
    }

    float tstart = max(tmin, 0.0);
    vec3 pStart = ro + rd*tstart;

    float sigma_t = u_volumeSigmaA + u_volumeSigmaS;
    float distSample = sampleDistance(seed, sigma_t);

    if(distSample < (tmax - tstart)){
        mi.happened     = true;
        mi.distTraveled = distSample;
        mi.position     = pStart + rd*distSample;
    }

    return mi;
}

bool traceNextEvent(
    vec3 ro,
    vec3 rd,
    inout uvec4 seed,
    out SceneHit surfaceHit,
    out MediumInteraction mediumHit,
    out float travelDist
){
    surfaceHit = rayMarch(ro, rd);
    mediumHit  = sampleVolumeInteraction(ro, rd, seed);

    if(!surfaceHit.hit && !mediumHit.happened){
        travelDist = 50.0; 
        return false;
    }

    if(mediumHit.happened){
        vec3 delta = mediumHit.position - ro;
        float distVolume = length(delta);

        if(surfaceHit.hit){
            vec3 surfDelta = surfaceHit.pos - ro;
            float distSurf = length(surfDelta);
            if(distVolume < distSurf){
                travelDist = distVolume;
                surfaceHit.hit = false; 
                return true;
            } else {
                mediumHit.happened = false;
                travelDist = distSurf;
                return true;
            }
        } else {
            travelDist = distVolume;
            return true;
        }
    } else {
        if(surfaceHit.hit){
            vec3 delta = surfaceHit.pos - ro;
            float distSurf = length(delta);
            travelDist = distSurf;
            return true;
        }
    }

    return false;
}

vec3 traceRay(inout uvec4 seed, vec3 ro, vec3 rd){
    vec3 L  = vec3(0.0);
    vec3 tp = vec3(1.0);

    float sigmaA = u_volumeSigmaA;
    float sigmaS = u_volumeSigmaS;
    float sigmaT = sigmaA + sigmaS;

    for(int bounce=0; bounce<MAX_BOUNCES; bounce++){
        SceneHit   surfHit;
        MediumInteraction medHit;
        float travelDist = 0.0;
        bool foundSomething = traceNextEvent(ro, rd, seed, surfHit, medHit, travelDist);

        if(!foundSomething){
            // Example environment => can add something if desired
             L += (u_ambientLightColor * u_ambientLightIntensity) * tp;
            break;
        }

        if(u_enableVolume){
            float Tr = transmittance(sigmaT, travelDist);
            tp *= Tr;
        }

        if(medHit.happened){
            vec3 volEmis = u_volumeEmission;
            if(length(volEmis) > 0.0){
                L += tp * volEmis;
            }

            {
                vec3 lpos   = sampleAreaLight(seed);
                vec3 ldir   = normalize(lpos - medHit.position);
                float ldist = length(lpos - medHit.position);

                float T_toLight = 1.0;
                if(u_enableVolume){
                    SceneHit sh = rayMarch(medHit.position + ldir*EPSILON, ldir);
                    float planeDist = 9999.0;
                    if(sh.hit){
                        planeDist = length(sh.pos - medHit.position);
                    }
                    if(planeDist < (ldist - EPSILON)){
                        T_toLight = 0.0; 
                    } else {
                        T_toLight = transmittance(sigmaT, ldist);
                    }
                } else {
                    SceneHit sh = rayMarch(medHit.position + ldir*EPSILON, ldir);
                    if(sh.hit){
                        float blockDist = length(sh.pos - medHit.position);
                        if(blockDist < (ldist - EPSILON)){
                            T_toLight = 0.0;
                        }
                    }
                }

                float dpl = areaLightPDF(lpos, medHit.position, vec3(0.0,1.0,0.0));
                vec3 w = -rd;
                vec3 pf = vec3(1.0/(4.0*M_PI)); // isotropic default

                if(abs(u_volumeG) > 1e-3){
                    float cosTheta = dot(w, ldir);
                    float g = u_volumeG;
                    float denom = 1.0 + g*g - 2.0*g*cosTheta;
                    pf = vec3((1.0 - g*g)/(4.0*M_PI*pow(denom,1.5)));
                }

                if(dpl > 0.0 && T_toLight > 1e-8){
                    vec3 Le = areaLightEmission(lpos, medHit.position);
                    float pdf_phase = pf.x; 
                    float mis = dpl / (dpl + pdf_phase + 1e-8);
                    L += tp * sigmaS * pf * Le * T_toLight * mis / (dpl+1e-8);
                }
            }

            {
                vec3 newDir = samplePhaseHenyeyGreenstein(-rd, u_volumeG, seed);
                tp *= sigmaS * u_volumeAlbedo;

                float rrProb = 0.9;
                if(random(seed) > rrProb){
                    break;
                }
                tp /= rrProb;

                ro = medHit.position + newDir*EPSILON;
                rd = newDir;
            }
        }
        else {
            Material mat = getMaterial(surfHit.id, surfHit.blend);
            if(length(mat.emission)>0.0){
                L += tp*mat.emission;
                break;
            }

            {
                vec3 lpos   = sampleAreaLight(seed);
                vec3 ldir   = normalize(lpos - surfHit.pos);
                float ldist = length(lpos - surfHit.pos);
                SceneHit sh = rayMarch(surfHit.pos + surfHit.normal*EPSILON, ldir);
                bool unsh   = (!sh.hit || length(sh.pos - surfHit.pos) > (ldist - EPSILON));

                float dpl   = areaLightPDF(lpos, surfHit.pos, surfHit.normal);
                float dpb;
                vec3 bsdfVal= evalBSDF(mat, surfHit.normal, -rd, ldir, dpb);
                float NdotL = max(dot(surfHit.normal, ldir), 0.0);

                float T_vol = 1.0;
                if(u_enableVolume && unsh){
                    float tminBB, tmaxBB;
                    bool volInt = intersectsVolumeBBox(surfHit.pos + surfHit.normal*EPSILON, ldir, tminBB, tmaxBB);
                    if(volInt){
                        float distLight = length(lpos - surfHit.pos);
                        float entryT = max(tminBB, 0.0);
                        float exitT  = tmaxBB;

                        if(exitT > entryT) {
                            float segLength = min(distLight, exitT) - entryT;
                            T_vol = exp(-sigmaT*segLength);
                        }
                    }
                } else {
                    if(unsh){
                        // no additional volume block
                    }
                }

                if(unsh && NdotL>0.0 && dpl>0.0 && T_vol>1e-8){
                    vec3 Le = areaLightEmission(lpos, surfHit.pos);
                    float misw = (dpl+dpb>0.0)? dpl/(dpl+dpb):0.0;
                    L += tp * Le * bsdfVal * (NdotL * T_vol/(dpl+1e-8)) * misw;
                }
            }

            {
                vec3 ndir;
                float clobe = random(seed);
                float diffW = (1.0 - mat.metalness)*(1.0 - mat.transmission) + mat.subsurface;
                bool pickDiffuse = (clobe<0.5 && diffW>0.0);

                if(pickDiffuse){
                    float r1 = random(seed);
                    float r2 = random(seed);
                    ndir = sampleHemisphereCosine(surfHit.normal, r1, r2);
                } else {
                    float r1 = random(seed);
                    float r2 = random(seed);
                    vec3 H = sampleGGXHemisphere(surfHit.normal, mat.roughness, r1, r2);
                    ndir    = reflect(-rd, H);
                }

                float npdf;
                vec3 be = evalBSDF(mat, surfHit.normal, -rd, ndir, npdf);
                float NdotNext = max(dot(surfHit.normal, ndir), 0.0);
                if(npdf<1e-7 || NdotNext<EPSILON){
                    break;
                }

                float rrProb = 0.9;
                if(random(seed) > rrProb){
                    break;
                }
                be /= rrProb;

                tp *= be*(NdotNext/npdf);

                ro = surfHit.pos + surfHit.normal*EPSILON;
                rd = ndir;
            }

            if(dot(tp, tp) > 10000.0){
                break;
            }
        }
    }

    return min(L, vec3(20.0));
}

// --------------------------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------------------------
void main()
{
    vec4 sb  = u_randomSeed + vec4(v_uv, float(u_frameCount), u_time);
    uvec4 seed = seedFromVec4(sb);

    float aspect = u_resolution.x / u_resolution.y;
    mat3 cam     = calcCameraMatrix(u_cameraPos, camTarget, camUp);
    float fs     = tan((u_cameraFov * M_PI / 180.0)*0.5);

    float rx = random(seed) - 0.5;
    float ry = random(seed) - 0.5;
    vec2 uvCenter = vec2(v_uv.x + rx*(1.0/u_resolution.x),
                         v_uv.y + ry*(1.0/u_resolution.y));
    vec2 uv = uvCenter * 2.0 - 1.0;
    uv.x *= aspect;

    float halfCA = 0.5 * u_chromaticAberration;
    float rColor, gColor, bColor;

    // --- RED ---
    {
        vec2 uvR = distortUV(uv, u_lensDistortionK.x + halfCA, 
                                 u_lensDistortionK.y + halfCA);
        vec3 rdLocal = normalize(vec3(uvR.x*fs, uvR.y*fs, 1.0));
        rdLocal = rotationX(u_cameraRot.x)*rotationY(u_cameraRot.y)*rotationZ(u_cameraRot.z)*rdLocal;
        vec3 rd = normalize(cam * rdLocal);
        vec3 ro = u_cameraPos;

        float lensRadius = u_cameraAperture*0.5;
        vec2 diskSample = sampleDisk(seed)*lensRadius;
        vec3 lensOffset = cam[0]*diskSample.x + cam[1]*diskSample.y;
        ro += lensOffset;

        float denom = dot(rd, cam[2]);
        float tFocus = (denom>0.0) ? (u_cameraFocusDistance / denom) : u_cameraFocusDistance;
        vec3 focusPoint = u_cameraPos + rd*tFocus;
        rd = normalize(focusPoint - ro);

        rColor = traceRay(seed, ro, rd).r; 
    }

    // --- GREEN ---
    {
        vec2 uvG = distortUV(uv, u_lensDistortionK.x, 
                                 u_lensDistortionK.y);
        vec3 rdLocal = normalize(vec3(uvG.x*fs, uvG.y*fs, 1.0));
        rdLocal = rotationX(u_cameraRot.x)*rotationY(u_cameraRot.y)*rotationZ(u_cameraRot.z)*rdLocal;
        vec3 rd = normalize(cam * rdLocal);
        vec3 ro = u_cameraPos;

        float lensRadius = u_cameraAperture*0.5;
        vec2 diskSample = sampleDisk(seed)*lensRadius;
        vec3 lensOffset = cam[0]*diskSample.x + cam[1]*diskSample.y;
        ro += lensOffset;

        float denom = dot(rd, cam[2]);
        float tFocus = (denom>0.0) ? (u_cameraFocusDistance / denom) : u_cameraFocusDistance;
        vec3 focusPoint = u_cameraPos + rd*tFocus;
        rd = normalize(focusPoint - ro);

        gColor = traceRay(seed, ro, rd).g; 
    }

    // --- BLUE ---
    {
        vec2 uvB = distortUV(uv, u_lensDistortionK.x - halfCA, 
                                 u_lensDistortionK.y - halfCA);
        vec3 rdLocal = normalize(vec3(uvB.x*fs, uvB.y*fs, 1.0));
        rdLocal = rotationX(u_cameraRot.x)*rotationY(u_cameraRot.y)*rotationZ(u_cameraRot.z)*rdLocal;
        vec3 rd = normalize(cam * rdLocal);
        vec3 ro = u_cameraPos;

        float lensRadius = u_cameraAperture*0.5;
        vec2 diskSample = sampleDisk(seed)*lensRadius;
        vec3 lensOffset = cam[0]*diskSample.x + cam[1]*diskSample.y;
        ro += lensOffset;

        float denom = dot(rd, cam[2]);
        float tFocus = (denom>0.0) ? (u_cameraFocusDistance / denom) : u_cameraFocusDistance;
        vec3 focusPoint = u_cameraPos + rd*tFocus;
        rd = normalize(focusPoint - ro);

        bColor = traceRay(seed, ro, rd).b;
    }

    vec3 finalColor = vec3(rColor, gColor, bColor);

    float distFromCenter = length(uv);
    float vig = 1.0 - clamp(distFromCenter * u_vignetteStrength, 0.0, 1.0);
    finalColor *= vig;

    outColor = vec4(finalColor, 1.0);
}


`;


//
// 3) Accumulate Fragment Shader
//
export const accumulateFS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform int u_frameCount;
uniform sampler2D u_prevAccum;
uniform sampler2D u_currentSample;

void main(){
    vec3 prevAccum = texture(u_prevAccum, v_uv).rgb;
    vec3 currentSample = texture(u_currentSample, v_uv).rgb;

    float f = float(u_frameCount);
    // Incremental accumulation
    vec3 accum = prevAccum + (currentSample - prevAccum) / f;

    outColor = vec4(accum, 1.0);
}
`;

//
// 4) Denoise Fragment Shader (NEW)
//    Simple bilateral-like filter with a 5x5 kernel.
//    Weighted by spatial distance + color distance to preserve edges.
//
export const denoiseFS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

// The accumulated color to be denoised
uniform sampler2D u_accum;

// The resolution of the texture (width, height)
uniform vec2 u_resolution;

// Control how strong the bilateral filter is in space and color
uniform float u_spatialSigma;  // e.g. 2.0
uniform float u_colorSigma;    // e.g. 0.1

// Gaussian function for distance
float gauss(float x, float sigma) {
    return exp(-0.5 * (x*x) / (sigma*sigma));
}

void main() {
    // Current pixel color
    vec3 centerColor = texture(u_accum, v_uv).rgb;

    // We use a 5x5 kernel => radius=2
    int radius = 2;

    float totalWeight = 0.0;
    vec3  sumColor   = vec3(0.0);

    for(int j=-radius; j<=radius; j++){
        for(int i=-radius; i<=radius; i++){
            vec2 offset = vec2(float(i), float(j)) / u_resolution;
            vec3 neighborColor = texture(u_accum, v_uv + offset).rgb;

            // Spatial weight
            float dist2 = float(i*i + j*j);
            float spatialWeight = gauss(sqrt(dist2), u_spatialSigma);

            // Color weight
            float colorDiff = length(neighborColor - centerColor);
            float colorWeight = gauss(colorDiff, u_colorSigma);

            float w = spatialWeight * colorWeight;
            sumColor    += neighborColor * w;
            totalWeight += w;
        }
    }

    if(totalWeight > 0.0) {
        sumColor /= totalWeight;
    }

    outColor = vec4(sumColor, 1.0);
}
`;

//
// 5) Display Fragment Shader
//
export const displayFS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_accum;

void main(){
    // Read the final texture (could be raw accumulated or denoised)
    vec3 accum = texture(u_accum, v_uv).rgb;

    // Gamma correction
    vec3 gammaColor = pow(accum, vec3(1.0/2.2));
    outColor = vec4(gammaColor, 1.0);
}
`;

//
// 6) Selection Fragment Shader
//
export const selectionFS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
    // ...logic de picking...
    outColor = vec4(1.0, 0.0, 0.0, 1.0);
}`;
