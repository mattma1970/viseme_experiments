/**
 * Type declarations for the vendored HeadTTS utils
 * (met4citizen/HeadTTS v1.3.0, MIT — see LICENSE in this directory).
 */

export function isNode(): boolean;
export function isModuleWebWorkers(): boolean;
export function isWebGPU(): boolean;
export const traceMask: {
  connection: number;
  messages: number;
  events: number;
  g2p: number;
  language: number;
};
