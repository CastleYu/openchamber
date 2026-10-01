export const PERMISSION_MODES = ['ask', 'safety', 'auto'];

export const isPermissionMode = (value) => PERMISSION_MODES.includes(value);

export const toPermissionMode = (value) => {
  if (isPermissionMode(value)) return value;
  if (value === true) return 'auto';
  if (value === false) return 'ask';
  return null;
};

export const isAutoAnsweringMode = (mode) => mode === 'safety' || mode === 'auto';
