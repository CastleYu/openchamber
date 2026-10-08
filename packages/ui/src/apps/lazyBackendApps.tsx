import { lazy } from 'react';

// BackendGate determines the family before React evaluates these application modules.
export const App = lazy(() => import('../App'));
export const MobileApp = lazy(() => import('./MobileApp').then((module) => ({ default: module.MobileApp })));
export const ElectronMiniChatApp = lazy(() => import('./ElectronMiniChatApp').then((module) => ({ default: module.ElectronMiniChatApp })));
