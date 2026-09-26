declare global {
  interface Window {
    __OPENCHAMBER_CONNECTION__?: {
      status: 'connecting' | 'connected' | 'error' | 'disconnected';
      error?: string;
      cliAvailable?: boolean;
    };
    __OPENCHAMBER_VSCODE_SHIKI_THEMES__?: {
      light?: Record<string, unknown>;
      dark?: Record<string, unknown>;
    } | null;
  }
}

export {};
