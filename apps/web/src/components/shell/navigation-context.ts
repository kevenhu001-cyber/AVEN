'use client';

import { createContext, useContext } from 'react';

/** The chat header and the shared mobile shell open the same navigation drawer. */
export const ShellNavigationContext = createContext<(() => void) | undefined>(undefined);
export const useShellNavigation = () => useContext(ShellNavigationContext);
