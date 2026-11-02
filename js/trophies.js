/**
 * The trophy event: score more than 7,500 in a day and win a real trophy,
 * claimed by posting a screenshot of the winner screen in #guessle.
 *
 * It ran from 17 October to 2 November 2026 and is over. Nothing is awarded
 * any more; what remains is the record — trophies won during the event stay in
 * the cabinet, travel in save files, and can still be turned over in 3D.
 *
 * To run an event like it again, the full version (award, winner ceremony,
 * claim screen, goal line) is commit a9a3f48.
 */

import { STORES, read } from './profile.js';

export const EVENT = {
  started: '2026-10-17',
  ended: '2026-11-02',
  /** For copy: "17 Oct – 2 Nov". */
  span: '17 Oct – 2 Nov',
  /**
   * The two people who won, by the ID on their trophy. IDs only: the game runs
   * in each player's browser and never knew who anyone was, so there are no
   * names or scores to show — and none should be invented.
   */
  winners: [{ id: 1 }, { id: 2 }],
};

export function list() {
  return read(STORES.trophies, []);
}
