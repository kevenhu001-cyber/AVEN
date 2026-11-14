'use client';

import { createContext, useContext } from 'react';

/** The chat header and the shared mobile shell open the same navigation drawer. */
export const ShellNavigationContext = createContext<(() => void) | undefined>(undefined);
export const useShellNavigation = () => useContext(ShellNavigationContext);

export const ShellAppsContext = createContext<(() => void) | undefined>(undefined);
export const useShellApps = () => useContext(ShellAppsContext);

/** Opens the AVEN profile side panel from the chat header and the desktop rail. */
export const ShellProfileContext = createContext<(() => void) | undefined>(undefined);
export const useShellProfile = () => useContext(ShellProfileContext);
