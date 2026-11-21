// Contact occlusion for every PBR material: faces that don't look up get less ambient light
// close to the floor and just above the table tops, as where cabinets, legs, feeders and bins
// stand. It grounds things that would otherwise float in the room's flat ambient light, and costs
// a few instructions per pixel (no extra pass). The horizontal receivers (floor, deck) have baked
// occlusion maps instead (occlusion.ts).
import * as THREE from 'three';
import { BELT_Y, TABLE } from './build';

/**
 * How much of the room probe's light reaches diffuse and glossy surfaces. The probe is bright
 * (lit walls and ceiling strips) so metals reflect a lit room and show the strips as streaks,
 * but as diffuse fill that much would flatten everything: the key light has to carry the shape.
 */
const AMBIENT_DIFFUSE = 0.62;
const AMBIENT_SPECULAR = 1.0;
/** Share of the baked contact occlusion (floor, deck) that also dims the direct light. */
const AO_DIRECT = 0.6;
/**
 * The key light stands for the hall's overhead lamps, which are also the brightest part of the
 * probe: where the key is shadowed, part of the probe's light is blocked too. Without this, a
 * shadow on brushed steel (all reflection, no diffuse) hardly shows.
 */
const SHADOW_DIFFUSE = 0.35;
const SHADOW_SPECULAR = 0.55;

const VERT_DECL = '#include <common>\nvarying vec3 vContactWorld;';
const VERT_BODY = `#include <worldpos_vertex>
	vec4 contactWorld = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		contactWorld = batchingMatrix * contactWorld;
	#endif
	#ifdef USE_INSTANCING
		contactWorld = instanceMatrix * contactWorld;
	#endif
	vContactWorld = ( modelMatrix * contactWorld ).xyz;`;
const FRAG_DECL = '#include <common>\nvarying vec3 vContactWorld;';
const FRAG_BODY = `#include <aomap_fragment>
	{
		vec3 contactN = inverseTransformDirection( normal, viewMatrix );
		float sideways = 1.0 - clamp( contactN.y, 0.0, 1.0 );
		float h = vContactWorld.y;
		float floorOcc = 1.0 - 0.6 * ( 1.0 - smoothstep( 0.0, 0.28, h ) );
		vec2 plan = abs( vContactWorld.xz );
		float onBench = step( plan.x, 2.72 ) * step( plan.y, 1.45 ) * step( 0.15, plan.y );
		float dh = h - ${(BELT_Y + TABLE).toFixed(4)};
		float deckOcc = 1.0 - onBench * 0.45 * step( 0.0, dh ) * ( 1.0 - smoothstep( 0.0, 0.075, dh ) );
		float occ = mix( 1.0, floorOcc * deckOcc, sideways );
		reflectedLight.indirectDiffuse *= mix( 1.0, keyShadow, ${SHADOW_DIFFUSE.toFixed(3)} );
		reflectedLight.indirectSpecular *= mix( 1.0, keyShadow, ${SHADOW_SPECULAR.toFixed(3)} );
		reflectedLight.indirectDiffuse *= occ * ${AMBIENT_DIFFUSE.toFixed(3)};
		reflectedLight.indirectSpecular *= mix( 1.0, occ, 0.7 ) * ${AMBIENT_SPECULAR.toFixed(3)};
		#ifdef USE_AOMAP
			// Under a bench the hall's many lamps are mostly hidden, not just the sky.
			reflectedLight.directDiffuse *= mix( 1.0, ambientOcclusion, ${AO_DIRECT.toFixed(3)} );
		#endif
	}`;

// Keep the key light's shadow term (the one shadowed directional light) for the code above.
if (!THREE.ShaderChunk.lights_fragment_begin.includes('keyShadow')) {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const shadowed = /directLight\.color \*= (\( directLight\.visible && receiveShadow \) \? getShadow\( directionalShadowMap\[ i \][^;]*;)/;
  if (!shadowed.test(chunk)) throw new Error('lights_fragment_begin: directional shadow not found');
  THREE.ShaderChunk.lights_fragment_begin = 'float keyShadow = 1.0;\n' + chunk.replace(shadowed, 'keyShadow = $1\n\t\tdirectLight.color *= keyShadow;');
}

for (const lib of [THREE.ShaderLib.standard, THREE.ShaderLib.physical]) {
  if (lib.vertexShader.includes('vContactWorld')) continue;
  lib.vertexShader = lib.vertexShader.replace('#include <common>', VERT_DECL).replace('#include <worldpos_vertex>', VERT_BODY);
  lib.fragmentShader = lib.fragmentShader.replace('#include <common>', FRAG_DECL).replace('#include <aomap_fragment>', FRAG_BODY);
}
