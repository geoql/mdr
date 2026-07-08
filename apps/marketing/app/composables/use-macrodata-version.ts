export interface MacrodataVersionState {
  readonly version: Ref<string>;
}

const VERSION = '0.3.0';

export function useMacrodataVersion(): MacrodataVersionState {
  return { version: ref(VERSION) };
}
