// Soft, contact-hardening shadows for the key light, as under a hall full of large overhead
// luminaires: where a part touches the surface (a mover on the belt, a foot on the floor, a feeder
// on the deck) the shadow is dark and crisp; the further the occluder is above the receiver, the
// wider the penumbra and the lighter the shadow, because a high gantry beam hides only a few of
// the many lamps. Frame shadows across the decks then stay short, soft and faint instead of hard,
// dark "sun" stripes.
//
// The renderer uses the basic (unfiltered depth) shadow map, and this replaces its lookup with a
// percentage-closer soft shadow: a blocker search over the largest penumbra gives the mean
// occluder depth, the penumbra follows from it, and a disc of depth compares filters it. A
// receiver-plane depth bias (from the screen derivatives of the shadow coordinate) keeps the wide
// filter from shadowing a slanted surface with itself.
import * as THREE from 'three';

/** Shadow camera depth range (m), fixed in Stage. */
export const SHADOW_NEAR = 1;
export const SHADOW_FAR = 15;
/** Height of the key's shadow camera over its width (Stage). */
export const FRUSTUM_ASPECT = 0.82;
/** Penumbra width per metre between occluder and receiver (the lamps' apparent size). */
export const PENUMBRA_PER_M = 0.16;
/** Occluder distance (m) beyond which the penumbra stops growing. */
const MAX_DISTANCE = 0.45;
/** Shadow strength at the contact, and what is left of it for an occluder FADE_FAR above. */
const FADE_NEAR = 0.02;
const FADE_FAR = 0.7;
const FAR_STRENGTH = 0.32;
const BLOCKER_SAMPLES = 12;
const FILTER_SAMPLES = 20;

/**
 * `shadow.radius` for the key light: the penumbra in shadow-map UV per unit of shadow depth, for
 * a shadow camera `width` metres across.
 */
export function penumbraScale(width: number): number {
  return (PENUMBRA_PER_M * (SHADOW_FAR - SHADOW_NEAR)) / width;
}

const f = (x: number) => x.toFixed(6);
const DEPTH_RANGE = SHADOW_FAR - SHADOW_NEAR;

const SOFT = /* glsl */ `
	float softShadowNoise( vec2 p ) {
		return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
	}

	vec2 softShadowDisc( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float theta = float( i ) * 2.399963229728653 + phi;
		return vec2( cos( theta ), sin( theta ) ) * r;
	}

	// shadowRadius: penumbra in UV per unit of depth (see softshadow.ts).
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;

		// Receiver plane: depth change per UV, from the screen derivatives (before any branch).
		vec3 dx = dFdx( shadowCoord.xyz );
		vec3 dy = dFdy( shadowCoord.xyz );
		float det = dx.x * dy.y - dx.y * dy.x;
		vec2 slope = abs( det ) > 1e-12 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
		// A face the key grazes has a steep slope (tan(elevation) * width / depth range, a few
		// units); silhouettes give absurd ones: clamp those (the normal bias covers the rest).
		slope = clamp( slope, vec2( -6.0 ), vec2( 6.0 ) );

		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		if ( inFrustum && shadowCoord.z <= 1.0 ) {

			vec2 texel = 1.0 / shadowMapSize;
			float phi = softShadowNoise( gl_FragCoord.xy ) * PI2;
			// Within one texel of the map a sloped receiver's depth varies by slope * texel.
			float zR = shadowCoord.z - dot( abs( slope ), texel ) - ${f(0.0007 / DEPTH_RANGE)};
			float maxDepth = ${f(MAX_DISTANCE / DEPTH_RANGE)};
			// The shadow camera is less tall than wide: a round penumbra spans more of v.
			vec2 scale = vec2( shadowRadius, shadowRadius / ${f(FRUSTUM_ASPECT)} );
			vec2 search = max( scale * maxDepth * 0.5, 2.0 * texel );

			float blockers = 0.0;
			float blockerDepth = 0.0;
			for ( int i = 0; i < ${BLOCKER_SAMPLES}; i ++ ) {
				vec2 o = softShadowDisc( i, ${BLOCKER_SAMPLES}, phi ) * search;
				float d = texture2D( shadowMap, shadowCoord.xy + o ).r;
				if ( d < zR + dot( slope, o ) ) {
					blockers += 1.0;
					blockerDepth += d;
				}
			}

			if ( blockers > 0.0 ) {

				float distance = min( zR - blockerDepth / blockers, maxDepth );
				vec2 radius = max( scale * distance * 0.5, 1.25 * texel );
				float lit = 0.0;
				for ( int i = 0; i < ${FILTER_SAMPLES}; i ++ ) {
					vec2 o = softShadowDisc( i, ${FILTER_SAMPLES}, phi + 1.3 ) * radius;
					lit += step( zR + dot( slope, o ), texture2D( shadowMap, shadowCoord.xy + o ).r );
				}
				shadow = lit / ${FILTER_SAMPLES}.0;
				// A far occluder hides only some of the lamps.
				shadowIntensity *= mix( 1.0, ${f(FAR_STRENGTH)}, smoothstep( ${f(FADE_NEAR / DEPTH_RANGE)}, ${f(FADE_FAR / DEPTH_RANGE)}, distance ) );

			}

		}

		return mix( 1.0, shadow, shadowIntensity );

	}
`;

// Replace the basic (hard) lookup; the PCF and VSM branches stay as they are.
const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
if (!chunk.includes('softShadowDisc')) {
  // The basic lookup is the last sampler2D getShadow (after the VSM one). The function has
  // #ifdef blocks of its own: it ends at the closing brace after its return.
  const fn = chunk.lastIndexOf('float getShadow( sampler2D shadowMap');
  const ret = chunk.indexOf('return mix( 1.0, shadow, shadowIntensity );', fn);
  const close = chunk.indexOf('}', ret);
  if (fn < 0 || ret < 0 || close < 0 || !chunk.slice(0, fn).includes('SHADOWMAP_TYPE_VSM'))
    throw new Error('shadowmap_pars_fragment: basic getShadow not found');
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, fn) + SOFT + chunk.slice(close + 1);
}
