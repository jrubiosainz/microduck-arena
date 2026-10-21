// The stadium's colours, and how its scenery is lit.
//
// Two kinds. The scenery boxes' colours are LINEAR floats, as MJCF rgba is
// read: those are the triples here. The crowd's shells and paint are the
// design tokens, sRGB hex.
// Everything is a flat Lambert left out of the tone mapping: the arena's ACES
// curve, right for its metallic racers, pulls a VHS cyan down to teal. And
// mixed stronger: the scenery's paint was chosen under a 2.2 sun over a 0.9
// ambient, and the arena lights its racers with a 1.7 key over 0.3 — a top
// face came out at nine tenths of its paint there, at half here, and orange at
// half is brown.

import { Color, MeshLambertMaterial } from "three";

export const PALETTE = {
  rail: [0.184, 0.941, 0.902],
  post: [0.98, 0.973, 0.949],
  cone: [1, 0.478, 0.184],
  stand: [0.227, 0.227, 0.275],
  paper: [0.98, 0.973, 0.949],
  ink: [0.063, 0.063, 0.094],
  // The crowd's duck: Pollen orange face, beak yellow feet, warm paper frame,
  // ink for what little of the mechanics shows.
  face: 0xff7a2f,
  feet: 0xffd23f,
  frame: 0xf2ecdd,
  dark: 0x101018,
};

// The shells, seat after seat: cream, sky, cyan VHS, magenta VHS, beak yellow.
export const SHELLS = [0xf7e6cb, 0x8fb8dc, 0x2ff0e6, 0xff2fa8, 0xffd23f];

export const GAIN = 1.8;

/** A palette colour mixed for the arena's light: a triple is linear, a hex is sRGB. */
export const colour = (paint) =>
  (Array.isArray(paint) ? new Color().setRGB(...paint) : new Color(paint)).multiplyScalar(GAIN);

/** Flat paint, in one of the palette's colours. */
export const flat = (paint) =>
  new MeshLambertMaterial({ color: colour(paint), toneMapped: false });
