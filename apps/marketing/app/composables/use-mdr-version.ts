export interface MdrVersionState {
  readonly version: Ref<string>;
}

const VERSION = '0.0.0';

export function useMdrVersion(): MdrVersionState {
  return { version: ref(VERSION) };
}
