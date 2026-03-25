export const shaderCompute = `
struct Uniforms {
    proj_inverse : mat4x4f,
    view_inverse : mat4x4f,
    screen_size  : vec4f
};

struct OrbitalElements {
    h   : f32,      // specific angular momentum
    n   : vec3f,    // line of nodes
    e   : f32,      // eccentricity
    a   : f32,      // semimajor axis
    p   : f32,      // semiparameter
    i   : f32,      // inclination
    an  : f32,      // right ascension of ascending node
    ap  : f32,      // argument of periapsis
    nu  : f32,      // true anomaly
};

struct Body {
    r : vec3f,
    v : vec3f,
};

@group(0) @binding(0) var canvas: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var envmap: texture_storage_2d<rgba32float, read>;

@group(1) @binding(0) var<uniform> uniforms : Uniforms;

const M_PI                              = 3.14159265358979323846;
const M_PI_2                            = 1.57079632679489661923;
const M_PI_4                            = 0.785398163397448309616;
const M_1_PI                            = 0.318309886183790671538;
const M_2_PI                            = 0.636619772367581343076;
const M_1_2PI                           = 0.159154943091895335768;
const M_1_4PI                           = 0.0795774715459476678844;
const error                             = 1.0e-6;
const infinity                          = 3.4e38;
const gravitational_constant            = 6.6743e-20;           // km^3 / (kg * s^2)
const blackhole_mass                    = 1.988416e38;          // kg
const blackhole_gravitational_parameter = gravitational_constant * blackhole_mass; // 1.32712849088e19
const light_speed                       = 299792.458;           // km/s
const light_speed_inv                   = 1.0 / light_speed;
const blackhole_schwarzschild_radius    = (2.0 * blackhole_gravitational_parameter) / (light_speed * light_speed);
const accretion_disk_start              = 2.0e8;
const accretion_disk_end                = 5.5e8;

/*
 * XYZ <-> IJK Coordinate system
 * I    - +X
 * J    - -Z
 * K    - +Y
 */
fn xyz2ijk(v : vec3f) -> vec3f {
    return vec3f(v.x, -v.z, v.y);
}

fn ijk2xyz(v : vec3f) -> vec3f {
    return vec3f(v.x, v.z, -v.y);
}

/* 
 * Convert from position and velocity to orbital elements in IJK coordinate system
 * r    - position
 * v    - velocity
 * mu   - gravitational parameter
 */
fn rv2coe(r : vec3f, v : vec3f, mu : f32) -> OrbitalElements {
    var rm = length(r);
    var vm = length(v);
    var oe : OrbitalElements;

    var hv = cross(r, v);
    oe.h = length(hv);
    oe.n = cross(vec3f(0, 0, 1), hv);
    var nm = length(oe.n);

    var c1 = (vm * vm) - (mu / rm);
    var rdotv = dot(r, v);
    var ev = (c1 * r - rdotv * v) / mu;
    oe.e = length(ev);

    var sme = vm * vm * 0.5 - (mu / rm);
    if (abs(sme) < 1.0 - error || abs(sme) > 1.0 + error) { // TODO should it be != 1.0?
        oe.a = -(mu / (2.0 * sme));
        oe.p = oe.a * (1.0 - oe.e * oe.e);
    } else {
        oe.a = infinity;
        oe.p = oe.h * oe.h / mu;
    }
    
    oe.i = acos(hv.z / oe.h);
    oe.an = acos(oe.n.x / nm);
    if (oe.n.y < 0.0) { 
        oe.an = 2.0 * M_PI - oe.an;
    }

    oe.ap = acos(dot(oe.n, ev) / (nm * oe.e));
    if (ev.z < 0.0) { 
        oe.ap = 2.0 * M_PI - oe.ap;
    }

    oe.nu = acos(dot(ev, r) / (oe.e * rm));
    if (dot(r, v) < 0.0) { 
        oe.nu = 2.0 * M_PI - oe.nu;
    }

    // TODO special cases

    return oe;
}

fn coe2rv(orbit : OrbitalElements, mu : f32) -> Body {
    var oe = orbit;
    /*
    if (abs(oe.i) < error) { 
        if (abs(oe.e) < error) {    // Circular equatorial
            oe.an = 0.0;
            oe.ap = 0.0;
            oe.nu = 1.0; // TODO true longitude
        }
        else {                      // Elliptical equatorial
            oe.an = 0.0;
            oe.ap = 1.0; // TODO
        }
    }                               // TODO Circular inclined
    */
    var body : Body;
    let cosnu = cos(oe.nu);
    let sinnu = sin(oe.nu);
    let temp = oe.p / (1.0 + oe.e * cosnu);
    body.r.x = temp * cosnu;
    body.r.y = temp * sinnu;
    body.r.z = 0.0;

    let root = sqrt(mu / oe.p);
    body.v.x = root * -sinnu;
    body.v.y = root * (oe.e + cosnu);
    body.v.z = 0.0;

    var matrix_ijkpqw : mat3x3f;
    let cosan = cos(oe.an);
    let sinan = sin(oe.an);
    let cosap = cos(oe.ap);
    let sinap = sin(oe.ap);
    let cosi  = cos(oe.i);
    let sini  = sin(oe.i);
    matrix_ijkpqw[0][0] =  cosan * cosap - sinan * sinap * cosi;
    matrix_ijkpqw[0][1] =  sinan * cosap + cosan * sinap * cosi;
    matrix_ijkpqw[0][2] =  sinap * sini;
    matrix_ijkpqw[1][0] = -cosan * sinap - sinan * cosap * cosi;
    matrix_ijkpqw[1][1] = -sinan * sinap + cosan * cosap * cosi;
    matrix_ijkpqw[1][2] =  cosap * sini;
    matrix_ijkpqw[2][0] =  sinan * sini;
    matrix_ijkpqw[2][1] = -cosan * sini;
    matrix_ijkpqw[2][2] =  cosi;

    body.r = matrix_ijkpqw * body.r;
    body.v = matrix_ijkpqw * body.v;
    return body;
}

fn kepler_coe(r : vec3f, v : vec3f, deltatime : f32) -> Body {
    return Body(vec3f(0.0), vec3f(0.0)); // TODO
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let pixel_center = vec2f(id.xy) + vec2f(0.5, 0.5);
    let s = (pixel_center / uniforms.screen_size.xy) * 2.0 - 1.0;

    var offset    =  uniforms.proj_inverse * vec4f(s.x, s.y, 1, 1);
    var position  = (uniforms.view_inverse * vec4f(0, 0, 0, 1)).xyz;
    var direction = (uniforms.view_inverse * vec4f(normalize(offset.xyz), 0)).xyz;
    var velocity  = direction * light_speed;

    var color = vec4f(0.0, 0.0, 0.0, 1.0);
    // Check camera is facing towards black hole to avoid mirroring due to hyperbolic trajectories
    // TODO causes clipping between hemispheres
    if (dot(direction, -position) > 0.0) {
        var orbit = rv2coe(xyz2ijk(position), xyz2ijk(velocity), blackhole_gravitational_parameter);
        
        var radius_ascending_node  = orbit.p / (1.0 + orbit.e * cos(orbit.ap));
        var radius_descending_node = orbit.p / (1.0 - orbit.e * cos(orbit.ap));

        if (radius_ascending_node > accretion_disk_start && radius_ascending_node < accretion_disk_end) {
            color += vec4f(0.95, 0.8, 0.5, 1.0);
        }
        if (radius_descending_node > accretion_disk_start && radius_descending_node < accretion_disk_end) {
            color += vec4f(0.95, 0.8, 0.5, 1.0);
        }

        orbit.nu = infinity;
        var body = coe2rv(orbit, blackhole_gravitational_parameter);
        direction = ijk2xyz(body.v) * light_speed_inv;
    }

    var uv : vec2f;
    uv.x = (1.0 + atan2(direction.x, -direction.z) * M_1_PI) * 0.5;
    uv.y = acos(direction.y) * M_1_PI;
    color += textureLoad(envmap, vec2i(i32(uv.x * 8192), i32(uv.y * 4096)));

    /*if (/*orbit.e < 1.0*/ -orbit.a * (orbit.e - 1.0) < blackhole_schwarzschild_radius) {
        color = vec4f(0.0, 0.0, 0.0, 1.0);
    }*/

    textureStore(canvas, id.xy, color);
}
`