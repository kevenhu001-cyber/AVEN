/** Screen stack for the Halo personal app: Home → Profile / Chat, with push/pop direction. */
export type HaloScreen = 'home' | 'profile' | 'chat';

export type ScreenStack = {
  stack: HaloScreen[];
  direction: 'forward' | 'back' | 'none';
};

export const initialStack: ScreenStack = { stack: ['home'], direction: 'none' };

export function currentScreen(state: ScreenStack): HaloScreen {
  return state.stack[state.stack.length - 1] ?? 'home';
}

/** Push a screen. Re-pushing a screen already in the stack pops back to it instead of duplicating. */
export function pushScreen(state: ScreenStack, screen: HaloScreen): ScreenStack {
  if (currentScreen(state) === screen) return state;
  const existing = state.stack.indexOf(screen);
  if (existing >= 0) return { stack: state.stack.slice(0, existing + 1), direction: 'back' };
  return { stack: [...state.stack, screen], direction: 'forward' };
}

export function popScreen(state: ScreenStack): ScreenStack {
  if (state.stack.length <= 1) return state;
  return { stack: state.stack.slice(0, -1), direction: 'back' };
}

/**
 * Where a mounted screen sits relative to the visible one. Screens below the top slide
 * slightly left (parallax), screens not in the stack wait off-canvas to the right.
 */
export function screenPosition(
  state: ScreenStack,
  screen: HaloScreen,
): 'active' | 'behind' | 'ahead' {
  const index = state.stack.indexOf(screen);
  if (index === state.stack.length - 1) return 'active';
  if (index >= 0) return 'behind';
  return 'ahead';
}
