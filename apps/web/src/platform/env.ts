export const DEV_HOOKS: boolean = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';

export const DEBUG_REST_POSE: boolean = new URLSearchParams(location.search).has('rest');
